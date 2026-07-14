import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let StateManager
let initLogger
try {
  ({ StateManager } = await import('../../dist/state/manager.js'));
  ({ initLogger } = await import('../../dist/utils/logger.js'))
} catch { /* not built */ }
const IMPL = !!StateManager

describe('F14 NOT YET IMPLEMENTED — simplified topic binding', { skip: IMPL }, () => {
  test('src/state/manager.ts missing simplified topic binding exports', () => {
    assert.fail(
      'StateManager topicBindings should be Map<string, string>. ' +
      'setTopicSession(chatId, threadId, sessionId) takes a string, not an object. ' +
      'getTopicSession returns a string. getAllTopics returns { threadId, sessionId } only.'
    )
  })
})

describe('F14 binding contract', { skip: !IMPL }, () => {
  let loggerInited = false

  async function initLog() {
    if (!loggerInited) {
      const logDir = await mkdtemp(join(tmpdir(), 'f14-log-'))
      initLogger({ logFile: join(logDir, 'test.log'), logLevel: 'error' })
      loggerInited = true
    }
  }

  async function freshState() {
    await initLog()
    const dir = await mkdtemp(join(tmpdir(), 'f14-state-'))
    const sm = new StateManager(join(dir, 'state.json'))
    await sm.load()
    return { sm, dir }
  }

  describe('1. setTopicSession takes sessionId string', () => {
    test('sessionId is a plain string, not an object', async () => {
      const { sm, dir } = await freshState()
      try {
        sm.setTopicSession(100, 200, 'ses_alpha')
        await sm.flushSave()
        assert.equal(sm.getTopicSession(100, 200), 'ses_alpha')
      } finally { await rm(dir, { recursive: true, force: true }) }
    })
  })

  describe('2. getTopicSession returns string', () => {
    test('returns a string, not an object', async () => {
      const { sm, dir } = await freshState()
      try {
        sm.setTopicSession(100, 201, 'ses_beta')
        await sm.flushSave()
        const result = sm.getTopicSession(100, 201)
        assert.equal(typeof result, 'string')
        assert.equal(result, 'ses_beta')
      } finally { await rm(dir, { recursive: true, force: true }) }
    })

    test('returns undefined for unknown topic', async () => {
      const { sm, dir } = await freshState()
      try {
        assert.equal(sm.getTopicSession(999, 999), undefined)
      } finally { await rm(dir, { recursive: true, force: true }) }
    })
  })

  describe('3. getAllTopics returns simplified entries', () => {
    test('each entry has only threadId and sessionId', async () => {
      const { sm, dir } = await freshState()
      try {
        sm.setTopicSession(100, 10, 'ses_one')
        sm.setTopicSession(100, 20, 'ses_two')
        await sm.flushSave()

        const topics = sm.getAllTopics(100)
        assert.equal(topics.length, 2)

        for (const t of topics) {
          assert.ok(typeof t.threadId === 'number', 'threadId must be number')
          assert.ok(typeof t.sessionId === 'string', 'sessionId must be string')
          assert.equal(Object.keys(t).length, 2, 'entry must have only threadId + sessionId')
          assert.ok(!('cwd' in t), 'must not have cwd')
          assert.ok(!('model' in t), 'must not have model')
          assert.ok(!('mode' in t), 'must not have mode')
        }
      } finally { await rm(dir, { recursive: true, force: true }) }
    })

    test('filters by chatId', async () => {
      const { sm, dir } = await freshState()
      try {
        sm.setTopicSession(100, 1, 'ses_aaa')
        sm.setTopicSession(200, 2, 'ses_bbb')
        await sm.flushSave()

        assert.equal(sm.getAllTopics(100).length, 1)
        assert.equal(sm.getAllTopics(200).length, 1)
        assert.equal(sm.getAllTopics(999).length, 0)
      } finally { await rm(dir, { recursive: true, force: true }) }
    })
  })

  describe('4. clearTopicSession', () => {
    test('getTopicSession returns undefined after clear', async () => {
      const { sm, dir } = await freshState()
      try {
        sm.setTopicSession(100, 300, 'ses_gamma')
        sm.clearTopicSession(100, 300)
        await sm.flushSave()
        assert.equal(sm.getTopicSession(100, 300), undefined)
      } finally { await rm(dir, { recursive: true, force: true }) }
    })

    test('sessionToTopic is cleaned up', async () => {
      const { sm, dir } = await freshState()
      try {
        sm.setTopicSession(100, 400, 'ses_delta')
        sm.clearTopicSession(100, 400)
        await sm.flushSave()

        const resolved = sm.resolveChat('ses_delta')
        assert.equal(resolved, undefined)
      } finally { await rm(dir, { recursive: true, force: true }) }
    })

    test('resolveChat returns undefined after clear', async () => {
      const { sm, dir } = await freshState()
      try {
        sm.setTopicSession(100, 500, 'ses_epsilon')
        const before = sm.resolveChat('ses_epsilon')
        assert.ok(before)
        assert.equal(before.chatId, 100)
        assert.equal(before.threadId, 500)

        sm.clearTopicSession(100, 500)
        assert.equal(sm.resolveChat('ses_epsilon'), undefined)
      } finally { await rm(dir, { recursive: true, force: true }) }
    })
  })

  describe('5. old format migration', () => {
    test('loads old-format topicBindings and returns just sessionId string', async () => {
      const { dir } = await freshState()
      const sm2 = new StateManager(join(dir, 'state.json'))
      try {
        const oldData = {
          sessions: [],
          models: [],
          modes: [],
          topicBindings: {
            '100:10': { sessionId: 'ses_old_a', cwd: '/tmp', model: { providerId: 'p', modelId: 'm' }, mode: 'full' },
            '100:20': { sessionId: 'ses_old_b' },
          },
        }
        writeFileSync(join(dir, 'state.json'), JSON.stringify(oldData, null, 2))
        await sm2.load()

        const a = sm2.getTopicSession(100, 10)
        assert.equal(typeof a, 'string', 'migrated value must be a string')
        assert.equal(a, 'ses_old_a')

        const b = sm2.getTopicSession(100, 20)
        assert.equal(typeof b, 'string', 'migrated value must be a string')
        assert.equal(b, 'ses_old_b')

        const topics = sm2.getAllTopics(100)
        assert.equal(topics.length, 2)
        for (const t of topics) {
          assert.equal(Object.keys(t).length, 2)
          assert.ok(!('cwd' in t))
        }
      } finally { await rm(dir, { recursive: true, force: true }) }
    })

    test('migrated sessionToTopic is populated', async () => {
      const { dir } = await freshState()
      const sm2 = new StateManager(join(dir, 'state.json'))
      try {
        const oldData = {
          sessions: [],
          models: [],
          modes: [],
          topicBindings: {
            '100:99': { sessionId: 'ses_migrate_s2t' },
          },
        }
        writeFileSync(join(dir, 'state.json'), JSON.stringify(oldData, null, 2))
        await sm2.load()

        const resolved = sm2.resolveChat('ses_migrate_s2t')
        assert.ok(resolved)
        assert.equal(resolved.chatId, 100)
        assert.equal(resolved.threadId, 99)
      } finally { await rm(dir, { recursive: true, force: true }) }
    })

    test('new-format string values still load correctly', async () => {
      const { dir } = await freshState()
      const sm2 = new StateManager(join(dir, 'state.json'))
      try {
        const newData = {
          sessions: [],
          models: [],
          modes: [],
          topicBindings: {
            '100:50': 'ses_new_fmt',
          },
        }
        writeFileSync(join(dir, 'state.json'), JSON.stringify(newData, null, 2))
        await sm2.load()

        assert.equal(sm2.getTopicSession(100, 50), 'ses_new_fmt')
      } finally { await rm(dir, { recursive: true, force: true }) }
    })
  })

  describe('6. per-topic independence', () => {
    test('clearing one topic does not affect another', async () => {
      const { sm, dir } = await freshState()
      try {
        sm.setTopicSession(100, 1, 'ses_ind_a')
        sm.setTopicSession(100, 2, 'ses_ind_b')
        await sm.flushSave()
        sm.clearTopicSession(100, 1)
        await sm.flushSave()

        assert.equal(sm.getTopicSession(100, 1), undefined)
        assert.equal(sm.getTopicSession(100, 2), 'ses_ind_b')
      } finally { await rm(dir, { recursive: true, force: true }) }
    })

    test('resolveChat for surviving topic still works', async () => {
      const { sm, dir } = await freshState()
      try {
        sm.setTopicSession(100, 10, 'ses_survive')
        sm.setTopicSession(100, 20, 'ses_cleared')
        await sm.flushSave()
        sm.clearTopicSession(100, 20)

        const resolved = sm.resolveChat('ses_survive')
        assert.ok(resolved)
        assert.equal(resolved.chatId, 100)
        assert.equal(resolved.threadId, 10)
        assert.equal(sm.resolveChat('ses_cleared'), undefined)
      } finally { await rm(dir, { recursive: true, force: true }) }
    })
  })

  describe('7. setTopicSession overwrites', () => {
    test('setting new sessionId for same topic replaces old', async () => {
      const { sm, dir } = await freshState()
      try {
        sm.setTopicSession(100, 1, 'ses_v1')
        assert.equal(sm.getTopicSession(100, 1), 'ses_v1')

        sm.setTopicSession(100, 1, 'ses_v2')
        await sm.flushSave()
        assert.equal(sm.getTopicSession(100, 1), 'ses_v2')

        const topics = sm.getAllTopics(100)
        assert.equal(topics.length, 1, 'only one binding per topic')
        assert.equal(topics[0].sessionId, 'ses_v2')
      } finally { await rm(dir, { recursive: true, force: true }) }
    })

    test('old sessionId removed from sessionToTopic on overwrite', async () => {
      const { sm, dir } = await freshState()
      try {
        sm.setTopicSession(100, 5, 'ses_old')
        const before = sm.resolveChat('ses_old')
        assert.ok(before)

        sm.setTopicSession(100, 5, 'ses_new')
        await sm.flushSave()
        assert.equal(
          sm.resolveChat('ses_old'), undefined,
          'old sessionId must be removed from sessionToTopic on overwrite'
        )
        const after = sm.resolveChat('ses_new')
        assert.ok(after, 'new sessionId must be in sessionToTopic')
        assert.equal(after.chatId, 100)
        assert.equal(after.threadId, 5)
      } finally { await rm(dir, { recursive: true, force: true }) }
    })
  })
})
