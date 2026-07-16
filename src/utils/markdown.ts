import telegramifyMarkdown from 'telegramify-markdown'
import { escapeMarkdown } from './formatter.js'

// Agent message rendering — the ccbot method: convert markdown tables to
// card-style first (Telegram has no tables), then telegramify → MarkdownV2.
// Send the result with parse_mode 'MarkdownV2'.

const TABLE_SEP_RE = /^[\s|:\-]+$/

function splitTableRow(line: string): string[] {
  const content = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return content.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))
}

// Port of ccbot's convert_markdown_tables: pipe tables → card-style
// "**Header**: value" blocks separated by a rule (skips code blocks).
export function convertMarkdownTables(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let i = 0
  let inCode = false

  while (i < lines.length) {
    const line = lines[i]
    const stripped = line.trim()

    if (stripped.startsWith('```')) { inCode = !inCode; result.push(line); i++; continue }
    if (inCode) { result.push(line); i++; continue }

    if (stripped.startsWith('|') && stripped.endsWith('|') && stripped.slice(1, -1).includes('|')) {
      const headers = splitTableRow(stripped)
      const sep = i + 1 < lines.length ? lines[i + 1].trim() : ''
      if (sep.startsWith('|') && TABLE_SEP_RE.test(sep)) {
        i += 2
        const rows: string[][] = []
        while (i < lines.length) {
          const dl = lines[i].trim()
          if (dl.startsWith('|') && dl.endsWith('|')) { rows.push(splitTableRow(dl)); i++ } else break
        }
        const separator = '────────────'
        const cards = rows.map(row =>
          headers.map((h, j) => {
            const v = j < row.length ? row[j] : ''
            return v ? `**${h}**: ${v}` : `**${h}**: —`
          }).join('\n')
        )
        result.push(cards.join(`\n${separator}\n`))
        continue
      }
    }

    result.push(line)
    i++
  }

  return result.join('\n')
}

// Convert agent-authored Markdown into Telegram MarkdownV2 (ccbot method).
// Never throws into the send path: on failure it falls back to a fully-escaped
// (valid) MarkdownV2 string — NOT escapeHtml, which would be invalid MarkdownV2.
export function toTelegramMarkdown(md: string): string {
  try {
    return telegramifyMarkdown(convertMarkdownTables(md), 'escape')
  } catch {
    return escapeMarkdown(md)
  }
}
