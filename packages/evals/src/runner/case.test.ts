import { describe, expect, test } from 'vitest'
import { parseJsonl } from './case.js'

describe('parseJsonl', () => {
  test('parses a valid 2-case JSONL', () => {
    const raw = [
      JSON.stringify({
        id: 'ok-1',
        input: 'hi',
        expected: { contains: ['hello'] },
      }),
      JSON.stringify({
        id: 'ok-2',
        input: 'bye',
        expected: { forbidden: ['hi'], ends_with_signoff: true },
      }),
    ].join('\n')
    const cases = parseJsonl(raw, 'test')
    expect(cases).toHaveLength(2)
    expect(cases[0]?.id).toBe('ok-1')
  })

  test('skips blank lines and trims whitespace', () => {
    const raw = `\n\n${JSON.stringify({ id: 'a', input: '', expected: {} })}\n  \n`
    const cases = parseJsonl(raw, 'test')
    expect(cases).toHaveLength(1)
    expect(cases[0]?.id).toBe('a')
  })

  test('throws on malformed JSON with file:line context', () => {
    const raw = `{"id":"a","input":"x","expected":{}}\nnot-json`
    expect(() => parseJsonl(raw, 'concierge/unit')).toThrow(/concierge\/unit:2/)
  })

  test('rejects unknown assertion keys (strict mode)', () => {
    const raw = JSON.stringify({
      id: 'typo',
      input: '',
      expected: { foribdden: ['x'] },
    })
    expect(() => parseJsonl(raw, 'concierge/unit')).toThrow(/schema error/)
  })

  test('rejects missing id', () => {
    const raw = JSON.stringify({ input: 'x', expected: {} })
    expect(() => parseJsonl(raw, 'f')).toThrow()
  })

  test('rejects non-positive max_sentences', () => {
    const raw = JSON.stringify({
      id: 'x',
      input: '',
      expected: { max_sentences: 0 },
    })
    expect(() => parseJsonl(raw, 'f')).toThrow()
  })
})
