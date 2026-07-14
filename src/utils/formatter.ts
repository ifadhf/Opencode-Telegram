import { PermissionRequest } from '../types/index.js'

// Strip ANSI escape codes from terminal output
export function stripAnsi(text: string): string {
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

// Get emoji icon for file type
export function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  const icons: Record<string, string> = {
    ts: '📘', js: '📜', tsx: '📘', jsx: '📜',
    py: '🐍', rb: '💎', go: '🔷', rs: '🦀',
    md: '⭐', txt: '📝', log: '📜',
    sh: '📜', bash: '📜', zsh: '📜',
    bat: '🔴', cmd: '🔴', exe: '🔴',
    json: '🧩', yaml: '🧩', yml: '🧩', toml: '🧩',
    env: '🔑',
    html: '🌐', css: '🎨', scss: '🎨',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️',
    pdf: '📕',
    docker: '🐳', dockerfile: '🐳',
    gitignore: '🟧', gitmodules: '🟧',
  }
  return icons[ext] || '📄'
}

export function escapeMarkdown(text: string): string {
  return text.replace(/([*[\]()~`>#+=|{}.!])/g, '\\$1')
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function formatPermissionRequest(permission: PermissionRequest): string {
  const patterns = permission.patterns.map((p: string) => `\`${escapeMarkdown(p)}\``).join(', ')

  return (
    `*Permission Request*\n\n` +
    `Permission: \`${escapeMarkdown(permission.permission)}\`\n` +
    `Patterns: ${patterns}\n\n` +
    `How would you like to respond?`
  )
}

export function splitMessage(text: string, maxLength = 4096): string[] {
  const chunks: string[] = []
  let currentChunk = ''
  let inCodeBlock = false
  let inInlineCode = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (ch === '`') {
      if (text.slice(i, i + 3) === '```') {
        inCodeBlock = !inCodeBlock
        i += 2
      } else {
        inInlineCode = !inInlineCode
      }
    }

    if (currentChunk.length >= maxLength) {
      if (inCodeBlock) {
        currentChunk += '\n```'
        chunks.push(currentChunk)
        currentChunk = '```\n'
      } else if (inInlineCode) {
        currentChunk += '`'
        chunks.push(currentChunk)
        currentChunk = '`'
      } else {
        const lastNewline = currentChunk.lastIndexOf('\n')
        if (lastNewline > maxLength * 0.7) {
          chunks.push(currentChunk.substring(0, lastNewline))
          currentChunk = currentChunk.substring(lastNewline + 1)
        } else {
          const lastSpace = currentChunk.lastIndexOf(' ')
          if (lastSpace > 0) {
            chunks.push(currentChunk.substring(0, lastSpace))
            currentChunk = currentChunk.substring(lastSpace + 1)
          } else {
            chunks.push(currentChunk)
            currentChunk = ''
          }
        }
      }
    }

    currentChunk += ch
  }

  if (currentChunk) {
    chunks.push(currentChunk)
  }

  return chunks
}
