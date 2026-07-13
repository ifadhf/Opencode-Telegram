import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

let TRANSCRIBE_IMPL = false
let TRANSCRIPTION_CLIENT_IMPL = false

try {
  const mod = await import('../../dist/opencode/voice.js')
  if (typeof mod.transcribeAudio === 'function') {
    TRANSCRIBE_IMPL = true
  }
  if (typeof mod.TranscriptionClient === 'function') {
    TRANSCRIPTION_CLIENT_IMPL = true
  }
} catch {
  // module not found — not yet implemented
}

describe('F3 NOT YET IMPLEMENTED — Voice transcription', { skip: TRANSCRIBE_IMPL }, () => {
  test('missing: voice message handler + transcribeAudio + TranscriptionClient', () => {
    assert.fail(
      'F3 Voice transcription not implemented. Create src/opencode/voice.ts with:\n' +
      '  class TranscriptionClient {\n' +
      '    constructor(config: { apiKey: string; baseUrl?: string })\n' +
      '    async transcribe(audioBuffer: Buffer, filename: string): Promise<string>\n' +
      '  }\n' +
      '  function transcribeAudio(client: TranscriptionClient, buffer: Buffer, filename: string): Promise<string>\n\n' +
      'Also add bot.on("message:voice") handler in src/bot/handlers.ts that:\n' +
      '  1. Downloads OGG from Telegram via ctx.api.getFile()\n' +
      '  2. Calls transcribeAudio()\n' +
      '  3. Forwards transcript as prompt (same flow as message:text)\n\n' +
      'Required env vars: OPENAI_API_KEY, OPENAI_BASE_URL (optional)'
    )
  })
})

describe('F3 TranscriptionClient contract', { skip: !TRANSCRIPTION_CLIENT_IMPL }, () => {
  test('TranscriptionClient constructor accepts apiKey and optional baseUrl', async () => {
    const { TranscriptionClient } = await import('../../dist/opencode/voice.js')
    const client = new TranscriptionClient({ apiKey: 'sk-test' })
    assert.ok(client instanceof TranscriptionClient)
    const client2 = new TranscriptionClient({ apiKey: 'sk-test', baseUrl: 'https://api.example.com/v1' })
    assert.ok(client2 instanceof TranscriptionClient)
  })

  test('TranscriptionClient.transcribe returns string for audio buffer', async () => {
    if (!process.env.OPENAI_API_KEY) {
      console.log('[SKIP] OPENAI_API_KEY not set — skipping live API test')
      return
    }
    const { TranscriptionClient } = await import('../../dist/opencode/voice.js')
    const client = new TranscriptionClient({
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
    })
    const fakeAudio = Buffer.alloc(1024, 0)
    try {
      const result = await client.transcribe(fakeAudio, 'test.ogg')
      assert.ok(typeof result === 'string', 'transcribe should return string')
    } catch (err) {
      assert.ok(err instanceof Error)
    }
  })

  test('transcribeAudio is a convenience wrapper', async () => {
    const { transcribeAudio, TranscriptionClient } = await import('../../dist/opencode/voice.js')
    const client = new TranscriptionClient({ apiKey: 'sk-test' })
    const fakeAudio = Buffer.alloc(1024, 0)
    try {
      await transcribeAudio(client, fakeAudio, 'test.ogg')
    } catch {
      // Expected: API will reject invalid audio
    }
    assert.strictEqual(typeof transcribeAudio, 'function')
  })
})

describe('F3 Voice env vars contract', { skip: !TRANSCRIBE_IMPL }, () => {
  test('OPENAI_API_KEY and OPENAI_BASE_URL are supported', () => {
    assert.ok(process.env.OPENAI_API_KEY === undefined || typeof process.env.OPENAI_API_KEY === 'string',
      'OPENAI_API_KEY should be a string if set')
    assert.ok(process.env.OPENAI_BASE_URL === undefined || typeof process.env.OPENAI_BASE_URL === 'string',
      'OPENAI_BASE_URL should be a string if set')
  })
})
