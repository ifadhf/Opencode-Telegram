import { Bot } from 'grammy'
import { OpenCodeClient } from './client.js'
import { StateManager } from '../state/manager.js'
import { PermissionHandler } from './permission.js'
import { MessageQueue } from '../bot/queue.js'
import { escapeMarkdown, splitMessage, stripAnsi } from '../utils/formatter.js'
import { getToolIcon, formatToolName, buildWorkingStatus } from '../utils/toolFormat.js'
import { renderQuestion } from './questionFormat.js'
import { QuestionRequest } from '../types/index.js'
import { getLogger } from '../utils/logger.js'

interface BusySessionInfo {
  chatId: number
  threadId: number
  sessionId: string
  anchorMessageId?: string
  processedPartIds: Set<string>
  processedStepFinishIds: Set<string>
  processingTools: Map<string, { partId: string; tool: string; title: string; startedAt: number }>
  startedAt: number
  lastActivityAt: number
  idleProcessing: boolean
  lastTodoHash: string
  lastWorkingStatus: string
  lastToolCall: string
  stepStartSeen: boolean
  currentStepTitle: string
}

interface TodoItem {
  content: string
  status: string
  priority: string
}

const SHOW_TOOL_CALLS = process.env.SHOW_TOOL_CALLS === 'true'
const SHOW_THINKING = process.env.SHOW_THINKING === 'true'
const SHOW_TOKENS = process.env.SHOW_TOKENS === 'true'
const COMPLETION_DEBOUNCE_MS = 5000

export class EventProcessor {
  private running = false
  private workingSessions = new Map<string, { chatId: number; threadId: number; messageId: number }>()
  private consecutiveErrors = 0
  private maxConsecutiveErrors = 10
  private busySessions = new Map<string, BusySessionInfo>()
  private sentQuestions = new Set<string>()
  private pendingCompletions = new Map<string, { debounceTimer: NodeJS.Timeout; chatId: number; threadId: number }>()
  private readonly SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000
  private readonly POLL_INTERVAL_MS = 3000
  private readonly TODO_POLL_INTERVAL_MS = 10000

  constructor(
    private client: OpenCodeClient,
    private bot: Bot,
    private stateManager: StateManager,
    private permissionHandler: PermissionHandler,
    private messageQueue: MessageQueue
  ) {}

  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    const log = getLogger()
    log.info('Event processor started (Polling mode)')

    let todoPollCounter = 0

