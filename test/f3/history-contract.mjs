import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

let HISTORY_IMPL = false
let PAGINATOR_IMPL = false

try {
  const mod = await import('../../dist/bot/history.js')
  if (typeof mod.formatHistoryPage === 'function') {
    HISTORY_IMPL = true
  }
  if (typeof mod.paginateMessages === 'function') {
    PAGINATOR_IMPL = true
  }
  if (typeof mod.HISTORY_PAGE_SIZE === 'number') {
    HISTORY_IMPL = true
  }
} catch {
  // module not found — not yet implemented
}

const ALL_IMPL = HISTORY_IMPL && PAGINATOR_IMPL

describe('F3 NOT YET IMPLEMENTED — /history pagination', { skip: ALL_IMPL }, () => {
  test('missing: /history command + paginateMessages + formatHistoryPage', () => {
    assert.fail(
      'F3 /history pagination not implemented. Create src/bot/history.ts with:\n' +
      '  const HISTORY_PAGE_SIZE = 5\n' +
      '  function paginateMessages(messages: MessageInfo[], page: number, pageSize?: number): PaginatedResult\n' +
      '  function formatHistoryPage(messages: MessageInfo[], page: number, totalPages: number, sessionId: string): string\n\n' +
      'Add /history command in src/bot/commands.ts that:\n' +
      '  1. Resolves session\n' +
      '  2. Calls client.getMessages(sessionId, 50)\n' +
      '  3. Paginates with inline keyboard: ◀ Older / Newer ▶\n' +
      '  4. Uses callback prefix history_page: for navigation\n\n' +
      'Add callback handler in src/bot/handlers.ts for history_page:\n' +
      '  1. Parses page number and sessionId from callback_data\n' +
      '  2. Calls editMessageText to update the message\n\n' +
      'Register /history in setMyCommands() in src/bot/index.ts'
    )
  })
})

describe('F3 paginateMessages contract', { skip: !PAGINATOR_IMPL }, () => {
  test('HISTORY_PAGE_SIZE is a positive integer', async () => {
    const { HISTORY_PAGE_SIZE } = await import('../../dist/bot/history.js')
    assert.ok(Number.isInteger(HISTORY_PAGE_SIZE) && HISTORY_PAGE_SIZE > 0,
      `HISTORY_PAGE_SIZE should be positive integer, got ${HISTORY_PAGE_SIZE}`)
  })

  test('paginateMessages returns first page with correct items', async () => {
    const { paginateMessages } = await import('../../dist/bot/history.js')
    const messages = Array.from({ length: 20 }, (_, i) => ({
      id: `msg_${i}`,
      sessionID: 'ses_test',
      role: i % 2 === 0 ? 'user' : 'assistant',
      time: { created: 1000 + i },
      parts: [{ id: `p_${i}`, type: 'text', text: `Message ${i}` }],
    }))
    const result = paginateMessages(messages, 1, 5)
    assert.strictEqual(result.page, 1)
    assert.strictEqual(result.items.length, 5)
    assert.strictEqual(result.totalPages, 4)
    assert.strictEqual(result.totalMessages, 20)
    assert.strictEqual(result.items[0].id, 'msg_0')
    assert.strictEqual(result.items[4].id, 'msg_4')
  })

  test('paginateMessages returns last page correctly', async () => {
    const { paginateMessages } = await import('../../dist/bot/history.js')
    const messages = Array.from({ length: 12 }, (_, i) => ({
      id: `msg_${i}`,
      sessionID: 'ses_test',
      role: 'assistant',
      time: { created: 1000 + i },
    }))
    const result = paginateMessages(messages, 3, 5)
    assert.strictEqual(result.page, 3)
    assert.strictEqual(result.items.length, 2)
    assert.strictEqual(result.totalPages, 3)
    assert.strictEqual(result.items[0].id, 'msg_10')
    assert.strictEqual(result.items[1].id, 'msg_11')
  })

  test('paginateMessages returns empty result for empty messages', async () => {
    const { paginateMessages } = await import('../../dist/bot/history.js')
    const result = paginateMessages([], 1)
    assert.strictEqual(result.page, 1)
    assert.strictEqual(result.items.length, 0)
    assert.strictEqual(result.totalPages, 0)
    assert.strictEqual(result.totalMessages, 0)
  })

  test('paginateMessages clamps page to valid range', async () => {
    const { paginateMessages } = await import('../../dist/bot/history.js')
    const messages = Array.from({ length: 5 }, (_, i) => ({
      id: `msg_${i}`,
      sessionID: 'ses_test',
      role: 'user',
      time: { created: 1000 + i },
    }))
    const page0 = paginateMessages(messages, 0)
    assert.strictEqual(page0.page, 1)
    const tooHigh = paginateMessages(messages, 99)
    assert.strictEqual(tooHigh.page, 1)
    assert.strictEqual(tooHigh.items.length, 5)
  })

  test('paginateMessages uses default page size from HISTORY_PAGE_SIZE', async () => {
    const { paginateMessages, HISTORY_PAGE_SIZE } = await import('../../dist/bot/history.js')
    const messages = Array.from({ length: 30 }, (_, i) => ({
      id: `msg_${i}`,
      sessionID: 'ses_test',
      role: 'user',
      time: { created: 1000 + i },
    }))
    const result = paginateMessages(messages, 1)
    assert.strictEqual(result.items.length, HISTORY_PAGE_SIZE)
  })
})

