import type { FilePartInput } from '../types/index.js'

export interface PhotoSize {
  file_id: string
  width?: number
  height?: number
  file_size?: number
}

// Telegram delivers a photo as several PhotoSize entries; pick the highest
// resolution (largest pixel area) so the agent gets the clearest image.
export function pickLargestPhoto(photos?: PhotoSize[]): PhotoSize | undefined {
  if (!photos || photos.length === 0) return undefined
  return [...photos].sort(
    (a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)
  )[0]
}

// Build an OpenCode file part that embeds the image bytes as a data: URI,
// which is what POST /session/:id/prompt_async accepts for uploaded images.
export function buildImagePart(mime: string, base64: string, filename = 'photo.jpg'): FilePartInput {
  return { type: 'file', mime, url: `data:${mime};base64,${base64}`, filename }
}

export interface OutgoingImage {
  source: 'url' | 'buffer' | 'path'
  filename: string
  url?: string
  buffer?: Buffer
  path?: string
}

// Classify an agent message part that carries an image (OpenCode FilePart:
// { type:'file', mime, url }) into how Telegram should send it. Returns
// undefined for anything that isn't an image file part.
export function imageFromPart(part: any): OutgoingImage | undefined {
  if (!part || part.type !== 'file') return undefined
  const mime: string = part.mime || ''
  if (!mime.startsWith('image/')) return undefined
  const url: string = part.url || ''
  const filename: string = part.filename || 'image'

  if (url.startsWith('data:')) {
    const b64 = url.slice(url.indexOf(',') + 1)
    return { source: 'buffer', buffer: Buffer.from(b64, 'base64'), filename }
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return { source: 'url', url, filename }
  }
  if (url.startsWith('file://')) {
    return { source: 'path', path: url.slice('file://'.length), filename }
  }
  if (url.startsWith('/')) {
    return { source: 'path', path: url, filename }
  }
  return undefined
}
