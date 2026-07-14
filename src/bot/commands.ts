import { Bot } from 'grammy'
import { StateManager } from '../state/manager.js'
import { OpenCodeClient, Model, Provider } from '../opencode/client.js'
import { EventProcessor } from '../opencode/events.js'
import { escapeMarkdown, splitMessage } from '../utils/formatter.js'
import { paginateMessages, formatHistoryPage, buildHistoryKeyboard, HISTORY_PAGE_SIZE } from './history.js'
import { buildDirBrowser, listSubdirs, setBrowseState } from './dirBrowser.js'
import { getLogger } from '../utils/logger.js'

// Build the "Available Providers" message. Pure + exported so it can be unit
// tested and, crucially, chunked with splitMessage before sending (a long
// provider list otherwise exceeds Telegram's 4096-char limit -> 400).
export function formatProvidersList(providers: Array<{ id: string; models?: Record<string, any> }>): string {
  let message = '*Available Providers:*\n\n'
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i]
    const modelCount = Object.keys(p.models || {}).length
    message += `${i + 1}. \`${escapeMarkdown(p.id)}\` (${modelCount} models)\n`
  }
  message += '\nUse `/models <provider>` to see models for a provider.'
  if (providers.length > 0) {
    message += '\nExample: `/models ' + escapeMarkdown(providers[0].id) + '`'
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
  function resolveSessionFromCtx(ctx: any): { sessionId?: string; threadId: number; cwd?: string; model?: { providerId: string; modelId: string }; mode?: string } {
    const threadId = ctx.message?.message_thread_id ?? 0
    if (threadId > 0) {
      const binding = stateManager.getTopicSession(ctx.chat.id, threadId)
      return { sessionId: binding?.sessionId, threadId, cwd: binding?.cwd, model: binding?.model, mode: binding?.mode }
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
      '*Welcome to OpenCode Telegram Bot!*\n\n' +
      '*Session Commands:*\n' +
      '/session - Create new session\n' +
      '/sessions - List recent sessions\n' +
      '/continue - Continue an old session\n' +
      '/newtopic - Create session in a forum topic\n' +
      '/status - Show current session\n' +
      '/abort - Stop running task\n' +
      '/clear - Clear current session\n\n' +
      '*Model Commands:*\n' +
      '/providers - List AI providers\n' +
      '/models <provider> - List models for provider\n' +
      '/model - Show/select current model\n\n' +
      '*Mode Commands:*\n' +
      '/mode - Select mode (build/plan)\n' +
      '/modes - List available modes\n\n' +
      '*File Commands:*\n' +
      '/files - List project files\n' +
      '/file <path> - View file content\n' +
      '/find <pattern> - Search code\n\n' +
      '*Info Commands:*\n' +
      '/cost - Show cost tracking\n' +
      '/todo - Show task list\n' +
      '/diff - Show file changes\n\n' +
      'Just send any message to prompt OpenCode!\n' +
      '_Multiple messages are queued automatically._',
      { parse_mode: 'Markdown' }
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
          stateManager.setTopicSession(ctx.chat.id, threadId, { sessionId: session.id, cwd: session.directory || '' })
        } else {
          stateManager.setCurrentSession(ctx.chat.id, session.id)
        }
        await ctx.reply(`Selected session: \`${escapeMarkdown(session.id)}\``, {
          parse_mode: 'Markdown',
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
          stateManager.setTopicSession(ctx.chat.id, threadId, { sessionId: session.id, cwd: session.directory || '' })
        } else {
          stateManager.setCurrentSession(ctx.chat.id, session.id)
        }
        await ctx.reply(`Created new session: \`${escapeMarkdown(session.id)}\`\n\nSend any message to start!`, {
          parse_mode: 'Markdown',
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
      const threadId = ctx.message?.message_thread_id ?? 0
      const cwd = threadId > 0 ? stateManager.getTopicSession(ctx.chat.id, threadId)?.cwd : undefined
      const sessions = await client.listSessions({ limit: 10, directory: cwd })

      if (sessions.length === 0) {
        if (cwd) {
          await ctx.reply(`No sessions found in \`${escapeMarkdown(cwd)}\`. Use /newtopic to create one.`, { parse_mode: 'Markdown' })
        } else {
          await ctx.reply('No sessions found. Use /session to create a new one.')
        }
        return
      }

      const inlineKeyboard = sessions.map((s) => {
        const title = `${s.directory ? `[${s.directory.split('/').pop() || s.directory}] ` : ''}${s.title || s.id.slice(0, 20)}`
        return [{ text: title.substring(0, 64), callback_data: `session:${s.id}` }]
      })

      await ctx.reply('*Select a session to continue:*', {
        parse_mode: 'Markdown',
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
      const threadId = ctx.message?.message_thread_id ?? 0
      const cwd = threadId > 0 ? stateManager.getTopicSession(ctx.chat.id, threadId)?.cwd : undefined
      const sessions = await client.listSessions({ limit: 10, directory: cwd })
      if (sessions.length === 0) {
        await ctx.reply('No sessions found.')
        return
      }

      let message = '*Recent Sessions:*\n\n'
      for (const s of sessions) {
        const title = s.title || '(untitled)'
        message += `- \`${escapeMarkdown(s.id)}\`\n  ${escapeMarkdown(title)}\n\n`
      }
      message += 'Use `/session <id>` to select a session.'

      await ctx.reply(message, { parse_mode: 'Markdown' })
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
    await ctx.reply('Cleared current session, model, and mode settings.')
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
    let cwd = ''

    if (threadId > 0) {
      const binding = stateManager.getTopicSession(ctx.chat.id, threadId)
      if (!binding) {
        await ctx.reply('No session bound to this topic. Use /newtopic to create one.')
        return
      }
      sessionId = binding.sessionId
      cwd = binding.cwd
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

    let message = '*Current Status*\n\n'

    try {
      const session = await client.getSession(sessionId)
      const sessionTitle = session.title || '(untitled)'
      message += `*Session:*\n`
      message += `ID: \`${escapeMarkdown(session.id)}\`\n`
      message += `Title: ${escapeMarkdown(sessionTitle)}\n`
      message += `Directory: \`${escapeMarkdown(session.directory)}\`\n`

      if ((session as any).summary) {
        const summary = (session as any).summary
        message += `Changes: +${summary.additions || 0} -${summary.deletions || 0} (${summary.files || 0} files)\n`
      }

      if ((session as any).permission && (session as any).permission.length > 0) {
        const perms = (session as any).permission as Array<{ permission: string; pattern: string; action: string }>
        const overrides = perms.filter(p => p.action === 'deny')
        if (overrides.length > 0) {
          message += `*Permission overrides:*\n`
          for (const p of overrides) {
            message += `  \`${escapeMarkdown(p.permission)}\` → ${p.action} (${escapeMarkdown(p.pattern)})\n`
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
      message += `*Session:* \`${escapeMarkdown(sessionId)}\` (not found)\n\n`
    }

    const binding = threadId > 0 ? stateManager.getTopicSession(ctx.chat.id, threadId) : undefined
    const topicModel = binding?.model
    const model = topicModel || stateManager.getCurrentModel(ctx.chat.id)
    if (model) {
      message += `*Model:* ${escapeMarkdown(model.providerId)}/${escapeMarkdown(model.modelId)}\n\n`
    } else {
      try {
        const status = await client.getSessionStatus(sessionId)
        if (status?.model) {
          message += `*Model:* ${escapeMarkdown(status.model)} (from session)\n\n`
        } else {
          message += `*Model:* Default (OpenCode configured default)\n\n`
        }
      } catch {
        message += `*Model:* Default (OpenCode configured default)\n\n`
      }
    }

    const topicMode = binding?.mode
    const mode = topicMode || stateManager.getCurrentMode(ctx.chat.id)
    if (mode) {
      message += `*Mode:* \`${escapeMarkdown(mode)}\`\n`
    } else {
      try {
        const status = await client.getSessionStatus(sessionId)
        if (status?.agent) {
          message += `*Mode:* \`${escapeMarkdown(status.agent)}\` (from session)\n`
        } else {
          message += `*Mode:* Default (OpenCode configured default)\n`
        }
      } catch {
        message += `*Mode:* Default (OpenCode configured default)\n`
      }
    }

    const cost = stateManager.getCost(sessionId)
    if (cost && cost.totalCost > 0) {
      message += `\n*Cost:* $${cost.totalCost.toFixed(4)} (${cost.messages} messages)\n`
    }

    const promptCount = stateManager.getPromptCount(ctx.chat.id)
    if (promptCount > 0) {
      message += `\n_Prompts sent: ${promptCount}_`
    }

    await ctx.reply(message, { parse_mode: 'Markdown' })
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

    const binding = stateManager.getTopicSession(ctx.chat.id, threadId)
    if (!binding) {
      await ctx.reply('No session bound to this topic. Use /newtopic to create one.')
      return
    }

    const arg = ctx.message?.text?.split(/\s+/)[1]?.toLowerCase()
    if (arg === 'on') {
      stateManager.setAllowSubagent(ctx.chat.id, threadId, true)
      await ctx.reply('✅ Subagent: *ON* — agent can dispatch subagents (explore/general)', { parse_mode: 'Markdown' })
    } else if (arg === 'off') {
      stateManager.setAllowSubagent(ctx.chat.id, threadId, false)
      await ctx.reply('✅ Subagent: *OFF* — agent will not dispatch subagents', { parse_mode: 'Markdown' })
    } else {
      const allowed = stateManager.getAllowSubagent(ctx.chat.id, threadId)
      const status = allowed ? 'ON' : 'OFF'
      await ctx.reply(`Subagent: *${status}*\n\nUse \`/subagent on\` or \`/subagent off\` to toggle.`, { parse_mode: 'Markdown' })
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

    let message = `*Cost Tracking*\n\n`
    message += `*Total:* $${cost.totalCost.toFixed(4)}\n`
    message += `*Messages:* ${cost.messages}\n`
    message += `*Avg/Message:* $${(cost.totalCost / cost.messages).toFixed(4)}\n\n`
    message += `*Tokens:*\n`
    message += `  Input: ${cost.totalInput.toLocaleString()}\n`
    message += `  Output: ${cost.totalOutput.toLocaleString()}\n`
    message += `  Reasoning: ${cost.totalReasoning.toLocaleString()}\n`
    message += `  Cache Read: ${cost.totalCacheRead.toLocaleString()}\n`
    message += `  Cache Write: ${cost.totalCacheWrite.toLocaleString()}\n`

    await ctx.reply(message, { parse_mode: 'Markdown' })
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

      let message = `📋 *Task List:*\n\n`
      for (const todo of todos) {
        const icon = statusIcon[todo.status] || '⬜'
        const content = todo.content?.substring(0, 80) || ''
        message += `${icon} ${escapeMarkdown(content)}\n`
      }

      await ctx.reply(message, { parse_mode: 'Markdown' })
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

      let message = `📁 *File Changes:*\n\n`
      for (const diff of diffs) {
        const statusIcon = diff.status === 'added' ? '🆕' : diff.status === 'deleted' ? '🗑️' : '📝'
        message += `${statusIcon} \`${escapeMarkdown(diff.file)}\` (+${diff.additions} -${diff.deletions})\n`
      }

      const chunks = splitMessage(message)
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'Markdown' })
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
      const threadId = ctx.message?.message_thread_id ?? 0
      if (threadId > 0) {
        const binding = stateManager.getTopicSession(ctx.chat.id, threadId)
        dirPath = binding?.cwd
      }
    }

    try {
      const entries = await client.listFiles(dirPath)

      if (entries.length === 0) {
        await ctx.reply('📂 Empty directory or not found.')
        return
      }

      let message = `📂 *Directory:*\n\n`
      for (const entry of entries) {
        const icon = entry.type === 'directory' ? '📁' : '📄'
        const name = entry.name || entry.path
        message += `${icon} \`${escapeMarkdown(name)}\`\n`
      }

      const chunks = splitMessage(message)
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'Markdown' })
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
      await ctx.reply('Usage: `/file <path>`\nExample: `/file src/index.ts`', { parse_mode: 'Markdown' })
      return
    }

    try {
      const result = await client.getFileContent(filePath)
      const content = result.content || ''

      if (!content) {
        await ctx.reply(`📄 File is empty: \`${escapeMarkdown(filePath)}\``, { parse_mode: 'Markdown' })
        return
      }

      const maxChunk = 4000
      if (content.length <= maxChunk) {
        await ctx.reply(`📄 *${escapeMarkdown(filePath)}*\n\n\`\`\`\n${content}\n\`\`\``, {
          parse_mode: 'Markdown',
        })
      } else {
        await ctx.reply(`📄 *${escapeMarkdown(filePath)}* (${content.length} chars)`, {
          parse_mode: 'Markdown',
        })

        for (let i = 0; i < content.length; i += maxChunk) {
          const chunk = content.substring(i, i + maxChunk)
          await ctx.reply(`\`\`\`\n${chunk}\n\`\`\``, { parse_mode: 'Markdown' })
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
      await ctx.reply('Usage: `/find <pattern>`\nExample: `/find function handleEvent`', { parse_mode: 'Markdown' })
      return
    }

    try {
      const results = await client.searchCode(pattern)

      if (!results || results.length === 0) {
        await ctx.reply(`🔍 No results for: \`${escapeMarkdown(pattern)}\``, { parse_mode: 'Markdown' })
        return
      }

      let message = `🔍 *Results for:* \`${escapeMarkdown(pattern)}\`\n\n`
      for (const result of results.slice(0, 20)) {
        const text = result.text?.trim().substring(0, 80) || ''
        message += `\`${escapeMarkdown(result.path)}:${result.line}\`\n${escapeMarkdown(text)}\n\n`
      }

      if (results.length > 20) {
        message += `_...and ${results.length - 20} more results_\n`
      }

      const chunks = splitMessage(message)
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'Markdown' })
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
        await ctx.reply(chunk, { parse_mode: 'Markdown' })
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
          await ctx.reply(chunk, { parse_mode: 'Markdown' })
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
        await ctx.reply(`No models found for provider: \`${escapeMarkdown(providerFilter)}\``, {
          parse_mode: 'Markdown',
        })
        return
      }

      modelsCache.set(ctx.chat.id, models)

      let message = `*Models for* \`${escapeMarkdown(providerFilter)}\`:\n\n`
      for (let i = 0; i < models.length; i++) {
        message += `${i + 1}. \`${escapeMarkdown(models[i].id)}\``
        if (models[i].name && models[i].name !== models[i].id) {
          message += ` - ${escapeMarkdown(models[i].name)}`
        }
        message += '\n'
      }
      message += `\nSelect with: \`/model ${escapeMarkdown(providerFilter)} <model_id>\``

      const chunks = splitMessage(message)
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'Markdown' })
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

    if (!args) {
      const threadId = ctx.message?.message_thread_id ?? 0
      const binding = threadId > 0 ? stateManager.getTopicSession(ctx.chat.id, threadId) : undefined
      const currentModel = binding?.model || stateManager.getCurrentModel(ctx.chat.id)

      let message = ''
      if (currentModel) {
        message += `*Current Model:*\n\`${escapeMarkdown(currentModel.providerId)}/${escapeMarkdown(currentModel.modelId)}\`\n\n`
      } else {
        message += '*No model selected.* Using default.\n\n'
      }

      message += '*Usage:*\n'
      message += '• `/providers` - List providers\n'
      message += '• `/models <provider>` - List models for provider\n'
      message += '• `/model <provider> <model>` - Select model\n\n'
      message += 'Example:\n'
      message += '`/model anthropic claude-3-opus`'

      await ctx.reply(message, { parse_mode: 'Markdown' })
      return
    }

    const parts = args.split(/\s+/)
    if (parts.length < 2) {
      await ctx.reply(
        'Invalid format. Use:\n' +
        '`/model <provider> <model>`\n\n' +
        'Example:\n' +
        '`/model anthropic claude-3-opus`',
        { parse_mode: 'Markdown' }
      )
      return
    }

    const providerId = parts[0]
    const modelId = parts.slice(1).join(' ')

    const threadId = ctx.message?.message_thread_id ?? 0
    if (threadId > 0) {
      const binding = stateManager.getTopicSession(ctx.chat.id, threadId)
      if (binding) {
        stateManager.setTopicModel(ctx.chat.id, threadId, providerId, modelId)
      } else {
        await ctx.reply('No session bound to this topic. Use /newtopic first.')
        return
      }
    } else {
      stateManager.setCurrentModel(ctx.chat.id, providerId, modelId)
    }

    await ctx.reply(
      `✅ *Model selected:*\n\`${escapeMarkdown(providerId)}/${escapeMarkdown(modelId)}\``,
      { parse_mode: 'Markdown' }
    )
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
          '*Available Modes:*\n\n' +
          '• `build` - Code implementation mode\n' +
          '• `plan` - Planning and design mode\n' +
          '• `code` - Alternative coding mode\n' +
          '• `review` - Code review mode\n' +
          '• `debug` - Debugging mode\n\n' +
          'Use `/mode <name>` to select.',
          { parse_mode: 'Markdown' }
        )
        return
      }

      let message = '*Available Modes:*\n\n'
      for (let i = 0; i < agents.length; i++) {
        const agent = agents[i]
        message += `${i + 1}. \`${escapeMarkdown(agent.name)}\``
        if (agent.description) {
          message += ` - ${escapeMarkdown(agent.description)}`
        }
        message += '\n'
      }
      message += '\nUse `/mode <name>` to select.'

      await ctx.reply(message, { parse_mode: 'Markdown' })
    } catch {
      await ctx.reply(
        '*Available Modes:*\n\n' +
        '• `build` - Code implementation mode\n' +
        '• `plan` - Planning and design mode\n' +
        '• `code` - Alternative coding mode\n' +
        '• `review` - Code review mode\n' +
        '• `debug` - Debugging mode\n\n' +
        'Use `/mode <name>` to select.',
        { parse_mode: 'Markdown' }
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

    if (!args) {
      const threadId = ctx.message?.message_thread_id ?? 0
      const binding = threadId > 0 ? stateManager.getTopicSession(ctx.chat.id, threadId) : undefined
      const currentMode = binding?.mode || stateManager.getCurrentMode(ctx.chat.id)

      let message = ''
      if (currentMode) {
        message += `*Current Mode:* \`${escapeMarkdown(currentMode)}\`\n\n`
      } else {
        message += '*No mode selected.* Using default.\n\n'
      }

      message += '*Usage:* `/mode <name>`\n\n'
      message += 'Allowed modes:\n'
      message += '• `build` - Code implementation\n'
      message += '• `plan` - Planning and design\n\n'
      message += 'Use `/modes` to see all available.'

      await ctx.reply(message, { parse_mode: 'Markdown' })
      return
    }

    if (args !== 'build' && args !== 'plan') {
      await ctx.reply(
        `❌ Invalid mode: \`${escapeMarkdown(args)}\`\n\n` +
        'Only `build` and `plan` modes are allowed.\n' +
        'Use `/mode build` or `/mode plan`.',
        { parse_mode: 'Markdown' }
      )
      return
    }

    const threadId = ctx.message?.message_thread_id ?? 0
    if (threadId > 0) {
      const binding = stateManager.getTopicSession(ctx.chat.id, threadId)
      if (binding) {
        stateManager.setTopicMode(ctx.chat.id, threadId, args)
      } else {
        await ctx.reply('No session bound to this topic. Use /newtopic first.')
        return
      }
    } else {
      stateManager.setCurrentMode(ctx.chat.id, args)
    }

    await ctx.reply(
      `✅ *Mode selected:* \`${escapeMarkdown(args)}\``,
      { parse_mode: 'Markdown' }
    )
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
        await ctx.reply(`🔧 *Currently working:*\n${escapeMarkdown(status)}`, { parse_mode: 'Markdown' })
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

          let message = '🔧 *Working on:*\n\n'
          if (inProgress.length > 0) {
            message += '*In Progress:*\n'
            for (const t of inProgress) {
              message += `🔄 ${escapeMarkdown(t.content)}\n`
            }
            message += '\n'
          }
          if (pending.length > 0) {
            message += '*Up Next:*\n'
            for (const t of pending.slice(0, 5)) {
              message += `⬜ ${escapeMarkdown(t.content)}\n`
            }
          }
          if (inProgress.length === 0 && pending.length === 0) {
            message += 'No tasks in todo list. OpenCode may be planning or thinking.'
          }

          await ctx.reply(message, { parse_mode: 'Markdown' })
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
      try {
        const oldBinding = stateManager.getTopicSession(ctx.chat.id, threadId)
        if (oldBinding && eventProcessor) {
          await eventProcessor.forceSessionIdle(oldBinding.sessionId, ctx.chat.id, '↪️ New session created')
        }

        const session = await client.createSession(args)
        stateManager.setTopicSession(ctx.chat.id, threadId, { sessionId: session.id, cwd: args })

        await ctx.reply(
          `✅ *Session created for this topic*\n` +
          `ID: \`${escapeMarkdown(session.id)}\`\n` +
          `Directory: \`${escapeMarkdown(args)}\`\n\n` +
          `Send any message to start!`,
          { parse_mode: 'Markdown' }
        )
      } catch (error) {
        await ctx.reply(`❌ Failed to create session: ${(error as Error).message}`)
      }
      return
    }

    try {
      // Start a navigable browser at ~/workspace; the user can descend, go up
      // (..), paginate, and Select this folder. State is kept server-side.
      const homeDir = process.env.HOME || '/home/fadh'
      const startDir = `${homeDir}/workspace`
      const subdirs = await listSubdirs(client, startDir).catch(() => [])
      setBrowseState(ctx.chat.id, threadId, { path: startDir, subdirs, page: 0 })

      const view = buildDirBrowser(startDir, subdirs, 0)
      await ctx.reply(view.text, {
        parse_mode: 'Markdown',
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
      '*OpenCode Telegram Bot Help*\n\n' +
      '*Session Commands:*\n' +
      '/session - Create new session\n' +
      '/session <id> - Select existing session\n' +
      '/sessions - List recent sessions\n' +
      '/continue - Continue old session (interactive)\n' +
      '/newtopic - Create session in a forum topic\n' +
      '/status - Show current status\n' +
      '/working - Show what OpenCode is doing now\n' +
      '/abort - Stop running session\n' +
      '/clear - Clear current settings\n\n' +
      '*Model Commands:*\n' +
      '/providers - List AI providers\n' +
      '/models <provider> - List models for provider\n' +
      '/model - Show current model\n' +
      '/model <provider> <model> - Select model\n\n' +
      '*Mode Commands:*\n' +
      '/mode - Show current mode\n' +
      '/mode <name> - Select mode\n' +
      '/modes - List available modes\n\n' +
      '*File Commands:*\n' +
      '/files [path] - List files in directory\n' +
      '/file <path> - View file content\n' +
      '/find <pattern> - Search code\n\n' +
      '*Info Commands:*\n' +
      '/cost - Show cost tracking\n' +
      '/todo - Show task list\n' +
      '/diff - Show file changes\n' +
      '/working - Show current working task\n\n' +
      '*Usage:*\n' +
      'Just send any message to prompt OpenCode!\n' +
      'Multiple messages are queued and processed in order.\n\n' +
      '*Tips:*\n' +
      '• Use `/providers` then `/models <provider>` to browse\n' +
      '• Use `/mode plan` for planning\n' +
      '• Use `/mode build` for coding\n' +
      '• Use `/abort` to stop a running task\n' +
      '• Use `/working` to check what OpenCode is doing\n' +
      '• Use `/todo` to see the task list\n' +
      '• Send multiple messages — they queue automatically',
      { parse_mode: 'Markdown' }
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

    const page = Math.max(1, parseInt((ctx.match as string || '').trim(), 10) || 1)

    try {
      const messages = await client.getMessages(sessionId, 50)
      const reversed = [...messages].reverse()
      const paginated = paginateMessages(reversed, page, HISTORY_PAGE_SIZE)
      const text = formatHistoryPage(paginated.items, paginated.page, paginated.totalPages, sessionId)
      const keyboard = buildHistoryKeyboard(paginated.page, paginated.totalPages, sessionId)

      const replyOpts: any = { parse_mode: 'Markdown', reply_markup: keyboard }
      if (threadId > 0) replyOpts.message_thread_id = threadId
      await ctx.reply(text, replyOpts)
    } catch (error) {
      await ctx.reply(`Failed to fetch history: ${(error as Error).message}`)
    }
  })

}
