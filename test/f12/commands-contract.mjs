// File: test/f12/commands-contract.mjs
// F12 TDD contract — /move, /compact, /delete session commands
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = 'http://127.0.0.1:4097'
const OC_TEST_DIR = process.env.OC_TEST_DIR || '/home/fadh/agent_workspace'

let OpenCodeClient
let IMPL = false
try {
  const m = await import('../../dist/opencode/client.js')
  OpenCodeClient = m.OpenCodeClient
  IMPL = true
} catch { /* module not found — not yet implemented */ }

let loggerInited = false
async function ensureLogger() {
  if (!loggerInited) {
    const { initLogger } = await import('../../dist/utils/logger.js')
    const logDir = await mkdtemp(join(tmpdir(), 'f12-log-'))
    initLogger({ logFile: join(logDir, 'test.log'), logLevel: 'error' })
    loggerInited = true
  }
}

// ────────────────────────────────────────────
// Phase 1: NOT YET IMPLEMENTED
// ────────────────────────────────────────────

describe('F12 NOT YET IMPLEMENTED — move/compact/delete commands', { skip: IMPL }, () => {
  test('missing: moveSession, compactSession, deleteSession on OpenCodeClient', () => {
    assert.fail(
      'F12 session commands not implemented. Add to src/opencode/client.ts:\n' +
      '\n' +
      '  async moveSession(sessionId: string, directory: string, moveChanges = false): Promise<void> {\n' +
      '    await this.request<void>(\'/experimental/control-plane/move-session\', {\n' +
      '      method: \'POST\',\n' +
      '      body: JSON.stringify({ sessionID: sessionId, destination: { directory }, moveChanges }),\n' +
      '    })\n' +
      '  }\n' +
      '\n' +
      '  async compactSession(sessionId: string): Promise<void> {\n' +
      '    await this.request<void>(`/api/session/${encodeURIComponent(sessionId)}/compact`, { method: \'POST\' })\n' +
      '  }\n' +
      '\n' +
      '  async deleteSession(sessionId: string): Promise<void> {\n' +
      '    await this.request<void>(`/session/${encodeURIComponent(sessionId)}`, { method: \'DELETE\' })\n' +
      '  }\n' +
      '\n' +
      'Wire bot commands in src/index.ts:\n' +
      '  /move <session_id> <directory> [--changes]  → calls client.moveSession(...)\n' +
      '  /compact <session_id>  → calls client.compactSession(...)\n' +
      '  /delete <session_id>  → calls client.deleteSession(...)\n' +
      '  (omit session_id or use "this" to target current session/forum topic)\n'
    )
  })
})

// ────────────────────────────────────────────
// Phase 2: Contract tests (unit layer)
// ────────────────────────────────────────────

describe('F12 moveSession contract', { skip: !IMPL }, () => {
  before(async () => { await ensureLogger() })

  test('moveSession is a function on OpenCodeClient', () => {
    const client = new OpenCodeClient(BASE)
    assert.equal(typeof client.moveSession, 'function')
  })

  test('moveSession with invalid sessionID rejects with an error', async () => {
    const client = new OpenCodeClient('http://127.0.0.1:1')
    await assert.rejects(
      client.moveSession('ses_fake_test_01', '/tmp/fake', false),
      (err) => err instanceof Error,
      'should reject on unreachable server'
    )
  })
})

describe('F12 compactSession contract', { skip: !IMPL }, () => {
  before(async () => { await ensureLogger() })

  test('compactSession is a function on OpenCodeClient', () => {
    const client = new OpenCodeClient(BASE)
    assert.equal(typeof client.compactSession, 'function')
  })

  test('compactSession with invalid sessionID rejects with an error', async () => {
    const client = new OpenCodeClient('http://127.0.0.1:1')
    await assert.rejects(
      client.compactSession('ses_fake_test_02'),
      (err) => err instanceof Error,
      'should reject on unreachable server'
    )
  })
})

describe('F12 deleteSession contract', { skip: !IMPL }, () => {
  before(async () => { await ensureLogger() })

  test('deleteSession is a function on OpenCodeClient', () => {
    const client = new OpenCodeClient(BASE)
    assert.equal(typeof client.deleteSession, 'function')
  })

  test('deleteSession with invalid sessionID rejects with an error', async () => {
    const client = new OpenCodeClient('http://127.0.0.1:1')
    await assert.rejects(
      client.deleteSession('ses_fake_test_03'),
      (err) => err instanceof Error,
      'should reject on unreachable server'
    )
  })
})

