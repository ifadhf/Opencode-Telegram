import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// F7.3: the /newtopic directory browser must be navigable — descend into
// folders, go up (..), paginate, and select. callback_data is capped at 64
// bytes so buttons use indices; paths are kept server-side. This tests the pure
// builder + parent-path logic; the listing/session-create wiring is validated
// by build + human test.

let mod
try { mod = await import('../../dist/bot/dirBrowser.js') } catch { /* not built */ }
const IMPL = !!(mod && typeof mod.buildDirBrowser === 'function' && typeof mod.parentDir === 'function')

const dirs = (n) => Array.from({ length: n }, (_, i) => ({ name: `d${i}`, path: `/root/d${i}`, isDir: true }))
const flat = (kb) => kb.flat().map(b => b.callback_data)

describe('F7.3 NOT YET IMPLEMENTED — directory browser', { skip: IMPL }, () => {
  test('src/bot/dirBrowser.ts missing', () => {
    assert.fail(
      'Create src/bot/dirBrowser.ts exporting buildDirBrowser(path, subdirs, page), ' +
      'parentDir(path), listSubdirs(client, path), and browse-state helpers. ' +
      'Wire /newtopic + dnav/dup/dpg/dpick/dcancel callbacks.'
    )
  })
})

describe('F7.3 directory browser contract', { skip: !IMPL }, () => {
  test('parentDir climbs one level and stops at root', () => {
    assert.equal(mod.parentDir('/a/b/c'), '/a/b')
    assert.equal(mod.parentDir('/a/b/'), '/a')
    assert.equal(mod.parentDir('/a'), '/')
    assert.equal(mod.parentDir('/'), '/')
  })

  test('buildDirBrowser: folder buttons use dnav:<globalIndex> + up/select/cancel rows', () => {
    const v = mod.buildDirBrowser('/root', dirs(3), 0)
    const cbs = flat(v.inlineKeyboard)
    assert.ok(cbs.includes('dnav:0') && cbs.includes('dnav:1') && cbs.includes('dnav:2'))
    assert.ok(cbs.includes('dup'), 'has go-up')
    assert.ok(cbs.includes('dpick'), 'has select-this-folder')
    assert.ok(cbs.includes('dcancel'), 'has cancel')
    assert.ok(v.text.includes('/root'), 'shows current path')
    assert.match(v.text, /<b>Select working directory<\/b>/, 'HTML header (not Markdown *)')
    assert.match(v.text, /<code>\/root<\/code>/, 'path in HTML code tag')
  })

  test('buildDirBrowser: no pager when subdirs fit one page', () => {
    const v = mod.buildDirBrowser('/root', dirs(6), 0)
    assert.ok(!flat(v.inlineKeyboard).some(c => c.startsWith('dpg:')), 'no pager for <= 6')
  })

  test('buildDirBrowser: paginates > 6 with page 2 showing the remainder', () => {
    const v0 = mod.buildDirBrowser('/root', dirs(10), 0)
    const cbs0 = flat(v0.inlineKeyboard)
    const folders0 = cbs0.filter(c => c.startsWith('dnav:'))
    assert.equal(folders0.length, 6, 'page 0 shows 6 folders')
    assert.ok(cbs0.some(c => c.startsWith('dpg:')), 'pager present')

    const v1 = mod.buildDirBrowser('/root', dirs(10), 1)
    const folders1 = flat(v1.inlineKeyboard).filter(c => c.startsWith('dnav:'))
    assert.deepEqual(folders1, ['dnav:6', 'dnav:7', 'dnav:8', 'dnav:9'], 'page 1 = global indices 6..9')
  })

  test('buildDirBrowser: empty dir still offers select + up', () => {
    const v = mod.buildDirBrowser('/root/empty', [], 0)
    const cbs = flat(v.inlineKeyboard)
    assert.ok(cbs.includes('dpick') && cbs.includes('dup'))
    assert.ok(!cbs.some(c => c.startsWith('dnav:')), 'no folder buttons')
  })

  test('listSubdirs: filters files + hidden, sorts, maps to {name,path,isDir}', async () => {
    const fakeClient = {
      listFiles: async () => [
        { name: 'zeta', path: 'zeta/', absolute: '/r/zeta', type: 'directory' },
        { name: '.git', path: '.git/', absolute: '/r/.git', type: 'directory' },
        { name: 'readme.md', path: 'readme.md', absolute: '/r/readme.md', type: 'file' },
        { name: 'alpha', path: 'alpha/', absolute: '/r/alpha', type: 'directory' },
      ],
    }
    const subs = await mod.listSubdirs(fakeClient, '/r')
    assert.deepEqual(subs.map(s => s.name), ['alpha', 'zeta'])
    assert.ok(subs.every(s => s.isDir))
  })
})
