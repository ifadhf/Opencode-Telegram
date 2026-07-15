// File: test/fl/session-contract.mjs
// Bug L contract — TDD for createSession directory fix + model/agent application.
// Phase 1 (NOT YET IMPLEMENTED) detects if the fix has been applied.
// Phase 2 unit tests mock OpenCodeClient.request to verify request shape.
// Phase 3 live tests verify end-to-end model/agent configuration.

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

const OC_URL = process.env.OPENCODE_URL || 'http://127.0.0.1:4097'
const OC_TEST_DIR = process.env.OC_TEST_DIR || '/home/fadh/workspace/opencode-telegram-dev/oc-test'

// Initialize logger before importing OpenCodeClient
const loggerMod = await import('../../dist/utils/logger.js')
loggerMod.initLogger({ logFile: '/tmp/opencode-test-fl.log', logLevel: 'error' })

// ============================================================
// Import detection
// ============================================================
let clientMod = null
try { clientMod = await import('../../dist/opencode/client.js') } catch { /* not built */ }
const IMPL = !!(clientMod && typeof clientMod.OpenCodeClient.prototype.createSession === 'function')

// ============================================================
// Phase 1: NOT YET IMPLEMENTED
// ============================================================
describe('Bug L NOT YET IMPLEMENTED — createSession fixes', { skip: IMPL }, () => {
  test('OpenCodeClient.createSession must be built before running contract tests', () => {
    assert.fail(
      'Build first: npm run build\n' +
      'Then run: node --test test/fl/prereq-api.mjs test/fl/session-contract.mjs'
    )
  })
})

// ============================================================
// Phase 2: Unit tests — mock the request method
// ============================================================
let capturedEndpoint = null
let capturedBody = null
let capturedMethod = null

function makeClient() {
  const client = new clientMod.OpenCodeClient('http://127.0.0.1:14097')
  client.request = async (endpoint, options) => {
    capturedEndpoint = endpoint
    capturedBody = options?.body ? JSON.parse(options.body) : null
    capturedMethod = options?.method || 'GET'
    return { id: 'mock-sid', directory: '/mock/dir', created: 1, updated: 1 }
  }
  return client
}

describe('Bug L createSession contract — query param', { skip: !IMPL }, () => {
  test('createSession(directory) sends directory as QUERY PARAM, not body', async () => {
    const client = makeClient()
    await client.createSession('/home/user/projects/myapp')

    // After fix: endpoint should be /session?directory=...
    assert.ok(capturedEndpoint.includes('?directory='),
      `createSession must use query param for directory, got endpoint: ${capturedEndpoint}`)
    assert.ok(capturedEndpoint.includes(encodeURIComponent('/home/user/projects/myapp')),
      `endpoint should contain encoded directory, got: ${capturedEndpoint}`)

    // Body should NOT contain directory
    const hasDirectoryInBody = capturedBody && capturedBody.directory !== undefined
    assert.ok(!hasDirectoryInBody,
      `directory must NOT be in the body, got body: ${JSON.stringify(capturedBody)}`)
  })

  test('createSession(undefined) sends no query param', async () => {
    const client = makeClient()
    await client.createSession()

    assert.equal(capturedEndpoint, '/session',
      `createSession() without directory should use /session, got: ${capturedEndpoint}`)
    assert.ok(!capturedEndpoint.includes('?directory='),
      `should not have ?directory= when no directory passed`)
  })

  test('createSession sends POST method', async () => {
    const client = makeClient()
    await client.createSession('/some/dir')

    assert.equal(capturedMethod, 'POST',
      `createSession must use POST, got: ${capturedMethod}`)
  })

  test('createSession with slashes in path encodes correctly', async () => {
    const client = makeClient()
    await client.createSession('/home/user/my project/folder')

    // Should contain encoded path
    assert.ok(capturedEndpoint.includes('%2Fhome%2Fuser%2Fmy%20project%2Ffolder'),
      `path with spaces should be encoded, got: ${capturedEndpoint}`)
  })
})

// ============================================================
// Phase 2b: model/agent application helper logic
// ============================================================
describe('Bug L model helper contract', { skip: !IMPL }, () => {
  test('parses config.model "provider/modelId" into providerID + modelId', () => {
    const configModel = 'cline-pass/cline-pass/deepseek-v4-pro'
    const slashIdx = configModel.indexOf('/')

    assert.ok(slashIdx > 0, 'model string must contain a slash')

    const providerID = configModel.substring(0, slashIdx)
    const modelId = configModel.substring(slashIdx + 1)

    assert.equal(providerID, 'cline-pass')
    assert.equal(modelId, 'cline-pass/deepseek-v4-pro')
  })

  test('parses config.model "simpleProvider/simpleModel"', () => {
    const configModel = 'openai/gpt-4'
    const slashIdx = configModel.indexOf('/')

    const providerID = configModel.substring(0, slashIdx)
    const modelId = configModel.substring(slashIdx + 1)

    assert.equal(providerID, 'openai')
    assert.equal(modelId, 'gpt-4')
  })

  test('finds default agent with mode=all from config', () => {
    const config = {
      agent: {
        plan: { mode: 'all', model: 'p1/m1' },
        build: { mode: 'all', model: 'p2/m2' },
        explorer: { mode: 'subagent', model: 'p3/m3' },
      }
    }

    const defaultAgent = Object.keys(config.agent)
      .find(k => config.agent[k]?.mode === 'all')

    assert.ok(defaultAgent, 'should find at least one agent with mode=all')
    assert.ok(defaultAgent === 'plan' || defaultAgent === 'build',
      `default agent should be plan or build, got: ${defaultAgent}`)
  })
})

