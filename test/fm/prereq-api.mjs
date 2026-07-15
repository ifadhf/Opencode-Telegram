// File: test/fm/prereq-api.mjs
// Bug M prerequisite — verify moveSession and state manager behavior.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

const OC_URL = process.env.OPENCODE_URL || 'http://127.0.0.1:4097'
const OC_TEST_DIR = process.env.OC_TEST_DIR || '/home/fadh/workspace/opencode-telegram-dev/oc-test'
const WS_ROOT = process.env.WS_ROOT || '/home/fadh/workspace'

async function api(path, init) {
  const res = await fetch(`${OC_URL}${path}`, init)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${init?.method || 'GET'} ${path} -> ${res.status} ${res.statusText}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

async function apiVoid(path, init) {
  const res = await fetch(`${OC_URL}${path}`, init)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${init?.method || 'GET'} ${path} -> ${res.status} ${res.statusText}: ${body.slice(0, 200)}`)
  }
}

let serverReachable = true
before(async () => {
  try { await api('/session') } catch { serverReachable = false }
})

describe('Bug M prerequisite — server reachable', { skip: !serverReachable }, () => {
  test('GET /session returns array', async () => {
    const sessions = await api('/session')
    assert.ok(Array.isArray(sessions))
  })

  test('moveSession succeeds within same project', async () => {
    const s = await api(`/session?directory=${encodeURIComponent(WS_ROOT)}`, { method: 'POST' })
    try {
      await apiVoid('/experimental/control-plane/move-session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionID: s.id,
          destination: { directory: WS_ROOT },
          moveChanges: false
        }),
      })
      const refreshed = await api(`/session/${s.id}`)
      assert.equal(refreshed.directory, WS_ROOT)
    } finally {
      await api(`/session/${s.id}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  test('moveSession with moveChanges=true also works', async () => {
    const s = await api(`/session?directory=${encodeURIComponent(WS_ROOT)}`, { method: 'POST' })
    try {
      await apiVoid('/experimental/control-plane/move-session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionID: s.id,
          destination: { directory: WS_ROOT },
          moveChanges: true
        }),
      })
      const refreshed = await api(`/session/${s.id}`)
      assert.equal(refreshed.directory, WS_ROOT)
    } finally {
      await api(`/session/${s.id}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  test('moveSession with nonexistent sessionID throws 4xx/5xx', async () => {
    await assert.rejects(
      apiVoid('/experimental/control-plane/move-session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionID: 'ses_nonexistent_fm_xyz',
          destination: { directory: WS_ROOT },
          moveChanges: false
        }),
      }),
      (err) => err instanceof Error && /4\d\d|5\d\d/.test(err.message),
      'nonexistent session should yield 4xx/5xx'
    )
  })
})

describe('Bug M prerequisite — server unreachable', { skip: serverReachable }, () => {
  test('OpenCode server must be running', () => {
    assert.fail(`Cannot reach OpenCode server at ${OC_URL}. Start via: systemctl --user start opencode-tele`)
  })
})