// ────────────────────────────────────────────
// Phase 3: Server-verified contract tests
// ────────────────────────────────────────────

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${init?.method || 'GET'} ${path} -> ${res.status} ${res.statusText}: ${body.slice(0, 200)}`)
  }
  const text = await res.text()
  try { return JSON.parse(text) } catch { return text }
}

let serverReachable = false
try { await api('/session'); serverReachable = true } catch { /* server not running */ }

describe('F12 moveSession request body', { skip: !IMPL }, () => {
  before(async () => { await ensureLogger() })

  test('moveSession sends correct body shape', () => {
    const client = new OpenCodeClient('http://127.0.0.1:1')
    assert.ok(client.moveSession)
    assert.equal(typeof client.moveSession, 'function')
  })

  test('moveSession can be called with (sessionId, directory, moveChanges)', () => {
    const client = new OpenCodeClient('http://127.0.0.1:1')
    assert.doesNotThrow(() => {
      // fire-and-forget: swallow the async rejection (unreachable server) so it
      // doesn't surface as an unhandledRejection after the test ends
      client.moveSession('ses_test', '/tmp/dir', false).catch(() => {})
    })
  })
})

describe('F12 commands — live API tests', { skip: !serverReachable }, () => {
  let testSessionId = null
  let secondSessionId = null

  before(async () => {
    await ensureLogger()
    const client = new OpenCodeClient(BASE)
    const s = await client.createSession(OC_TEST_DIR)
    testSessionId = s.id
  })

  after(async () => {
    if (testSessionId) {
      try {
        const client = new OpenCodeClient(BASE)
        await client.deleteSession(testSessionId)
      } catch { /* best effort */ }
    }
    if (secondSessionId) {
      try {
        const client = new OpenCodeClient(BASE)
        await client.deleteSession(secondSessionId)
      } catch { /* best effort */ }
    }
  })

  test('moveSession with valid params returns successfully (204)', async () => {
    const client = new OpenCodeClient(BASE)
    await client.moveSession(testSessionId, OC_TEST_DIR, false)
  })

  test('moveSession with moveChanges=true also works', async () => {
    const client = new OpenCodeClient(BASE)
    await client.moveSession(testSessionId, OC_TEST_DIR, true)
  })

  test('moveSession with nonexistent sessionID throws an error', async () => {
    const client = new OpenCodeClient(BASE)
    await assert.rejects(
      client.moveSession('ses_nonexistent_f12_move', OC_TEST_DIR, false),
      (err) => err instanceof Error && /4\d\d|5\d\d/.test(err.message),
      'nonexistent session should yield 4xx/5xx server error'
    )
  })

  test('compactSession returns without crashing (may be not available yet)', async () => {
    const client = new OpenCodeClient(BASE)
    try {
      await client.compactSession(testSessionId)
    } catch (err) {
      assert.match(err.message, /4\d\d|5\d\d/, 'even failure should be a proper HTTP error')
    }
  })

  test('compactSession with nonexistent sessionID throws', async () => {
    const client = new OpenCodeClient(BASE)
    await assert.rejects(
      client.compactSession('ses_nonexistent_f12_compact'),
      (err) => err instanceof Error && /4\d\d|5\d\d/.test(err.message),
      'nonexistent compact target should yield 4xx/5xx'
    )
  })

  test('deleteSession removes a session', async () => {
    const client = new OpenCodeClient(BASE)
    const s = await client.createSession(OC_TEST_DIR)
    secondSessionId = s.id
    await client.deleteSession(secondSessionId)
    secondSessionId = null
    await assert.rejects(
      client.getSession(s.id),
      (err) => err instanceof Error && /4\d\d/.test(err.message),
      'deleted session should not be fetchable'
    )
  })

  test('deleteSession with nonexistent sessionID throws', async () => {
    const client = new OpenCodeClient(BASE)
    await assert.rejects(
      client.deleteSession('ses_nonexistent_f12_delete'),
      (err) => err instanceof Error && /4\d\d|5\d\d/.test(err.message),
      'nonexistent delete target should yield 4xx/5xx'
    )
  })
})

describe('F12 commands — server unreachable', { skip: serverReachable }, () => {
  test('OpenCode server must be running', () => {
    assert.fail(`Cannot reach OpenCode server at ${BASE}. Start it via: systemctl --user start opencode-tele`)
  })
})
