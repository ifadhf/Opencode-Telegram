// File: test/f4/config-contract.mjs
// F4 TDD contract — config validation hardening: env completeness, startup guards
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let VALIDATOR_IMPL = false

try {
  const mod = await import('../../dist/utils/config.js')
  // Check that the validateConfig function exists and has more detailed error messages
  if (typeof mod.validateConfig === 'function') {
    VALIDATOR_IMPL = true
  }
} catch {
  // module not found — not yet implemented
}

let ENV_EXAMPLE_COMPLETE = false
try {
  const { readFileSync } = await import('node:fs')
  const envContent = readFileSync(
    join(import.meta.dirname, '..', '..', '.env.example'),
    'utf-8'
  )
  const requiredInExample = [
    'TELEGRAM_BOT_TOKEN',
    'AUTHORIZED_USER_ID',
    'OPENAI_API_KEY',
    'SHOW_TOOL_CALLS',
    'SHOW_THINKING',
    'SHOW_TOKENS',
  ]
  ENV_EXAMPLE_COMPLETE = requiredInExample.every(v => envContent.includes(v))
} catch {
  ENV_EXAMPLE_COMPLETE = false
}

// ────────────────────────────────────────────
// Phase 1: NOT YET IMPLEMENTED — live spec
// ────────────────────────────────────────────

describe('F4 NOT YET IMPLEMENTED — .env.example completeness', { skip: ENV_EXAMPLE_COMPLETE }, () => {
  test('.env.example missing required variables', () => {
    assert.fail(
      'F4 .env.example is incomplete. Update .env.example to include:\n' +
      '  - TELEGRAM_BOT_TOKEN (required)\n' +
      '  - AUTHORIZED_USER_ID (required)\n' +
      '  - OPENAI_API_KEY (required for voice)\n' +
      '  - OPENAI_BASE_URL (optional, defaults to https://api.openai.com/v1)\n' +
      '  - OPENCODE_SERVER_URL (optional, defaults to http://127.0.0.1:4097)\n' +
      '  - OPENCODE_SERVER_USERNAME (optional)\n' +
      '  - OPENCODE_SERVER_PASSWORD (optional)\n' +
      '  - SHOW_TOOL_CALLS (default: false)\n' +
      '  - SHOW_THINKING (default: false)\n' +
      '  - SHOW_TOKENS (default: false)\n' +
      '  - LOG_LEVEL (default: info)\n' +
      '\n' +
      'Each variable should show its default value and a short description.'
    )
  })
})

describe('F4 NOT YET IMPLEMENTED — config validation hardening', { skip: VALIDATOR_IMPL }, () => {
  test('missing: detailed config validation with actionable error messages', () => {
    assert.fail(
      'F4 config validation hardening needed in src/utils/config.ts:\n' +
      '\n' +
      '  1. validateConfig() must emit clear error messages for:\n' +
      '     - Missing TELEGRAM_BOT_TOKEN\n' +
      '     - Missing AUTHORIZED_USER_ID\n' +
      '     - Invalid OPENCODE_SERVER_URL format\n' +
      '     - Missing OPENAI_API_KEY (warning, not fatal)\n' +
      '\n' +
      '  2. validateFeatureFlags() function to parse SHOW_* flags:\n' +
      '     - Returns { showToolCalls, showThinking, showTokens } with defaults\n' +
      '     - Warns on invalid values (not "true"/"false")\n' +
      '\n' +
      '  3. .env.example updated with all variables + defaults + descriptions\n'
    )
  })
})

// ────────────────────────────────────────────
// Phase 2: Contract tests — .env.example
// ────────────────────────────────────────────

describe('F4 .env.example contract', { skip: !ENV_EXAMPLE_COMPLETE }, () => {
  test('.env.example contains TELEGRAM_BOT_TOKEN', async () => {
    const { readFileSync } = await import('node:fs')
    const envContent = readFileSync(
      join(import.meta.dirname, '..', '..', '.env.example'),
      'utf-8'
    )
    assert.ok(
      envContent.includes('TELEGRAM_BOT_TOKEN'),
      '.env.example must document TELEGRAM_BOT_TOKEN'
    )
  })

  test('.env.example contains AUTHORIZED_USER_ID', async () => {
    const { readFileSync } = await import('node:fs')
    const envContent = readFileSync(
      join(import.meta.dirname, '..', '..', '.env.example'),
      'utf-8'
    )
    assert.ok(
      envContent.includes('AUTHORIZED_USER_ID'),
      '.env.example must document AUTHORIZED_USER_ID'
    )
  })

  test('.env.example contains OPENAI_API_KEY', async () => {
    const { readFileSync } = await import('node:fs')
    const envContent = readFileSync(
      join(import.meta.dirname, '..', '..', '.env.example'),
      'utf-8'
    )
    assert.ok(
      envContent.includes('OPENAI_API_KEY'),
      '.env.example must document OPENAI_API_KEY for voice feature'
    )
  })

  test('.env.example documents SHOW_* feature flags', async () => {
    const { readFileSync } = await import('node:fs')
    const envContent = readFileSync(
      join(import.meta.dirname, '..', '..', '.env.example'),
      'utf-8'
    )
    assert.ok(envContent.includes('SHOW_TOOL_CALLS'), '.env.example must document SHOW_TOOL_CALLS')
    assert.ok(envContent.includes('SHOW_THINKING'), '.env.example must document SHOW_THINKING')
    assert.ok(envContent.includes('SHOW_TOKENS'), '.env.example must document SHOW_TOKENS')
  })

  test('.env.example documents OPENCODE_SERVER_* variables', async () => {
    const { readFileSync } = await import('node:fs')
    const envContent = readFileSync(
      join(import.meta.dirname, '..', '..', '.env.example'),
      'utf-8'
    )
    assert.ok(
      envContent.includes('OPENCODE_SERVER_URL') || envContent.includes('openCodeUrl'),
      '.env.example must document OPENCODE_SERVER_URL'
    )
  })

  test('.env.example contains LOG_LEVEL', async () => {
    const { readFileSync } = await import('node:fs')
    const envContent = readFileSync(
      join(import.meta.dirname, '..', '..', '.env.example'),
      'utf-8'
    )
    assert.ok(envContent.includes('LOG_LEVEL'), '.env.example must document LOG_LEVEL')
  })
})

