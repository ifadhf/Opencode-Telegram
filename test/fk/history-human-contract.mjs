// File: test/fk/history-human-contract.mjs
// Bug K — /history human-friendly: no reasoning, no tool detail,
// tool count summary, chronological order (newest at bottom).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

let HISTORY_IMPL = false
let KEYBOARD_IMPL = false

try {
  const mod = await import('../../dist/bot/history.js')
  if (typeof mod.formatHistoryPage === 'function') HISTORY_IMPL = true
  if (typeof mod.buildHistoryKeyboard === 'function') KEYBOARD_IMPL = true
} catch { /* not built */ }

const ALL_IMPL = HISTORY_IMPL && KEYBOARD_IMPL

describe('Bug K NOT YET IMPLEMENTED — human-friendly history', { skip: ALL_IMPL }, () => {
  test('missing: history.ts filters reasoning/tools from output', () => {
    assert.fail(
      'History output still includes reasoning and raw tool types.\n' +
      'Fix src/bot/history.ts:\n' +
      '  - getTextFromParts: filter only text type, skip ignored/synthetic\n' +
      '  - Add tool count summary (e.g. "→ 3 tool calls")\n' +
      '  - buildHistoryKeyboard: labels "◀ Older" / "Newer ▶"\n' +
      'Fix src/bot/commands.ts /history:\n' +
      '  - Remove .reverse() (chronological order, newest at bottom)\n' +
      '  - Default page = last page (newest messages)'
    )
  })
})

// Helper: build a realistic message with parts
const makeMsg = (role, parts, opts = {}) => ({
  id: opts.id || `msg_${role}_${Date.now()}`,
  sessionID: 'ses_test',
  role,
  time: { created: opts.time || Date.now() },
  parts,
  tokens: opts.tokens,
  cost: opts.cost,
})

const makeTextPart = (text, opts = {}) => ({
  id: `prt_${Date.now()}_${Math.random()}`,
  sessionID: 'ses_test',
  messageID: 'msg_test',
  type: 'text',
  text,
  ignored: opts.ignored || false,
  synthetic: opts.synthetic || false,
})

const makeToolPart = (tool, status = 'completed') => ({
  id: `prt_${Date.now()}_${Math.random()}`,
  sessionID: 'ses_test',
  messageID: 'msg_test',
  type: 'tool',
  tool,
  state: { status },
})

const makeReasoningPart = (text) => ({
  id: `prt_${Date.now()}_${Math.random()}`,
  sessionID: 'ses_test',
  messageID: 'msg_test',
  type: 'reasoning',
  text,
})

