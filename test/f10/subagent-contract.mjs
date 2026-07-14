// File: test/f10/subagent-contract.mjs
// F10 — subagent toggle contract tests
// Tests StateManager subagent flags and OpenCodeClient sendAsyncMessage tools param.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'

// Initialize logger before importing modules that use getLogger()
const loggerMod = await import('../../dist/utils/logger.js')
const { initLogger, getLogger } = loggerMod
initLogger({ logFile: '/tmp/opencode-test-f10.log', logLevel: 'error' })

const STATE_FILE = '/tmp/opencode-test-f10-state.json'
const STATE_FILE_ALT = '/tmp/opencode-test-f10-state-alt.json'
const LOG_FILE = '/tmp/opencode-test-f10.log'

let stateMod
let clientMod
try { stateMod = await import('../../dist/state/manager.js') } catch { /* not built */ }
try { clientMod = await import('../../dist/opencode/client.js') } catch { /* not built */ }

const IMPL_STATE = !!(stateMod && typeof stateMod.StateManager === 'function')
const IMPL_CLIENT = !!(clientMod && typeof clientMod.OpenCodeClient === 'function')

async function cleanup() {
  try { getLogger().close() } catch {}
  for (const f of [STATE_FILE, STATE_FILE_ALT, LOG_FILE]) {
    try { if (existsSync(f)) await unlink(f) } catch {}
  }
}

after(cleanup)

// ============================================================
// StateManager subagent flag tests
// ============================================================

describe('F10 StateManager subagent — NOT YET IMPLEMENTED', { skip: IMPL_STATE }, () => {
  test('StateManager must have getAllowSubagent', () => {
    assert.fail(
      'Export StateManager with getAllowSubagent(chatId, threadId) and ' +
      'setAllowSubagent(chatId, threadId, allow) from dist/state/manager.js'
    )
  })
})

describe('F10 StateManager subagent flags', { skip: !IMPL_STATE }, () => {
  after(async () => {
    try { await unlink(STATE_FILE) } catch {}
    try { await unlink(STATE_FILE_ALT) } catch {}
  })

  test('getAllowSubagent returns false by default for any chatId/threadId', () => {
    const sm = new stateMod.StateManager(STATE_FILE)
    assert.equal(sm.getAllowSubagent(123, 0), false)
    assert.equal(sm.getAllowSubagent(456, 789), false)
    assert.equal(sm.getAllowSubagent(0, 0), false)
  })

  test('setAllowSubagent true → getAllowSubagent returns true', async () => {
    const sm = new stateMod.StateManager(STATE_FILE)
    sm.setAllowSubagent(123, 0, true)
    await sm.flushSave()
    assert.equal(sm.getAllowSubagent(123, 0), true)
  })

  test('setAllowSubagent true then false → getAllowSubagent returns false', async () => {
    const sm = new stateMod.StateManager(STATE_FILE)
    sm.setAllowSubagent(999, 1, true)
    await sm.flushSave()
    assert.equal(sm.getAllowSubagent(999, 1), true)
    sm.setAllowSubagent(999, 1, false)
    await sm.flushSave()
    assert.equal(sm.getAllowSubagent(999, 1), false)
  })

  test('per-topic isolation: two threadIds in same chat have independent flags', async () => {
    const sm = new stateMod.StateManager(STATE_FILE)
    const chatId = 100
    const topicA = 11
    const topicB = 22

    // Default: both false
    assert.equal(sm.getAllowSubagent(chatId, topicA), false)
    assert.equal(sm.getAllowSubagent(chatId, topicB), false)

    // Set topicA to true
    sm.setAllowSubagent(chatId, topicA, true)
    await sm.flushSave()
    assert.equal(sm.getAllowSubagent(chatId, topicA), true)
    assert.equal(sm.getAllowSubagent(chatId, topicB), false)

    // Set topicB to true also — independent
    sm.setAllowSubagent(chatId, topicB, true)
    await sm.flushSave()
    assert.equal(sm.getAllowSubagent(chatId, topicA), true)
    assert.equal(sm.getAllowSubagent(chatId, topicB), true)

    // Toggle topicA back to false
    sm.setAllowSubagent(chatId, topicA, false)
    await sm.flushSave()
    assert.equal(sm.getAllowSubagent(chatId, topicA), false)
    assert.equal(sm.getAllowSubagent(chatId, topicB), true)
  })

  test('persistence: flag survives save + reload from same file', async () => {
    // Create, set flag, flush save
    const sm1 = new stateMod.StateManager(STATE_FILE)
    sm1.setAllowSubagent(42, 7, true)
    await sm1.flushSave()

    // Create new StateManager loading from same file
    const sm2 = new stateMod.StateManager(STATE_FILE)
    await sm2.load()
    assert.equal(sm2.getAllowSubagent(42, 7), true)

    // Verify unset flag remains false after reload
    assert.equal(sm2.getAllowSubagent(42, 99), false)

    // Clean up this file so it doesn't interfere with other tests
    await unlink(STATE_FILE)
  })

  test('persistence: false flag also survives save + reload', async () => {
    const sm1 = new stateMod.StateManager(STATE_FILE_ALT)
    // Set to true, then false
    sm1.setAllowSubagent(55, 3, true)
    sm1.setAllowSubagent(55, 3, false)
    await sm1.flushSave()

    const sm2 = new stateMod.StateManager(STATE_FILE_ALT)
    await sm2.load()
    assert.equal(sm2.getAllowSubagent(55, 3), false)

    await unlink(STATE_FILE_ALT)
  })
})

