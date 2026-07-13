import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { StateManager } from '../../dist/state/manager.js'

const F2_IMPLEMENTED =
  typeof StateManager.prototype.setTopicSession === 'function' &&
  typeof StateManager.prototype.getTopicSession === 'function' &&
  typeof StateManager.prototype.getTopicBySession === 'function' &&
  typeof StateManager.prototype.getAllTopics === 'function' &&
  typeof StateManager.prototype.clearTopicSession === 'function'

let tmpDir
let stateFile

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'f2-state-'))
  stateFile = join(tmpDir, 'state.json')
})

after(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('F2 NOT YET IMPLEMENTED — StateManager needs topic-aware API', { skip: F2_IMPLEMENTED }, () => {
  test('missing methods: setTopicSession, getTopicSession, getTopicBySession, getAllTopics, clearTopicSession', () => {
    assert.fail(
      'F2 StateManager contract not implemented. Add topic-aware methods to src/state/manager.ts:\n' +
      '  setTopicSession(chatId, threadId, { sessionId, cwd, model?, mode? })\n' +
      '  getTopicSession(chatId, threadId) -> binding | undefined\n' +
      '  clearTopicSession(chatId, threadId)\n' +
      '  getTopicBySession(sessionId) -> { chatId, threadId } | undefined   // for routing notifications back to the right thread\n' +
      '  getAllTopics(chatId) -> Array<{ threadId, sessionId, cwd, model, mode }>   // for /status per-topic'
    )
  })
})

describe('F2 StateManager topic-binding contract', { skip: !F2_IMPLEMENTED }, () => {
  test('setTopicSession + getTopicSession round-trips a binding', async () => {
    const sm = new StateManager(stateFile)
    await sm.load()
    await sm.setTopicSession(123, 11, { sessionId: 'ses_a', cwd: '/proj/a' })
    const got = sm.getTopicSession(123, 11)
    assert.equal(got?.sessionId, 'ses_a')
    assert.equal(got?.cwd, '/proj/a')
  })

  test('two threads in the same chat are isolated', async () => {
    const sm = new StateManager(stateFile)
    await sm.load()
    await sm.setTopicSession(123, 11, { sessionId: 'ses_a', cwd: '/proj/a' })
    await sm.setTopicSession(123, 22, { sessionId: 'ses_b', cwd: '/proj/b' })
    assert.equal(sm.getTopicSession(123, 11).sessionId, 'ses_a')
    assert.equal(sm.getTopicSession(123, 22).sessionId, 'ses_b')
  })

  test('same thread id in different chats is independent', async () => {
    const sm = new StateManager(stateFile)
    await sm.load()
    await sm.setTopicSession(123, 11, { sessionId: 'ses_a', cwd: '/proj/a' })
    await sm.setTopicSession(456, 11, { sessionId: 'ses_b', cwd: '/proj/b' })
    assert.equal(sm.getTopicSession(123, 11).sessionId, 'ses_a')
    assert.equal(sm.getTopicSession(456, 11).sessionId, 'ses_b')
  })

  test('getTopicBySession reverse-lookup returns {chatId, threadId}', async () => {
    const sm = new StateManager(stateFile)
    await sm.load()
    await sm.setTopicSession(123, 22, { sessionId: 'ses_x', cwd: '/proj/x' })
    const loc = sm.getTopicBySession('ses_x')
    assert.deepEqual(loc, { chatId: 123, threadId: 22 })
  })

  test('getTopicBySession returns undefined for unknown session', async () => {
    const sm = new StateManager(stateFile)
    await sm.load()
    assert.equal(sm.getTopicBySession('nonexistent'), undefined)
  })

  test('getAllTopics lists every topic binding in a chat', async () => {
    const sm = new StateManager(stateFile)
    await sm.load()
    await sm.setTopicSession(789, 1, { sessionId: 'ses_1', cwd: '/p/1' })
    await sm.setTopicSession(789, 2, { sessionId: 'ses_2', cwd: '/p/2' })
    await sm.setTopicSession(999, 1, { sessionId: 'ses_3', cwd: '/p/3' })
    const topics = sm.getAllTopics(789)
    assert.equal(topics.length, 2)
    const threadIds = topics.map(t => t.threadId).sort()
    assert.deepEqual(threadIds, [1, 2])
    for (const t of topics) {
      assert.ok(t.sessionId, 'topic binding should have sessionId')
      assert.ok(t.cwd, 'topic binding should have cwd')
    }
  })

  test('clearTopicSession removes one binding without touching others', async () => {
    const sm = new StateManager(stateFile)
    await sm.load()
    await sm.setTopicSession(123, 11, { sessionId: 'ses_a', cwd: '/proj/a' })
    await sm.setTopicSession(123, 22, { sessionId: 'ses_b', cwd: '/proj/b' })
    await sm.clearTopicSession(123, 11)
    assert.equal(sm.getTopicSession(123, 11), undefined)
    assert.equal(sm.getTopicSession(123, 22).sessionId, 'ses_b')
    assert.equal(sm.getTopicBySession('ses_a'), undefined)
    assert.equal(sm.getTopicBySession('ses_b'), { chatId: 123, threadId: 22 })
  })

  test('bindings persist across save + reload', async () => {
    const sm1 = new StateManager(stateFile)
    await sm1.load()
    await sm1.setTopicSession(123, 33, { sessionId: 'ses_p', cwd: '/proj/p', model: { providerId: 'p', modelId: 'm' }, mode: 'plan' })
    await sm1.save()

    const sm2 = new StateManager(stateFile)
    await sm2.load()
    const got = sm2.getTopicSession(123, 33)
    assert.equal(got?.sessionId, 'ses_p')
    assert.equal(got?.cwd, '/proj/p')
    assert.equal(got?.model?.modelId, 'm')
    assert.equal(got?.mode, 'plan')
    assert.deepEqual(sm2.getTopicBySession('ses_p'), { chatId: 123, threadId: 33 })
  })

  test('backward compat — legacy chatId-only session still readable', async () => {
    const sm = new StateManager(stateFile)
    await sm.load()
    await sm.setCurrentSession(123, 'ses_legacy')
    assert.equal(sm.getCurrentSession(123), 'ses_legacy')
  })
})