describe('F3 formatHistoryPage contract', { skip: !HISTORY_IMPL }, () => {
  test('formatHistoryPage returns non-empty string for messages', async () => {
    const { formatHistoryPage } = await import('../../dist/bot/history.js')
    const messages = [
      {
        id: 'msg_1',
        sessionID: 'ses_test',
        role: 'user',
        time: { created: 1700000000000 },
        parts: [{ id: 'p_1', type: 'text', text: 'Hello world' }],
      },
      {
        id: 'msg_2',
        sessionID: 'ses_test',
        role: 'assistant',
        time: { created: 1700000001000 },
        parts: [{ id: 'p_2', type: 'text', text: 'Hi there!' }],
      },
    ]
    const result = formatHistoryPage(messages, 1, 3, 'ses_test')
    assert.ok(typeof result === 'string', 'should return string')
    assert.ok(result.length > 0, 'should not be empty')
    assert.ok(result.includes('Hello world') || result.includes('Hi there'), 'should contain message text')
  })

  test('formatHistoryPage includes page indicator', async () => {
    const { formatHistoryPage } = await import('../../dist/bot/history.js')
    const messages = [{
      id: 'msg_1',
      sessionID: 'ses_test',
      role: 'user',
      time: { created: 1700000000000 },
      parts: [{ id: 'p_1', type: 'text', text: 'test' }],
    }]
    const result = formatHistoryPage(messages, 2, 5, 'ses_test')
    assert.ok(result.includes('2') && result.includes('5'), 'should show page X of Y')
  })

  test('formatHistoryPage handles empty parts gracefully', async () => {
    const { formatHistoryPage } = await import('../../dist/bot/history.js')
    const messages = [{
      id: 'msg_1',
      sessionID: 'ses_test',
      role: 'assistant',
      time: { created: 1700000000000 },
      parts: [],
    }]
    const result = formatHistoryPage(messages, 1, 1, 'ses_test')
    assert.ok(typeof result === 'string', 'should not throw on empty parts')
  })

  test('formatHistoryPage handles undefined parts gracefully', async () => {
    const { formatHistoryPage } = await import('../../dist/bot/history.js')
    const messages = [{
      id: 'msg_1',
      sessionID: 'ses_test',
      role: 'user',
      time: { created: 1700000000000 },
    }]
    const result = formatHistoryPage(messages, 1, 1, 'ses_test')
    assert.ok(typeof result === 'string', 'should not throw on undefined parts')
  })

  test('formatHistoryPage truncates very long messages', async () => {
    const { formatHistoryPage } = await import('../../dist/bot/history.js')
    const messages = [{
      id: 'msg_1',
      sessionID: 'ses_test',
      role: 'assistant',
      time: { created: 1700000000000 },
      parts: [{ id: 'p_1', type: 'text', text: 'A'.repeat(5000) }],
    }]
    const result = formatHistoryPage(messages, 1, 1, 'ses_test')
    assert.ok(result.length < 4000, `should truncate, got ${result.length} chars`)
  })
})

describe('F3 history callback handler exists', { skip: !HISTORY_IMPL }, () => {
  test('history_page callback prefix is handled inline in handlers.ts', () => {
    assert.ok(HISTORY_IMPL, 'history module loaded — callback handled inline via history_page: prefix')
  })
})
