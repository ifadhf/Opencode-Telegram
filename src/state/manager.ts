import { readFile, writeFile, mkdir, rename } from 'fs/promises'
import { dirname } from 'path'
import { z } from 'zod'
import { getLogger } from '../utils/logger.js'

export interface SelectedModel {
  providerId: string
  modelId: string
}

export interface ChatState {
  sessionId?: string
  model?: SelectedModel
  mode?: string
}

export interface TopicBinding {
  sessionId: string
  cwd: string
  model?: SelectedModel
  mode?: string
}

const TopicBindingSchema = z.object({
  sessionId: z.string(),
  cwd: z.string(),
  model: z.object({ providerId: z.string(), modelId: z.string() }).optional(),
  mode: z.string().optional(),
})

const SavedStateSchema = z.object({
  sessions: z.array(z.tuple([z.number(), z.string()])),
  models: z.array(z.tuple([z.number(), z.object({ providerId: z.string(), modelId: z.string() })])),
  modes: z.array(z.tuple([z.number(), z.string()])),
  lastUpdateId: z.number().optional(),
  costTracking: z.record(z.string(), z.object({
    totalCost: z.number(),
    totalInput: z.number(),
    totalOutput: z.number(),
    totalReasoning: z.number(),
    totalCacheRead: z.number(),
    totalCacheWrite: z.number(),
    messages: z.number(),
  })).optional(),
  promptCounters: z.record(z.string(), z.number()).optional(),
  queuedMessages: z.array(z.object({
    chatId: z.number(),
    text: z.string(),
  })).optional(),
  topicBindings: z.record(z.string(), TopicBindingSchema).optional(),
}).strip()

export interface CostEntry {
  totalCost: number
  totalInput: number
  totalOutput: number
  totalReasoning: number
  totalCacheRead: number
  totalCacheWrite: number
  messages: number
}

export interface QueuedMessage {
  chatId: number
  text: string
}

export class StateManager {
  private state: {
    sessions: Map<number, string>
    models: Map<number, SelectedModel>
    modes: Map<number, string>
    lastUpdateId?: number
    costTracking: Map<string, CostEntry>
    promptCounters: Map<number, number>
    queuedMessages: QueuedMessage[]
    topicBindings: Map<string, TopicBinding>
    sessionToTopic: Map<string, { chatId: number; threadId: number }>
  }
  private stateFile: string
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(stateFile: string = 'bot-state.json') {
    this.stateFile = stateFile
    this.state = {
      sessions: new Map(),
      models: new Map(),
      modes: new Map(),
      costTracking: new Map(),
      promptCounters: new Map(),
      queuedMessages: [],
      topicBindings: new Map(),
      sessionToTopic: new Map(),
    }
  }

