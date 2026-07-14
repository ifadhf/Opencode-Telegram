import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// F7.1: sending a photo to the agent. Telegram delivers several PhotoSize
// resolutions; we pick the largest, download it, and attach it to the prompt
// as an OpenCode FilePartInput { type:'file', mime, url:data-URI, filename }.
// These pure helpers are unit-tested; the download/send wiring is validated by
// build + human test.

let mod
try { mod = await import('../../dist/bot/photo.js') } catch { /* not built */ }
const IMPL = !!(mod && typeof mod.buildImagePart === 'function' && typeof mod.pickLargestPhoto === 'function')

describe('F7.1 NOT YET IMPLEMENTED — image part helpers', { skip: IMPL }, () => {
  test('src/bot/photo.ts missing', () => {
    assert.fail(
      'Create src/bot/photo.ts exporting pickLargestPhoto(photos) and ' +
      'buildImagePart(mime, base64, filename). Add a message:photo handler + ' +
      'sendAsyncMessage files option.'
    )
  })
})

describe('F7.1 image-part contract', { skip: !IMPL }, () => {
  test('pickLargestPhoto returns the highest-resolution size', () => {
    const photos = [
      { file_id: 'a', width: 90, height: 90 },
      { file_id: 'b', width: 1280, height: 960 },
      { file_id: 'c', width: 320, height: 240 },
    ]
    assert.equal(mod.pickLargestPhoto(photos).file_id, 'b')
  })

  test('pickLargestPhoto handles empty/undefined', () => {
    assert.equal(mod.pickLargestPhoto([]), undefined)
    assert.equal(mod.pickLargestPhoto(undefined), undefined)
  })

  test('buildImagePart produces a FilePartInput with a data: URI', () => {
    const part = mod.buildImagePart('image/jpeg', 'QUJD', 'shot.jpg')
    assert.equal(part.type, 'file')
    assert.equal(part.mime, 'image/jpeg')
    assert.equal(part.filename, 'shot.jpg')
    assert.equal(part.url, 'data:image/jpeg;base64,QUJD')
  })

  test('buildImagePart defaults filename', () => {
    const part = mod.buildImagePart('image/png', 'AAAA')
    assert.equal(part.mime, 'image/png')
    assert.ok(part.url.startsWith('data:image/png;base64,'))
    assert.ok(typeof part.filename === 'string' && part.filename.length > 0)
  })
})
