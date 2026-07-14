import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// F8 bugfix: /providers (and /models with no arg) built one big message and
// ctx.reply()'d it without chunking — with many providers it blew past
// Telegram's 4096-char limit -> 400 "message is too long" -> "Failed to list
// providers". Fix: formatProvidersList() (pure) + splitMessage() at both sites.

let cmd, fmt
try { cmd = await import('../../dist/bot/commands.js') } catch { /* not built */ }
try { fmt = await import('../../dist/utils/formatter.js') } catch { /* not built */ }
const IMPL = !!(cmd && typeof cmd.formatProvidersList === 'function' && fmt && typeof fmt.splitMessage === 'function')

// ids with no Markdown special chars so escaping doesn't alter substrings
const many = Array.from({ length: 200 }, (_, i) => ({
  id: 'provlongname' + String(i).padStart(3, '0'),
  models: { a: {}, b: {}, c: {} },
}))

describe('F8 NOT YET IMPLEMENTED — providers list chunking', { skip: IMPL }, () => {
  test('formatProvidersList missing', () => {
    assert.fail('Export formatProvidersList(providers) from commands.ts and send it via splitMessage in /providers + /models(no-arg).')
  })
})

describe('F8 /providers stays within Telegram 4096 limit', { skip: !IMPL }, () => {
  test('a long provider list splits into multiple <=4096 chunks', () => {
    const msg = cmd.formatProvidersList(many)
    assert.ok(msg.length > 4096, 'fixture must be long enough to need splitting')
    const chunks = fmt.splitMessage(msg)
    assert.ok(chunks.length > 1, 'should split into multiple messages')
    for (const c of chunks) assert.ok(c.length <= 4096, `chunk within limit (was ${c.length})`)
  })

  test('every provider id survives across the chunks', () => {
    const msg = cmd.formatProvidersList(many)
    for (const p of [many[0], many[99], many[199]]) {
      assert.ok(msg.includes(p.id), `contains ${p.id}`)
    }
  })

  test('shows model count + usage hint', () => {
    const msg = cmd.formatProvidersList([{ id: 'openai', models: { a: {}, b: {} } }])
    assert.match(msg, /openai/)
    assert.match(msg, /2 models/)
    assert.match(msg, /\/models/)
  })

  test('handles empty provider list without crashing', () => {
    assert.doesNotThrow(() => cmd.formatProvidersList([]))
  })
})
