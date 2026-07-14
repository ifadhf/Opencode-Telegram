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
