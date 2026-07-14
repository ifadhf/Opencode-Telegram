import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// F5.2: interactive questions from the agent must reach Telegram as tappable
// buttons. OpenCode delivers questions via GET /question (QuestionRequest[]);
// options are { label, description } objects and the reply body is answers:
// string[][] of the selected LABELS (not indices). This tests the pure
// render + answer-mapping; the poll wiring is validated by build + human test.

let mod
try { mod = await import('../../dist/opencode/questionFormat.js') } catch { /* not built */ }
const IMPL = !!(mod && typeof mod.renderQuestion === 'function' && typeof mod.answerForIndex === 'function')

const req = {
  id: 'que_1',
  sessionID: 'ses_1',
  questions: [{
    question: 'Which package manager?',
    header: 'Pick one',
    options: [
      { label: 'npm', description: 'default' },
      { label: 'pnpm', description: 'fast' },
    ],
  }],
}

describe('F5.2 NOT YET IMPLEMENTED — question render/answer', { skip: IMPL }, () => {
  test('src/opencode/questionFormat.ts missing', () => {
    assert.fail(
      'Create src/opencode/questionFormat.ts exporting renderQuestion(req) and ' +
      'answerForIndex(req, idx). Wire GET /question polling (client.listQuestions) + ' +
      'fix replyQuestion to POST { answers: string[][] } of option labels.'
    )
  })
})

describe('F5.2 question render + answer contract', { skip: !IMPL }, () => {
  test('renderQuestion: header + question text + one button per option + dismiss', () => {
    const r = mod.renderQuestion(req)
    assert.match(r.text, /Pick one/)
    assert.match(r.text, /Which package manager\?/)
    // 2 option rows + 1 dismiss row
    assert.equal(r.inlineKeyboard.length, 3)
    assert.equal(r.inlineKeyboard[0][0].text, 'npm')
    assert.equal(r.inlineKeyboard[0][0].callback_data, 'q:que_1:0')
    assert.equal(r.inlineKeyboard[1][0].text, 'pnpm')
    assert.equal(r.inlineKeyboard[1][0].callback_data, 'q:que_1:1')
    assert.equal(r.inlineKeyboard[2][0].callback_data, 'q:reject:que_1')
  })

  test('renderQuestion: option buttons show LABEL text (not [object Object])', () => {
    const r = mod.renderQuestion(req)
    for (const row of r.inlineKeyboard) {
      assert.ok(!row[0].text.includes('[object'), 'button label must be the option label string')
    }
  })

  test('answerForIndex: maps index -> { label, answers: [[label]] }', () => {
    assert.deepEqual(mod.answerForIndex(req, 0), { label: 'npm', answers: [['npm']] })
    assert.deepEqual(mod.answerForIndex(req, 1), { label: 'pnpm', answers: [['pnpm']] })
  })

  test('answerForIndex: out-of-range index -> undefined', () => {
    assert.equal(mod.answerForIndex(req, 9), undefined)
  })

  test('renderQuestion: free-form question (no options) asks for text reply', () => {
    const free = { id: 'que_2', sessionID: 'ses', questions: [{ question: 'Name?', header: 'Input', options: [] }] }
    const r = mod.renderQuestion(free)
    assert.match(r.text, /Reply to this message/)
    // only the dismiss row
    assert.equal(r.inlineKeyboard.length, 1)
    assert.equal(r.inlineKeyboard[0][0].callback_data, 'q:reject:que_2')
  })

  test('renderQuestion: multi-question request notes the extras', () => {
    const multi = { id: 'que_3', sessionID: 'ses', questions: [req.questions[0], req.questions[0]] }
    const r = mod.renderQuestion(multi)
    assert.match(r.text, /\+1 more/)
  })
})
