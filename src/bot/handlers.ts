import { Bot } from 'grammy'
import { StateManager } from '../state/manager.js'
import { OpenCodeClient } from '../opencode/client.js'
import { PermissionHandler } from '../opencode/permission.js'
import { EventProcessor } from '../opencode/events.js'
import { MessageQueue } from './queue.js'
import { getLogger } from '../utils/logger.js'
import { paginateMessages, formatHistoryPage, buildHistoryKeyboard } from './history.js'
import { TranscriptionClient, transcribeAudio } from '../opencode/voice.js'
import { answerForIndex } from '../opencode/questionFormat.js'
import { pickLargestPhoto, buildImagePart } from './photo.js'
import { buildDirBrowser, parentDir, listSubdirs, getBrowseState, setBrowseState, clearBrowseState } from './dirBrowser.js'

function resolveSession(ctx: any, stateManager: StateManager): { sessionId?: string; threadId: number } {
  const threadId = ctx.message?.message_thread_id ?? 0
  if (threadId > 0) {
    const binding = stateManager.getTopicSession(ctx.chat.id, threadId)
    return { sessionId: binding?.sessionId, threadId }
  }
  return { sessionId: stateManager.getCurrentSession(ctx.chat.id), threadId: 0 }
}

function getThreadId(ctx: any): number {
  return ctx.message?.message_thread_id ?? ctx.callbackQuery?.message?.message_thread_id ?? 0
}

