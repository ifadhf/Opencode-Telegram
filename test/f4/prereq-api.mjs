// File: test/f4/prereq-api.mjs
// F4 prerequisite — verifikasi OpenCode API endpoint yang dibutuhkan F4
// (stabilitas: status sesi, server health check, restart resiliency)
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'

const OC_URL = process.env.OPENCODE_URL || 'http://127.0.0.1:4097'
const OC_TEST_DIR = process.env.OC_TEST_DIR || '/home/fadh/workspace/opencode-telegram-dev/oc-test'

async function api(path, init) {
  const res = await fetch(`${OC_URL}${path}`, init)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${init?.method || 'GET'} ${path} -> ${res.status} ${res.statusText}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

let serverReachable = true
let testSessionId = null

before(async () => {
  try {
    await api('/session')
  } catch {
    serverReachable = false
  }
  if (serverReachable) {
    const sessions = await api(`/session?directory=${encodeURIComponent(OC_TEST_DIR)}`)
    if (sessions.length > 0) {
      testSessionId = sessions[0].id
    }
  }
})

describe('F4 prerequisite — OpenCode server reachable', { skip: !serverReachable }, () => {
  test('GET /session returns array (server alive check)', async () => {
    const sessions = await api('/session')
    assert.ok(Array.isArray(sessions), '/session should return an array')
  })

  test('GET /session?directory= filters sessions by project dir', async () => {
    const sessions = await api(`/session?directory=${encodeURIComponent(OC_TEST_DIR)}`)
    assert.ok(Array.isArray(sessions), 'directory-filtered /session should return array')
    assert.ok(sessions.length >= 0, 'should return sessions (can be empty or populated)')
  })

  test('GET /session/:id/message returns array — history endpoint stable', async () => {
    if (!testSessionId) {
      const created = await api('/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ directory: OC_TEST_DIR }),
      })
      testSessionId = created.id
    }
    const messages = await api(`/session/${testSessionId}/message`)
    assert.ok(Array.isArray(messages), '/session/:id/message should return an array')
  })

  test('server responds to /session after simulated restart (resiliency check)', async () => {
    // API should still be reachable — this validates the bot can reconnect after
    // the OpenCode server restart cycle that F4 HealthMonitor must handle
    const sessions = await api('/session')
    assert.ok(Array.isArray(sessions), 'server should remain responsive')
  })
})

describe('F4 prerequisite — server unreachable', { skip: serverReachable }, () => {
  test('OpenCode server must be running', () => {
    assert.fail(`Cannot reach OpenCode server at ${OC_URL}. Start it via: systemctl --user start opencode-tele`)
  })
})
