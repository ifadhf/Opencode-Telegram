// File: test/fj/prereq-api.mjs
// Bug J prerequisite — verify the OpenCode server is serving sessions
// correctly under the unified project (worktree = /home/fadh/workspace).
// Read-only: no sessions created/modified.
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'

const OC_URL = process.env.OPENCODE_URL || 'http://127.0.0.1:4097'

async function api(path, init) {
  const res = await fetch(`${OC_URL}${path}`, init)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${init?.method || 'GET'} ${path} -> ${res.status} ${res.statusText}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

let serverReachable = true
before(async () => {
  try { await api('/session') } catch { serverReachable = false }
})

describe('Bug J prerequisite — OpenCode server reachable', { skip: !serverReachable }, () => {
  test('GET /session returns session list', async () => {
    const sessions = await api('/session')
    assert.ok(Array.isArray(sessions), '/session should return an array')
    assert.ok(sessions.length > 0, 'should have at least one session')
  })

  test('GET /session/:id returns session with directory field', async () => {
    const sessions = await api('/session')
    const s = await api(`/session/${sessions[0].id}`)
    assert.ok(typeof s.directory === 'string', 'session must have directory')
    assert.ok(s.directory.length > 0, 'directory should not be empty')
  })

  test('GET /file?directory=...&path=. returns entries for workspace root', async () => {
    const entries = await api(`/file?directory=${encodeURIComponent('/home/fadh/workspace')}&path=.`)
    assert.ok(Array.isArray(entries), '/file should return an array')
    assert.ok(entries.length > 0, 'workspace root should have subdirectories')
    const dirs = entries.filter(e => e.type === 'directory')
    assert.ok(dirs.length > 0, 'workspace root should have at least one subdirectory')
  })
})

describe('Bug J prerequisite — server unreachable', { skip: serverReachable }, () => {
  test('OpenCode server must be running', () => {
    assert.fail(`Cannot reach OpenCode server at ${OC_URL}. Start it via: systemctl --user start opencode-tele`)
  })
})
