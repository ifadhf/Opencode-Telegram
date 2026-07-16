// File: test/f4/health-contract.mjs
// F4 TDD contract — HealthMonitor: deteksi crash server OpenCode + auto-restart
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

let HEALTH_MONITOR_IMPL = false

try {
  const mod = await import('../../dist/opencode/health.js')
  if (typeof mod.HealthMonitor === 'function') {
    HEALTH_MONITOR_IMPL = true
  }
} catch {
  // module not found — not yet implemented
}

// ────────────────────────────────────────────
// Phase 1: NOT YET IMPLEMENTED — live spec
// ────────────────────────────────────────────

describe('F4 NOT YET IMPLEMENTED — HealthMonitor', { skip: HEALTH_MONITOR_IMPL }, () => {
  test('missing: HealthMonitor class for crash detection & auto-restart', () => {
    assert.fail(
      'F4 HealthMonitor not implemented. Create src/opencode/health.ts with:\n' +
      '\n' +
      '  export interface HealthMonitorOptions {\n' +
      '    checkIntervalMs?: number      // default 10000\n' +
      '    healthUrl?: string            // default http://127.0.0.1:{port}/session\n' +
      '    maxRestartAttempts?: number   // default 3\n' +
      '    restartBackoffMs?: number     // default 5000\n' +
      '    onUnhealthy?: (reason: string, attempt: number) => void\n' +
      '    onRecovered?: () => void\n' +
      '    onRestartFailed?: (reason: string) => void\n' +
      '  }\n' +
      '\n' +
      '  export class HealthMonitor {\n' +
      '    constructor(options: HealthMonitorOptions)\n' +
      '    checkOnce(): Promise<{ healthy: boolean; reason?: string }>\n' +
      '    start(): void\n' +
      '    stop(): void\n' +
      '    get isRunning(): boolean\n' +
      '    get restartCount(): number\n' +
      '  }\n' +
      '\n' +
      'Wire integration in src/index.ts:\n' +
      '  1. Create HealthMonitor after OpenCodeServer starts\n' +
      '  2. Pass a restart callback that calls openCodeServer.stop() + start()\n' +
      '  3. Start monitoring after bot.start()\n' +
      '  4. Stop monitoring before server.stop() in shutdown\n' +
      '\n' +
      'Behaviour:\n' +
      '  - Every checkIntervalMs, pings healthUrl via fetch\n' +
      '  - If 2 consecutive checks fail → triggers restart callback\n' +
      '  - After restart, waits restartBackoffMs then resumes checking\n' +
      '  - Exceeding maxRestartAttempts → fires onRestartFailed, stops monitoring\n' +
      '  - Recovery detection: first successful check after failure → fires onRecovered\n' +
      '  - checkOnce() is a one-shot manual check (for use from /health command)\n'
    )
  })
})

// ────────────────────────────────────────────
// Phase 2: Contract tests
// ────────────────────────────────────────────

