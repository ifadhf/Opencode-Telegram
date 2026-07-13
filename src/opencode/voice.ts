import { getLogger } from '../utils/logger.js'

export interface TranscriptionConfig {
  apiKey: string
  baseUrl?: string
}

export class TranscriptionClient {
  private apiKey: string
  private baseUrl: string

  constructor(config: TranscriptionConfig) {
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl?.replace(/\/$/, '') || 'https://api.openai.com/v1'
  }

  async transcribe(audioBuffer: Buffer, filename: string): Promise<string> {
    const log = getLogger()
    const url = `${this.baseUrl}/audio/transcriptions`

    const formData = new FormData()
    const mimeType = filename.endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg'
    const blob = new Blob([audioBuffer], { type: mimeType })
    formData.append('file', blob, filename)
    formData.append('model', 'whisper-1')
    formData.append('response_format', 'text')

    log.info('Transcribing audio', { url: url.replace(/\/\/.*@/, '//***@'), filename, size: audioBuffer.length })

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: formData,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `Transcription API error (${response.status}): ${body.slice(0, 300)}`
      )
    }

    const text = await response.text()
    const trimmed = text.trim()
    if (!trimmed) {
      throw new Error('Transcription returned empty result')
    }

    log.info('Transcription complete', { length: trimmed.length })
    return trimmed
  }
}

export async function transcribeAudio(
  client: TranscriptionClient,
  buffer: Buffer,
  filename: string
): Promise<string> {
  return client.transcribe(buffer, filename)
}
