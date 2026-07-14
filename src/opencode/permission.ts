import { Bot } from 'grammy'
import { OpenCodeClient } from './client.js'
import { StateManager } from '../state/manager.js'
import { PermissionRequest } from '../types/index.js'
import { formatPermissionRequest } from '../utils/formatter.js'
import { getLogger } from '../utils/logger.js'

export class PermissionHandler {
  private pendingRequests = new Map<string, { chatId: number; messageId: number; sentAt: number }>()
  private readonly PERMISSION_TIMEOUT_MS = 5 * 60 * 1000

  constructor(
    private client: OpenCodeClient,
    private bot: Bot,
    private stateManager: StateManager
  ) {}

  async handlePermissionRequest(permission: PermissionRequest): Promise<void> {
    const log = getLogger()
    // Resolve topic-bound sessions too — forum-topic sessions are invisible to the
    // legacy chatId→session map, which previously dropped their approval prompts.
    const target = this.stateManager.resolveChat(permission.sessionID)

    if (!target) {
      // Silent: This session belongs to another client (CLI or another bot)
      return
    }

    const { chatId, threadId } = target
    const message = formatPermissionRequest(permission)

    try {
      const sendOpts: any = {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Once', callback_data: `perm:once:${permission.id}` },
              { text: '🔄 Always', callback_data: `perm:always:${permission.id}` },
            ],
            [
              { text: '❌ Reject', callback_data: `perm:reject:${permission.id}` },
            ],
          ],
        },
      }
      if (threadId > 0) sendOpts.message_thread_id = threadId

      const msg = await this.bot.api.sendMessage(chatId, message, sendOpts)

      this.pendingRequests.set(permission.id, { chatId, messageId: msg.message_id, sentAt: Date.now() })
      log.info('Permission request sent', { requestId: permission.id, chatId, threadId })
    } catch (error) {
      log.error('Failed to send permission request', { error: (error as Error).message })
    }
  }

  async handlePermissionReply(callbackQuery: any): Promise<void> {
    const log = getLogger()
    const data = callbackQuery.data
    const [_, reply, requestId] = data.split(':')

    if (!this.pendingRequests.has(requestId)) {
      await this.bot.api.answerCallbackQuery(callbackQuery.id, {
        text: 'This permission request has expired',
      })
      try {
        await this.bot.api.editMessageText(
          callbackQuery.message.chat.id,
          callbackQuery.message.message_id,
          `Permission ${reply === 'reject' ? 'Rejected' : 'Approved'} (expired request)`
        )
      } catch {
        // Message may be gone
      }
      return
    }

    try {
      await this.client.replyPermission(requestId, reply as any)

      const statusText = reply === 'reject' ? 'Rejected' : 'Approved'
      const message = callbackQuery.message

      if (message) {
        await this.bot.api.editMessageText(
          message.chat.id,
          message.message_id,
          `Permission ${statusText}`
        ).catch(() => {})
      }

      this.pendingRequests.delete(requestId)
      await this.bot.api.answerCallbackQuery(callbackQuery.id)
      log.info('Permission replied', { requestId, reply })
    } catch (error) {
      log.error('Failed to reply to permission', { error: (error as Error).message })
      await this.bot.api.answerCallbackQuery(callbackQuery.id, {
        text: 'Failed to process permission',
      })
    }
  }

  async checkPendingPermissions(): Promise<void> {
    try {
      const permissions = await this.client.listPermissions()

      for (const permission of permissions) {
        if (!this.pendingRequests.has(permission.id)) {
          await this.handlePermissionRequest(permission)
        }
      }
    } catch (error) {
      getLogger().error('Failed to check pending permissions', { error: (error as Error).message })
    }
  }

  async checkPermissionTimeouts(): Promise<void> {
    const log = getLogger()
    const now = Date.now()

    for (const [requestId, info] of [...this.pendingRequests.entries()]) {
      if (now - info.sentAt < this.PERMISSION_TIMEOUT_MS) continue

      try {
        await this.client.replyPermission(requestId, 'reject')
      } catch {
        // Permission may already be gone from the server — proceed with cleanup
      }

      this.pendingRequests.delete(requestId)

      try {
        await this.bot.api.editMessageText(
          info.chatId,
          info.messageId,
          '⏰ Permission request expired (auto-rejected after 5 min)'
        )
      } catch {
        // Message may have been deleted
      }

      log.info('Permission timed out', { requestId })
    }
  }
}
