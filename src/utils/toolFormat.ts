import { escapeHtml } from './formatter.js'

// Pure formatting helpers for tool activity and the live "Working..." status
// bubble. Kept out of events.ts so they can be unit-tested in isolation.

const TOOL_ICONS: Record<string, string> = {
  bash: '🖥️', edit: '✏️', write: '📝', read: '📖',
  grep: '🔍', glob: '🔍', todowrite: '📋', websearch: '🌐',
}

const TOOL_NAMES: Record<string, string> = {
  bash: 'Bash', edit: 'Edit', write: 'Write', read: 'Read',
  grep: 'Grep', glob: 'Glob', todowrite: 'Todo', websearch: 'Search',
}

export function getToolIcon(tool: string): string {
  return TOOL_ICONS[tool] || '🔧'
}

export function formatToolName(tool: string): string {
  return TOOL_NAMES[tool] || tool.charAt(0).toUpperCase() + tool.slice(1)
}

export interface ActiveTool {
  tool: string
  title: string
}

// Build the live "Working..." status text shown in the single status bubble.
// Returns '' when there's nothing to show, so the caller keeps the previous text
// (and avoids a redundant Telegram edit).
export function buildWorkingStatus(step: string, tools: ActiveTool[]): string {
  const parts: string[] = []

  if (step) {
    parts.push(`🚀 <b>Step:</b> ${escapeHtml(step)}`)
  }

  for (const t of tools.slice(0, 3)) {
    const icon = getToolIcon(t.tool)
    const name = formatToolName(t.tool)
    if (t.title) {
      parts.push(`${icon} <b>${name}:</b> ${escapeHtml(t.title.substring(0, 80))}`)
    } else {
      parts.push(`${icon} <b>${name}</b>`)
    }
  }

  if (parts.length === 0) return ''

  return `🔧 <b>Working...</b>\n\n${parts.join('\n')}`
}

// A real Telegram inline mention that pings the user regardless of whether they
// have a public @username (works via their numeric id). Send with parse_mode HTML.
export function buildUserMention(id: number, name: string): string {
  return `<a href="tg://user?id=${id}">${escapeHtml(name)}</a>`
}

// Build the idle message shown when a session finishes and the queue is empty.
// `label` is expected to already be a mention (HTML from buildUserMention).
export function buildIdleMessage(label: string): string {
  return `✅ <b>Task Selesai — menunggu input</b> ${label}`
}
