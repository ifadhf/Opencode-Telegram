// File: test/fo/idle-contract.mjs
// Idle-message contract — TDD for buildIdleMessage helper
// and the session completion idle message format.
//
// Phase 1 (NOT YET IMPLEMENTED) detects if buildIdleMessage has been built.
// Phase 2 unit tests verify the message format.
// Phase 3 live tests verify session creation API flow.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

const OC_URL = process.env.OPENCODE_URL || 'http://127.0.0.1:4097'
const OC_TEST_DIR = process.env.OC_TEST_DIR || '/home/fadh/agent_workspace'

// Initialize logger before importing any module that uses it
const loggerMod = await import('../../dist/utils/logger.js')
loggerMod.initLogger({ logFile: '/tmp/opencode-test-fo.log', logLevel: 'error' })

// ============================================================
// Import detection
// ============================================================
let toolFormatMod = null
try { toolFormatMod = await import('../../dist/utils/toolFormat.js') } catch { /* not built */ }
const IMPL = !!(toolFormatMod && typeof toolFormatMod.buildIdleMessage === 'function')

// ============================================================
// Phase 1: NOT YET IMPLEMENTED
// ============================================================
describe('Idle-message NOT YET IMPLEMENTED', { skip: IMPL }, () => {
  test('buildIdleMessage must be built before running contract tests', () => {
    assert.fail(
      'Build first: npm run build\n' +
      'Then run: node --test test/fo/prereq-api.mjs test/fo/idle-contract.mjs'
    )
  })
})

// ============================================================
// Phase 2: Unit tests — buildIdleMessage
// ============================================================
describe('buildIdleMessage format', { skip: !IMPL }, () => {
  test('produces "Task Selesai — menunggu input" text', () => {
    const msg = toolFormatMod.buildIdleMessage('@fadh')
    assert.ok(msg.includes('Task Selesai'), `should contain "Task Selesai", got: ${msg}`)
    assert.ok(msg.includes('menunggu input'), `should contain "menunggu input", got: ${msg}`)
  })

  test('includes the label argument in output', () => {
    const msg = toolFormatMod.buildIdleMessage('@testuser')
    assert.ok(msg.includes('@testuser'), `should contain "@testuser", got: ${msg}`)
  })

  test('uses HTML bold tag for "Task Selesai"', () => {
    const msg = toolFormatMod.buildIdleMessage('@fadh')
    assert.ok(msg.includes('<b>Task Selesai'), `should contain <b>Task Selesai..., got: ${msg}`)
    assert.ok(msg.includes('</b>'), `should contain closing </b>, got: ${msg}`)
  })

  test('handles first-name-only label (no @)', () => {
    const msg = toolFormatMod.buildIdleMessage('Fadh')
    assert.ok(msg.includes('Fadh'), `should contain "Fadh", got: ${msg}`)
    assert.ok(msg.includes('Task Selesai'), 'should still contain Task Selesai')
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

describe('Idle-message live tests', { skip: !serverReachable }, () => {
  test('createSession via API returns id and directory', async () => {
    const { OpenCodeClient } = await import('../../dist/opencode/client.js')
    const client = new OpenCodeClient(OC_URL)

    const s = await client.createSession(OC_TEST_DIR)
    try {
      assert.ok(s.id, 'session should have id')
      assert.ok(s.directory, 'session should have directory')
    } finally {
      await client.deleteSession(s.id).catch(() => {})
    }
  })

  test('getSession returns expected fields for idle message context', async () => {
    const { OpenCodeClient } = await import('../../dist/opencode/client.js')
    const client = new OpenCodeClient(OC_URL)

    const s = await client.createSession(OC_TEST_DIR)
    try {
      const refreshed = await client.getSession(s.id)
      assert.ok(refreshed.id, 'session should have id')
      assert.ok(refreshed.title !== undefined, 'session should have title')
      assert.ok(refreshed.directory, 'session should have directory')
    } finally {
      await client.deleteSession(s.id).catch(() => {})
    }
  })
})

describe('Idle-message live tests — server unreachable', { skip: serverReachable }, () => {
  test('OpenCode server must be running', () => {
    assert.fail(`Cannot reach OpenCode server at ${OC_URL}.`)
  })
})
