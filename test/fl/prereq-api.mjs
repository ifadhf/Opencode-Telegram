// File: test/fl/prereq-api.mjs
// Bug L prerequisite — verify POST /session?directory=X honours directory
// and that setSessionAgent/setSessionModel work correctly.
// Read-only aside from creating one test session (cleaned up).

import { test, describe, before, after } from 'node:test'
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

describe('Bug L prerequisite — OpenCode server reachable', { skip: !serverReachable }, () => {
  test('GET /session returns an array', async () => {
    const sessions = await api('/session')
    assert.ok(Array.isArray(sessions))
  })

  test('POST /session?directory=X creates session at directory X', async () => {
    const s = await api(`/session?directory=${encodeURIComponent(OC_TEST_DIR)}`, { method: 'POST' })
    assert.ok(s.id, 'created session should have an id')
    assert.equal(s.directory, OC_TEST_DIR, `session directory should be ${OC_TEST_DIR}, got ${s.directory}`)
    // cleanup
    await api(`/session/${s.id}`, { method: 'DELETE' }).catch(() => {})
  })

  test('POST /session (no query) with {directory} in body IGNORES directory', async () => {
    // Verifies the bug: body directory is ignored by the API
    const s = await api('/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ directory: OC_TEST_DIR }),
    })
    assert.ok(s.id, 'created session should have an id')
    assert.notEqual(s.directory, OC_TEST_DIR,
      `session directory should NOT be ${OC_TEST_DIR} (body parameter is ignored by API)`)
    // cleanup
    await api(`/session/${s.id}`, { method: 'DELETE' }).catch(() => {})
  })

  test('GET /config returns model + agent config', async () => {
    const cfg = await api('/config')
    // config.model is the global default
    // config.agent has per-agent model config
    assert.ok(cfg.model || cfg.agent, 'config must have model or agent fields')
  })
})

describe('Bug L prerequisite — model/agent after creation', { skip: !serverReachable }, () => {
  let sid = null

  before(async () => {
    const s = await api(`/session?directory=${encodeURIComponent(OC_TEST_DIR)}`, { method: 'POST' })
    sid = s.id
  })

  after(async () => {
    if (sid) await api(`/session/${sid}`, { method: 'DELETE' }).catch(() => {})
  })

  test('fresh session has no model or agent field', async () => {
    const s = await api(`/session/${sid}`)
    // Freshly created sessions don't have model/agent set — Bug 3
    assert.ok(!s.model, `fresh session should have no model, got: ${JSON.stringify(s.model)}`)
    assert.ok(!s.agent, `fresh session should have no agent, got: ${s.agent}`)
  })

  test('POST /api/session/:id/agent sets the agent on the session', async () => {
    await apiVoid(`/api/session/${sid}/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'plan' }),
    })
    const s = await api(`/session/${sid}`)
    assert.equal(s.agent, 'plan', 'session agent should be plan')
  })

  test('POST /api/session/:id/model sets the model on the session', async () => {
    // First set an agent so the model tracking is consistent
    await apiVoid(`/api/session/${sid}/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'plan' }),
    })
    await apiVoid(`/api/session/${sid}/model`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: { providerID: 'cline-pass', id: 'cline-pass/deepseek-v4-pro' } }),
    })
    const s = await api(`/session/${sid}`)
    assert.ok(s.model, 'session should have model after POST model')
    assert.equal(s.model.id, 'cline-pass/deepseek-v4-pro')
    assert.equal(s.model.providerID, 'cline-pass')
    assert.equal(s.agent, 'plan')
  })
})

describe('Bug L prerequisite — server unreachable', { skip: serverReachable }, () => {
  test('OpenCode server must be running', () => {
    assert.fail(`Cannot reach OpenCode server at ${OC_URL}. Start it via: systemctl --user start opencode-tele`)
  })
})