    while (this.running) {
      try {
        await this.permissionHandler.checkPendingPermissions().catch(() => {})
        await this.checkPendingQuestions().catch(() => {})

        // Discover busy sessions via topic bindings
        const topicBindings = this.stateManager.getAllTopicBindings()
        for (const binding of topicBindings) {
          const { chatId, threadId, sessionId } = binding
          const isBusy = this.messageQueue.isBusy(chatId, threadId)

          if (isBusy && !this.busySessions.has(sessionId)) {
            try {
              const messages = await this.client.getMessages(sessionId, 50)
              const todos = await this.client.getSessionTodo(sessionId).catch(() => [])
              const lastUser = [...messages].reverse().find(m => m.role === 'user')
              this.busySessions.set(sessionId, {
                chatId,
                threadId,
                sessionId,
                anchorMessageId: lastUser?.id,
                processedPartIds: new Set(),
                processedStepFinishIds: new Set(),
                processingTools: new Map(),
                startedAt: Date.now(),
                lastActivityAt: Date.now(),
                idleProcessing: false,
                lastTodoHash: this.hashTodos(todos),
                lastWorkingStatus: '',
                lastToolCall: '',
                stepStartSeen: false,
                currentStepTitle: '',
              })
            } catch {
              // Ignore - will retry next poll
            }
          } else if (!isBusy) {
            this.busySessions.delete(sessionId)
          }
        }

        // Discover busy sessions via legacy chatId bindings (skip already tracked by topic)
        const chatIds = this.stateManager.getAllChatIds()
        for (const chatId of chatIds) {
          const sessionId = this.stateManager.getCurrentSession(chatId)
          if (!sessionId) continue
          if (this.busySessions.has(sessionId)) continue

          const isBusy = this.messageQueue.isBusy(chatId)

          if (isBusy && !this.busySessions.has(sessionId)) {
            try {
              const messages = await this.client.getMessages(sessionId, 50)
              const todos = await this.client.getSessionTodo(sessionId).catch(() => [])
              const lastUser = [...messages].reverse().find(m => m.role === 'user')
              this.busySessions.set(sessionId, {
                chatId,
                threadId: 0,
                sessionId,
                anchorMessageId: lastUser?.id,
                processedPartIds: new Set(),
                processedStepFinishIds: new Set(),
                processingTools: new Map(),
                startedAt: Date.now(),
                lastActivityAt: Date.now(),
                idleProcessing: false,
                lastTodoHash: this.hashTodos(todos),
                lastWorkingStatus: '',
                lastToolCall: '',
                stepStartSeen: false,
                currentStepTitle: '',
              })
            } catch {
              // Ignore - will retry next poll
            }
          } else if (!isBusy) {
            this.busySessions.delete(sessionId)
          }
        }

        todoPollCounter++

        const sessionsToProcess = [...this.busySessions.entries()]
        for (const [sessionId, busyInfo] of sessionsToProcess) {
          try {
            const messages = await this.client.getMessages(sessionId, 50)

            busyInfo.lastActivityAt = Date.now()

            // Only messages after the anchor (the prompt we just sent) are new
            const newMessages = this.messagesAfterAnchor(messages, busyInfo.anchorMessageId)

            // Relay newly finished parts before checking completion
            await this.processNewMessages(busyInfo.chatId, sessionId, newMessages, busyInfo)

            const last = messages[messages.length - 1]
            const lastIsNew = last && newMessages.some(m => m.id === last.id)

            if (lastIsNew && last.role === 'assistant' && (last.time?.completed || (last as any).finish)) {
              if (!this.pendingCompletions.has(sessionId)) {
                log.info('Detected session completion via polling', { sessionId, chatId: busyInfo.chatId, threadId: busyInfo.threadId })

                const debounceTimer = setTimeout(async () => {
                  this.pendingCompletions.delete(sessionId)
                  this.busySessions.delete(sessionId)
                  await this.processSessionIdle(sessionId, busyInfo.chatId, busyInfo.threadId)
                }, COMPLETION_DEBOUNCE_MS)

                this.pendingCompletions.set(sessionId, { debounceTimer, chatId: busyInfo.chatId, threadId: busyInfo.threadId })
              }
            } else {
              // Still working: keep the Telegram "typing…" indicator alive
              // (it auto-expires after ~5s; we poll every 3s) and refresh the
              // single status bubble in place from the messages we just fetched.
              await this.sendTyping(busyInfo.chatId, busyInfo.threadId)
              await this.updateWorkingStatus(busyInfo, messages)

              if (todoPollCounter >= Math.floor(this.TODO_POLL_INTERVAL_MS / this.POLL_INTERVAL_MS)) {
                await this.pollTodos(busyInfo)
              }
            }
          } catch (error) {
            log.warn('Failed to poll busy session', { sessionId, error: (error as Error).message })
            this.busySessions.delete(sessionId)
            this.messageQueue.setIdle(busyInfo.chatId, busyInfo.threadId)

            const pendingCompletion = this.pendingCompletions.get(sessionId)
            if (pendingCompletion) {
              clearTimeout(pendingCompletion.debounceTimer)
              this.pendingCompletions.delete(sessionId)
            }

            const working = this.workingSessions.get(sessionId)
            if (working) {
              await this.bot.api.editMessageText(
                working.chatId,
                working.messageId,
                '❌ Connection to OpenCode lost'
              ).catch(() => {})
              this.workingSessions.delete(sessionId)
            }
          }
        }

        if (todoPollCounter >= Math.floor(this.TODO_POLL_INTERVAL_MS / this.POLL_INTERVAL_MS)) {
          todoPollCounter = 0
        }

        for (const [sessionId, busyInfo] of [...this.busySessions.entries()]) {
          if (!this.messageQueue.isBusy(busyInfo.chatId, busyInfo.threadId)) {
            this.busySessions.delete(sessionId)
          }
        }

        for (const [sessionId, busyInfo] of [...this.busySessions.entries()]) {
          const age = Date.now() - busyInfo.startedAt
          const inactive = Date.now() - busyInfo.lastActivityAt
          if (age > this.SESSION_TIMEOUT_MS || inactive > this.SESSION_TIMEOUT_MS) {
            log.warn('Session timed out, forcing idle', { sessionId, age, inactive })
            this.busySessions.delete(sessionId)
            this.messageQueue.setIdle(busyInfo.chatId, busyInfo.threadId)

            const pendingCompletion = this.pendingCompletions.get(sessionId)
            if (pendingCompletion) {
              clearTimeout(pendingCompletion.debounceTimer)
              this.pendingCompletions.delete(sessionId)
            }

            const working = this.workingSessions.get(sessionId)
            if (working) {
              await this.bot.api.editMessageText(
                working.chatId,
                working.messageId,
                '⏰ Session timed out (4 hour limit)'
              ).catch(() => {})
              this.workingSessions.delete(sessionId)
            }

            await this.processSessionIdle(sessionId, busyInfo.chatId, busyInfo.threadId)
          }
        }

        for (const chatId of chatIds) {
          this.messageQueue.purgeStale(chatId)
        }
        for (const binding of topicBindings) {
          this.messageQueue.purgeStale(binding.chatId, binding.threadId)
        }

        this.consecutiveErrors = 0
        await new Promise(resolve => setTimeout(resolve, this.POLL_INTERVAL_MS))
      } catch (error) {
        this.consecutiveErrors++
        log.error('Polling error', { error: (error as Error).message, consecutiveErrors: this.consecutiveErrors })

        if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
          log.error('Too many consecutive errors, stopping event processor')
          this.running = false
          break
        }

        await new Promise(resolve => setTimeout(resolve, 5000))
      }
    }
  }

  private async pollTodos(busyInfo: BusySessionInfo): Promise<void> {
    try {
      const todos = await this.client.getSessionTodo(busyInfo.sessionId)
      const currentHash = this.hashTodos(todos)

      if (currentHash !== busyInfo.lastTodoHash && todos.length > 0) {
        busyInfo.lastTodoHash = currentHash
        await this.sendTodoUpdate(busyInfo.chatId, busyInfo.threadId, todos)
      }
    } catch {
      // Ignore todo poll errors
    }
  }

  // Refresh the single "working" status bubble in place from messages already
  // fetched this poll (no extra API call). Deduped so we skip no-op edits.
  private async updateWorkingStatus(busyInfo: BusySessionInfo, messages: any[]): Promise<void> {
    try {
      const latest = messages[messages.length - 1]
      if (!latest || latest.role !== 'assistant' || !latest.parts) return

      const activeTools: Array<{ tool: string; title: string }> = []
      let currentStep = ''

      for (const part of latest.parts) {
        if (part.type === 'step-start') {
          currentStep = (part as any).title || (part as any).label || ''
        }
        if (part.type === 'tool' && part.state?.status === 'running') {
          activeTools.push({
            tool: part.tool || 'unknown',
            title: stripAnsi(part.state?.title || ''),
          })
        }
      }

      const statusText = buildWorkingStatus(currentStep, activeTools)
      if (statusText && statusText !== busyInfo.lastWorkingStatus) {
        busyInfo.lastWorkingStatus = statusText
        busyInfo.currentStepTitle = currentStep

        // Edit the "⏳ …working" bubble itself in place (working.messageId),
        // which processSessionIdle later flips to "✅ Task completed!".
        const working = this.workingSessions.get(busyInfo.sessionId)
        if (working) {
          await this.bot.api.editMessageText(
            working.chatId,
            working.messageId,
            statusText,
            { parse_mode: 'Markdown' }
          ).catch(() => {})
        }
      }
    } catch {
      // Ignore working status poll errors
    }
  }

  private async sendTyping(chatId: number, threadId: number): Promise<void> {
    try {
      await this.bot.api.sendChatAction(
        chatId,
        'typing',
        threadId > 0 ? { message_thread_id: threadId } : {}
      )
    } catch {
      // Best-effort; the typing indicator is cosmetic
    }
  }

  private async sendTodoUpdate(chatId: number, threadId: number, todos: TodoItem[]): Promise<void> {
    const statusIcon: Record<string, string> = {
      completed: '✅', in_progress: '🔄', pending: '⬜', cancelled: '❌',
    }

    const pendingTodos = todos.filter(t => t.status !== 'completed' && t.status !== 'cancelled')
    if (pendingTodos.length === 0) return

    let message = `📋 *Todo List (${pendingTodos.length} remaining):*\n\n`
    for (const todo of todos.slice(0, 15)) {
      const icon = statusIcon[todo.status] || '⬜'
      const content = todo.content?.substring(0, 80) || ''
      message += `${icon} ${escapeMarkdown(content)}\n`
    }

    await this.sendWithRateLimit(chatId, threadId, message, { parse_mode: 'Markdown' })
  }

  private hashTodos(todos: TodoItem[]): string {
    return todos.map(t => `${t.status}:${t.content}`).join('|')
  }

  private async processSessionIdle(sessionId: string, chatId: number, threadId: number, statusText = '✅ Task completed!'): Promise<void> {
    const existingBusy = this.busySessions.get(sessionId)
    if (existingBusy?.idleProcessing) return
    if (existingBusy) {
      existingBusy.idleProcessing = true
    }

    this.pendingCompletions.delete(sessionId)

    const working = this.workingSessions.get(sessionId)
    if (working) {
      await this.bot.api.editMessageText(
        working.chatId,
        working.messageId,
        statusText
      ).catch(() => {})
      this.workingSessions.delete(sessionId)
    }

    this.messageQueue.setIdle(chatId, threadId)

    const sendOpts: any = {}
    if (threadId > 0) sendOpts.message_thread_id = threadId

    const next = this.messageQueue.dequeue(chatId, threadId)
    if (next) {
      this.messageQueue.setBusy(chatId, threadId)
      const selectedModel = this.stateManager.getCurrentModel(chatId)
      const selectedMode = this.stateManager.getCurrentMode(chatId)

      try {
        const workingMsg = await this.bot.api.sendMessage(chatId, '⏳ Processing next message...', sendOpts)
        this.setWorkingMessage(sessionId, chatId, workingMsg.message_id, threadId)

        await this.client.sendAsyncMessage(sessionId, next.text, {
          providerId: selectedModel?.providerId,
          modelId: selectedModel?.modelId,
          agent: selectedMode,
        })
        next.resolve()
      } catch (error) {
        getLogger().error('Failed to process queued message', { error: (error as Error).message })
        await this.bot.api.sendMessage(chatId, `❌ Error: ${(error as Error).message}`, sendOpts).catch(() => {})
        next.reject(error as Error)
        this.messageQueue.setIdle(chatId, threadId)
      }
    } else {
      await this.bot.api.sendMessage(chatId, '✅ *Selesai — menunggu input*', { ...sendOpts, parse_mode: 'Markdown' }).catch(() => {})
    }
  }

  private async processNewMessages(chatId: number, sessionId: string, messages: any[], busyInfo: BusySessionInfo): Promise<void> {
    // Only cancel a pending completion debounce if there is genuinely new
    // activity to process. Without this guard, every poll clears the pending
    // timer (even when nothing is new), so the completion block below resets a
    // fresh 5s timer every 3s poll and the debounce NEVER fires.
    const hasNewActivity = messages.some(msg =>
      msg.role === 'assistant' && msg.parts?.some((part: any) => {
        const partKey = part.id || `${msg.id}:${part.type}`
        if (part.type === 'tool') {
          const status = part.state?.status
          if (status === 'running') return !busyInfo.processingTools.has(partKey)
          if (status === 'completed' || status === 'error') return busyInfo.processingTools.has(partKey)
          return false
        }
        if (part.type === 'step-finish') {
          const stepId = part.id || `${msg.id}-${part.type}`
          return !busyInfo.processedStepFinishIds.has(stepId)
        }
        if (part.type === 'step-start') {
          const stepTitle = part.title || part.label || ''
          return !!stepTitle && stepTitle !== busyInfo.currentStepTitle
        }
        return !busyInfo.processedPartIds.has(partKey)
      })
    )

    if (hasNewActivity) {
      const pending = this.pendingCompletions.get(sessionId)
      if (pending) {
        clearTimeout(pending.debounceTimer)
        this.pendingCompletions.delete(sessionId)
      }
    }

    for (const msg of messages) {
      if (msg.role !== 'assistant' || !msg.parts) continue

      for (const part of msg.parts) {
        const partKey = part.id || `${msg.id}:${part.type}`

        if (part.type === 'step-start') {
          const stepTitle = (part as any).title || (part as any).label || ''
          if (stepTitle && stepTitle !== busyInfo.currentStepTitle) {
            busyInfo.currentStepTitle = stepTitle
            busyInfo.stepStartSeen = true
            await this.sendWithRateLimit(
              chatId,
              busyInfo.threadId,
              `🚀 *Step started:* ${escapeMarkdown(stepTitle)}`,
              { parse_mode: 'Markdown' }
            )
          }
        }

        if (part.type === 'reasoning' && part.time?.end && !busyInfo.processedPartIds.has(partKey)) {
          busyInfo.processedPartIds.add(partKey)
          if (!part.text?.trim() || !SHOW_THINKING) continue
          const thinking = part.text.trim()
          const maxLen = 2000
          const displayText = thinking.length > maxLen ? thinking.substring(0, maxLen) + '...' : thinking
          await this.sendWithRateLimit(
            chatId,
            busyInfo.threadId,
            `🤔 *Thinking:*\n${escapeMarkdown(displayText)}`,
            { parse_mode: 'Markdown' }
          )
        }

        if (part.type === 'text' && part.time?.end && !busyInfo.processedPartIds.has(partKey)) {
          busyInfo.processedPartIds.add(partKey)
          if (!part.text?.trim() || part.ignored || part.synthetic) continue
          const text = stripAnsi(part.text.trim())
          if (text) {
            const chunks = splitMessage(`📝 *Response:*\n${escapeMarkdown(text)}`)
            for (const chunk of chunks) {
              await this.sendWithRateLimit(chatId, busyInfo.threadId, chunk, { parse_mode: 'Markdown' })
            }
          }
        }

        if (part.type === 'tool') {
          const toolName = part.tool || 'unknown'
          const icon = getToolIcon(toolName)
          const title = stripAnsi(part.state?.title || '')
          const status = part.state?.status

          if (status === 'running') {
            busyInfo.processingTools.set(partKey, {
              partId: partKey,
              tool: toolName,
              title,
              startedAt: Date.now(),
            })
            if (!SHOW_TOOL_CALLS) continue
            const toolKey = `${toolName}:${title}`
            if (title && toolKey !== busyInfo.lastToolCall) {
              busyInfo.lastToolCall = toolKey
              await this.sendWithRateLimit(
                chatId,
                busyInfo.threadId,
                `⏳ ${icon} *${formatToolName(toolName)}:* ${escapeMarkdown(title.substring(0, 100))}`,
                { parse_mode: 'Markdown' }
              )
            }
          } else if (status === 'completed' || status === 'error') {
            const runningEntry = busyInfo.processingTools.get(partKey)
            busyInfo.processingTools.delete(partKey)
            if (!runningEntry) continue

            const summary = this.buildToolSummary(toolName, part, runningEntry.title)
            if (summary) {
              await this.sendWithRateLimit(chatId, busyInfo.threadId, summary, { parse_mode: 'Markdown' })
            }
          }
        }

        if (part.type === 'step-finish') {
          const stepId = part.id || `${msg.id}-${part.type}`
          if (busyInfo.processedStepFinishIds.has(stepId)) continue
          busyInfo.processedStepFinishIds.add(stepId)

          if (SHOW_TOKENS) {
            const tokens = part.tokens
            const cost = part.cost
            if (tokens || cost) {
              let info = '📊 '
              if (tokens) {
                info += `${tokens.input || 0}→${tokens.output || 0} tokens`
                if (tokens.reasoning && tokens.reasoning > 0) {
                  info += ` (${tokens.reasoning} reasoning)`
                }
                if (tokens.cache && (tokens.cache.read > 0 || tokens.cache.write > 0)) {
                  info += ` [cache: ${tokens.cache.read || 0}r/${tokens.cache.write || 0}w]`
                }
              }
              if (cost && cost > 0) {
                info += ` • $${cost.toFixed(4)}`
              }
              await this.sendWithRateLimit(chatId, busyInfo.threadId, info)
            }
          }

          const tokens = part.tokens
          const cost = part.cost
          this.stateManager.addCost(
            sessionId,
            cost || 0,
            tokens?.input || 0,
            tokens?.output || 0,
            tokens?.reasoning || 0,
            tokens?.cache?.read || 0,
            tokens?.cache?.write || 0
          )
        }
      }
    }
  }

  private buildToolSummary(tool: string, part: any, runningTitle: string): string | null {
    const icon = getToolIcon(tool)
    const name = formatToolName(tool)
    const status = part.state?.status
    const stateData = part.state || {}
    const output = stripAnsi(stateData.output || '')

    if (status === 'error') {
      const errorMsg = stripAnsi(stateData.error || 'Unknown error')
      return `${icon} *${name}:* ❌ Failed — ${escapeMarkdown(errorMsg.substring(0, 200))}`
    }

    if (tool === 'bash') {
      const exitCode = stateData.exitCode
      const command = stateData.command || runningTitle || ''
      if (exitCode !== undefined && exitCode !== 0) {
        return `${icon} *${name}:* Exit code ${exitCode}`
      }
      if (output) {
        const lines = output.split('\n').length
        const size = output.length
        let summary = `${icon} *${name}:*`
        if (lines <= 3 && size <= 200) {
          summary += `\n\`\`\`\n${escapeMarkdown(output.trim().substring(0, 200))}\n\`\`\``
        } else if (lines > 0) {
          summary += ` ${lines} lines, ${size} chars`
        } else {
          summary += ` completed`
        }
        return summary
      }
      return `${icon} *${name}*`
    }

    if (tool === 'read') {
      if (output) {
        const lines = output.split('\n').length
        return `${icon} *${name}:* ${lines} lines`
      }
      return `${icon} *${name}:* ${escapeMarkdown(runningTitle?.substring(0, 100) || '')}`
    }

    if (tool === 'grep' || tool === 'glob') {
      if (output) {
        const matches = output.trim().split('\n').filter(l => l.trim()).length
        return `${icon} *${name}:* ${matches} match${matches !== 1 ? 'es' : ''}`
      }
      return `${icon} *${name}:* ${escapeMarkdown(runningTitle?.substring(0, 100) || '')}`
    }

    if (output) {
      const short = output.trim().substring(0, 150)
      return `${icon} *${name}:* ${escapeMarkdown(short)}`
    }

    if (runningTitle) {
      return `${icon} *${name}:* ${escapeMarkdown(runningTitle.substring(0, 100))}`
    }

    return `${icon} *${name}*`
  }

  private messagesAfterAnchor(messages: any[], anchorId?: string): any[] {
    if (!anchorId) return messages
    const idx = messages.findIndex(m => m.id === anchorId)
    return idx >= 0 ? messages.slice(idx + 1) : messages
  }

  private async sendWithRateLimit(chatId: number, threadId: number, text: string, options?: any): Promise<void> {
    try {
      const sendOpts = { ...options }
      if (threadId > 0) sendOpts.message_thread_id = threadId
      await this.bot.api.sendMessage(chatId, text, sendOpts)
    } catch (error: any) {
      if (error.description?.includes('message thread not found') && threadId > 0) {
        getLogger().warn('Topic deleted, clearing binding', { chatId, threadId })
        this.messageQueue.clear(chatId, threadId)
        this.stateManager.clearTopicSession(chatId, threadId)
        return
      }
      if (error.description?.includes('rate limit') || error.error_code === 429) {
        const retryAfter = error.parameters?.retry_after || 1
        getLogger().warn('Telegram rate limited, waiting', { retryAfter })
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000))
        try {
          const sendOpts = { ...options }
          if (threadId > 0) sendOpts.message_thread_id = threadId
          await this.bot.api.sendMessage(chatId, text, sendOpts)
        } catch {
          // Give up on this message
        }
      }
    }
  }

  stop(): void {
    this.running = false
  }

  setWorkingMessage(sessionId: string, chatId: number, messageId: number, threadId = 0): void {
    this.workingSessions.set(sessionId, { chatId, threadId, messageId })
  }

  async forceSessionIdle(sessionId: string, chatId: number, statusText = '🛑 Task aborted', threadId = 0): Promise<void> {
    this.busySessions.delete(sessionId)
    const pending = this.pendingCompletions.get(sessionId)
    if (pending) {
      clearTimeout(pending.debounceTimer)
      this.pendingCompletions.delete(sessionId)
    }
    await this.processSessionIdle(sessionId, chatId, threadId, statusText)
  }

  getWorkingStatus(sessionId: string): string | null {
    const busyInfo = this.busySessions.get(sessionId)
    if (!busyInfo) return null

    const parts: string[] = []
    if (busyInfo.currentStepTitle) {
      parts.push(`Step: ${busyInfo.currentStepTitle}`)
    }

    const elapsed = Math.floor((Date.now() - busyInfo.startedAt) / 1000)
    const mins = Math.floor(elapsed / 60)
    const secs = elapsed % 60
    parts.push(`Running: ${mins}m ${secs}s`)

    return parts.join(' | ')
  }

  private resolveSessionChat(sessionId: string): { chatId: number; threadId: number } | undefined {
    return this.stateManager.resolveChat(sessionId)
  }

  private async handleSessionError(event: any): Promise<void> {
    const target = this.resolveSessionChat(event.sessionID)
    if (!target) return

    const errorName = event.error?.name || 'Error'
    const errorMsg = stripAnsi(event.error?.message || 'Unknown error')

    const opts: any = { parse_mode: 'Markdown' }
    if (target.threadId > 0) opts.message_thread_id = target.threadId

    await this.bot.api.sendMessage(
      target.chatId,
      `⚠️ *${escapeMarkdown(errorName)}*\n${escapeMarkdown(errorMsg.substring(0, 300))}`,
      opts
    ).catch(() => {})
  }

  private async handleSessionDiff(event: any): Promise<void> {
    const target = this.resolveSessionChat(event.sessionID)
    if (!target) return

    const diffs = event.diff || []
    if (diffs.length === 0) return

    let message = `📁 *File Changes (${diffs.length}):*\n\n`
    for (const diff of diffs.slice(0, 10)) {
      const statusIcon = diff.status === 'added' ? '🆕' : diff.status === 'deleted' ? '🗑️' : '📝'
      message += `${statusIcon} \`${escapeMarkdown(diff.file)}\` (+${diff.additions || 0} -${diff.deletions || 0})\n`
    }
    if (diffs.length > 10) {
      message += `_...and ${diffs.length - 10} more files_\n`
    }

    const chunks = splitMessage(message)
    for (const chunk of chunks) {
      await this.sendWithRateLimit(target.chatId, target.threadId, chunk, { parse_mode: 'Markdown' })
    }
  }

  private async handleSessionUpdated(event: any): Promise<void> {
    const target = this.resolveSessionChat(event.sessionID)
    if (!target) return

    const info = event.info
    if (!info) return

    if (info.title) {
      await this.sendWithRateLimit(
        target.chatId, target.threadId,
        `📝 *Session title:* ${escapeMarkdown(info.title)}`,
        { parse_mode: 'Markdown' }
      )
    }

    if (info.summary) {
      const s = info.summary
      if (s.additions || s.deletions) {
        await this.sendWithRateLimit(
          target.chatId, target.threadId,
          `📊 Changes: +${s.additions || 0} -${s.deletions || 0} (${s.files || 0} files)`,
          { parse_mode: 'Markdown' }
        )
      }
    }
  }

  private async handleSessionCompacted(event: any): Promise<void> {
    const target = this.resolveSessionChat(event.sessionID)
    if (!target) return

    await this.sendWithRateLimit(
      target.chatId, target.threadId,
      '📦 *Context compacted* — older messages summarized to save space.',
      { parse_mode: 'Markdown' }
    )
  }

  // Poll GET /question for pending interactive questions and surface each new
  // one as tappable buttons. OpenCode has no push on the polling path, so we
  // mirror checkPendingPermissions. sentQuestions dedupes across polls; ids no
  // longer pending are pruned so a genuine re-ask surfaces again.
  private async checkPendingQuestions(): Promise<void> {
    try {
      const pending = await this.client.listQuestions()
      const activeIds = new Set(pending.map(q => q.id))
      for (const id of [...this.sentQuestions]) {
        if (!activeIds.has(id)) this.sentQuestions.delete(id)
      }
      for (const req of pending) {
        if (this.sentQuestions.has(req.id)) continue
        this.sentQuestions.add(req.id)
        await this.sendQuestionPrompt(req)
      }
    } catch {
      // Non-fatal: endpoint unavailable / older server — skip this poll.
    }
  }

  private async sendQuestionPrompt(req: QuestionRequest): Promise<void> {
    const target = this.resolveSessionChat(req.sessionID)
    if (!target) return

    const log = getLogger()
    log.info('Question asked', { questionId: req.id, sessionID: req.sessionID })

    const { text, inlineKeyboard } = renderQuestion(req)
    const opts: any = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard } }
    if (target.threadId > 0) opts.message_thread_id = target.threadId

    await this.bot.api.sendMessage(target.chatId, text, opts).catch(error => {
      log.error('Failed to send question', { error: (error as Error).message })
    })
  }

  private async handleTodoUpdated(event: any): Promise<void> {
    const target = this.resolveSessionChat(event.sessionID)
    if (!target) return

    const todos: TodoItem[] = event.todos || []
    if (todos.length === 0) return

    await this.sendTodoUpdate(target.chatId, target.threadId, todos)
  }

  private async handleUpdateAvailable(event: any): Promise<void> {
    const chatIds = this.stateManager.getAllChatIds()
    for (const chatId of chatIds) {
      await this.sendWithRateLimit(
        chatId, 0,
        `🔔 *Update Available*: OpenCode \`${escapeMarkdown(event.version || 'new version')}\` is available!`,
        { parse_mode: 'Markdown' }
      )
    }
    const topicBindings = this.stateManager.getAllTopicBindings()
    for (const binding of topicBindings) {
      await this.sendWithRateLimit(
        binding.chatId, binding.threadId,
        `🔔 *Update Available*: OpenCode \`${escapeMarkdown(event.version || 'new version')}\` is available!`,
        { parse_mode: 'Markdown' }
      )
    }
  }

}
