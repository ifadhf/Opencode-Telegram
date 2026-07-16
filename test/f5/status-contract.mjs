import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// F5.3: the live "Working..." status bubble. Its text builder is extracted to a
// pure module so it can be unit-tested; the wiring (editing the working message
// in place + typing indicator) is validated by build + human test.

let mod
try { mod = await import('../../dist/utils/toolFormat.js') } catch { /* not built yet */ }
const IMPL = !!(mod && typeof mod.buildWorkingStatus === 'function')

describe('F5.3 NOT YET IMPLEMENTED — pure working-status formatter', { skip: IMPL }, () => {
  test('src/utils/toolFormat.ts missing', () => {
    assert.fail(
      'Create src/utils/toolFormat.ts exporting getToolIcon(tool), formatToolName(tool), ' +
      'buildWorkingStatus(step, tools). events.ts should import these and edit the working ' +
      'message in place (working.messageId) with a typing indicator each poll.'
    )
  })
})

describe('F5.3 working-status formatter contract', { skip: !IMPL }, () => {
  test('empty step + no tools -> empty string (keep previous bubble)', () => {
    assert.equal(mod.buildWorkingStatus('', []), '')
  })

  test('step only -> Working header + step line', () => {
    const s = mod.buildWorkingStatus('Analyze code', [])
    assert.match(s, /🔧 \*Working\.\.\.\*/)
    assert.match(s, /🚀 \*Step:\* Analyze code/)
  })

  test('tools rendered with icon + name (title HTML-escaped)', () => {
    // Post-F13: output uses parse_mode HTML, so dynamic text is escapeHtml'd
    // (angle brackets → entities), not Markdown-backslash-escaped.
    const s = mod.buildWorkingStatus('', [{ tool: 'bash', title: 'cat a<b>c' }])
    assert.match(s, /🖥️/)
    assert.match(s, /Bash/)
    assert.ok(s.includes('a&lt;b&gt;c'), 'title HTML-escaped')
    assert.ok(!s.includes('a<b>c'), 'raw angle brackets must be escaped')
  })

  test('caps at 3 tools', () => {
    const tools = ['read', 'grep', 'edit', 'write', 'bash'].map(t => ({ tool: t, title: '' }))
    const s = mod.buildWorkingStatus('', tools)
    const lines = s.split('\n').filter(l => l.startsWith('📖') || l.startsWith('🔍') || l.startsWith('✏️') || l.startsWith('📝') || l.startsWith('🖥️'))
    assert.equal(lines.length, 3)
  })

  test('title truncated to 80 chars', () => {
    const long = 'x'.repeat(200)
    const s = mod.buildWorkingStatus('', [{ tool: 'read', title: long }])
    assert.ok(!s.includes('x'.repeat(81)), 'title should be truncated')
  })

  test('getToolIcon / formatToolName known + fallback', () => {
    assert.equal(mod.getToolIcon('bash'), '🖥️')
    assert.equal(mod.getToolIcon('mysterytool'), '🔧')
    assert.equal(mod.formatToolName('grep'), 'Grep')
    assert.equal(mod.formatToolName('customthing'), 'Customthing')
  })
})