export function registerHandlers(
  bot: Bot,
  stateManager: StateManager,
  client: OpenCodeClient,
  permissionHandler: PermissionHandler,
  eventProcessor: EventProcessor,
  messageQueue: MessageQueue
) {
  const log = getLogger()

  // Handle text messages
  bot.on('message:text', async (ctx) => {
    const userId = ctx.from?.id.toString()
    if (userId !== process.env.AUTHORIZED_USER_ID) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    const threadId = getThreadId(ctx)
    const { sessionId } = resolveSession(ctx, stateManager)
    if (!sessionId) {
      if (threadId > 0) {
        await ctx.reply('No session bound to this topic. Use /newtopic to create one.')
      } else {
        await ctx.reply('No session selected. Use /session to create or select one.')
      }
      return
    }

    const text = ctx.message.text

    // Skip if it's a command
    if (text.startsWith('/')) {
      return
    }

    // If session is busy, queue the message
    if (messageQueue.isBusy(ctx.chat.id, threadId)) {
      try {
        const position = messageQueue.getQueueLength(ctx.chat.id, threadId) + 1
        await messageQueue.enqueue(ctx.chat.id, text, threadId)
        await ctx.reply(`📋 Queued (position ${position}). Will process when current task finishes.`)
      } catch (error) {
        await ctx.reply(`❌ Failed to queue message: ${(error as Error).message}`)
      }
      return
    }

    // Get selected model and mode — topic-specific takes priority
    const binding = threadId > 0 ? stateManager.getTopicSession(ctx.chat.id, threadId) : undefined
    const selectedModel = binding?.model || stateManager.getCurrentModel(ctx.chat.id)
    const selectedMode = binding?.mode || stateManager.getCurrentMode(ctx.chat.id)

    // Increment prompt counter
    const count = stateManager.incrementPromptCount(ctx.chat.id)
    if (count > 0 && count % 10 === 0) {
      await ctx.reply(`📊 You've sent ${count} prompts. Use /cost to check spending.`)
    }

    // Mark session as busy
    messageQueue.setBusy(ctx.chat.id, threadId)

    // Send "working" message
    const replyOpts: any = {}
    if (threadId > 0) replyOpts.message_thread_id = threadId
    const workingMsg = await ctx.reply('⏳ OpenCode is working...', replyOpts)

    // Store the working message so we can update it when done
    eventProcessor.setWorkingMessage(sessionId, ctx.chat.id, workingMsg.message_id, threadId)

    try {
      // Send async message to OpenCode with model and mode selection
      await client.sendAsyncMessage(sessionId, text, {
        providerId: selectedModel?.providerId,
        modelId: selectedModel?.modelId,
        agent: selectedMode,
      })

      log.info('Sent to OpenCode', { sessionId, chatId: ctx.chat.id, threadId })
    } catch (error) {
      log.error('Failed to send message', { error: (error as Error).message })
      messageQueue.setIdle(ctx.chat.id, threadId)

      await ctx.api.editMessageText(
        ctx.chat.id,
        workingMsg.message_id,
        `❌ Error: ${(error as Error).message}`
      )

      // Try to process queue in case there are waiting messages
      const next = messageQueue.dequeue(ctx.chat.id, threadId)
      if (next) {
        messageQueue.setBusy(ctx.chat.id, threadId)
        try {
          const newWorkingMsg = await ctx.reply('⏳ Processing next queued message...', replyOpts)
          eventProcessor.setWorkingMessage(sessionId, ctx.chat.id, newWorkingMsg.message_id, threadId)
          await client.sendAsyncMessage(sessionId, next.text, {
            providerId: selectedModel?.providerId,
            modelId: selectedModel?.modelId,
            agent: selectedMode,
          })
          next.resolve()
        } catch {
          messageQueue.setIdle(ctx.chat.id, threadId)
          next.reject(error as Error)
        }
      }
    }
  })

  // Handle photo messages (image → prompt to the agent)
  bot.on('message:photo', async (ctx) => {
    const userId = ctx.from?.id.toString()
    if (userId !== process.env.AUTHORIZED_USER_ID) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    const threadId = getThreadId(ctx)
    const { sessionId } = resolveSession(ctx, stateManager)
    if (!sessionId) {
      if (threadId > 0) {
        await ctx.reply('No session bound to this topic. Use /newtopic to create one.')
      } else {
        await ctx.reply('No session selected. Use /session to create or select one.')
      }
      return
    }

    // Images can't be queued (the queue only holds text) — ask to resend later.
    if (messageQueue.isBusy(ctx.chat.id, threadId)) {
      await ctx.reply("⏳ Agent is busy — please resend the photo once it's done (images can't be queued).")
      return
    }

    const replyOpts: any = {}
    if (threadId > 0) replyOpts.message_thread_id = threadId

    try {
      const largest = pickLargestPhoto(ctx.message.photo)
      if (!largest) {
        await ctx.reply('❌ Could not read the photo.')
        return
      }
      const file = await ctx.api.getFile(largest.file_id)
      const token = process.env.TELEGRAM_BOT_TOKEN
      const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`
      const resp = await fetch(url)
      const buffer = Buffer.from(await resp.arrayBuffer())
      const mime = file.file_path?.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
      const part = buildImagePart(mime, buffer.toString('base64'), file.file_path?.split('/').pop() || 'photo.jpg')

      const caption = ctx.message.caption || ''
      const binding = threadId > 0 ? stateManager.getTopicSession(ctx.chat.id, threadId) : undefined
      const selectedModel = binding?.model || stateManager.getCurrentModel(ctx.chat.id)
      const selectedMode = binding?.mode || stateManager.getCurrentMode(ctx.chat.id)

      stateManager.incrementPromptCount(ctx.chat.id)
      messageQueue.setBusy(ctx.chat.id, threadId)
      const workingMsg = await ctx.reply('📷 Image sent — OpenCode is working...', replyOpts)
      eventProcessor.setWorkingMessage(sessionId, ctx.chat.id, workingMsg.message_id, threadId)

      await client.sendAsyncMessage(sessionId, caption, {
        providerId: selectedModel?.providerId,
        modelId: selectedModel?.modelId,
        agent: selectedMode,
        files: [part],
      })
      log.info('Sent image to OpenCode', { sessionId, chatId: ctx.chat.id, threadId })
    } catch (error) {
      log.error('Failed to send image', { error: (error as Error).message })
      messageQueue.setIdle(ctx.chat.id, threadId)
      await ctx.reply(`❌ Failed to send image: ${(error as Error).message}`)
    }
  })

  // Handle voice messages (transcription → prompt)
  bot.on('message:voice', async (ctx) => {
    const userId = ctx.from?.id.toString()
    if (userId !== process.env.AUTHORIZED_USER_ID) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    const threadId = getThreadId(ctx)
    const { sessionId } = resolveSession(ctx, stateManager)
    if (!sessionId) {
      if (threadId > 0) {
        await ctx.reply('No session bound to this topic. Use /newtopic to create one.')
      } else {
        await ctx.reply('No session selected. Use /session to create or select one.')
      }
      return
    }

    const transcribingMsg = await ctx.reply('🎤 Transcribing voice...')

    try {
      const file = await ctx.api.getFile(ctx.message.voice.file_id)
      const token = process.env.TELEGRAM_BOT_TOKEN
      const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`
      const audioResp = await fetch(url)
      const audioBuffer = Buffer.from(await audioResp.arrayBuffer())

      if (!process.env.OPENAI_API_KEY) {
        await ctx.api.editMessageText(
          ctx.chat.id,
          transcribingMsg.message_id,
          '❌ OPENAI_API_KEY not configured'
        )
        return
      }

      const transcriptionClient = new TranscriptionClient({
        apiKey: process.env.OPENAI_API_KEY!,
        baseUrl: process.env.OPENAI_BASE_URL,
      })
      const transcript = await transcribeAudio(transcriptionClient, audioBuffer, file.file_path || 'voice.ogg')
      await ctx.api.editMessageText(
        ctx.chat.id,
        transcribingMsg.message_id,
        `🎤 ${transcript}`
      )

      // Forward as prompt — same flow as text
      if (messageQueue.isBusy(ctx.chat.id, threadId)) {
        try {
          const position = messageQueue.getQueueLength(ctx.chat.id, threadId) + 1
          await messageQueue.enqueue(ctx.chat.id, transcript, threadId)
          await ctx.reply(`📋 Queued (position ${position}). Will process when current task finishes.`)
        } catch (error) {
          await ctx.reply(`❌ Failed to queue message: ${(error as Error).message}`)
        }
        return
      }

      const binding = threadId > 0 ? stateManager.getTopicSession(ctx.chat.id, threadId) : undefined
      const selectedModel = binding?.model || stateManager.getCurrentModel(ctx.chat.id)
      const selectedMode = binding?.mode || stateManager.getCurrentMode(ctx.chat.id)

      stateManager.incrementPromptCount(ctx.chat.id)
      messageQueue.setBusy(ctx.chat.id, threadId)

      const replyOpts: any = {}
      if (threadId > 0) replyOpts.message_thread_id = threadId
      const workingMsg = await ctx.reply('⏳ OpenCode is working...', replyOpts)
      eventProcessor.setWorkingMessage(sessionId, ctx.chat.id, workingMsg.message_id, threadId)

      try {
        await client.sendAsyncMessage(sessionId, transcript, {
          providerId: selectedModel?.providerId,
          modelId: selectedModel?.modelId,
          agent: selectedMode,
        })
        log.info('Sent voice transcript to OpenCode', { sessionId, chatId: ctx.chat.id, threadId })
      } catch (error) {
        log.error('Failed to send voice transcript', { error: (error as Error).message })
        messageQueue.setIdle(ctx.chat.id, threadId)

        await ctx.api.editMessageText(
          ctx.chat.id,
          workingMsg.message_id,
          `❌ Error: ${(error as Error).message}`
        )

        const next = messageQueue.dequeue(ctx.chat.id, threadId)
        if (next) {
          messageQueue.setBusy(ctx.chat.id, threadId)
          try {
            const newWorkingMsg = await ctx.reply('⏳ Processing next queued message...', replyOpts)
            eventProcessor.setWorkingMessage(sessionId, ctx.chat.id, newWorkingMsg.message_id, threadId)
            await client.sendAsyncMessage(sessionId, next.text, {
              providerId: selectedModel?.providerId,
              modelId: selectedModel?.modelId,
              agent: selectedMode,
            })
            next.resolve()
          } catch {
            messageQueue.setIdle(ctx.chat.id, threadId)
            next.reject(error as Error)
          }
        }
      }
    } catch (error) {
      log.error('Voice transcription failed', { error: (error as Error).message })
      await ctx.api.editMessageText(
        ctx.chat.id,
        transcribingMsg.message_id,
        `❌ Transcription failed: ${(error as Error).message}`
      )
    }
  })

  // Handle callback queries (inline buttons)
  bot.on('callback_query:data', async (ctx) => {
    const userId = ctx.from?.id.toString()
    const data = ctx.callbackQuery.data

    if (userId !== process.env.AUTHORIZED_USER_ID) {
      await ctx.answerCallbackQuery('Not authorized')
      return
    }

    // Permission callbacks
    if (data.startsWith('perm:')) {
      await permissionHandler.handlePermissionReply(ctx.callbackQuery)
      return
    }

    // Question callbacks: q:<questionId>:<answerIndex> or q:reject:<questionId>
    if (data.startsWith('q:')) {
      const parts = data.split(':')
      if (parts[1] === 'reject') {
        const questionId = parts[2]
        try {
          await client.rejectQuestion(questionId)
          await ctx.answerCallbackQuery('Question dismissed')
          await ctx.editMessageText('❌ Question dismissed')
        } catch (error) {
          log.error('Failed to reject question', { error: (error as Error).message })
          await ctx.answerCallbackQuery('Failed to dismiss')
        }
      } else {
        const questionId = parts[1]
        const answerIndex = parseInt(parts[2], 10)
        try {
          // Resolve the tapped index to its option LABEL (the API replies with
          // labels, not indices) by re-reading the still-pending question.
          const pending = await client.listQuestions().catch(() => [])
          const req = pending.find(q => q.id === questionId)
          const resolved = req ? answerForIndex(req, answerIndex) : undefined
          if (!resolved) {
            await ctx.answerCallbackQuery('This question is no longer active')
            await ctx.editMessageText('⏱ Question expired').catch(() => {})
            return
          }
          await client.replyQuestion(questionId, resolved.answers)
          await ctx.answerCallbackQuery(`Selected: ${resolved.label}`)
          await ctx.editMessageText(`✅ Answered: ${resolved.label}`).catch(() => {})
        } catch (error) {
          log.error('Failed to reply to question', { error: (error as Error).message })
          await ctx.answerCallbackQuery('Failed to answer')
        }
      }
      return
    }

    // Session selection callbacks
    if (data.startsWith('session:')) {
      const sessionId = data.replace('session:', '')
      const threadId = getThreadId(ctx)

      if (threadId > 0) {
        const oldBinding = stateManager.getTopicSession(ctx.chat!.id, threadId)
        if (oldBinding && oldBinding.sessionId !== sessionId) {
          await eventProcessor.forceSessionIdle(oldBinding.sessionId, ctx.chat!.id, '↪️ Session switched')
        }
        const session = await client.getSession(sessionId).catch(() => null)
        const cwd = session?.directory || ''
        stateManager.setTopicSession(ctx.chat!.id, threadId, { sessionId, cwd })
      } else {
        const oldSessionId = stateManager.getCurrentSession(ctx.chat!.id)
        if (oldSessionId && oldSessionId !== sessionId) {
          await eventProcessor.forceSessionIdle(oldSessionId, ctx.chat!.id, '↪️ Session switched')
        }
        stateManager.setCurrentSession(ctx.chat!.id, sessionId)
      }

      await ctx.answerCallbackQuery('Session selected')
      await ctx.editMessageText(`✅ Session selected: \`${sessionId}\``, { parse_mode: 'Markdown' })
      return
    }

    // Directory selection callbacks (for /newtopic)
    if (data.startsWith('dir:')) {
      const directory = data.replace('dir:', '')
      const threadId = getThreadId(ctx)

      if (threadId === 0) {
        await ctx.answerCallbackQuery('This command only works in forum topics')
        return
      }

      try {
        const oldBinding = stateManager.getTopicSession(ctx.chat!.id, threadId)
        if (oldBinding) {
          await eventProcessor.forceSessionIdle(oldBinding.sessionId, ctx.chat!.id, '↪️ New session created')
        }

        const session = await client.createSession(directory)
        stateManager.setTopicSession(ctx.chat!.id, threadId, { sessionId: session.id, cwd: directory })

        await ctx.answerCallbackQuery('Session created')
        await ctx.editMessageText(
          `✅ *New session created*\n` +
          `ID: \`${session.id}\`\n` +
          `Directory: \`${directory}\`\n\n` +
          `Send any message to start!`,
          { parse_mode: 'Markdown' }
        )
      } catch (error) {
        log.error('Failed to create topic session', { error: (error as Error).message })
        await ctx.answerCallbackQuery('Failed')
        await ctx.editMessageText(`❌ Failed to create session: ${(error as Error).message}`)
      }
      return
    }

    // Navigable directory browser (for /newtopic)
    if (data === 'dnoop') { await ctx.answerCallbackQuery(); return }
    if (data.startsWith('dnav:') || data === 'dup' || data.startsWith('dpg:') || data === 'dpick' || data === 'dcancel') {
      const threadId = getThreadId(ctx)
      const chatId = ctx.chat!.id
      const state = getBrowseState(chatId, threadId)
      if (!state) {
        await ctx.answerCallbackQuery('Browser expired — run /newtopic again')
        return
      }

      if (data === 'dcancel') {
        clearBrowseState(chatId, threadId)
        await ctx.answerCallbackQuery('Cancelled')
        await ctx.editMessageText('❌ Cancelled').catch(() => {})
        return
      }

      if (data === 'dpick') {
        try {
          const oldBinding = stateManager.getTopicSession(chatId, threadId)
          if (oldBinding) {
            await eventProcessor.forceSessionIdle(oldBinding.sessionId, chatId, '↪️ New session created')
          }
          const session = await client.createSession(state.path)
          stateManager.setTopicSession(chatId, threadId, { sessionId: session.id, cwd: state.path })
          clearBrowseState(chatId, threadId)
          await ctx.answerCallbackQuery('Session created')
          await ctx.editMessageText(
            `✅ *New session created*\n` +
            `Directory: \`${state.path}\`\n\n` +
            `Send any message to start!`,
            { parse_mode: 'Markdown' }
          )
        } catch (error) {
          log.error('Failed to create topic session', { error: (error as Error).message })
          await ctx.answerCallbackQuery('Failed')
          await ctx.editMessageText(`❌ Failed to create session: ${(error as Error).message}`)
        }
        return
      }

      // Navigation: compute the new path/page, (re)list if the path changed, re-render.
      let newPath = state.path
      let newPage = state.page
      if (data.startsWith('dnav:')) {
        const idx = parseInt(data.slice('dnav:'.length), 10)
        const target = state.subdirs[idx]
        if (!target) { await ctx.answerCallbackQuery('That folder is gone'); return }
        newPath = target.path
        newPage = 0
      } else if (data === 'dup') {
        newPath = parentDir(state.path)
        newPage = 0
      } else if (data.startsWith('dpg:')) {
        newPage = parseInt(data.slice('dpg:'.length), 10) || 0
      }

      const subdirs = newPath !== state.path
        ? await listSubdirs(client, newPath).catch(() => [])
        : state.subdirs
      setBrowseState(chatId, threadId, { path: newPath, subdirs, page: newPage })

      const view = buildDirBrowser(newPath, subdirs, newPage)
      await ctx.answerCallbackQuery()
      await ctx.editMessageText(view.text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: view.inlineKeyboard },
      }).catch(() => {})
      return
    }

    // Model page navigation
    if (data.startsWith('models_page:')) {
      // Handled by commands.ts
      return
    }

    // History pagination
    if (data.startsWith('history_nop')) {
      await ctx.answerCallbackQuery()
      return
    }

    if (data.startsWith('history_page:')) {
      const parts = data.split(':')
      const page = parseInt(parts[1], 10)
      const sessionId = parts.slice(2).join(':')
      try {
        const messages = await client.getMessages(sessionId, 50)
        messages.reverse()
        const paginated = paginateMessages(messages, page)
        const text = formatHistoryPage(paginated.items, paginated.page, paginated.totalPages, sessionId)
        const keyboard = buildHistoryKeyboard(paginated.page, paginated.totalPages, sessionId)
        await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard })
      } catch (error) {
        log.error('Failed to load history page', { error: (error as Error).message })
        await ctx.answerCallbackQuery('Failed to load page')
      }
      return
    }

    await ctx.answerCallbackQuery()
  })

  // Handle errors
  bot.catch((err) => {
    log.error('Bot error', { error: err.message })
  })
}