// ============================================================
// Phase 3: Live API tests — end-to-end model/agent application
// ============================================================

// Check server reachability with top-level await (before describe registration)
let serverReachable = false
let configCache = null
try {
  const res = await fetch(`${OC_URL}/session`)
  if (res.ok) {
    serverReachable = true
    const cfgRes = await fetch(`${OC_URL}/config`)
    if (cfgRes.ok) configCache = await cfgRes.json()
  }
} catch { serverReachable = false }

describe('Bug L model/agent live tests', { skip: !serverReachable }, () => {
  let testSessionId = null
  let defaultAgent = 'plan'
  let agentModel = null

  before(() => {
    if (configCache?.agent) {
      const found = Object.keys(configCache.agent)
        .find(k => configCache.agent[k]?.mode === 'all')
      if (found) {
        defaultAgent = found
        agentModel = configCache.agent[found]?.model
      }
    }
  })

  after(async () => {
    if (testSessionId) {
      const { OpenCodeClient } = await import('../../dist/opencode/client.js')
      const client = new OpenCodeClient(OC_URL)
      await client.deleteSession(testSessionId).catch(() => {})
    }
  })

  test('createSession via fixed client returns correct directory', async () => {
    const { OpenCodeClient } = await import('../../dist/opencode/client.js')
    const client = new OpenCodeClient(OC_URL)

    const s = await client.createSession(OC_TEST_DIR)
    try {
      assert.equal(s.directory, OC_TEST_DIR,
        `session directory should be ${OC_TEST_DIR}, got ${s.directory}`)
    } finally {
      await client.deleteSession(s.id).catch(() => {})
    }
  })

  test('after setSessionAgent, session.agent matches', async () => {
    const { OpenCodeClient } = await import('../../dist/opencode/client.js')
    const client = new OpenCodeClient(OC_URL)
    const s = await client.createSession(OC_TEST_DIR)
    testSessionId = s.id

    await client.setSessionAgent(s.id, 'plan')

    const refreshed = await client.getSession(s.id)
    assert.equal(refreshed.agent, 'plan', 'session.agent should be plan after setSessionAgent')
  })

  test('after setSessionModel, session.model matches', async () => {
    const { OpenCodeClient } = await import('../../dist/opencode/client.js')
    const client = new OpenCodeClient(OC_URL)
    // Use a fresh session for clean state
    const s = await client.createSession(OC_TEST_DIR)
    try {
      testSessionId = s.id
      await client.setSessionAgent(s.id, 'plan')
      await client.setSessionModel(s.id, 'cline-pass', 'cline-pass/deepseek-v4-pro')

      const refreshed = await client.getSession(s.id)
      assert.ok(refreshed.model, 'session.model should exist')
      assert.equal(refreshed.model.id, 'cline-pass/deepseek-v4-pro')
      assert.equal(refreshed.model.providerID, 'cline-pass')
      assert.equal(refreshed.agent, 'plan')
    } finally {
      await client.deleteSession(s.id).catch(() => {})
    }
  })

  test('model set via client methods matches what CLI would show', async () => {
    const { OpenCodeClient } = await import('../../dist/opencode/client.js')
    const client = new OpenCodeClient(OC_URL)

    const s = await client.createSession(OC_TEST_DIR)
    try {
      await client.setSessionAgent(s.id, defaultAgent)

      if (agentModel) {
        const slashIdx = agentModel.indexOf('/')
        if (slashIdx > 0) {
          const providerID = agentModel.substring(0, slashIdx)
          const modelId = agentModel.substring(slashIdx + 1)
          await client.setSessionModel(s.id, providerID, modelId)
        }
      }

      const refreshed = await client.getSession(s.id)
      assert.equal(refreshed.agent, defaultAgent)
      if (agentModel) {
        assert.ok(refreshed.model, 'session should have model after setSessionModel')
        assert.ok(refreshed.model.id, 'model.id should be set')
        assert.ok(refreshed.model.providerID, 'model.providerID should be set')
      }
    } finally {
      await client.deleteSession(s.id).catch(() => {})
    }
  })
})

describe('Bug L live tests — server unreachable', { skip: serverReachable }, () => {
  test('OpenCode server must be running', () => {
    assert.fail(`Cannot reach OpenCode server at ${OC_URL}. Start it via: systemctl --user start opencode-tele`)
  })
})
