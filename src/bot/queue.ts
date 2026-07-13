import { getLogger } from '../utils/logger.js'

interface QueuedMessage {
  chatId: number
  threadId: number
  text: string
  timestamp: number
  resolve: () => void
  reject: (error: Error) => void
}

function compositeKey(chatId: number, threadId?: number): string {
  return `${chatId}:${threadId ?? 0}`
}

export class MessageQueue {
  private queues = new Map<string, QueuedMessage[]>()
  private busyKeys = new Set<string>()
  private readonly MAX_QUEUE_SIZE = 50
  private readonly QUEUE_TIMEOUT_MS = 30 * 60 * 1000

  setBusy(chatId: number, threadId?: number): void {
    this.busyKeys.add(compositeKey(chatId, threadId))
  }

  setIdle(chatId: number, threadId?: number): void {
    this.busyKeys.delete(compositeKey(chatId, threadId))
  }

  isBusy(chatId: number, threadId?: number): boolean {
    return this.busyKeys.has(compositeKey(chatId, threadId))
  }

  getQueueLength(chatId: number, threadId?: number): number {
    return this.queues.get(compositeKey(chatId, threadId))?.length || 0
  }

  enqueue(chatId: number, text: string, threadId?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const key = compositeKey(chatId, threadId)
      if (!this.queues.has(key)) {
        this.queues.set(key, [])
      }
      const queue = this.queues.get(key)!
      if (queue.length >= this.MAX_QUEUE_SIZE) {
        reject(new Error('Queue is full (max 50 messages)'))
        return
      }
      queue.push({ chatId, threadId: threadId ?? 0, text, timestamp: Date.now(), resolve, reject })
      getLogger().debug('Message enqueued', { chatId, threadId, queueLength: queue.length })
    })
  }

  dequeue(chatId: number, threadId?: number): QueuedMessage | undefined {
    const queue = this.queues.get(compositeKey(chatId, threadId))
    if (!queue || queue.length === 0) return undefined
    return queue.shift()
  }

  clear(chatId: number, threadId?: number): void {
    const key = compositeKey(chatId, threadId)
    const queue = this.queues.get(key)
    if (queue) {
      for (const msg of queue) {
        msg.reject(new Error('Queue cleared'))
      }
      this.queues.delete(key)
    }
    this.busyKeys.delete(key)
  }

  getStaleMessages(chatId: number, threadId?: number): QueuedMessage[] {
    const queue = this.queues.get(compositeKey(chatId, threadId))
    if (!queue) return []
    const now = Date.now()
    const stale: QueuedMessage[] = []
    for (let i = queue.length - 1; i >= 0; i--) {
      if (now - queue[i].timestamp > this.QUEUE_TIMEOUT_MS) {
        const [removed] = queue.splice(i, 1)
        stale.push(removed)
      }
    }
    return stale
  }

  purgeStale(chatId: number, threadId?: number): void {
    const stale = this.getStaleMessages(chatId, threadId)
    for (const msg of stale) {
      msg.reject(new Error('Message expired (timeout)'))
    }
  }
}