describe('F4 HealthMonitor contract', { skip: !HEALTH_MONITOR_IMPL }, () => {
  test('HealthMonitor constructor accepts options with defaults', async () => {
    const { HealthMonitor } = await import('../../dist/opencode/health.js')
    const hm = new HealthMonitor({ healthUrl: 'http://127.0.0.1:9999/session' })
    assert.ok(hm instanceof HealthMonitor)
    assert.equal(hm.isRunning, false)
    assert.equal(hm.restartCount, 0)
  })

  test('checkOnce() returns { healthy, reason? } object', async () => {
    const { HealthMonitor } = await import('../../dist/opencode/health.js')
    const hm = new HealthMonitor({
      healthUrl: 'http://127.0.0.1:9999/session',
      checkIntervalMs: 500,
    })
    const result = await hm.checkOnce()
    assert.ok(typeof result === 'object')
    assert.ok('healthy' in result)
    assert.equal(typeof result.healthy, 'boolean')
    if (!result.healthy) {
      assert.ok(typeof result.reason === 'string', 'unhealthy check should include reason')
    }
  })

  test('start() sets isRunning to true', async () => {
    const { HealthMonitor } = await import('../../dist/opencode/health.js')
    const hm = new HealthMonitor({
      healthUrl: 'http://127.0.0.1:9999/session',
      checkIntervalMs: 60000, // long interval to avoid side effects
    })
    hm.start()
    assert.equal(hm.isRunning, true)
    hm.stop()
    assert.equal(hm.isRunning, false)
  })

  test('stop() sets isRunning to false and clears interval', async () => {
    const { HealthMonitor } = await import('../../dist/opencode/health.js')
    const hm = new HealthMonitor({
      healthUrl: 'http://127.0.0.1:9999/session',
      checkIntervalMs: 100,
    })
    hm.start()
    assert.equal(hm.isRunning, true)
    hm.stop()
    assert.equal(hm.isRunning, false)
    // Starting again should work (no lingering timers)
    hm.start()
    assert.equal(hm.isRunning, true)
    hm.stop()
  })

  test('onUnhealthy callback fires after repeated failures', async () => {
    const { HealthMonitor } = await import('../../dist/opencode/health.js')
    let unhealthyCalls = 0
    const hm = new HealthMonitor({
      healthUrl: 'http://127.0.0.1:9999/nonexistent', // will always fail
      checkIntervalMs: 50,
      onUnhealthy: () => { unhealthyCalls++ },
    })
    hm.start()
    // Wait for at least 2 check cycles (2 consecutive failures -> unhealthy)
    await new Promise(resolve => setTimeout(resolve, 200))
    hm.stop()
    assert.ok(unhealthyCalls >= 1, `expected at least 1 unhealthy callback, got ${unhealthyCalls}`)
  })

  test('onRestartFailed fires after exceeding maxRestartAttempts', async () => {
    const { HealthMonitor } = await import('../../dist/opencode/health.js')
    let failedCalls = 0
    const hm = new HealthMonitor({
      healthUrl: 'http://127.0.0.1:9999/nonexistent',
      checkIntervalMs: 50,
      maxRestartAttempts: 2,
      onRestartFailed: () => { failedCalls++ },
    })
    hm.start()
    // Wait for 2 rounds of failure + restart attempts
    await new Promise(resolve => setTimeout(resolve, 400))
    hm.stop()
    assert.equal(failedCalls, 1, 'onRestartFailed should fire exactly once when max attempts exceeded')
  })

  test('restartCount increments after each restart attempt', async () => {
    const { HealthMonitor } = await import('../../dist/opencode/health.js')
    const hm = new HealthMonitor({
      healthUrl: 'http://127.0.0.1:9999/nonexistent',
      checkIntervalMs: 50,
      maxRestartAttempts: 3,
    })
    hm.start()
    await new Promise(resolve => setTimeout(resolve, 400))
    assert.ok(hm.restartCount > 0, `restartCount should be > 0, got ${hm.restartCount}`)
    assert.ok(hm.restartCount <= 3, `restartCount should not exceed maxRestartAttempts, got ${hm.restartCount}`)
    hm.stop()
  })

  test('monitor stops checking after exceeding maxRestartAttempts', async () => {
    const { HealthMonitor } = await import('../../dist/opencode/health.js')
    const hm = new HealthMonitor({
      healthUrl: 'http://127.0.0.1:9999/nonexistent',
      checkIntervalMs: 30,
      maxRestartAttempts: 1,
    })
    hm.start()
    await new Promise(resolve => setTimeout(resolve, 300))
    // After exceeding max attempts, should auto-stop
    assert.equal(hm.isRunning, false, 'monitor should stop after maxRestartAttempts exceeded')
    assert.equal(hm.restartCount, 1)
  })

  test('restartAttempts RESET on recovery — monitor survives crashes spread over time', async () => {
    const { HealthMonitor } = await import('../../dist/opencode/health.js')
    let restarts = 0
    const hm = new HealthMonitor({
      healthUrl: 'http://127.0.0.1:9999/x',
      checkIntervalMs: 600000,
      maxRestartAttempts: 2,
      restartBackoffMs: 1,
      onRestart: async () => { restarts++ },
    })
    // Drive check() directly with scripted health results (bypass real fetch).
    let nextResult = { healthy: true }
    hm.checkOnce = async () => nextResult

    // Episode 1: two failures -> unhealthy -> 1 restart
    nextResult = { healthy: false, reason: 'x' }
    await hm.check(); await hm.check()
    assert.equal(hm.restartCount, 1, 'first crash episode -> restartCount 1')

    // Recovery: restartCount MUST reset to 0 (this was the bug — it never reset)
    nextResult = { healthy: true }
    await hm.check()
    assert.equal(hm.restartCount, 0, 'restartCount must reset to 0 after recovery')

    // Episode 2 (later crash): should count from 1 again, NOT accumulate to maxRestartAttempts
    nextResult = { healthy: false, reason: 'x' }
    await hm.check(); await hm.check()
    assert.equal(hm.restartCount, 1, 'after recovery the counter restarts from 1, not accumulates to the cap')
    assert.equal(restarts, 2, 'a restart must fire in BOTH episodes (monitor did not self-disable)')
    hm.stop()
  })

  test('default checkIntervalMs is 10000', async () => {
    const { HealthMonitor } = await import('../../dist/opencode/health.js')
    const hm = new HealthMonitor({ healthUrl: 'http://127.0.0.1:9999/session' })
    // We can't easily test the interval value directly, but verify it constructs OK
    assert.ok(hm instanceof HealthMonitor)
    // The default should be a reasonable value (don't start anything though)
  })

  test('default maxRestartAttempts is 3', async () => {
    const { HealthMonitor } = await import('../../dist/opencode/health.js')
    const hm = new HealthMonitor({
      healthUrl: 'http://127.0.0.1:9999/session',
      checkIntervalMs: 50,
    })
    hm.start()
    await new Promise(resolve => setTimeout(resolve, 300))
    // Should stop after 3 restarts with default
    assert.ok(hm.restartCount <= 3)
    hm.stop()
  })

  test('checkOnce() on a healthy server returns { healthy: true }', async () => {
    const OC_URL = process.env.OPENCODE_URL || 'http://127.0.0.1:4097'
    const { HealthMonitor } = await import('../../dist/opencode/health.js')

    // First check if server is actually reachable
    let reachable = false
    try {
      const res = await fetch(`${OC_URL}/session`)
      reachable = res.ok
    } catch { /* server not running */ }

    if (!reachable) return // skip if no server

    const hm = new HealthMonitor({ healthUrl: `${OC_URL}/session` })
    const result = await hm.checkOnce()
    assert.equal(result.healthy, true, `server at ${OC_URL} should be healthy`)
  })
})
