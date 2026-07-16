import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// F15: agent Response/Thinking use the ccbot method — telegramify → MarkdownV2,
// with markdown tables pre-converted to card-style (Telegram has no tables) and
// a VALID MarkdownV2 fallback (not escapeHtml, which produced invalid MarkdownV2
// that Telegram 400'd → the raw "## ALUR RESPONS" the user saw).

let mod
try { mod = await import('../../dist/utils/markdown.js') } catch { /* not built */ }
const IMPL = !!(mod && typeof mod.toTelegramMarkdown === 'function' && typeof mod.convertMarkdownTables === 'function')

describe('F15 NOT YET IMPLEMENTED — ccbot markdown method', { skip: IMPL }, () => {
  test('convertMarkdownTables missing', () => {
    assert.fail('Add convertMarkdownTables(md) to src/utils/markdown.ts; toTelegramMarkdown must call it before telegramify and fall back to escapeMarkdown (valid MarkdownV2).')
  })
})

describe('F15 ccbot markdown method contract', { skip: !IMPL }, () => {
  test('convertMarkdownTables: pipe table → card-style **Header**: value', () => {
    const table = '| Name | Role |\n| --- | --- |\n| Ann | Dev |\n| Bob | Ops |'
    const out = mod.convertMarkdownTables(table)
    assert.ok(!out.includes('| Name |'), 'raw table header removed')
    assert.ok(out.includes('**Name**: Ann') && out.includes('**Role**: Dev'))
    assert.ok(out.includes('**Name**: Bob') && out.includes('**Role**: Ops'))
    assert.ok(out.includes('────────────'), 'cards separated by a rule')
  })

  test('convertMarkdownTables: empty cell → em dash', () => {
    const table = '| A | B |\n|---|---|\n| x |  |'
    const out = mod.convertMarkdownTables(table)
    assert.ok(out.includes('**B**: —'))
  })

  test('convertMarkdownTables: leaves tables inside code blocks alone', () => {
    const md = '```\n| A | B |\n|---|---|\n| 1 | 2 |\n```'
    const out = mod.convertMarkdownTables(md)
    assert.ok(out.includes('| A | B |'), 'table inside code block untouched')
  })

  test('convertMarkdownTables: non-table text is unchanged', () => {
    const md = '# Title\n\nsome text\n- a\n- b'
    assert.equal(mod.convertMarkdownTables(md), md)
  })

  test('toTelegramMarkdown: heading → bold MarkdownV2, no literal ##', () => {
    const out = mod.toTelegramMarkdown('## ALUR RESPONS')
    assert.ok(out.includes('*ALUR RESPONS*'), 'heading becomes MarkdownV2 bold')
    assert.ok(!out.includes('##'), 'no literal ##')
  })

  test('toTelegramMarkdown: the reported example renders (no raw ##, chars escaped)', () => {
    const txt = `## ALUR RESPONS
Untuk setiap keluhan, ikuti alur:
1. Pahami: Ajukan maksimal 2 pertanyaan klarifikasi jika perlu.
2. Diagnosa: Berikan 1-3 langkah troubleshooting.`
    const out = mod.toTelegramMarkdown(txt)
    assert.ok(out.includes('*ALUR RESPONS*'))
    assert.ok(!out.includes('## ALUR'), 'heading converted, not raw')
    assert.ok(out.includes('1\\.'), 'list numbers escaped for MarkdownV2 (valid, no 400)')
  })

  test('toTelegramMarkdown: **bold** and `code` still work (ccbot/telegramify)', () => {
    assert.ok(mod.toTelegramMarkdown('**hi**').includes('*hi*'))
    assert.ok(mod.toTelegramMarkdown('run `npm i`').includes('`npm i`'))
  })
})
