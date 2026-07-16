import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// F16: idle/completion notification must be a REAL Telegram mention that pings
// the user regardless of whether they have a public @username. Previously the
// label was '@username' (only pings with a public username) or first_name
// (plain text, no ping). Fix: buildUserMention → <a href="tg://user?id=ID">name</a>.

let mod
try { mod = await import('../../dist/utils/toolFormat.js') } catch { /* not built */ }
const IMPL = !!(mod && typeof mod.buildUserMention === 'function' && typeof mod.buildIdleMessage === 'function')

describe('F16 NOT YET IMPLEMENTED — real user mention', { skip: IMPL }, () => {
  test('buildUserMention missing', () => {
    assert.fail('Add buildUserMention(id, name) to src/utils/toolFormat.ts → <a href="tg://user?id=ID">name</a>; handlers store it via setUserInfo.')
  })
})

describe('F16 user-mention contract', { skip: !IMPL }, () => {
  test('buildUserMention builds an HTML tg://user mention that always pings', () => {
    const m = mod.buildUserMention(54692684, 'Fadh')
    assert.equal(m, '<a href="tg://user?id=54692684">Fadh</a>')
  })

  test('buildUserMention HTML-escapes the display name', () => {
    const m = mod.buildUserMention(1, 'a<b> & c')
    assert.ok(m.includes('a&lt;b&gt; &amp; c'), 'name escaped')
    assert.ok(!m.includes('a<b>'), 'no raw angle brackets in name')
    assert.ok(m.startsWith('<a href="tg://user?id=1">'))
  })

  test('buildIdleMessage embeds the mention (pre-built HTML, not re-escaped)', () => {
    const mention = mod.buildUserMention(42, 'Ann')
    const msg = mod.buildIdleMessage(mention)
    assert.ok(msg.includes('<a href="tg://user?id=42">Ann</a>'), 'mention passes through intact')
    assert.ok(msg.includes('Task Selesai') && msg.includes('menunggu input'))
  })
})
