import { getLogger } from '../utils/logger.js'

export interface HealthMonitorOptions {
  checkIntervalMs?: number
  healthUrl?: string
  maxRestartAttempts?: number
  restartBackoffMs?: number
  onUnhealthy?: (reason: string, attempt: number) => void
  onRecovered?: () => void
  onRestartFailed?: (reason: string) => void
  onRestart?: () => Promise<void>
}

export class HealthMonitor {
  private options: {
    checkIntervalMs: number
    healthUrl: string
    maxRestartAttempts: number
    restartBackoffMs: number
    onUnhealthy: ((reason: string, attempt: number) => void) | undefined
    onRecovered: (() => void) | undefined
    onRestartFailed: ((reason: string) => void) | undefined
    onRestart: (() => Promise<void>) | undefined
  }
  private interval: ReturnType<typeof setInterval> | null = null
  private backoffTimeout: ReturnType<typeof setTimeout> | null = null
  private consecutiveFailures = 0
  private restartAttempts = 0
  private unhealthy = false
  private wasUnhealthy = false
  private _isRunning = false

  constructor(options: HealthMonitorOptions) {
    this.options = {
      checkIntervalMs: options.checkIntervalMs ?? 10000,
      healthUrl: options.healthUrl ?? 'http://127.0.0.1:4097/session',
      maxRestartAttempts: options.maxRestartAttempts ?? 3,
      restartBackoffMs: options.restartBackoffMs ?? 5000,
      onUnhealthy: options.onUnhealthy,
      onRecovered: options.onRecovered,
      onRestartFailed: options.onRestartFailed,
      onRestart: options.onRestart,
    }
  }

  private log(level: 'info' | 'warn' | 'error', message: string, data?: any): void {
    try {
      const logger = getLogger()
      logger[level](message, data)
    } catch {
      console.log(`[HealthMonitor] [${level.toUpperCase()}] ${message}`)
    }
  }

  async checkOnce(): Promise<{ healthy: boolean; reason?: string }> {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const response = await fetch(this.options.healthUrl, { signal: controller.signal })
      clearTimeout(timeout)
      if (response.ok) {
        return { healthy: true }
      }
      return { healthy: false, reason: `HTTP ${response.status}` }
    } catch (err) {
      return { healthy: false, reason: (err as Error).message }
    }
  }

  private async check(): Promise<void> {
    const result = await this.checkOnce()

    if (result.healthy) {
      if (this.wasUnhealthy) {
        this.wasUnhealthy = false
        this.unhealthy = false
        // Reset the restart budget on recovery — otherwise attempts accumulate
        // over the whole process lifetime and the monitor permanently disables
        // itself after a few crashes days apart (a silent SPOF).
        this.restartAttempts = 0
        this.log('info', 'Health monitor: server recovered')
        this.options.onRecovered?.()
      }
      this.consecutiveFailures = 0
      return
    }

    this.consecutiveFailures++
    this.log('warn', 'Health monitor: check failed', { reason: result.reason, consecutive: this.consecutiveFailures })

    if (this.consecutiveFailures >= 2 && !this.unhealthy) {
      this.consecutiveFailures = 0
      this.unhealthy = true
      this.wasUnhealthy = true
      this.restartAttempts++

      if (this.restartAttempts >= this.options.maxRestartAttempts) {
        this.log('error', 'Health monitor: max restart attempts exceeded', { attempts: this.restartAttempts })
        this.options.onRestartFailed?.(`Max restart attempts (${this.options.maxRestartAttempts}) exceeded`)
        this.stop()
        return
      }

      this.log('error', 'Health monitor: server unhealthy', { attempt: this.restartAttempts, reason: result.reason })
      this.options.onUnhealthy?.(result.reason!, this.restartAttempts)

      if (this.options.onRestart) {
        try {
          await this.options.onRestart()
        } catch (err) {
          this.log('error', 'Health monitor: restart callback failed', { error: (err as Error).message })
        }
        this.pauseForBackoff()
      } else {
        this.unhealthy = false
      }
    }
  }

  private pauseForBackoff(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    this.log('info', `Health monitor: waiting ${this.options.restartBackoffMs}ms before resuming checks`)
    this.backoffTimeout = setTimeout(() => {
      this.backoffTimeout = null
      this.unhealthy = false
      if (this._isRunning) {
        this.interval = setInterval(() => this.check(), this.options.checkIntervalMs)
      }
    }, this.options.restartBackoffMs)
  }

  start(): void {
    if (this._isRunning) return
    this._isRunning = true
    this.interval = setInterval(() => this.check(), this.options.checkIntervalMs)
    this.log('info', 'Health monitor started', { intervalMs: this.options.checkIntervalMs, url: this.options.healthUrl })
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    if (this.backoffTimeout) {
      clearTimeout(this.backoffTimeout)
      this.backoffTimeout = null
    }
    this._isRunning = false
    this.log('info', 'Health monitor stopped')
  }

  get isRunning(): boolean {
    return this._isRunning
  }

  get restartCount(): number {
    return this.restartAttempts
  }
}
