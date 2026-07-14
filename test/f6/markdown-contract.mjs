import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// F6.1: agent-authored Markdown must render as real Telegram formatting
// (MarkdownV2) — bold, headings, lists, and especially fenced CODE BLOCKS —
// instead of being escaped into literal punctuation. toTelegramMarkdown wraps
// telegramify-markdown; send its output with parse_mode 'MarkdownV2'.

let mod
try { mod = await import('../../dist/utils/markdown.js') } catch { /* not built */ }
const IMPL = !!(mod && typeof mod.toTelegramMarkdown === 'function')
const conv = (s) => mod.toTelegramMarkdown(s)
const fenceCount = (s) => (s.match(/```/g) || []).length

describe('F6.1 NOT YET IMPLEMENTED — toTelegramMarkdown', { skip: IMPL }, () => {
  test('src/utils/markdown.ts missing', () => {
    assert.fail(
      'Create src/utils/markdown.ts exporting toTelegramMarkdown(md) using ' +
      'telegramify-markdown (escape strategy). Route agent text/thinking through it ' +
      'and send with parse_mode MarkdownV2.'
    )
  })
})

describe('F6.1 markdown rendering contract', { skip: !IMPL }, () => {
  test('fenced code block preserved; inner specials NOT escaped', () => {
    const out = conv('```js\nconst d = a - b; // note.\n```')
    assert.ok(out.includes('```'), 'keeps a fence')
    assert.ok(out.includes('a - b'), 'inner code unescaped')
    assert.ok(!out.includes('a \\- b'), 'inner code must not be prose-escaped')
    assert.ok(out.includes('// note.'), 'inner comment unescaped')
    assert.equal(fenceCount(out) % 2, 0, 'fences balanced')
  })

  test('literal * and = in prose are escaped (render literally, no bold)', () => {
    const out = conv('5 * 3 = 15')
    assert.match(out, /\\\*/, 'asterisk escaped')
    assert.match(out, /\\=/, 'equals escaped')
  })

  test('**bold** -> single-asterisk MarkdownV2 bold', () => {
    const out = conv('**bold**')
    assert.ok(!out.includes('**bold**'), 'no double asterisks')
    assert.ok(!/\\\*\\\*/.test(out), 'not escaped literally')
    assert.match(out, /(?<!\*)\*bold\*(?!\*)/, 'becomes *bold*')
  })

  test('inline `code` preserved', () => {
    const out = conv('run `npm install` now')
    assert.ok(out.includes('`npm install`'), 'inline code intact')
  })

  test('heading renders as bold, not literal ##', () => {
    const out = conv('## Title')
    assert.ok(!out.includes('##'), 'no literal ##')
    assert.ok(out.includes('*Title*'), 'heading becomes bold')
  })

  test('prose period is escaped (balanced, Telegram-safe)', () => {
    const out = conv('Hello world.')
    assert.ok(out.includes('Hello world\\.'), 'period escaped for MarkdownV2')
  })

  test('empty / plain string does not throw', () => {
    assert.doesNotThrow(() => conv(''))
    assert.doesNotThrow(() => conv('just text'))
  })
})
