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
    parts.push(`🚀 *Step:* ${escapeHtml(step)}`)
  }

  for (const t of tools.slice(0, 3)) {
    const icon = getToolIcon(t.tool)
    const name = formatToolName(t.tool)
    if (t.title) {
      parts.push(`${icon} *${name}:* ${escapeHtml(t.title.substring(0, 80))}`)
    } else {
      parts.push(`${icon} *${name}*`)
    }
  }

  if (parts.length === 0) return ''

  return `🔧 *Working...*\n\n${parts.join('\n')}`
}