  async load(): Promise<void> {
    try {
      const data = await readFile(this.stateFile, 'utf-8')
      const parsed = SavedStateSchema.parse(JSON.parse(data))
      const topicBindings = new Map<string, TopicBinding>(
        Object.entries(parsed.topicBindings || {})
      )
      const sessionToTopic = new Map<string, { chatId: number; threadId: number }>()
      for (const [key, binding] of topicBindings) {
        const [chatIdStr, threadIdStr] = key.split(':')
        sessionToTopic.set(binding.sessionId, {
          chatId: parseInt(chatIdStr, 10),
          threadId: parseInt(threadIdStr, 10),
        })
      }
      this.state = {
        sessions: new Map(parsed.sessions || []),
        models: new Map(parsed.models || []),
        modes: new Map(parsed.modes || []),
        lastUpdateId: parsed.lastUpdateId,
        costTracking: new Map(
          Object.entries(parsed.costTracking || {}).map(([k, v]) => [k, v])
        ),
        promptCounters: new Map(
          Object.entries(parsed.promptCounters || {})
            .map(([k, v]) => [parseInt(k), v] as [number, number])
            .filter(([k]) => !isNaN(k))
        ),
        queuedMessages: parsed.queuedMessages || [],
        topicBindings,
        sessionToTopic,
      }
      getLogger().info('State loaded', {
        sessions: this.state.sessions.size,
        models: this.state.models.size,
        modes: this.state.modes.size,
        queuedMessages: this.state.queuedMessages.length
      })
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'ENOENT') {
        getLogger().info('No existing state found, starting fresh')
      } else {
        getLogger().warn('State file corrupted, starting fresh', { error: err.message })
      }
    }
  }

  async save(): Promise<void> {
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        const dir = dirname(this.stateFile)
        await mkdir(dir, { recursive: true })

        const data = {
          sessions: Array.from(this.state.sessions.entries()),
          models: Array.from(this.state.models.entries()),
          modes: Array.from(this.state.modes.entries()),
          lastUpdateId: this.state.lastUpdateId,
          costTracking: Object.fromEntries(this.state.costTracking),
          promptCounters: Object.fromEntries(this.state.promptCounters),
          queuedMessages: this.state.queuedMessages,
          topicBindings: Object.fromEntries(this.state.topicBindings),
        }
        const tmpFile = this.stateFile + '.' + Date.now() + '.' + Math.random().toString(36).slice(2, 8) + '.tmp'
        await writeFile(tmpFile, JSON.stringify(data, null, 2))
        await rename(tmpFile, this.stateFile)
      } catch (error) {
        getLogger().error('Failed to save state', { error: (error as Error).message })
      }
    }).catch(() => {})
    return this.saveQueue
  }

  setCurrentSession(chatId: number, sessionId: string): void {
    this.state.sessions.set(chatId, sessionId)
    this.save()
  }

  getCurrentSession(chatId: number): string | undefined {
    return this.state.sessions.get(chatId)
  }

  clearCurrentSession(chatId: number): void {
    this.state.sessions.delete(chatId)
    this.save()
  }

  getChatIdForSession(sessionId: string): number | undefined {
    for (const [chatId, sid] of this.state.sessions.entries()) {
      if (sid === sessionId) return chatId
    }
    return undefined
  }

  // Resolve which Telegram chat + forum thread a session's messages belong to.
  // Topic-bound sessions first (forum topics, with their threadId), then legacy
  // per-chat sessions (threadId 0). Single source of truth for routing agent
  // output, permission prompts, and questions back to the right place.
  resolveChat(sessionId: string): { chatId: number; threadId: number } | undefined {
    const topic = this.getTopicBySession(sessionId)
    if (topic) return topic
    const chatId = this.getChatIdForSession(sessionId)
    if (chatId !== undefined) return { chatId, threadId: 0 }
    return undefined
  }

  setCurrentModel(chatId: number, providerId: string, modelId: string): void {
    this.state.models.set(chatId, { providerId, modelId })
    this.save()
  }

  getCurrentModel(chatId: number): SelectedModel | undefined {
    return this.state.models.get(chatId)
  }

  clearCurrentModel(chatId: number): void {
    this.state.models.delete(chatId)
    this.save()
  }

  setCurrentMode(chatId: number, mode: string): void {
    this.state.modes.set(chatId, mode)
    this.save()
  }

  getCurrentMode(chatId: number): string | undefined {
    return this.state.modes.get(chatId)
  }

  clearCurrentMode(chatId: number): void {
    this.state.modes.delete(chatId)
    this.save()
  }

  getChatState(chatId: number): ChatState {
    return {
      sessionId: this.getCurrentSession(chatId),
      model: this.getCurrentModel(chatId),
      mode: this.getCurrentMode(chatId),
    }
  }

  clearChatState(chatId: number): void {
    const sessionId = this.state.sessions.get(chatId)
    this.state.sessions.delete(chatId)
    this.state.models.delete(chatId)
    this.state.modes.delete(chatId)
    if (sessionId) this.state.costTracking.delete(sessionId)
    this.state.promptCounters.delete(chatId)
    this.state.queuedMessages = this.state.queuedMessages.filter(m => m.chatId !== chatId)
    this.save()
  }

  setLastUpdateId(updateId: number): void {
    this.state.lastUpdateId = updateId
  }

  getLastUpdateId(): number | undefined {
    return this.state.lastUpdateId
  }

  addCost(sessionId: string, cost: number, input: number, output: number, reasoning: number, cacheRead: number, cacheWrite: number): void {
    const existing = this.state.costTracking.get(sessionId) || {
      totalCost: 0, totalInput: 0, totalOutput: 0,
      totalReasoning: 0, totalCacheRead: 0, totalCacheWrite: 0, messages: 0,
    }
    existing.totalCost += cost
    existing.totalInput += input
    existing.totalOutput += output
    existing.totalReasoning += reasoning
    existing.totalCacheRead += cacheRead
    existing.totalCacheWrite += cacheWrite
    existing.messages += 1
    this.state.costTracking.set(sessionId, existing)
    this.save()
  }

  getCost(sessionId: string): CostEntry | undefined {
    return this.state.costTracking.get(sessionId)
  }

  incrementPromptCount(chatId: number): number {
    const current = this.state.promptCounters.get(chatId) || 0
    const next = current + 1
    this.state.promptCounters.set(chatId, next)
    this.save()
    return next
  }

  getPromptCount(chatId: number): number {
    return this.state.promptCounters.get(chatId) || 0
  }

  getAllChatIds(): number[] {
    return Array.from(this.state.sessions.keys())
  }

  getQueuedMessages(): QueuedMessage[] {
    return [...this.state.queuedMessages]
  }

  addQueuedMessage(chatId: number, text: string): void {
    this.state.queuedMessages.push({ chatId, text })
    this.save()
  }

  removeQueuedMessage(chatId: number, text: string): void {
    this.state.queuedMessages = this.state.queuedMessages.filter(
      m => !(m.chatId === chatId && m.text === text)
    )
    this.save()
  }

  clearQueuedMessages(chatId?: number): void {
    if (chatId !== undefined) {
      this.state.queuedMessages = this.state.queuedMessages.filter(m => m.chatId !== chatId)
    } else {
      this.state.queuedMessages = []
    }
    this.save()
  }

  // Topic-aware session management (F2: forum topics / multi-sesi)
  private topicKey(chatId: number, threadId: number): string {
    return `${chatId}:${threadId}`
  }

  setTopicSession(chatId: number, threadId: number, binding: TopicBinding): void {
    const key = this.topicKey(chatId, threadId)
    this.state.topicBindings.set(key, binding)
    this.state.sessionToTopic.set(binding.sessionId, { chatId, threadId })
    this.save()
  }

  getTopicSession(chatId: number, threadId: number): TopicBinding | undefined {
    return this.state.topicBindings.get(this.topicKey(chatId, threadId))
  }

  getTopicBySession(sessionId: string): { chatId: number; threadId: number } | undefined {
    return this.state.sessionToTopic.get(sessionId)
  }

  getAllTopics(chatId: number): Array<{ threadId: number; sessionId: string; cwd: string; model?: SelectedModel; mode?: string }> {
    const prefix = `${chatId}:`
    const results: Array<{ threadId: number; sessionId: string; cwd: string; model?: SelectedModel; mode?: string }> = []
    for (const [key, binding] of this.state.topicBindings) {
      if (key.startsWith(prefix)) {
        const threadId = parseInt(key.slice(prefix.length), 10)
        results.push({ threadId, ...binding })
      }
    }
    return results
  }

  clearTopicSession(chatId: number, threadId: number): void {
    const key = this.topicKey(chatId, threadId)
    const binding = this.state.topicBindings.get(key)
    if (binding) {
      this.state.sessionToTopic.delete(binding.sessionId)
    }
    this.state.topicBindings.delete(key)
    this.save()
  }

  setTopicModel(chatId: number, threadId: number, providerId: string, modelId: string): void {
    const key = this.topicKey(chatId, threadId)
    const binding = this.state.topicBindings.get(key)
    if (binding) {
      binding.model = { providerId, modelId }
      this.save()
    }
  }

  setTopicMode(chatId: number, threadId: number, mode: string): void {
    const key = this.topicKey(chatId, threadId)
    const binding = this.state.topicBindings.get(key)
    if (binding) {
      binding.mode = mode
      this.save()
    }
  }

  getAllTopicBindings(): Array<{ chatId: number; threadId: number; sessionId: string; cwd: string; model?: SelectedModel; mode?: string }> {
    const results: Array<{ chatId: number; threadId: number; sessionId: string; cwd: string; model?: SelectedModel; mode?: string }> = []
    for (const [key, binding] of this.state.topicBindings) {
      const [chatIdStr, threadIdStr] = key.split(':')
      results.push({
        chatId: parseInt(chatIdStr, 10),
        threadId: parseInt(threadIdStr, 10),
        ...binding,
      })
    }
    return results
  }

  flushSave(): Promise<void> {
    return this.saveQueue
  }
}