// ────────────────────────────────────────────
// Phase 2: Contract tests — config validation
// ────────────────────────────────────────────

describe('F4 config validation contract', { skip: !VALIDATOR_IMPL }, () => {
  test('validateConfig() throws with clear message when TELEGRAM_BOT_TOKEN is empty', async () => {
    const { validateConfig } = await import('../../dist/utils/config.js')
    try {
      validateConfig({
        telegramToken: '',
        authorizedUserId: '123',
        openCodeUrl: 'http://127.0.0.1:4097',
        stateFile: '/tmp/test.json',
        logFile: '/tmp/test.log',
        logLevel: 'error',
      })
      assert.fail('should have thrown')
    } catch (err) {
      assert.ok(err.message.toLowerCase().includes('telegram') || err.message.toLowerCase().includes('token'),
        `error should mention telegram/token, got: ${err.message}`)
    }
  })

  test('validateConfig() throws with clear message when AUTHORIZED_USER_ID is empty', async () => {
    const { validateConfig } = await import('../../dist/utils/config.js')
    try {
      validateConfig({
        telegramToken: '123:abc',
        authorizedUserId: '',
        openCodeUrl: 'http://127.0.0.1:4097',
        stateFile: '/tmp/test.json',
        logFile: '/tmp/test.log',
        logLevel: 'error',
      })
      assert.fail('should have thrown')
    } catch (err) {
      assert.ok(
        err.message.toLowerCase().includes('user') || err.message.toLowerCase().includes('authorized'),
        `error should mention user/authorized, got: ${err.message}`
      )
    }
  })

  test('validateConfig() passes with valid config', async () => {
    const { validateConfig } = await import('../../dist/utils/config.js')
    validateConfig({
      telegramToken: '123:abc',
      authorizedUserId: '456',
      openCodeUrl: 'http://127.0.0.1:4097',
      stateFile: '/tmp/test.json',
      logFile: '/tmp/test.log',
      logLevel: 'info',
    })
    // should not throw
  })
})

// ────────────────────────────────────────────
// Phase 2: Contract tests — feature flag parsing
// ────────────────────────────────────────────

let FLAGS_IMPL = false
try {
  const mod = await import('../../dist/utils/config.js')
  if (typeof mod.validateFeatureFlags === 'function') {
    FLAGS_IMPL = true
  }
} catch { /* not yet */ }

describe('F4 feature flag parsing contract', { skip: !FLAGS_IMPL }, () => {
  test('validateFeatureFlags() returns defaults when env vars not set', async () => {
    const { validateFeatureFlags } = await import('../../dist/utils/config.js')
    const flags = validateFeatureFlags({})
    assert.equal(flags.showToolCalls, false)
    assert.equal(flags.showThinking, false)
    assert.equal(flags.showTokens, false)
  })

  test('validateFeatureFlags() parses "true" correctly', async () => {
    const { validateFeatureFlags } = await import('../../dist/utils/config.js')
    const flags = validateFeatureFlags({
      SHOW_TOOL_CALLS: 'true',
      SHOW_THINKING: 'true',
      SHOW_TOKENS: 'true',
    })
    assert.equal(flags.showToolCalls, true)
    assert.equal(flags.showThinking, true)
    assert.equal(flags.showTokens, true)
  })

  test('validateFeatureFlags() treats non-"true" values as false', async () => {
    const { validateFeatureFlags } = await import('../../dist/utils/config.js')
    const flags = validateFeatureFlags({
      SHOW_TOOL_CALLS: '1',
      SHOW_THINKING: 'yes',
      SHOW_TOKENS: 'on',
    })
    assert.equal(flags.showToolCalls, false)
    assert.equal(flags.showThinking, false)
    assert.equal(flags.showTokens, false)
  })
})
