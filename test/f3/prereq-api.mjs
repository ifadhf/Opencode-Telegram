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

describe('F3 prerequisite — OpenCode server reachable', { skip: !serverReachable }, () => {
  test('GET /session/:id/message returns an array', async () => {
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

  test('messages have id, role, and time.created', async () => {
    const messages = await api(`/session/${testSessionId}/message?limit=5`)
    assert.ok(messages.length > 0, 'should have at least one message for testing')
    for (const m of messages) {
      const info = m.info || m
      assert.ok(typeof info.id === 'string', 'message should have id string')
      assert.ok(['user', 'assistant'].includes(info.role), `unexpected role: ${info.role}`)
      assert.ok(typeof info.time?.created === 'number', 'message should have time.created number')
    }
  })

  test('getMessages with limit=N returns at most N messages', async () => {
    const messages = await api(`/session/${testSessionId}/message?limit=2`)
    assert.ok(Array.isArray(messages))
    assert.ok(messages.length <= 2, `expected <=2 messages, got ${messages.length}`)
  })

  test('messages are ordered oldest-first (API default)', async () => {
    const messages = await api(`/session/${testSessionId}/message?limit=5`)
    if (messages.length < 2) return
    const infos = messages.map(m => m.info || m)
    for (let i = 1; i < infos.length; i++) {
      assert.ok(
        infos[i - 1].time.created <= infos[i].time.created,
        `messages not ordered oldest-first at index ${i}: ${infos[i-1].time.created} > ${infos[i].time.created}`
      )
    }
  })

  test('message parts have type, id, and optional text', async () => {
    const messages = await api(`/session/${testSessionId}/message?limit=3`)
    const withParts = messages.find(m => Array.isArray(m.parts || (m.info && m.info.parts)))
    if (!withParts) return
    const parts = withParts.parts || (withParts.info && withParts.info.parts)
    assert.ok(Array.isArray(parts), 'parts should be array')
    if (parts.length === 0) return
    for (const p of parts) {
      assert.ok(typeof p.type === 'string', `part should have type string, got: ${JSON.stringify(p).slice(0, 80)}`)
      assert.ok(typeof p.id === 'string', `part should have id string, got: ${JSON.stringify(p).slice(0, 80)}`)
    }
  })
})

describe('F3 prerequisite — server unreachable', { skip: serverReachable }, () => {
  test('OpenCode server must be running', () => {
    assert.fail(`Cannot reach OpenCode server at ${OC_URL}. Start it via: systemctl --user start opencode-tele`)
  })
})
