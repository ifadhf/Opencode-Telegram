import { Bot } from 'grammy'
import { StateManager } from '../state/manager.js'
import { OpenCodeClient, Model, Provider } from '../opencode/client.js'
import { EventProcessor } from '../opencode/events.js'
import { escapeHtml, splitMessage } from '../utils/formatter.js'
import { paginateMessages, formatHistoryPage, buildHistoryKeyboard, HISTORY_PAGE_SIZE } from './history.js'
import { buildDirBrowser, listSubdirs, setBrowseState, getWorktreeRoot } from './dirBrowser.js'
import { getLogger } from '../utils/logger.js'

// Build the "Available Providers" message. Pure + exported so it can be unit
// tested and, crucially, chunked with splitMessage before sending (a long
// provider list otherwise exceeds Telegram's 4096-char limit -> 400).
export function formatProvidersList(providers: Array<{ id: string; models?: Record<string, any> }>): string {
  let message = '<b>Available Providers:</b>\n\n'
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i]
    const modelCount = Object.keys(p.models || {}).length
    message += `${i + 1}. <code>${escapeHtml(p.id)}</code> (${modelCount} models)\n`
  }
  message += '\nUse <code>/models <provider></code> to see models for a provider.'
  if (providers.length > 0) {
    message += '\nExample: <code>/models ' + escapeHtml(providers[0].id) + '</code>'
  }
  return message
}

