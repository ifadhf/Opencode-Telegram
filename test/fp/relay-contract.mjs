// Bug P — relay reliability: no missing messages, no duplicates.
//
// Root causes (session ses_096461521…): dedup used a fresh per-discovery
// Set + a 5s time-based pre-population, and completion could fire on an
// intermediate empty assistant message. Result: a genuine response got
// pre-marked (missing), and a re-discovered part got re-relayed (duplicate).
//
// Fix: persistent per-session relayed-set (survives re-discovery) seeded only
// on first discovery, + isSessionStillGenerating() re-check before idling.

import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'

const loggerMod = await import('../../dist/utils/logger.js')
loggerMod.initLogger({ logFile: '/tmp/opencode-test-fp.log', logLevel: 'error' })

let EventProcessor
try { ({ EventProcessor } = await import('../../dist/opencode/events.js')) } catch { /* not built */ }
const IMPL = !!(EventProcessor
  && typeof EventProcessor.prototype.getRelayedSet === 'function'
  && typeof EventProcessor.prototype.isSessionStillGenerating === 'function')

function makeFakes(scriptedMessages = []) {
  const sent = []
  const bot = {
    api: {
      sendMessage: async (chatId, text, opts = {}) => { sent.push({ chatId, text, opts }); return { message_id: sent.length } },
      sendChatAction: async () => {},
      editMessageText: async () => {},
      deleteMessage: async () => {},
      sendPhoto: async () => {},
    },
  }
  const client = { getMessages: async () => scriptedMessages }
  const stateManager = { clearTopicSession: () => {}, resolveChat: () => undefined }
  const messageQueue = { clear: () => {}, setIdle: () => {}, isBusy: () => false }
  const ep = new EventProcessor(client, bot, stateManager, {}, messageQueue)
  return { ep, sent }
}

function makeBusyInfo(ep, sessionId, chatId = 1) {
  return {
    chatId, threadId: 0, sessionId,
    processedPartIds: ep.getRelayedSet(sessionId),
    processedStepFinishIds: ep.getRelayedStepSet(sessionId),
    processingTools: new Map(),
    currentStepTitle: '', stepStartSeen: false, lastToolCall: '',
    lastWorkingStatus: '', lastTodoHash: '',
  }
}

const textMsg = (msgId, partId, text) => ({
  role: 'assistant', id: msgId,
  parts: [{ id: partId, type: 'text', time: { end: 1 }, text }],
})

describe('Bug P NOT YET IMPLEMENTED — persistent relay dedup', { skip: IMPL }, () => {
  test('getRelayedSet / isSessionStillGenerating missing', () => {
    assert.fail('Add getRelayedSet(sessionId), getRelayedStepSet(sessionId), isSessionStillGenerating(sessionId) to EventProcessor; make discovery reuse the persistent set + seed only on first discovery.')
  })
})

describe('Bug P relay contract', { skip: !IMPL }, () => {
  test('getRelayedSet is persistent (same reference across calls / re-discovery)', () => {
    const { ep } = makeFakes()
    const a = ep.getRelayedSet('ses_1')
    const b = ep.getRelayedSet('ses_1')
    assert.equal(a, b, 'same Set instance persists per session')
  })

  test('a part relayed once is NOT relayed again after re-discovery (no duplicate)', async () => {
    const { ep, sent } = makeFakes()
    const messages = [textMsg('msg1', 'prt_1', 'Sudah saya cek hasilnya')]

    // Turn 1 busyInfo relays the text
    const busy1 = makeBusyInfo(ep, 'ses_dup')
    await ep.processNewMessages(1, 'ses_dup', messages, busy1)
    const firstCount = sent.filter(s => s.text.includes('Sudah saya cek')).length
    assert.equal(firstCount, 1, 'relayed once on first processing')

    // Simulate RE-DISCOVERY: brand-new busyInfo, but the persistent set is reused
    const busy2 = makeBusyInfo(ep, 'ses_dup')
    await ep.processNewMessages(1, 'ses_dup', messages, busy2)
    const totalCount = sent.filter(s => s.text.includes('Sudah saya cek')).length
    assert.equal(totalCount, 1, 're-discovery must NOT re-relay (was the duplicate bug)')
  })

  test('a genuinely new part IS relayed (no false pre-mark)', async () => {
    const { ep, sent } = makeFakes()
    const busy1 = makeBusyInfo(ep, 'ses_new')
    await ep.processNewMessages(1, 'ses_new', [textMsg('m1', 'p1', 'first answer')], busy1)
    // a new message arrives later
    const busy2 = makeBusyInfo(ep, 'ses_new')
    await ep.processNewMessages(1, 'ses_new', [textMsg('m1', 'p1', 'first answer'), textMsg('m2', 'p2', 'second answer')], busy2)
    assert.equal(sent.filter(s => s.text.includes('first answer')).length, 1)
    assert.equal(sent.filter(s => s.text.includes('second answer')).length, 1, 'new part relayed exactly once')
  })

  test('isSessionStillGenerating: true when last message is an in-progress assistant', async () => {
    const { ep } = makeFakes([{ role: 'assistant', time: { created: 1 }, parts: [] }])
    assert.equal(await ep.isSessionStillGenerating('ses_x'), true)
  })

  test('isSessionStillGenerating: false when last assistant message is completed', async () => {
    const { ep } = makeFakes([{ role: 'assistant', time: { created: 1, completed: 2 }, parts: [] }])
    assert.equal(await ep.isSessionStillGenerating('ses_x'), false)
  })

  test('isSessionStillGenerating: false when no messages / last is user', async () => {
    const { ep: ep1 } = makeFakes([])
    assert.equal(await ep1.isSessionStillGenerating('ses_x'), false)
    const { ep: ep2 } = makeFakes([{ role: 'user', time: { created: 1 }, parts: [] }])
    assert.equal(await ep2.isSessionStillGenerating('ses_x'), false)
  })
})
