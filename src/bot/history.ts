import { MessageInfo, MessagePart } from '../types/index.js'
import { escapeHtml } from '../utils/formatter.js'

export const HISTORY_PAGE_SIZE = 5

export interface PaginatedResult {
  items: MessageInfo[]
  page: number
  totalPages: number
  totalMessages: number
}

export function paginateMessages(
  messages: MessageInfo[],
  page: number,
  pageSize: number = HISTORY_PAGE_SIZE
): PaginatedResult {
  const totalMessages = messages.length
  const totalPages = totalMessages === 0 ? 0 : Math.ceil(totalMessages / pageSize)
  const clampedPage = Math.max(1, Math.min(page, totalPages || 1))
  const start = (clampedPage - 1) * pageSize
  const items = messages.slice(start, start + pageSize)
  return { items, page: clampedPage, totalPages, totalMessages }
}

const USER_ROLE_LABEL: Record<string, string> = {
  user: 'You',
  assistant: 'OpenCode',
}

function formatRole(role: string): string {
  return USER_ROLE_LABEL[role] || role
}

function formatTimestamp(created: number): string {
  const d = new Date(created)
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getTextFromParts(parts?: MessagePart[]): string {
  if (!parts || parts.length === 0) return '<i>(no content)</i>'
  const texts = parts
    .filter((p) => p.type === 'text' || p.type === 'reasoning')
    .map((p) => p.text || '')
    .filter(Boolean)
  if (texts.length === 0) {
    const types = parts.map((p) => p.type).join(', ')
    return `<i>(${escapeHtml(types)})</i>`
  }
  let result = texts.join('\n')
  if (result.length > 500) {
    result = result.slice(0, 497) + '...'
  }
  return escapeHtml(result)
}

export function formatHistoryPage(
  messages: MessageInfo[],
  page: number,
  totalPages: number,
  sessionId: string
): string {
  if (messages.length === 0) {
    return `📜 <b>History</b>\nSession: <code>${escapeHtml(sessionId)}</code>\n\nNo messages yet.`
  }

  let text = `📜 <b>History</b>\nSession: <code>${escapeHtml(sessionId)}</code>\nPage ${page}/${totalPages}\n\n`

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const role = formatRole(m.role)
    const time = formatTimestamp(m.time.created)
    const content = getTextFromParts(m.parts)
    text += `<b>${escapeHtml(role)}</b> <i>${escapeHtml(time)}</i>\n${content}\n`
    if (i < messages.length - 1) {
      text += '\n'
    }
  }

  return text
}

export function buildHistoryKeyboard(
  page: number,
  totalPages: number,
  sessionId: string
): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  const row: Array<{ text: string; callback_data: string }> = []

  if (page > 1) {
    row.push({ text: '◀ Newer', callback_data: `history_page:${page - 1}:${sessionId}` })
  }

  row.push({ text: `${page}/${totalPages}`, callback_data: `history_nop` })

  if (page < totalPages) {
    row.push({ text: 'Older ▶', callback_data: `history_page:${page + 1}:${sessionId}` })
  }

  return { inline_keyboard: [row] }
}
