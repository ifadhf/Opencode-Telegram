// File: test/fn/prereq-api.mjs
// Pin-on-session prerequisite — verify OpenCode server and session API.

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

const OC_URL = process.env.OPENCODE_URL || 'http://127.0.0.1:4097'
const OC_TEST_DIR = process.env.OC_TEST_DIR || '/home/fadh/agent_workspace'

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

describe('Pin-on-session prerequisite — server reachable', { skip: !serverReachable }, () => {
  test('GET /session returns an array', async () => {
    const sessions = await api('/session')
    assert.ok(Array.isArray(sessions))
  })

  test('POST /session?directory=X creates session at directory X', async () => {
    const s = await api(`/session?directory=${encodeURIComponent(OC_TEST_DIR)}`, { method: 'POST' })
    try {
      assert.ok(s.id, 'created session should have an id')
      assert.equal(s.directory, OC_TEST_DIR, `session directory should be ${OC_TEST_DIR}`)
    } finally {
      await api(`/session/${s.id}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  test('GET /session/:id returns full session object', async () => {
    const s = await api(`/session?directory=${encodeURIComponent(OC_TEST_DIR)}`, { method: 'POST' })
    try {
      const refreshed = await api(`/session/${s.id}`)
      assert.ok(refreshed.id, 'refreshed session should have id')
      assert.ok(refreshed.directory, 'refreshed session should have directory')
      // May or may not have model/agent depending on applySessionDefaults
    } finally {
      await api(`/session/${s.id}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  test('GET /session/:id returns title or null', async () => {
    const s = await api(`/session?directory=${encodeURIComponent(OC_TEST_DIR)}`, { method: 'POST' })
    try {
      const refreshed = await api(`/session/${s.id}`)
      assert.ok(refreshed.title !== undefined, 'session should have title field')
    } finally {
      await api(`/session/${s.id}`, { method: 'DELETE' }).catch(() => {})
    }
  })
})

describe('Pin-on-session prerequisite — server unreachable', { skip: serverReachable }, () => {
  test('OpenCode server must be running', () => {
    assert.fail(`Cannot reach OpenCode server at ${OC_URL}. Start it via: systemctl --user start opencode-tele`)
  })
})
