import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { StateManager } from '../../dist/state/manager.js'
import { PermissionHandler } from '../../dist/opencode/permission.js'
import { initLogger } from '../../dist/utils/logger.js'

// F5.1: permission approvals must reach the correct chat AND forum topic.
// The gap: PermissionHandler used getChatIdForSession (legacy chat map only),
// so topic-bound sessions resolved to undefined and prompts were silently dropped.
// Fix: StateManager.resolveChat(sessionId) resolves topic-first (with threadId),
// falls back to legacy (threadId 0); PermissionHandler passes message_thread_id.

const RESOLVE_IMPL = typeof StateManager.prototype.resolveChat === 'function'

let loggerInited = false
async function freshState() {
  if (!loggerInited) {
    const logDir = await mkdtemp(join(tmpdir(), 'f5-log-'))
    initLogger({ logFile: join(logDir, 'test.log'), logLevel: 'error' })
    loggerInited = true
  }
  const dir = await mkdtemp(join(tmpdir(), 'f5-state-'))
  const sm = new StateManager(join(dir, 'state.json'))
  await sm.load()
  return { sm, dir }
}

function fakeBot() {
  const sent = []
  return {
    sent,
    api: {
      sendMessage: async (chatId, text, opts = {}) => {
        sent.push({ chatId, text, opts })
        return { message_id: 42 }
      },
      editMessageText: async () => {},
      answerCallbackQuery: async () => {},
    },
  }
}
const fakeClient = { replyPermission: async () => {} }
const permReq = (id, sessionID) => ({ id, sessionID, permission: 'bash', patterns: ['ls*'] })

describe('F5.1 NOT YET IMPLEMENTED — StateManager.resolveChat', { skip: RESOLVE_IMPL }, () => {
  test('resolveChat(sessionId) is missing', () => {
    assert.fail(
      'F5.1 not implemented. Add StateManager.resolveChat(sessionId) -> { chatId, threadId } | undefined ' +
      '(topic-first via getTopicBySession, else legacy getChatIdForSession with threadId 0), ' +
      'and make PermissionHandler.handlePermissionRequest use it + pass message_thread_id when threadId > 0.'
    )
  })
})

describe('F5.1 permission routing contract', { skip: !RESOLVE_IMPL }, () => {
  test('resolveChat: topic-bound session returns {chatId, threadId}', async () => {
    const { sm, dir } = await freshState()
    try {
      sm.setTopicSession(-100123, 55, 'ses_t')
      await sm.flushSave()
      assert.deepEqual(sm.resolveChat('ses_t'), { chatId: -100123, threadId: 55 })
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  test('resolveChat: legacy session returns {chatId, threadId: 0}', async () => {
    const { sm, dir } = await freshState()
    try {
      sm.setCurrentSession(777, 'ses_l')
      await sm.flushSave()
      assert.deepEqual(sm.resolveChat('ses_l'), { chatId: 777, threadId: 0 })
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  test('resolveChat: unknown session returns undefined', async () => {
    const { sm, dir } = await freshState()
    try {
      assert.equal(sm.resolveChat('ghost'), undefined)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  test('permission for a TOPIC session is delivered to that thread', async () => {
    const { sm, dir } = await freshState()
    try {
      sm.setTopicSession(-100123, 55, 'ses_t')
      await sm.flushSave()
      const bot = fakeBot()
      const h = new PermissionHandler(fakeClient, bot, sm)
      await h.handlePermissionRequest(permReq('perm1', 'ses_t'))
      assert.equal(bot.sent.length, 1, 'topic permission must be sent (was dropped before fix)')
      assert.equal(bot.sent[0].chatId, -100123)
      assert.equal(bot.sent[0].opts.message_thread_id, 55, 'must target the bound thread')
      assert.ok(
        bot.sent[0].opts.reply_markup?.inline_keyboard?.length >= 1,
        'must include approve/reject buttons'
      )
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  test('permission for a LEGACY session is sent without message_thread_id', async () => {
    const { sm, dir } = await freshState()
    try {
      sm.setCurrentSession(777, 'ses_l')
      await sm.flushSave()
      const bot = fakeBot()
      const h = new PermissionHandler(fakeClient, bot, sm)
      await h.handlePermissionRequest(permReq('perm2', 'ses_l'))
      assert.equal(bot.sent.length, 1)
      assert.equal(bot.sent[0].chatId, 777)
      assert.equal(bot.sent[0].opts.message_thread_id, undefined)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  test('permission for an UNKNOWN session is dropped (no send)', async () => {
    const { sm, dir } = await freshState()
    try {
      const bot = fakeBot()
      const h = new PermissionHandler(fakeClient, bot, sm)
      await h.handlePermissionRequest(permReq('perm3', 'ghost'))
      assert.equal(bot.sent.length, 0)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