// ============================================================
// OpenCodeClient sendAsyncMessage tools param tests
// ============================================================

describe('F10 OpenCodeClient sendAsyncMessage tools — NOT YET IMPLEMENTED', { skip: IMPL_CLIENT }, () => {
  test('OpenCodeClient must accept tools option in sendAsyncMessage', () => {
    assert.fail(
      'sendAsyncMessage(sessionId, content, options) must accept options.tools ' +
      'and pass it to the request body. Export OpenCodeClient from dist/opencode/client.js'
    )
  })
})

describe('F10 OpenCodeClient sendAsyncMessage tools param', { skip: !IMPL_CLIENT }, () => {
  let capturedBody = null
  let capturedEndpoint = null

  function makeClient() {
    const client = new clientMod.OpenCodeClient('http://127.0.0.1:14097')
    client.request = async (endpoint, options) => {
      capturedEndpoint = endpoint
      capturedBody = options?.body ? JSON.parse(options.body) : null
      return {}
    }
    return client
  }

  test('sendAsyncMessage with tools: { task: false } includes tools in body', async () => {
    const client = makeClient()
    await client.sendAsyncMessage('fake-sid', 'hello', { tools: { task: false } })

    assert.ok(capturedBody, 'request body should be captured')
    assert.deepEqual(capturedBody.tools, { task: false }, 'body.tools should be { task: false }')
    assert.equal(capturedEndpoint, '/session/fake-sid/prompt_async')
  })

  test('sendAsyncMessage without tools option does NOT include tools in body', async () => {
    const client = makeClient()
    await client.sendAsyncMessage('fake-sid', 'hello')

    assert.ok(capturedBody, 'request body should be captured')
    assert.equal(capturedBody.tools, undefined, 'body.tools should be undefined when not passed')
  })

  test('sendAsyncMessage with tools: undefined does NOT include tools in body', async () => {
    const client = makeClient()
    await client.sendAsyncMessage('fake-sid', 'hello', { tools: undefined })

    assert.ok(capturedBody, 'request body should be captured')
    assert.equal(capturedBody.tools, undefined)
  })

  test('sendAsyncMessage with tools sends to correct endpoint with text part', async () => {
    const client = makeClient()
    await client.sendAsyncMessage('sess-abc', 'test message', { tools: { task: false } })

    assert.equal(capturedEndpoint, '/session/sess-abc/prompt_async')
    assert.ok(Array.isArray(capturedBody.parts), 'body should have parts array')
    assert.equal(capturedBody.parts.length, 1)
    assert.deepEqual(capturedBody.parts[0], { type: 'text', text: 'test message' })
  })

  test('tools: { task: false } as used by handlers when subagent is disabled', async () => {
    // This is the exact pattern used in handlers.ts and events.ts:
    //   tools: stateManager.getAllowSubagent(chatId, threadId) ? undefined : { task: false }
    const client = makeClient()
    const getAllowSubagent = () => false // subagent disabled
    const tools = getAllowSubagent() ? undefined : { task: false }

    await client.sendAsyncMessage('sid', 'msg', { tools })

    assert.deepEqual(capturedBody.tools, { task: false })
  })

  test('tools: undefined as used by handlers when subagent is enabled', async () => {
    // Subagent enabled → tools: undefined → body should NOT have tools
    const client = makeClient()
    const getAllowSubagent = () => true // subagent enabled
    const tools = getAllowSubagent() ? undefined : { task: false }

    await client.sendAsyncMessage('sid', 'msg', { tools })

    assert.equal(capturedBody.tools, undefined)
  })
})
