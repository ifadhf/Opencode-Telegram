import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// F7.2: images the agent produces arrive as a message part { type:'file',
// mime:'image/*', url } (data: URI, http(s) URL, or a server path). imageFromPart
// classifies how to send it; events.ts turns that into a Telegram sendPhoto.

let mod
try { mod = await import('../../dist/bot/photo.js') } catch { /* not built */ }
const IMPL = !!(mod && typeof mod.imageFromPart === 'function')

describe('F7.2 NOT YET IMPLEMENTED — imageFromPart', { skip: IMPL }, () => {
  test('imageFromPart missing', () => {
    assert.fail('Add imageFromPart(part) to src/bot/photo.ts + a file-part branch in events.ts that sendPhoto()s it.')
  })
})

describe('F7.2 agent-image output contract', { skip: !IMPL }, () => {
  test('data: URI image -> buffer with decoded bytes', () => {
    const b64 = Buffer.from('PNGDATA').toString('base64')
    const out = mod.imageFromPart({ type: 'file', mime: 'image/png', url: `data:image/png;base64,${b64}`, filename: 'chart.png' })
    assert.equal(out.source, 'buffer')
    assert.equal(out.filename, 'chart.png')
    assert.equal(out.buffer.toString(), 'PNGDATA')
  })

  test('http(s) URL image -> url source', () => {
    const out = mod.imageFromPart({ type: 'file', mime: 'image/jpeg', url: 'https://x/y.jpg' })
    assert.equal(out.source, 'url')
    assert.equal(out.url, 'https://x/y.jpg')
  })

  test('absolute path image -> path source', () => {
    const out = mod.imageFromPart({ type: 'file', mime: 'image/png', url: '/tmp/out.png' })
    assert.equal(out.source, 'path')
    assert.equal(out.path, '/tmp/out.png')
  })

  test('non-image file part -> undefined', () => {
    assert.equal(mod.imageFromPart({ type: 'file', mime: 'text/plain', url: '/a.txt' }), undefined)
  })

  test('non-file part -> undefined', () => {
    assert.equal(mod.imageFromPart({ type: 'text', text: 'hi' }), undefined)
    assert.equal(mod.imageFromPart(undefined), undefined)
  })
})
