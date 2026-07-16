import { escapeHtml } from '../utils/formatter.js'
import type { QuestionRequest } from '../types/index.js'

export interface RenderedQuestion {
  text: string
  inlineKeyboard: Array<Array<{ text: string; callback_data: string }>>
}

// Render a QuestionRequest as a Telegram prompt with tappable option buttons.
// OpenCode's AskUserQuestion is single-question in the common case; when a
// request carries several questions we render the first and note the rest
// (the reply flow answers one question per tap).
export function renderQuestion(req: QuestionRequest): RenderedQuestion {
  const q = req.questions?.[0]
  const header = q?.header || 'Question'
  const questionText = q?.question || 'OpenCode has a question'
  const options = q?.options || []

  let text = `❓ <b>${escapeHtml(header)}</b>\n\n${escapeHtml(questionText)}`
  if (req.questions && req.questions.length > 1) {
    text += `\n\n<i>(+${req.questions.length - 1} more — answer this first)</i>`
  }

  const inlineKeyboard: Array<Array<{ text: string; callback_data: string }>> = []
  options.forEach((opt, idx) => {
    // One button per option; callback carries the request id + option index.
    inlineKeyboard.push([{ text: opt.label, callback_data: `q:${req.id}:${idx}` }])
  })
  if (options.length === 0) {
    text += '\n\n<i>Reply to this message with your answer.</i>'
  }
  inlineKeyboard.push([{ text: '❌ Dismiss', callback_data: `q:reject:${req.id}` }])

  return { text, inlineKeyboard }
}

// Map a tapped option index to the reply body OpenCode expects.
// `answers` is one array per question in the request; a single-select tap on
// the first question yields [[label]]. Returns undefined for an out-of-range
// index (e.g. a stale button whose question already changed).
export function answerForIndex(
  req: QuestionRequest,
  answerIndex: number
): { label: string; answers: string[][] } | undefined {
  const opt = req.questions?.[0]?.options?.[answerIndex]
  if (!opt) return undefined
  return { label: opt.label, answers: [[opt.label]] }
}
