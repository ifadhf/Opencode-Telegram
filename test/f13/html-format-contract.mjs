import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// F13: HTML format migration — migrate all user-facing output from Markdown(legacy)/MarkdownV2
// parse_mode to HTML parse_mode. This means escapeHtml replaces escapeMarkdown, and output
// templates use <b>/<i>/<code>/<pre> instead of */_/`/```.

let ESCAPE_IMPL = false
let HISTORY_IMPL = false

try {
  const fmt = await import('../../dist/utils/formatter.js')
  if (typeof fmt.escapeHtml === 'function') ESCAPE_IMPL = true
} catch { /* not built */ }

try {
  const hist = await import('../../dist/bot/history.js')
  if (typeof hist.formatHistoryPage === 'function' && typeof hist.paginateMessages === 'function') {
    HISTORY_IMPL = true
  }
} catch { /* not built */ }

// ==========================================================================
// Category 1: escapeHtml escapes the right characters
// ==========================================================================

describe('F13.1 escapeHtml character escaping', { skip: !ESCAPE_IMPL }, () => {
  let escapeHtml
  const messages = []

  // Load before each test (clean, but cheap enough)
  test.beforeEach(async () => {
    ;({ escapeHtml } = await import('../../dist/utils/formatter.js'))
  })

  test('ampersand & -> &amp;', () => {
    assert.strictEqual(escapeHtml('a & b'), 'a &amp; b')
  })

  test('angle brackets escaped', () => {
    assert.strictEqual(escapeHtml('<div>'), '&lt;div&gt;')
  })

  test('normal text unchanged', () => {
    assert.strictEqual(escapeHtml('hello world'), 'hello world')
  })

  test('underscore _ is NOT escaped (literal in HTML)', () => {
    assert.strictEqual(escapeHtml('_italic_'), '_italic_')
    assert.strictEqual(escapeHtml('some_var_name'), 'some_var_name')
  })

  test('asterisk * is NOT escaped', () => {
    assert.strictEqual(escapeHtml('*bold*'), '*bold*')
  })

  test('dash - is NOT escaped', () => {
    assert.strictEqual(escapeHtml('keep-dashes'), 'keep-dashes')
  })

  test('backtick ` is NOT escaped', () => {
    assert.strictEqual(escapeHtml('`code`'), '`code`')
  })

  test('dot . is NOT escaped', () => {
    assert.strictEqual(escapeHtml('file.txt'), 'file.txt')
  })

  test('file paths with underscores and dashes are NOT modified', () => {
    const path = '/home/user/my_project/file-v2.txt'
    assert.strictEqual(escapeHtml(path), path)
  })

  test('channel name with underscore is NOT modified', () => {
    assert.strictEqual(escapeHtml('@Fad_MSI_OC_bot'), '@Fad_MSI_OC_bot')
  })
})

// ==========================================================================
// Category 2: formatHistoryPage uses HTML tags
// ==========================================================================

describe('F13.2 formatHistoryPage HTML tag contract', { skip: !HISTORY_IMPL }, () => {
  let formatHistoryPage

  test.beforeEach(async () => {
    ;({ formatHistoryPage } = await import('../../dist/bot/history.js'))
  })

  test('role wrapped in <b> not *role*', () => {
    const messages = [{
      id: 'm1', sessionID: 's',
      role: 'user',
      time: { created: 1700000000000 },
      parts: [{ id: 'p1', type: 'text', text: 'hi' }],
    }]
    const out = formatHistoryPage(messages, 1, 1, 's')
    assert.ok(out.includes('<b>'), 'output should contain <b> for bold')
    assert.ok(!/\\\*/.test(out), `should NOT contain escaped asterisk: ${out.slice(0, 200)}`)
    assert.ok(!/\*\w/.test(out), 'should NOT contain Markdown bold *role*')
  })

  test('time wrapped in <i> not _time_', () => {
    const messages = [{
      id: 'm1', sessionID: 's',
      role: 'user',
      time: { created: 1700000000000 },
      parts: [{ id: 'p1', type: 'text', text: 'hi' }],
    }]
    const out = formatHistoryPage(messages, 1, 1, 's')
    assert.ok(out.includes('<i>'), 'output should contain <i> for italic')
    assert.ok(!/\\_/.test(out), `should NOT contain escaped underscore: ${out.slice(0, 200)}`)
  })

  test('sessionId wrapped in <code> not `sessionId`', () => {
    const messages = [{
      id: 'm1', sessionID: 's',
      role: 'user',
      time: { created: 1700000000000 },
      parts: [{ id: 'p1', type: 'text', text: 'hi' }],
    }]
    const out = formatHistoryPage(messages, 1, 1, 'ses_abc')
    assert.ok(out.includes('<code>ses_abc</code>'), 'sessionId should be in <code> tags')
  })

  test('empty messages show <i>(no content)</i>', () => {
    const messages = [{
      id: 'm1', sessionID: 's',
      role: 'assistant',
      time: { created: 1700000000000 },
      parts: [],
    }]
    const out = formatHistoryPage(messages, 1, 1, 's')
    assert.ok(out.includes('<i>(no content)</i>'), 'should show HTML italic placeholder')
  })

  test('header contains <b>History</b> not *History*', () => {
    const messages = [{
      id: 'm1', sessionID: 's',
      role: 'user',
      time: { created: 1700000000000 },
      parts: [{ id: 'p1', type: 'text', text: 'hi' }],
    }]
    const out = formatHistoryPage(messages, 1, 1, 's')
    assert.ok(out.includes('<b>History</b>'), 'header should use <b> tag')
  })
})

