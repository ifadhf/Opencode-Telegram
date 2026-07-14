// File: test/f5/prereq-api.mjs
// F5 prerequisite — verify the live OpenCode endpoints F5 relies on:
//   GET /question       (poll pending interactive questions — F5.2)
//   GET /permission     (poll pending permission requests — F5.1 routing)
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

describe('F5 prerequisite — OpenCode question/permission poll endpoints', { skip: !serverReachable }, () => {
  test('GET /question returns an array (question poll endpoint exists)', async () => {
    const questions = await api('/question')
    assert.ok(Array.isArray(questions), '/question should return an array (QuestionRequest[])')
    // When populated, each item must carry the fields the bot maps.
    for (const q of questions) {
      assert.ok(typeof q.id === 'string', 'question has id')
      assert.ok(typeof q.sessionID === 'string', 'question has sessionID')
      assert.ok(Array.isArray(q.questions), 'question has questions[]')
    }
  })

  test('GET /permission returns an array (permission poll endpoint exists)', async () => {
    const perms = await api('/permission')
    assert.ok(Array.isArray(perms), '/permission should return an array')
  })
})

describe('F5 prerequisite — server unreachable', { skip: serverReachable }, () => {
  test('OpenCode server must be running', () => {
    assert.fail(`Cannot reach OpenCode server at ${OC_URL}. Start it via: systemctl --user start opencode-tele`)
  })
})
