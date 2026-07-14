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
  const visible = parts.filter((p: any) => p.type === 'text' && !p.ignored && !p.synthetic)
  const texts = visible.map((p: any) => p.text || '').filter(Boolean)
  if (texts.length > 0) {
    let result = texts.join('\n')
    if (result.length > 500) {
      result = result.slice(0, 497) + '...'
    }
    return escapeHtml(result)
  }
  return ''
}

function getToolCount(parts?: MessagePart[]): number {
  if (!parts) return 0
  return parts.filter((p: any) => p.type === 'tool').length
}

function formatCost(m: MessageInfo): string {
  const parts: string[] = []
  if (m.tokens) {
    parts.push(`${m.tokens.input}→${m.tokens.output} tok`)
  }
  if (m.cost && m.cost > 0) {
    parts.push(`$${typeof m.cost === 'number' ? m.cost.toFixed(6) : m.cost}`)
  }
  return parts.length > 0 ? ` <i>(${escapeHtml(parts.join(' • '))})</i>` : ''
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

  const sorted = [...messages].sort((a, b) => {
    const ta = (a?.time?.created as number) ?? 0
    const tb = (b?.time?.created as number) ?? 0
    return ta - tb
  })

  let text = `📜 <b>History</b>\nSession: <code>${escapeHtml(sessionId)}</code>\nPage ${page}/${totalPages}\n\n`

  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i]
    const role = formatRole(m.role)
    const time = formatTimestamp(m.time.created)
    const content = getTextFromParts(m.parts)
    const cost = formatCost(m)

    text += `<b>${escapeHtml(role)}</b> <i>${escapeHtml(time)}</i>${cost}\n`

    if (m.role === 'assistant') {
      const toolCount = getToolCount(m.parts)
      if (toolCount > 0) {
        text += `<i>→ ${toolCount} tool call${toolCount !== 1 ? 's' : ''}</i>\n`
      }
    }

    if (content) {
      text += content + '\n'
    } else if (m.role === 'user') {
      text += '<i>(no text)</i>\n'
    }

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
    row.push({ text: '◀ Older', callback_data: `history_page:${page - 1}:${sessionId}` })
  }

  row.push({ text: `${page}/${totalPages}`, callback_data: `history_nop` })

  if (page < totalPages) {
    row.push({ text: 'Newer ▶', callback_data: `history_page:${page + 1}:${sessionId}` })
  }

  return { inline_keyboard: [row] }
}
