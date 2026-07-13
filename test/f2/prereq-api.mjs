import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'

const OC_URL = process.env.OPENCODE_URL || 'http://127.0.0.1:4097'
const OC_TEST_DIR = process.env.OC_TEST_DIR || '/home/fadh/workspace/opencode-telegram-dev/oc-test'
const OTHER_DIR = process.env.OTHER_DIR || '/home/fadh/opencode'

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
  try {
    await api('/session')
  } catch {
    serverReachable = false
  }
})

describe('F2 prerequisite — OpenCode server reachable', { skip: !serverReachable }, () => {
  test('GET /session responds with an array', async () => {
    const sessions = await api('/session')
    assert.ok(Array.isArray(sessions), '/session should return an array')
  })
})

describe('F2 prerequisite — ?directory= filter isolates sessions', { skip: !serverReachable }, () => {
  test('every session returned for OC_TEST_DIR has that directory', async () => {
    const sessions = await api(`/session?directory=${encodeURIComponent(OC_TEST_DIR)}`)
    assert.ok(Array.isArray(sessions))
    for (const s of sessions) {
      assert.equal(s.directory, OC_TEST_DIR, `session ${s.id} has wrong directory: ${s.directory}`)
    }
  })

  test('every session returned for OTHER_DIR has that directory', async () => {
    const sessions = await api(`/session?directory=${encodeURIComponent(OTHER_DIR)}`)
    assert.ok(Array.isArray(sessions))
    for (const s of sessions) {
      assert.equal(s.directory, OTHER_DIR, `session ${s.id} has wrong directory: ${s.directory}`)
    }
  })

  test('the two directory sets are disjoint (no shared session id)', async () => {
    const a = await api(`/session?directory=${encodeURIComponent(OC_TEST_DIR)}`)
    const b = await api(`/session?directory=${encodeURIComponent(OTHER_DIR)}`)
    const idsA = new Set(a.map(s => s.id))
    const shared = b.filter(s => idsA.has(s.id))
    assert.equal(shared.length, 0, `sessions leaked across directories: ${shared.map(s => s.id).join(', ')}`)
  })

  test('unfiltered /session is a superset of each filtered result', async () => {
    const all = await api('/session')
    const a = await api(`/session?directory=${encodeURIComponent(OC_TEST_DIR)}`)
    const allIds = new Set(all.map(s => s.id))
    for (const s of a) {
      assert.ok(allIds.has(s.id), `filtered session ${s.id} not in unfiltered list`)
    }
  })
})

describe('F2 prerequisite — POST /session accepts {directory}', { skip: !serverReachable }, () => {
  test('creating a session with a directory returns a session bound to it', async () => {
    const created = await api('/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ directory: OC_TEST_DIR }),
    })
    assert.ok(created.id, 'created session should have an id')
    assert.equal(created.directory, OC_TEST_DIR, 'created session directory mismatch')
  })
})

describe('F2 prerequisite — /api/fs/list returns directory entries', { skip: !serverReachable }, () => {
  test('listing OC_TEST_DIR returns {location, data} with path+type entries', async () => {
    const listing = await api(`/api/fs/list?path=${encodeURIComponent(OC_TEST_DIR)}`)
    assert.ok(listing.location, 'listing should have a location object')
    assert.equal(listing.location.directory, OC_TEST_DIR)
    assert.ok(Array.isArray(listing.data), 'listing.data should be an array')
    for (const entry of listing.data) {
      assert.ok(typeof entry.path === 'string', `entry missing path: ${JSON.stringify(entry)}`)
      assert.ok(typeof entry.type === 'string', `entry missing type: ${JSON.stringify(entry)}`)
    }
    const names = listing.data.map(e => e.path.replace(/\/$/, ''))
    assert.ok(names.includes('hello.py'), `hello.py not in listing: ${names.join(', ')}`)
  })
})

describe('F2 prerequisite — server unreachable', { skip: serverReachable }, () => {
  test('OpenCode server must be running for F2 API tests', () => {
    assert.fail(`Cannot reach OpenCode server at ${OC_URL}. Start it via: systemctl --user start opencode-tele (or: opencode serve --port 4097 --pure)`)
  })
})
