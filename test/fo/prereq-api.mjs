// File: test/fo/prereq-api.mjs
// Idle-message prerequisite — verify OpenCode server and session API.

import { test, describe, before } from 'node:test'
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

describe('Idle-message prerequisite — server reachable', { skip: !serverReachable }, () => {
  test('GET /session returns an array', async () => {
    const sessions = await api('/session')
    assert.ok(Array.isArray(sessions))
  })

  test('POST /session?directory=X creates session', async () => {
    const s = await api(`/session?directory=${encodeURIComponent(OC_TEST_DIR)}`, { method: 'POST' })
    try {
      assert.ok(s.id, 'session should have id')
    } finally {
      await api(`/session/${s.id}`, { method: 'DELETE' }).catch(() => {})
    }
  })
})

describe('Idle-message prerequisite — server unreachable', { skip: serverReachable }, () => {
  test('OpenCode server must be running', () => {
    assert.fail(`Cannot reach OpenCode server at ${OC_URL}.`)
  })
})