export function registerCommands(
  bot: Bot,
  stateManager: StateManager,
  client: OpenCodeClient,
  eventProcessor?: EventProcessor
) {
  const log = getLogger()

  // Caches
  const modelsCache = new Map<number, Model[]>()
  const providersCache = new Map<number, Provider[]>()

  // Helper to check authorization
  const isAuthorized = (userId?: string) => userId === process.env.AUTHORIZED_USER_ID

  // Helper to resolve session from topic or legacy chat context
  function resolveSessionFromCtx(ctx: any): { sessionId?: string; threadId: number } {
    const threadId = ctx.message?.message_thread_id ?? 0
    if (threadId > 0) {
      const sessionId = stateManager.getTopicSession(ctx.chat.id, threadId)
      return { sessionId, threadId }
    }
    return { sessionId: stateManager.getCurrentSession(ctx.chat.id), threadId: 0 }
  }

  // Start command
  bot.command('start', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    await ctx.reply(
      '<b>Welcome to OpenCode Telegram Bot!</b>\n\n' +
      '<b>Session Commands:</b>\n' +
      '/session - Create new session\n' +
      '/sessions - List recent sessions\n' +
      '/continue - Continue an old session\n' +
      '/newtopic - Create session in a forum topic\n' +
      '/status - Show current session\n' +
      '/abort - Stop running task\n' +
      '/clear - Clear current session\n\n' +
      '<b>Model Commands:</b>\n' +
      '/providers - List AI providers\n' +
      '/models <provider> - List models for provider\n' +
      '/model - Show/select current model\n\n' +
      '<b>Mode Commands:</b>\n' +
      '/mode - Select mode (build/plan)\n' +
      '/modes - List available modes\n\n' +
      '<b>File Commands:</b>\n' +
      '/files - List project files\n' +
      '/file <path> - View file content\n' +
      '/find <pattern> - Search code\n\n' +
      '<b>Info Commands:</b>\n' +
      '/cost - Show cost tracking\n' +
      '/todo - Show task list\n' +
      '/diff - Show file changes\n\n' +
      'Just send any message to prompt OpenCode!\n' +
      '<i>Multiple messages are queued automatically.</i>',
      { parse_mode: 'HTML' }
    )
  })

  // Session command
  bot.command('session', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/session', args: ctx.match, userId: ctx.from?.id })

    const args = ctx.match as string
    const threadId = ctx.message?.message_thread_id ?? 0

    if (args) {
      try {
        const { sessionId: oldId } = resolveSessionFromCtx(ctx)
        const session = await client.getSession(args)
        if (oldId && oldId !== session.id && eventProcessor) {
          await eventProcessor.forceSessionIdle(oldId, ctx.chat.id, '↪️ Session switched', threadId)
        }
        if (threadId > 0) {
          stateManager.setTopicSession(ctx.chat.id, threadId, session.id)
        } else {
          stateManager.setCurrentSession(ctx.chat.id, session.id)
        }
        await ctx.reply(`Selected session: <code>${escapeHtml(session.id)}</code>`, {
          parse_mode: 'HTML',
        })
      } catch (error) {
        await ctx.reply(`Session not found: ${(error as Error).message}`)
      }
    } else {
      try {
        const { sessionId: oldId } = resolveSessionFromCtx(ctx)
        const session = await client.createSession()
        if (oldId && oldId !== session.id && eventProcessor) {
          await eventProcessor.forceSessionIdle(oldId, ctx.chat.id, '↪️ Session switched', threadId)
        }
        if (threadId > 0) {
          stateManager.setTopicSession(ctx.chat.id, threadId, session.id)
        } else {
          stateManager.setCurrentSession(ctx.chat.id, session.id)
        }
        await ctx.reply(`Created new session: <code>${escapeHtml(session.id)}</code>\n\nSend any message to start!`, {
          parse_mode: 'HTML',
        })
      } catch (error) {
        await ctx.reply(`Failed to create session: ${(error as Error).message}`)
      }
    }
  })

  // Continue command
  bot.command('continue', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/continue', userId: ctx.from?.id })

    try {
      const sessions = await client.listSessions({ limit: 10 })

      if (sessions.length === 0) {
        await ctx.reply('No sessions found. Use /session to create a new one.')
        return
      }

      const inlineKeyboard = sessions.map((s) => {
        const title = `${s.directory ? `[${s.directory.split('/').pop() || s.directory}] ` : ''}${s.title || s.id.slice(0, 20)}`
        return [{ text: title.substring(0, 64), callback_data: `session:${s.id}` }]
      })

      await ctx.reply('<b>Select a session to continue:</b>', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: inlineKeyboard },
      })
    } catch (error) {
      await ctx.reply(`Failed to list sessions: ${(error as Error).message}`)
    }
  })

  // Sessions command
  bot.command('sessions', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/sessions', userId: ctx.from?.id })

    try {
      const sessions = await client.listSessions({ limit: 10 })
      if (sessions.length === 0) {
        await ctx.reply('No sessions found.')
        return
      }

      let message = '<b>Recent Sessions:</b>\n\n'
      for (const s of sessions) {
        const title = s.title || '(untitled)'
        message += `- <code>${escapeHtml(s.id)}</code>\n  ${escapeHtml(title)}\n\n`
      }
      message += 'Use <code>/session <id></code> to select a session.'

      await ctx.reply(message, { parse_mode: 'HTML' })
    } catch (error) {
      await ctx.reply(`Failed to list sessions: ${(error as Error).message}`)
    }
  })

  // Abort command
  bot.command('abort', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/abort', userId: ctx.from?.id })

    const { sessionId, threadId } = resolveSessionFromCtx(ctx)
    if (!sessionId) {
      await ctx.reply(threadId > 0 ? 'No session bound to this topic.' : 'No session selected.')
      return
    }

    try {
      await client.abortSession(sessionId)
      if (eventProcessor) await eventProcessor.forceSessionIdle(sessionId, ctx.chat.id, '🛑 Session aborted', threadId)
      await ctx.reply('🛑 Session aborted.')
    } catch (error) {
      await ctx.reply(`Failed to abort: ${(error as Error).message}`)
    }
  })

  // Clear command
  bot.command('clear', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/clear', userId: ctx.from?.id })

    const { sessionId, threadId } = resolveSessionFromCtx(ctx)
    if (sessionId && eventProcessor) {
      await eventProcessor.forceSessionIdle(sessionId, ctx.chat.id, '🧹 Session cleared', threadId)
    }
    if (threadId > 0) {
      stateManager.clearTopicSession(ctx.chat.id, threadId)
    } else {
      stateManager.clearChatState(ctx.chat.id)
    }
    await ctx.reply('Cleared current session.')
  })

  // Status command
  bot.command('status', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/status', userId: ctx.from?.id })

    const threadId = ctx.message?.message_thread_id ?? 0

    let sessionId: string | undefined

    if (threadId > 0) {
      sessionId = stateManager.getTopicSession(ctx.chat.id, threadId)
      if (!sessionId) {
        await ctx.reply('No session bound to this topic. Use /newtopic to create one.')
        return
      }
    } else {
      const chatState = stateManager.getChatState(ctx.chat.id)
      sessionId = chatState.sessionId
    }

    if (!sessionId) {
      if (threadId > 0) {
        await ctx.reply('No session bound to this topic. Use /newtopic to create one.')
      } else {
        await ctx.reply('No session selected. Use /session to create one.')
      }
      return
    }

    let message = '<b>Current Status</b>\n\n'
    let sessionModel: { id: string; providerID: string; variant?: string } | undefined
    let sessionAgent: string | undefined

    try {
      const session = await client.getSession(sessionId)
      sessionModel = session.model
      sessionAgent = session.agent
      const sessionTitle = session.title || '(untitled)'
      message += `<b>Session:</b>\n`
      message += `ID: <code>${escapeHtml(session.id)}</code>\n`
      message += `Title: ${escapeHtml(sessionTitle)}\n`

      try {
        const messages = await client.getMessages(sessionId, 1)
        const lastMsg = messages[0] as any
        const STALE_MS = 120_000
        const lastActivity = lastMsg?.time?.updated || lastMsg?.time?.created
        const isStale = lastActivity && (Date.now() - lastActivity > STALE_MS)
        const isRunning = lastMsg?.role === 'assistant'
          && !isStale
          && (!lastMsg.time?.completed || lastMsg.parts?.some((p: any) => p.state?.status === 'running'))
        if (isRunning) {
          message += `State: 🔄 Running\n`
        } else {
          message += `State: 💤 Idle\n`
        }
      } catch {
        message += `State: ❓ Unknown\n`
      }

      message += `Directory: <code>${escapeHtml(session.directory)}</code>\n`

      if ((session as any).summary) {
        const summary = (session as any).summary
        message += `Changes: +${summary.additions || 0} -${summary.deletions || 0} (${summary.files || 0} files)\n`
      }

      if ((session as any).permission && (session as any).permission.length > 0) {
        const perms = (session as any).permission as Array<{ permission: string; pattern: string; action: string }>
        const overrides = perms.filter(p => p.action === 'deny')
        if (overrides.length > 0) {
          message += `<b>Permission overrides:</b>\n`
          for (const p of overrides) {
            message += `  <code>${escapeHtml(p.permission)}</code> → ${p.action} (${escapeHtml(p.pattern)})\n`
          }
        }
      }

      const tCreated = (session as any).time?.created
      const tUpdated = (session as any).time?.updated
      if (tCreated) {
        message += `Created: ${new Date(tCreated).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n`
      }
      if (tUpdated) {
        message += `Updated: ${new Date(tUpdated).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n`
      }

      message += '\n'
    } catch {
      message += `<b>Session:</b> <code>${escapeHtml(sessionId)}</code> (not found)\n\n`
    }

    if (sessionModel) {
      message += `<b>Model:</b> <code>${escapeHtml(sessionModel.id)}</code>\n\n`
    } else {
      try {
        const status = await client.getSessionStatus(sessionId)
        if (status?.model) {
          message += `<b>Model:</b> ${escapeHtml(status.model)} (from session)\n\n`
        } else {
          const config = await client.getConfig()
          message += `<b>Model:</b> <code>${escapeHtml(config.model || 'unknown')}</code> (default)\n\n`
        }
      } catch {
        message += `<b>Model:</b> Default (OpenCode configured default)\n\n`
      }
    }

    if (sessionAgent) {
      message += `<b>Mode:</b> <code>${escapeHtml(sessionAgent)}</code>\n`
    } else {
      try {
        const status = await client.getSessionStatus(sessionId)
        if (status?.agent) {
          message += `<b>Mode:</b> <code>${escapeHtml(status.agent)}</code> (from session)\n`
        } else {
          const config = await client.getConfig()
          const defaultAgent = Object.keys(config.agent || {}).find(k => config.agent?.[k]?.mode === 'all') || 'build'
          message += `<b>Mode:</b> <code>${escapeHtml(defaultAgent)}</code> (default)\n`
        }
      } catch {
        message += `<b>Mode:</b> Default (OpenCode configured default)\n`
      }
    }

    const cost = stateManager.getCost(sessionId)
    if (cost && cost.totalCost > 0) {
      message += `\n<b>Cost:</b> $${cost.totalCost.toFixed(4)} (${cost.messages} messages)\n`
    }

    const promptCount = stateManager.getPromptCount(ctx.chat.id)
    if (promptCount > 0) {
      message += `\n<i>Prompts sent: ${promptCount}</i>`
    }

    await ctx.reply(message, { parse_mode: 'HTML' })
  })

  // Subagent toggle
  bot.command('subagent', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    const threadId = ctx.message?.message_thread_id ?? 0

    if (threadId === 0) {
      await ctx.reply('This command only works in a forum topic. Create a topic with /newtopic first.')
      return
    }

    const sessionId = stateManager.getTopicSession(ctx.chat.id, threadId)
    if (!sessionId) {
      await ctx.reply('No session bound to this topic. Use /newtopic to create one.')
      return
    }

    const arg = ctx.message?.text?.split(/\s+/)[1]?.toLowerCase()
    if (arg === 'on') {
      stateManager.setAllowSubagent(ctx.chat.id, threadId, true)
      await ctx.reply('✅ Subagent: <b>ON</b> — agent can dispatch subagents (explore/general)', { parse_mode: 'HTML' })
    } else if (arg === 'off') {
      stateManager.setAllowSubagent(ctx.chat.id, threadId, false)
      await ctx.reply('✅ Subagent: <b>OFF</b> — agent will not dispatch subagents', { parse_mode: 'HTML' })
    } else {
      const allowed = stateManager.getAllowSubagent(ctx.chat.id, threadId)
      const status = allowed ? 'ON' : 'OFF'
      await ctx.reply(`Subagent: <b>${status}</b>\n\nUse <code>/subagent on</code> or <code>/subagent off</code> to toggle.`, { parse_mode: 'HTML' })
    }
  })

  // Move session to a different directory
  bot.command('move', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }
    log.info('User command', { command: '/move', userId: ctx.from?.id })

    const { sessionId, threadId } = resolveSessionFromCtx(ctx)
    if (!sessionId) {
      await ctx.reply(threadId > 0 ? 'No session bound to this topic.' : 'No session selected.')
      return
    }

    const args = ctx.message?.text?.split(/\s+/) || []
    if (args.length < 2) {
      await ctx.reply('Usage: <code>/move <directory> [--changes]</code>\n\nMove session to another directory. Use <code>--changes</code> to transfer uncommitted changes.', { parse_mode: 'HTML' })
      return
    }

    const directory = args[1]
    const moveChanges = args.includes('--changes')

    try {
      await client.moveSession(sessionId, directory, moveChanges)
      const msg = moveChanges
        ? `✅ Session moved to <code>${escapeHtml(directory)}</code> (with uncommitted changes)`
        : `✅ Session moved to <code>${escapeHtml(directory)}</code>`
      await ctx.reply(msg, { parse_mode: 'HTML' })
    } catch (error) {
      const msg = (error as Error).message
      if (msg.includes('MoveSessionError') || msg.includes('another project')) {
        await ctx.reply(
          '❌ Cannot move session — the destination directory is in a different OpenCode project.\n' +
          'Use <code>/newtopic</code> or <code>/session</code> to create a new session in the target directory.',
          { parse_mode: 'HTML' }
        )
      } else {
        await ctx.reply(`❌ Failed to move session: ${msg}`)
      }
    }
  })

  // Compact session context
  bot.command('compact', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }
    log.info('User command', { command: '/compact', userId: ctx.from?.id })

    const { sessionId, threadId } = resolveSessionFromCtx(ctx)
    if (!sessionId) {
      await ctx.reply(threadId > 0 ? 'No session bound to this topic.' : 'No session selected.')
      return
    }

    try {
      await client.compactSession(sessionId)
      await ctx.reply('✅ Session compacted — context window reclaimed.')
    } catch (error) {
      await ctx.reply(`❌ Failed to compact session: ${(error as Error).message}`)
    }
  })

  // Delete a session
  bot.command('delete', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }
    log.info('User command', { command: '/delete', userId: ctx.from?.id })

    const args = ctx.message?.text?.split(/\s+/) || []
    const targetId = args[1]

    if (!targetId) {
      const { sessionId, threadId } = resolveSessionFromCtx(ctx)
      if (!sessionId) {
        await ctx.reply(threadId > 0 ? 'No session bound to this topic. Use <code>/delete <session_id></code>.' : 'No session selected. Use <code>/delete <session_id></code>.', { parse_mode: 'HTML' })
        return
      }
      await ctx.reply(`Current session: <code>${escapeHtml(sessionId)}</code>\n\nTo delete, use: <code>/delete ${escapeHtml(sessionId)}</code>`, { parse_mode: 'HTML' })
      return
    }

    if (!targetId.startsWith('ses_')) {
      await ctx.reply('Invalid session ID. Must start with <code>ses_</code>.', { parse_mode: 'HTML' })
      return
    }

    try {
      await client.deleteSession(targetId)
      await ctx.reply(`🗑️ Session deleted: <code>${escapeHtml(targetId)}</code>`, { parse_mode: 'HTML' })
    } catch (error) {
      await ctx.reply(`❌ Failed to delete session: ${(error as Error).message}`)
    }
  })

  // Cost command
  bot.command('cost', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/cost', userId: ctx.from?.id })

    const { sessionId, threadId } = resolveSessionFromCtx(ctx)
    if (!sessionId) {
      await ctx.reply(threadId > 0 ? 'No session bound to this topic.' : 'No session selected.')
      return
    }

    const cost = stateManager.getCost(sessionId)
    if (!cost || cost.messages === 0) {
      await ctx.reply('No cost data for this session yet.')
      return
    }

    let message = `<b>Cost Tracking</b>\n\n`
    message += `<b>Total:</b> $${cost.totalCost.toFixed(4)}\n`
    message += `<b>Messages:</b> ${cost.messages}\n`
    message += `<b>Avg/Message:</b> $${(cost.totalCost / cost.messages).toFixed(4)}\n\n`
    message += `<b>Tokens:</b>\n`
    message += `  Input: ${cost.totalInput.toLocaleString()}\n`
    message += `  Output: ${cost.totalOutput.toLocaleString()}\n`
    message += `  Reasoning: ${cost.totalReasoning.toLocaleString()}\n`
    message += `  Cache Read: ${cost.totalCacheRead.toLocaleString()}\n`
    message += `  Cache Write: ${cost.totalCacheWrite.toLocaleString()}\n`

    await ctx.reply(message, { parse_mode: 'HTML' })
  })

  // Todo command
  bot.command('todo', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    const { sessionId, threadId } = resolveSessionFromCtx(ctx)
    if (!sessionId) {
      await ctx.reply(threadId > 0 ? 'No session bound to this topic.' : 'No session selected.')
      return
    }

    try {
      const todos = await client.getSessionTodo(sessionId)
      if (todos.length === 0) {
        await ctx.reply('No tasks in this session.')
        return
      }

      const statusIcon: Record<string, string> = {
        completed: '✅', in_progress: '🔄', pending: '⬜', cancelled: '❌',
      }

      let message = `📋 <b>Task List:</b>\n\n`
      for (const todo of todos) {
        const icon = statusIcon[todo.status] || '⬜'
        const content = todo.content?.substring(0, 80) || ''
        message += `${icon} ${escapeHtml(content)}\n`
      }

      await ctx.reply(message, { parse_mode: 'HTML' })
    } catch (error) {
      await ctx.reply(`Failed to get tasks: ${(error as Error).message}`)
    }
  })

  // Diff command
  bot.command('diff', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    const { sessionId, threadId } = resolveSessionFromCtx(ctx)
    if (!sessionId) {
      await ctx.reply(threadId > 0 ? 'No session bound to this topic.' : 'No session selected.')
      return
    }

    try {
      const diffs = await client.getSessionDiff(sessionId)
      if (diffs.length === 0) {
        await ctx.reply('No file changes in this session.')
        return
      }

      let message = `📁 <b>File Changes:</b>\n\n`
      for (const diff of diffs) {
        const statusIcon = diff.status === 'added' ? '🆕' : diff.status === 'deleted' ? '🗑️' : '📝'
        message += `${statusIcon} <code>${escapeHtml(diff.file)}</code> (+${diff.additions} -${diff.deletions})\n`
      }

      const chunks = splitMessage(message)
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'HTML' })
      }
    } catch (error) {
      await ctx.reply(`Failed to get diff: ${(error as Error).message}`)
    }
  })

  // Files command
  bot.command('files', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/files', args: ctx.match, userId: ctx.from?.id })

    let dirPath = (ctx.match as string || '').trim() || undefined
    if (!dirPath) {
      const { sessionId } = resolveSessionFromCtx(ctx)
      if (sessionId) {
        try {
          const session = await client.getSession(sessionId)
          dirPath = session.directory
        } catch {}
      }
    }

    try {
      const entries = await client.listFiles(dirPath)

      if (entries.length === 0) {
        await ctx.reply('📂 Empty directory or not found.')
        return
      }

      let message = `📂 <b>Directory:</b>\n\n`
      for (const entry of entries) {
        const icon = entry.type === 'directory' ? '📁' : '📄'
        const name = entry.name || entry.path
        message += `${icon} <code>${escapeHtml(name)}</code>\n`
      }

      const chunks = splitMessage(message)
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'HTML' })
      }
    } catch (error) {
      await ctx.reply(`Failed to list files: ${(error as Error).message}`)
    }
  })

  // File command
  bot.command('file', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    const filePath = (ctx.match as string || '').trim()

    log.info('User command', { command: '/file', args: filePath, userId: ctx.from?.id })

    if (!filePath) {
      await ctx.reply('Usage: <code>/file <path></code>\nExample: <code>/file src/index.ts</code>', { parse_mode: 'HTML' })
      return
    }

    try {
      const result = await client.getFileContent(filePath)
      const content = result.content || ''

      if (!content) {
        await ctx.reply(`📄 File is empty: <code>${escapeHtml(filePath)}</code>`, { parse_mode: 'HTML' })
        return
      }

      const maxChunk = 4000
      if (content.length <= maxChunk) {
        await ctx.reply(`📄 <b>${escapeHtml(filePath)}</b>\n\n<pre>${content}</pre>`, {
          parse_mode: 'HTML',
        })
      } else {
        await ctx.reply(`📄 <b>${escapeHtml(filePath)}</b> (${content.length} chars)`, {
          parse_mode: 'HTML',
        })

        for (let i = 0; i < content.length; i += maxChunk) {
          const chunk = content.substring(i, i + maxChunk)
          await ctx.reply(`<pre>${chunk}</pre>`, { parse_mode: 'HTML' })
        }
      }
    } catch (error) {
      await ctx.reply(`Failed to read file: ${(error as Error).message}`)
    }
  })

  // Find command
  bot.command('find', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    const pattern = (ctx.match as string || '').trim()

    log.info('User command', { command: '/find', args: pattern, userId: ctx.from?.id })

    if (!pattern) {
      await ctx.reply('Usage: <code>/find <pattern></code>\nExample: <code>/find function handleEvent</code>', { parse_mode: 'HTML' })
      return
    }

    try {
      const results = await client.searchCode(pattern)

      if (!results || results.length === 0) {
        await ctx.reply(`🔍 No results for: <code>${escapeHtml(pattern)}</code>`, { parse_mode: 'HTML' })
        return
      }

      let message = `🔍 <b>Results for:</b> <code>${escapeHtml(pattern)}</code>\n\n`
      for (const result of results.slice(0, 20)) {
        const text = result.text?.trim().substring(0, 80) || ''
        message += `<code>${escapeHtml(result.path)}:${result.line}</code>\n${escapeHtml(text)}\n\n`
      }

      if (results.length > 20) {
        message += `<i>...and ${results.length - 20} more results</i>\n`
      }

      const chunks = splitMessage(message)
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'HTML' })
      }
    } catch (error) {
      await ctx.reply(`Search failed: ${(error as Error).message}`)
    }
  })

  // Providers command - list providers first
  bot.command('providers', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/providers', userId: ctx.from?.id })

    try {
      const providers = await client.listProviders()

      if (providers.length === 0) {
        await ctx.reply('No providers configured. Check your OpenCode settings.')
        return
      }

      providersCache.set(ctx.chat.id, providers)

      const message = formatProvidersList(providers)
      for (const chunk of splitMessage(message)) {
        await ctx.reply(chunk, { parse_mode: 'HTML' })
      }
    } catch (error) {
      await ctx.reply(`Failed to list providers: ${(error as Error).message}`)
    }
  })

  // Models command - now shows models for a specific provider
  bot.command('models', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    const providerFilter = (ctx.match as string || '').trim()

    log.info('User command', { command: '/models', args: providerFilter, userId: ctx.from?.id })

    if (!providerFilter) {
      // No provider specified, show providers
      try {
        const providers = await client.listProviders()

        if (providers.length === 0) {
          await ctx.reply('No providers configured. Check your OpenCode settings.')
          return
        }

        providersCache.set(ctx.chat.id, providers)

        const message = formatProvidersList(providers)
        for (const chunk of splitMessage(message)) {
          await ctx.reply(chunk, { parse_mode: 'HTML' })
        }
      } catch (error) {
        await ctx.reply(`Failed to list providers: ${(error as Error).message}`)
      }
      return
    }

    // Provider specified, show models for that provider
    try {
      const models = await client.listModels(providerFilter)

      if (models.length === 0) {
        await ctx.reply(`No models found for provider: <code>${escapeHtml(providerFilter)}</code>`, {
          parse_mode: 'HTML',
        })
        return
      }

      modelsCache.set(ctx.chat.id, models)

      let message = `<b>Models for</b> <code>${escapeHtml(providerFilter)}</code>:\n\n`
      for (let i = 0; i < models.length; i++) {
        message += `${i + 1}. <code>${escapeHtml(models[i].id)}</code>`
        if (models[i].name && models[i].name !== models[i].id) {
          message += ` - ${escapeHtml(models[i].name)}`
        }
        message += '\n'
      }
      message += `\nSelect with: <code>/model ${escapeHtml(providerFilter)} <model_id></code>`

      const chunks = splitMessage(message)
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'HTML' })
      }
    } catch (error) {
      await ctx.reply(`Failed to list models: ${(error as Error).message}`)
    }
  })

  // Model command
  bot.command('model', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    const args = (ctx.match as string || '').trim()

    log.info('User command', { command: '/model', args, userId: ctx.from?.id })

    const { sessionId, threadId } = resolveSessionFromCtx(ctx)
    if (!sessionId) {
      await ctx.reply(threadId > 0 ? 'No session bound to this topic.' : 'No session selected.')
      return
    }

    if (!args) {
      let message = ''
      try {
        const session = await client.getSession(sessionId)
        const sessionModel = session.model
        if (sessionModel) {
          message += `<b>Current Model:</b>\n<code>${escapeHtml(sessionModel.id)}</code>\n\n`
        } else {
          message += '<b>No model set for this session.</b> Using default.\n\n'
        }
      } catch {
        message += '<b>Could not fetch session model.</b>\n\n'
      }

      message += '<b>Usage:</b>\n'
      message += '• <code>/providers</code> - List providers\n'
      message += '• <code>/models <provider></code> - List models for provider\n'
      message += '• <code>/model <provider> <model></code> - Select model\n\n'
      message += 'Example:\n'
      message += '<code>/model anthropic claude-3-opus</code>'

      await ctx.reply(message, { parse_mode: 'HTML' })
      return
    }

    const parts = args.split(/\s+/)
    if (parts.length < 2) {
      await ctx.reply(
        'Invalid format. Use:\n' +
        '<code>/model <provider> <model></code>\n\n' +
        'Example:\n' +
        '<code>/model anthropic claude-3-opus</code>',
        { parse_mode: 'HTML' }
      )
      return
    }

    const providerId = parts[0]
    const modelId = parts.slice(1).join(' ')

    try {
      await client.setSessionModel(sessionId, providerId, modelId)
      await ctx.reply(
        `✅ <b>Model set:</b>\n<code>${escapeHtml(providerId)}/${escapeHtml(modelId)}</code>`,
        { parse_mode: 'HTML' }
      )
    } catch (error) {
      await ctx.reply(`Failed to set model: ${(error as Error).message}`)
    }
  })

  // Modes command
  bot.command('modes', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/modes', userId: ctx.from?.id })

    try {
      const agents = await client.listAgents()

      if (agents.length === 0) {
        await ctx.reply(
          '<b>Available Modes:</b>\n\n' +
          '• <code>build</code> - Code implementation mode\n' +
          '• <code>plan</code> - Planning and design mode\n' +
          '• <code>code</code> - Alternative coding mode\n' +
          '• <code>review</code> - Code review mode\n' +
          '• <code>debug</code> - Debugging mode\n\n' +
          'Use <code>/mode <name></code> to select.',
          { parse_mode: 'HTML' }
        )
        return
      }

      let message = '<b>Available Modes:</b>\n\n'
      for (let i = 0; i < agents.length; i++) {
        const agent = agents[i]
        message += `${i + 1}. <code>${escapeHtml(agent.name)}</code>`
        if (agent.description) {
          message += ` - ${escapeHtml(agent.description)}`
        }
        message += '\n'
      }
      message += '\nUse <code>/mode <name></code> to select.'

      await ctx.reply(message, { parse_mode: 'HTML' })
    } catch {
      await ctx.reply(
        '<b>Available Modes:</b>\n\n' +
        '• <code>build</code> - Code implementation mode\n' +
        '• <code>plan</code> - Planning and design mode\n' +
        '• <code>code</code> - Alternative coding mode\n' +
        '• <code>review</code> - Code review mode\n' +
        '• <code>debug</code> - Debugging mode\n\n' +
        'Use <code>/mode <name></code> to select.',
        { parse_mode: 'HTML' }
      )
    }
  })

  // Mode command
  bot.command('mode', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    const args = (ctx.match as string || '').trim().toLowerCase()

    log.info('User command', { command: '/mode', args, userId: ctx.from?.id })

    const { sessionId, threadId } = resolveSessionFromCtx(ctx)
    if (!sessionId) {
      await ctx.reply(threadId > 0 ? 'No session bound to this topic.' : 'No session selected.')
      return
    }

    if (!args) {
      let message = ''
      try {
        const session = await client.getSession(sessionId)
        const agent = session.agent
        if (agent) {
          message += `<b>Current Mode:</b> <code>${escapeHtml(agent)}</code>\n\n`
        } else {
          message += '<b>No mode set for this session.</b> Using default.\n\n'
        }
      } catch {
        message += '<b>Could not fetch session mode.</b>\n\n'
      }

      message += '<b>Usage:</b> <code>/mode <name></code>\n\n'
      message += 'Allowed modes:\n'
      message += '• <code>build</code> - Code implementation\n'
      message += '• <code>plan</code> - Planning and design\n\n'
      message += 'Use <code>/modes</code> to see all available.'

      await ctx.reply(message, { parse_mode: 'HTML' })
      return
    }

    if (args !== 'build' && args !== 'plan') {
      await ctx.reply(
        `❌ Invalid mode: <code>${escapeHtml(args)}</code>\n\n` +
        'Only <code>build</code> and <code>plan</code> modes are allowed.\n' +
        'Use <code>/mode build</code> or <code>/mode plan</code>.',
        { parse_mode: 'HTML' }
      )
      return
    }

    try {
      await client.setSessionAgent(sessionId, args)
      await ctx.reply(
        `✅ <b>Mode set:</b> <code>${escapeHtml(args)}</code>`,
        { parse_mode: 'HTML' }
      )
    } catch (error) {
      await ctx.reply(`Failed to set mode: ${(error as Error).message}`)
    }
  })

  // Working command
  bot.command('working', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/working', userId: ctx.from?.id })

    const { sessionId, threadId } = resolveSessionFromCtx(ctx)
    if (!sessionId) {
      await ctx.reply(threadId > 0 ? 'No session bound to this topic.' : 'No session selected.')
      return
    }

    if (eventProcessor) {
      const status = eventProcessor.getWorkingStatus(sessionId)
      if (status) {
        await ctx.reply(`🔧 <b>Currently working:</b>\n${escapeHtml(status)}`, { parse_mode: 'HTML' })
        return
      }
    }

    try {
      const sessionStatus = await client.getSessionStatus(sessionId)
      const isBusy = sessionStatus?.status === 'busy'

      if (isBusy) {
        await ctx.reply('🔧 OpenCode is working... (checking details)')
        try {
          const todos = await client.getSessionTodo(sessionId)
          const inProgress = todos.filter(t => t.status === 'in_progress')
          const pending = todos.filter(t => t.status === 'pending')

          let message = '🔧 <b>Working on:</b>\n\n'
          if (inProgress.length > 0) {
            message += '<b>In Progress:</b>\n'
            for (const t of inProgress) {
              message += `🔄 ${escapeHtml(t.content)}\n`
            }
            message += '\n'
          }
          if (pending.length > 0) {
            message += '<b>Up Next:</b>\n'
            for (const t of pending.slice(0, 5)) {
              message += `⬜ ${escapeHtml(t.content)}\n`
            }
          }
          if (inProgress.length === 0 && pending.length === 0) {
            message += 'No tasks in todo list. OpenCode may be planning or thinking.'
          }

          await ctx.reply(message, { parse_mode: 'HTML' })
        } catch {
          await ctx.reply('🔧 OpenCode is working but could not fetch details.')
        }
      } else {
        await ctx.reply('✅ OpenCode is idle. No active work.')
      }
    } catch {
      await ctx.reply('Could not check session status.')
    }
  })

  // Newtopic command — create a session in a forum topic
  bot.command('newtopic', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    const threadId = ctx.message?.message_thread_id ?? 0
    if (threadId === 0) {
      await ctx.reply('This command only works in forum topics. Use /session in direct chat.')
      return
    }

    log.info('User command', { command: '/newtopic', threadId, userId: ctx.from?.id })

    const args = (ctx.match as string || '').trim()

    if (args) {
      const worktree = getWorktreeRoot()
      const absPath = args.startsWith('/') ? args : `${process.env.HOME || '/home/fadh'}/${args}`
      if (!absPath.startsWith(worktree)) {
        await ctx.reply(`❌ Directory must be within workspace: \`${escapeHtml(worktree)}\``, { parse_mode: 'HTML' })
        return
      }

      try {
        const oldSession = stateManager.getTopicSession(ctx.chat.id, threadId)
        if (oldSession && eventProcessor) {
          await eventProcessor.forceSessionIdle(oldSession, ctx.chat.id, '↪️ New session created')
        }

        const session = await client.createSession(absPath)
        stateManager.setTopicSession(ctx.chat.id, threadId, session.id)

        await ctx.reply(
          `✅ <b>Session created for this topic</b>\n` +
          `ID: <code>${escapeHtml(session.id)}</code>\n` +
          `Directory: <code>${escapeHtml(session.directory)}</code>\n\n` +
          `Send any message to start!`,
          { parse_mode: 'HTML' }
        )
      } catch (error) {
        await ctx.reply(`❌ Failed to create session: ${(error as Error).message}`)
      }
      return
    }

    try {
      const startDir = getWorktreeRoot()
      const subdirs = await listSubdirs(client, startDir).catch(() => [])
      setBrowseState(ctx.chat.id, threadId, { path: startDir, subdirs, page: 0 })

      const view = buildDirBrowser(startDir, subdirs, 0)
      await ctx.reply(view.text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: view.inlineKeyboard },
      })
    } catch (error) {
      await ctx.reply(`Failed to list directories: ${(error as Error).message}`)
    }
  })

  // Help command
  bot.command('help', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/help', userId: ctx.from?.id })

    await ctx.reply(
      '<b>OpenCode Telegram Bot Help</b>\n\n' +
      '<b>Session Commands:</b>\n' +
      '/session - Create new session\n' +
      '/session <id> - Select existing session\n' +
      '/sessions - List recent sessions\n' +
      '/continue - Continue old session (interactive)\n' +
      '/newtopic - Create session in a forum topic\n' +
      '/status - Show current status\n' +
      '/working - Show what OpenCode is doing now\n' +
      '/abort - Stop running session\n' +
      '/clear - Clear current settings\n\n' +
      '<b>Model Commands:</b>\n' +
      '/providers - List AI providers\n' +
      '/models <provider> - List models for provider\n' +
      '/model - Show current model\n' +
      '/model <provider> <model> - Select model\n\n' +
      '<b>Mode Commands:</b>\n' +
      '/mode - Show current mode\n' +
      '/mode <name> - Select mode\n' +
      '/modes - List available modes\n\n' +
      '<b>File Commands:</b>\n' +
      '/files [path] - List files in directory\n' +
      '/file <path> - View file content\n' +
      '/find <pattern> - Search code\n\n' +
      '<b>Info Commands:</b>\n' +
      '/cost - Show cost tracking\n' +
      '/todo - Show task list\n' +
      '/diff - Show file changes\n' +
      '/working - Show current working task\n\n' +
      '<b>Usage:</b>\n' +
      'Just send any message to prompt OpenCode!\n' +
      'Multiple messages are queued and processed in order.\n\n' +
      '<b>Tips:</b>\n' +
      '• Use <code>/providers</code> then <code>/models <provider></code> to browse\n' +
      '• Use <code>/mode plan</code> for planning\n' +
      '• Use <code>/mode build</code> for coding\n' +
      '• Use <code>/abort</code> to stop a running task\n' +
      '• Use <code>/working</code> to check what OpenCode is doing\n' +
      '• Use <code>/todo</code> to see the task list\n' +
      '• Send multiple messages — they queue automatically',
      { parse_mode: 'HTML' }
    )
  })

  // History command
  bot.command('history', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/history', userId: ctx.from?.id })

    const { sessionId, threadId } = resolveSessionFromCtx(ctx)
    if (!sessionId) {
      await ctx.reply(threadId > 0 ? 'No session bound to this topic.' : 'No session selected.')
      return
    }

    const args = (ctx.match as string || '').trim()

    try {
      const messages = await client.getMessages(sessionId, 50)
      const lastPage = Math.ceil(messages.length / HISTORY_PAGE_SIZE) || 1
      const page = Math.max(1, parseInt(args, 10) || lastPage)
      const paginated = paginateMessages(messages, page, HISTORY_PAGE_SIZE)
      const text = formatHistoryPage(paginated.items, paginated.page, paginated.totalPages, sessionId)
      const keyboard = buildHistoryKeyboard(paginated.page, paginated.totalPages, sessionId)

      const replyOpts: any = { parse_mode: 'HTML', reply_markup: keyboard }
      if (threadId > 0) replyOpts.message_thread_id = threadId
      await ctx.reply(text, replyOpts)
    } catch (error) {
      await ctx.reply(`Failed to fetch history: ${(error as Error).message}`)
    }
  })

}
