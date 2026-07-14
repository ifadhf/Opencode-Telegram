import telegramifyMarkdown from 'telegramify-markdown'
import { escapeMarkdown } from './formatter.js'

// Convert agent-authored Markdown into Telegram MarkdownV2: real bold, headings,
// lists, and preserved fenced/inline code, with reserved chars escaped only in
// prose (not inside code). Send the result with parse_mode 'MarkdownV2'.
// Never throws into the send path: on failure it falls back to a fully-escaped
// (formatting-stripped but Telegram-safe) MarkdownV2 string.
export function toTelegramMarkdown(md: string): string {
  try {
    return telegramifyMarkdown(md, 'escape')
  } catch {
    return escapeMarkdown(md)
  }
}