describe('Bug K human-friendly history contract', { skip: !ALL_IMPL }, () => {
  test('formatHistoryPage shows text content, not reasoning', async () => {
    const { formatHistoryPage } = await import('../../dist/bot/history.js')
    const msgs = [makeMsg('assistant', [
      makeReasoningPart('The user wants X, I will do Y with tool Z...'),
      makeTextPart('Here is the answer.'),
    ])]
    const result = formatHistoryPage(msgs, 1, 1, 'ses_test')
    assert.ok(result.includes('Here is the answer'), 'shows text content')
    assert.ok(!result.includes('The user wants X'), 'does NOT show reasoning')
    assert.ok(!result.includes('tool Z'), 'does NOT show reasoning content')
  })

  test('formatHistoryPage shows tool count summary, not raw tool types', async () => {
    const { formatHistoryPage } = await import('../../dist/bot/history.js')
    const msgs = [makeMsg('assistant', [
      makeToolPart('bash'),
      makeToolPart('read'),
      makeToolPart('grep'),
      makeTextPart('Done.'),
    ])]
    const result = formatHistoryPage(msgs, 1, 1, 'ses_test')
    assert.ok(!result.includes('(tool'), 'does NOT show raw tool type list')
    assert.ok(result.includes('3 tool calls'), 'shows tool count summary')
  })

  test('formatHistoryPage skips ignored and synthetic text parts', async () => {
    const { formatHistoryPage } = await import('../../dist/bot/history.js')
    const msgs = [makeMsg('assistant', [
      makeTextPart('Tool call 1 started', { ignored: true }),
      makeTextPart('System note', { synthetic: true }),
      makeTextPart('Actual visible output.'),
    ])]
    const result = formatHistoryPage(msgs, 1, 1, 'ses_test')
    assert.ok(!result.includes('Tool call 1 started'), 'skips ignored text')
    assert.ok(!result.includes('System note'), 'skips synthetic text')
    assert.ok(result.includes('Actual visible output'), 'shows real text')
  })

  test('formatHistoryPage: assistant with text but zero tools shows no tool line', async () => {
    const { formatHistoryPage } = await import('../../dist/bot/history.js')
    const msgs = [makeMsg('assistant', [
      makeTextPart('Just a text response.'),
    ])]
    const result = formatHistoryPage(msgs, 1, 1, 'ses_test')
    assert.ok(!result.includes('tool call'), 'no tool count when zero tools')
    assert.ok(result.includes('Just a text response'), 'shows text')
  })

  test('formatHistoryPage: assistant with only tools shows tool count + fallback', async () => {
    const { formatHistoryPage } = await import('../../dist/bot/history.js')
    const msgs = [makeMsg('assistant', [
      makeToolPart('bash'),
      makeToolPart('read'),
    ])]
    const result = formatHistoryPage(msgs, 1, 1, 'ses_test')
    assert.ok(result.includes('2 tool calls'), 'shows tool count for tool-only message')
  })

  test('formatHistoryPage includes cost when tokens data present', async () => {
    const { formatHistoryPage } = await import('../../dist/bot/history.js')
    const msgs = [makeMsg('assistant', [makeTextPart('Hello')], { tokens: { input: 1000, output: 500, reasoning: 200 }, cost: 0.005 })]
    const result = formatHistoryPage(msgs, 1, 1, 'ses_test')
    assert.ok(result.includes('$0.005'), 'shows cost')
    assert.ok(result.includes('1000'), 'shows input tokens')
  })

  test('formatHistoryPage shows user messages normally', async () => {
    const { formatHistoryPage } = await import('../../dist/bot/history.js')
    const msgs = [makeMsg('user', [makeTextPart('Hello bot')])]
    const result = formatHistoryPage(msgs, 1, 1, 'ses_test')
    assert.ok(result.includes('You'), 'shows "You" role label')
    assert.ok(result.includes('Hello bot'), 'shows user text')
  })

  test('formatHistoryPage: empty parts shown with fallback label', async () => {
    const { formatHistoryPage } = await import('../../dist/bot/history.js')
    const msgs = [makeMsg('user', [], { id: 'no_parts' })]
    const result = formatHistoryPage(msgs, 1, 1, 'ses_test')
    assert.ok(typeof result === 'string' && result.length > 0, 'no crash on empty parts')
  })

  test('buildHistoryKeyboard uses Older/Newer labels (chronological)', async () => {
    const { buildHistoryKeyboard } = await import('../../dist/bot/history.js')
    const kb = buildHistoryKeyboard(2, 5, 'ses_test')
    const texts = kb.inline_keyboard.flat().map(b => b.text)
    assert.ok(texts.some(t => t.includes('Older')), 'has Older button')
    assert.ok(texts.some(t => t.includes('Newer')), 'has Newer button')
    assert.ok(!texts.some(t => t.includes('Newer') && t.includes('◀')), 'Older is on left')
  })

  test('buildHistoryKeyboard hides Older on page 1', async () => {
    const { buildHistoryKeyboard } = await import('../../dist/bot/history.js')
    const kb = buildHistoryKeyboard(1, 5, 'ses_test')
    const texts = kb.inline_keyboard.flat().map(b => b.text)
    assert.ok(!texts.some(t => t.includes('Older')), 'no Older on page 1')
  })

  test('buildHistoryKeyboard hides Newer on last page', async () => {
    const { buildHistoryKeyboard } = await import('../../dist/bot/history.js')
    const kb = buildHistoryKeyboard(5, 5, 'ses_test')
    const texts = kb.inline_keyboard.flat().map(b => b.text)
    assert.ok(!texts.some(t => t.includes('Newer')), 'no Newer on last page')
  })

  test('formatHistoryPage sorts messages chronologically (oldest→newest)', async () => {
    const { formatHistoryPage } = await import('../../dist/bot/history.js')
    // Messages in REVERSE order (newest first) — sort should fix it
    const msgs = [
      makeMsg('user', [makeTextPart('3rd message')], { time: 3000 }),
      makeMsg('assistant', [makeTextPart('2nd message')], { time: 2000 }),
      makeMsg('user', [makeTextPart('1st message')], { time: 1000 }),
    ]
    const result = formatHistoryPage(msgs, 1, 1, 'ses_test')
    const idx1 = result.indexOf('1st message')
    const idx2 = result.indexOf('2nd message')
    const idx3 = result.indexOf('3rd message')
    assert.ok(idx1 > 0 && idx2 > 0 && idx3 > 0, 'all messages present')
    assert.ok(idx1 < idx2, '1st (oldest) comes BEFORE 2nd')
    assert.ok(idx2 < idx3, '2nd comes BEFORE 3rd (newest)')
    assert.ok(idx1 < idx3, 'oldest first, newest last')
  })

  test('formatHistoryPage: same-timestamp messages preserve original order', async () => {
    const { formatHistoryPage } = await import('../../dist/bot/history.js')
    const msgs = [
      makeMsg('assistant', [makeTextPart('msg-A')], { time: 1000 }),
      makeMsg('assistant', [makeTextPart('msg-B')], { time: 1000 }),
      makeMsg('assistant', [makeTextPart('msg-C')], { time: 1000 }),
    ]
    const result = formatHistoryPage(msgs, 1, 1, 'ses_test')
    const idxA = result.indexOf('msg-A')
    const idxB = result.indexOf('msg-B')
    const idxC = result.indexOf('msg-C')
    assert.ok(idxA < idxB && idxB < idxC, 'same-timestamp stays stable')
  })
})
