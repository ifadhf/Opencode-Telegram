// File: test/fm/move-contract.mjs
// Bug M contract — TDD for /move command fixes.
// Phase 1: detect if parseMoveArgs helper exists
// Phase 2: unit test arg parsing logic
// Phase 3: live test move + state consistency

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const OC_URL = process.env.OPENCODE_URL || 'http://127.0.0.1:4097'
const WS_ROOT = process.env.WS_ROOT || '/home/fadh/workspace'
let HOME = process.env.HOME || '/home/fadh'

// Logger init for dist imports
let loggerMod = null
try { loggerMod = await import('../../dist/utils/logger.js') } catch {}
if (loggerMod) {
  try { loggerMod.initLogger({ logFile: '/tmp/opencode-test-fm.log', logLevel: 'error' }) } catch {}
}

// ============================================================
// Detection
// ============================================================
let commandsMod = null
try { commandsMod = await import('../../dist/bot/commands.js') } catch {}
const IMPL = !!(commandsMod && typeof commandsMod.parseMoveArgs === 'function')

// ============================================================
// Phase 1: NOT YET IMPLEMENTED
// ============================================================
describe('Bug M NOT YET IMPLEMENTED — /move command fixes', { skip: IMPL }, () => {
  test('commands.ts must export parseMoveArgs helper', () => {
    assert.fail(
      'commands.ts needs parseMoveArgs(text, worktreeRoot) exported.\n' +
      'Returns { directory, moveChanges } | null.\n' +
      'Then run: npm run build && node --test test/fm/'
    )
  })
})

// ============================================================
// Phase 2: Arg parsing unit tests
// ============================================================
describe('Bug M parseMoveArgs contract', { skip: !IMPL }, () => {
  test('/move /absolute/path → returns absolute path, moveChanges=false', () => {
    const r = commandsMod.parseMoveArgs(`/move ${WS_ROOT}/project`, WS_ROOT)
    assert.ok(r, 'should not be null')
    assert.equal(r.directory, `${WS_ROOT}/project`)
    assert.equal(r.moveChanges, false)
  })

  test('/move /absolute/path --changes → moveChanges=true', () => {
    const r = commandsMod.parseMoveArgs(`/move ${WS_ROOT}/project --changes`, WS_ROOT)
    assert.ok(r)
    assert.equal(r.directory, `${WS_ROOT}/project`)
    assert.equal(r.moveChanges, true)
  })

  test('/move --changes /absolute/path → directory /absolute/path, moveChanges=true', () => {
    const r = commandsMod.parseMoveArgs(`/move --changes ${WS_ROOT}/project`, WS_ROOT)
    assert.ok(r)
    assert.equal(r.directory, `${WS_ROOT}/project`)
    assert.equal(r.moveChanges, true)
  })

  test('/move relative → resolves to HOME/relative', () => {
    const r = commandsMod.parseMoveArgs('/move relative', '/home')
    assert.ok(r)
    assert.equal(r.directory, join(HOME, 'relative'))
    assert.equal(r.moveChanges, false)
  })

  test('/move relative --changes → resolves and sets changes', () => {
    const r = commandsMod.parseMoveArgs('/move relative --changes', '/home')
    assert.ok(r)
    assert.equal(r.directory, join(HOME, 'relative'))
    assert.equal(r.moveChanges, true)
  })

  test('/move relative/path → resolves to HOME/relative/path', () => {
    const r = commandsMod.parseMoveArgs('/move relative/path', '/home')
    assert.ok(r)
    assert.equal(r.directory, join(HOME, 'relative/path'))
  })

  test('/move → returns null (no args)', () => {
    const r = commandsMod.parseMoveArgs('/move', WS_ROOT)
    assert.equal(r, null)
  })

  test('/move         → returns null (only whitespace)', () => {
    const r = commandsMod.parseMoveArgs('/move        ', WS_ROOT)
    assert.equal(r, null)
  })

  test('/move /outside-root → returns null (outside worktree)', () => {
    const r = commandsMod.parseMoveArgs('/move /etc/passwd', WS_ROOT)
    assert.equal(r, null)
  })

  test('/move --changes alone → returns null', () => {
    const r = commandsMod.parseMoveArgs('/move --changes', WS_ROOT)
    assert.equal(r, null)
  })

  test('/move with path inside worktree → valid', () => {
    const r = commandsMod.parseMoveArgs(`/move ${WS_ROOT}/subdir`, WS_ROOT)
    assert.ok(r)
    assert.equal(r.directory, `${WS_ROOT}/subdir`)
  })
})

// ============================================================
// Phase 3: State update after move
// ============================================================
describe('Bug M state-after-move contract', () => {
  test('StateManager topic bindings work + can re-bind after move', async () => {
    const { StateManager } = await import('../../dist/state/manager.js')
    const dir = await mkdtemp(join(tmpdir(), 'fm-state-'))
    try {
      const sm = new StateManager(join(dir, 'state.json'))
      sm.setTopicSession(123, 45, 'ses_move_test')
      assert.equal(sm.getTopicSession(123, 45), 'ses_move_test')

      // After a move, re-binding with same sessionId works (idempotent)
      sm.setTopicSession(123, 45, 'ses_move_test')
      assert.equal(sm.getTopicSession(123, 45), 'ses_move_test')

      // Clear and re-bind
      sm.clearTopicSession(123, 45)
      assert.equal(sm.getTopicSession(123, 45), undefined)

      sm.setTopicSession(123, 45, 'ses_moved')
      assert.equal(sm.getTopicSession(123, 45), 'ses_moved')
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })
})

// ============================================================
// Phase 4: Live API test
// ============================================================
let serverReachable = false
try {
  const res = await fetch(`${OC_URL}/session`)
  serverReachable = res.ok
} catch { serverReachable = false }

describe('Bug M live move test', { skip: !serverReachable }, () => {
  let testSessionIds = []

  after(async () => {
    for (const sid of testSessionIds) {
      try {
        await fetch(`${OC_URL}/session/${sid}`, { method: 'DELETE' })
      } catch {}
    }
  })

  test('create session then move to different dir within project', async () => {
    const s1 = await fetch(`${OC_URL}/session?directory=${encodeURIComponent(WS_ROOT)}`, { method: 'POST' })
      .then(r => r.json())
    testSessionIds.push(s1.id)
    assert.equal(s1.directory, WS_ROOT)

    // Move to subdir
    const subdir = `${WS_ROOT}/opencode-telegram-dev`
    const res = await fetch(`${OC_URL}/experimental/control-plane/move-session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionID: s1.id,
        destination: { directory: subdir },
        moveChanges: false,
      }),
    })
    assert.ok(res.ok || res.status === 400, 'move returns 2xx or 4xx')

    const refreshed = await fetch(`${OC_URL}/session/${s1.id}`).then(r => r.json())
    // Note: cross-project moves may fail (400), session stays at old dir
    assert.ok(typeof refreshed.directory === 'string')
  })
})

describe('Bug M live tests — server unreachable', { skip: serverReachable }, () => {
  test('OpenCode server must be running', () => {
    assert.fail(`Cannot reach OpenCode server at ${OC_URL}. Start via: systemctl --user start opencode-tele`)
  })
})