// ==========================================================================
// Category 3: No Markdown artifacts
// ==========================================================================

describe('F13.3 zero Markdown artifacts in formatHistoryPage', { skip: !HISTORY_IMPL }, () => {
  let formatHistoryPage
  let out

  test.beforeEach(async () => {
    ;({ formatHistoryPage } = await import('../../dist/bot/history.js'))
    out = formatHistoryPage([{
      id: 'm1', sessionID: 's_123',
      role: 'user',
      time: { created: 1700000000000 },
      parts: [{ id: 'p1', type: 'text', text: 'Hello *world* with _emphasis_ and `code`' }],
    }], 1, 1, 's_123')
  })

  test('output should NOT contain \\* (escaped asterisk)', () => {
    assert.ok(!out.includes('\\*'), `found escaped asterisk: ${out}`)
  })

  test('output should NOT contain \\_ (escaped underscore)', () => {
    assert.ok(!out.includes('\\_'), `found escaped underscore: ${out}`)
  })

  test('output should NOT contain \\` (escaped backtick)', () => {
    assert.ok(!out.includes('\\`'), `found escaped backtick: ${out}`)
  })
})

// ==========================================================================
// Category 4: Message content is properly HTML-escaped
// ==========================================================================

describe('F13.4 HTML escaping in message content', { skip: !HISTORY_IMPL }, () => {
  let formatHistoryPage

  test.beforeEach(async () => {
    ;({ formatHistoryPage } = await import('../../dist/bot/history.js'))
  })

  test('<script> tag in message text is escaped', () => {
    const messages = [{
      id: 'm1', sessionID: 's',
      role: 'user',
      time: { created: 1700000000000 },
      parts: [{ id: 'p1', type: 'text', text: 'inject <script>alert(1)</script> here' }],
    }]
    const out = formatHistoryPage(messages, 1, 1, 's')
    assert.ok(out.includes('&lt;script&gt;'), `should escape <script>: ${out}`)
    assert.ok(!out.includes('<script>'), `should not contain raw <script>: ${out}`)
  })

  test('double-escaped ampersand (already &amp;) stays &amp;amp;', () => {
    const messages = [{
      id: 'm1', sessionID: 's',
      role: 'user',
      time: { created: 1700000000000 },
      parts: [{ id: 'p1', type: 'text', text: 'use &amp; for ampersand' }],
    }]
    const out = formatHistoryPage(messages, 1, 1, 's')
    // &amp; in text -> &amp;amp; after escapeHtml
    assert.ok(out.includes('&amp;amp;'), `should double-escape: ${out}`)
  })

  test('channel name with underscore is unchanged (literal)', () => {
    const messages = [{
      id: 'm1', sessionID: 's',
      role: 'assistant',
      time: { created: 1700000000000 },
      parts: [{ id: 'p1', type: 'text', text: 'Use @Fad_MSI_OC_bot to test' }],
    }]
    const out = formatHistoryPage(messages, 1, 1, 's')
    assert.ok(out.includes('@Fad_MSI_OC_bot'), `channel name should be unchanged: ${out}`)
  })

  test('path-like strings with special chars are not broken', () => {
    const messages = [{
      id: 'm1', sessionID: 's',
      role: 'assistant',
      time: { created: 1700000000000 },
      parts: [{ id: 'p1', type: 'text', text: 'Path: /home/user/my_project/file-v2.txt' }],
    }]
    const out = formatHistoryPage(messages, 1, 1, 's')
    assert.ok(out.includes('/home/user/my_project/file-v2.txt'), `path should be intact: ${out}`)
  })
})
