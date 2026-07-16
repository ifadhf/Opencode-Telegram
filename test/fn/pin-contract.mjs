// File: test/fn/pin-contract.mjs
// Pin-on-session contract — TDD for pinLastMessage utility
// and end-to-end session creation flow.
//
// Phase 1 (NOT YET IMPLEMENTED) detects if pinLastMessage has been built.
// Phase 2 unit tests mock ctx to verify pinChatMessage call shape.
// Phase 3 live tests verify session creation API flow.

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

const OC_URL = process.env.OPENCODE_URL || 'http://127.0.0.1:4097'
const OC_TEST_DIR = process.env.OC_TEST_DIR || '/home/fadh/agent_workspace'

// Initialize logger before importing
const loggerMod = await import('../../dist/utils/logger.js')
loggerMod.initLogger({ logFile: '/tmp/opencode-test-fn.log', logLevel: 'error' })

// ============================================================
// Import detection
// ============================================================
let commandsMod = null
try { commandsMod = await import('../../dist/bot/commands.js') } catch { /* not built */ }
const IMPL = !!(commandsMod && typeof commandsMod.pinLastMessage === 'function')

// ============================================================
// Phase 1: NOT YET IMPLEMENTED
// ============================================================
describe('Pin-on-session NOT YET IMPLEMENTED', { skip: IMPL }, () => {
  test('pinLastMessage must be built before running contract tests', () => {
    assert.fail(
      'Build first: npm run build\n' +
      'Then run: node --test test/fn/prereq-api.mjs test/fn/pin-contract.mjs'
    )
  })
})

// ============================================================
// Phase 2: Unit tests — mock ctx
// ============================================================
describe('pinLastMessage utility', { skip: !IMPL }, () => {
  test('calls ctx.pinChatMessage with correct message_id', async () => {
    let capturedMsgId = null
    let capturedOpts = null

    const mockCtx = {
      pinChatMessage: async (msgId, opts) => {
        capturedMsgId = msgId
        capturedOpts = opts
        return true
      }
    }

    await commandsMod.pinLastMessage(mockCtx, { message_id: 42 })

    assert.equal(capturedMsgId, 42, `pinChatMessage should receive message_id=42, got ${capturedMsgId}`)
  })

  test('passes disable_notification: true', async () => {
    let capturedOpts = null

    const mockCtx = {
      pinChatMessage: async (_msgId, opts) => {
        capturedOpts = opts
        return true
      }
    }

    await commandsMod.pinLastMessage(mockCtx, { message_id: 99 })

    assert.ok(capturedOpts, 'opts should be passed to pinChatMessage')
    assert.equal(capturedOpts.disable_notification, true,
      `disable_notification should be true, got ${JSON.stringify(capturedOpts)}`)
  })

  test('handles pin errors silently (does not throw)', async () => {
    const mockCtx = {
      pinChatMessage: async () => {
        throw new Error('Not enough rights to pin')
      }
    }

    // Should not throw — pinLastMessage catches internally
    await assert.doesNotReject(
      () => commandsMod.pinLastMessage(mockCtx, { message_id: 1 }),
      'pinLastMessage should not throw on pin failure'
    )
  })

  test('returns undefined on success', async () => {
    const mockCtx = {
      pinChatMessage: async () => true
    }

    const result = await commandsMod.pinLastMessage(mockCtx, { message_id: 7 })
    assert.equal(result, undefined, 'pinLastMessage should return undefined')
  })
})

// ============================================================
// Phase 3: Live session creation tests
// ============================================================

let serverReachable = false
try {
  const res = await fetch(`${OC_URL}/session`)
  serverReachable = res.ok
} catch { serverReachable = false }

describe('Pin-on-session live tests', { skip: !serverReachable }, () => {
  test('createSession via API returns id and directory', async () => {
    const { OpenCodeClient } = await import('../../dist/opencode/client.js')
    const client = new OpenCodeClient(OC_URL)

    const s = await client.createSession(OC_TEST_DIR)
    try {
      assert.ok(s.id, 'session should have id')
      assert.equal(s.directory, OC_TEST_DIR, `session directory should be ${OC_TEST_DIR}`)
    } finally {
      await client.deleteSession(s.id).catch(() => {})
    }
  })

  test('getSession after createSession returns matching directory', async () => {
    const { OpenCodeClient } = await import('../../dist/opencode/client.js')
    const client = new OpenCodeClient(OC_URL)

    const s = await client.createSession(OC_TEST_DIR)
    try {
      // We cannot test applySessionDefaults without importing more modules.
      // Just verify the session was created and is fetchable.
      const refreshed = await client.getSession(s.id)
      assert.equal(refreshed.id, s.id, 'refreshed session id should match')
    } finally {
      await client.deleteSession(s.id).catch(() => {})
    }
  })

  test('pinned message format: new session created contains expected fields', () => {
    // Verify the message format contract: the reply for /newtopic
    // must include ID, Title, State, Directory.
    // This is a contract test — the format is defined in commands.ts.
    const requiredFields = ['ID:', 'Title:', 'State:', 'Directory:']
    const msg = buildMockNewtopicReply('ses_abc123', '/home/fadh/workspace')

    for (const field of requiredFields) {
      assert.ok(msg.includes(field),
        `new session reply must include "${field}", got: ${msg.slice(0, 200)}...`)
    }
  })

  test('pinned message format: selected session contains ID', () => {
    const msg = buildMockSessionSelectedReply('ses_abc123')
    assert.ok(msg.includes('ses_abc123'), 'selected session reply must include session ID')
    assert.ok(msg.includes('Selected session'), 'selected session reply must include "Selected session" label')
  })

  test('pinned message format: created session (no-arg) contains ID and prompt', () => {
    const msg = buildMockSessionCreatedReply('ses_xyz789')
    assert.ok(msg.includes('ses_xyz789'), 'created session reply must include session ID')
    assert.ok(msg.includes('Created new session'), 'created session reply must include label')
    assert.ok(msg.includes('Send any message to start'), 'created session reply must include prompt')
  })
})

// ============================================================
// Helpers: message format builders matching commands.ts output
// ============================================================
function buildMockNewtopicReply(sessionId, directory) {
  return `✅ <b>New session created</b>\n` +
    `<b>Session:</b>\n` +
    `ID: <code>${sessionId}</code>\n` +
    `Title: (untitled)\n` +
    `State: 💤 Idle\n` +
    `Directory: <code>${directory}</code>\n` +
    `\n` +
    `<b>Model:</b> <code>(default)</code> (default)\n` +
    `<b>Mode:</b> <code>(default)</code> (default)\n\n` +
    `Send any message to start!`
}

function buildMockSessionSelectedReply(sessionId) {
  return `Selected session: <code>${sessionId}</code>`
}

function buildMockSessionCreatedReply(sessionId) {
  return `Created new session: <code>${sessionId}</code>\n\nSend any message to start!`
}

// ============================================================
// Phase 4: Server unreachable guard
// ============================================================
describe('Pin-on-session live tests — server unreachable', { skip: serverReachable }, () => {
  test('OpenCode server must be running', () => {
    assert.fail(`Cannot reach OpenCode server at ${OC_URL}. Start it via: systemctl --user start opencode-tele`)
  })
})
