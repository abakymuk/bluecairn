import { describe, expect, test } from 'vitest'
import {
  checkContains,
  checkEndsWithSignoff,
  checkForbidden,
  checkMaxSentences,
  runDeterministicChecks,
} from './assertions.js'

describe('checkContains', () => {
  test('passes when all substrings present', () => {
    const r = checkContains('Got it, Concierge here.', ['Got it', 'Concierge'])
    expect(r.passed).toBe(true)
  })

  test('fails with missing list when at least one is absent', () => {
    const r = checkContains('Got it.', ['Concierge'])
    expect(r.passed).toBe(false)
    expect(r.detail).toContain('Concierge')
  })

  test('case-sensitive', () => {
    const r = checkContains('concierge', ['Concierge'])
    expect(r.passed).toBe(false)
  })
})

describe('checkForbidden', () => {
  test('passes when no forbidden substrings present', () => {
    const r = checkForbidden('no bad words here', ['foo', 'bar'])
    expect(r.passed).toBe(true)
  })

  test('fails when any forbidden substring is present', () => {
    const r = checkForbidden("I'll call the vendor.", ["I'll call", "I've contacted"])
    expect(r.passed).toBe(false)
    expect(r.detail).toContain("I'll call")
  })

  test('case-insensitive', () => {
    const r = checkForbidden('THIS IS FUCK', ['fuck'])
    expect(r.passed).toBe(false)
  })
})

describe('checkEndsWithSignoff', () => {
  test('passes with em-dash signoff', () => {
    const r = checkEndsWithSignoff('Thanks for flagging. — Concierge', 'Concierge')
    expect(r.passed).toBe(true)
  })

  test('passes with trailing whitespace', () => {
    const r = checkEndsWithSignoff('Hello — Concierge\n', 'Concierge')
    expect(r.passed).toBe(true)
  })

  test('fails without signoff', () => {
    const r = checkEndsWithSignoff('Thanks, Concierge', 'Concierge')
    expect(r.passed).toBe(false)
  })

  test('persona-specific', () => {
    const r = checkEndsWithSignoff('Thanks. — Sofia', 'Sofia')
    expect(r.passed).toBe(true)
    const r2 = checkEndsWithSignoff('Thanks. — Sofia', 'Concierge')
    expect(r2.passed).toBe(false)
  })
})

describe('checkMaxSentences', () => {
  test('one-sentence with signoff passes limit 2', () => {
    const r = checkMaxSentences('Got it, thanks for flagging. — Concierge', 2, 'Concierge')
    expect(r.passed).toBe(true)
  })

  test('two-sentence with signoff passes limit 2', () => {
    const r = checkMaxSentences(
      'Got it. A human will look at this shortly. — Concierge',
      2,
      'Concierge',
    )
    expect(r.passed).toBe(true)
  })

  test('three-sentence fails limit 2', () => {
    const r = checkMaxSentences(
      'Got it. Thanks a lot. Someone is on the way. — Concierge',
      2,
      'Concierge',
    )
    expect(r.passed).toBe(false)
    expect(r.detail).toContain('got 3')
  })

  test('ignores signoff line from count', () => {
    // Signoff itself should not count as a sentence.
    const r = checkMaxSentences('One two. — Concierge', 1, 'Concierge')
    expect(r.passed).toBe(true)
  })
})

describe('runDeterministicChecks', () => {
  test('aggregates contains + forbidden + signoff + max_sentences', () => {
    const output = 'Got it, thanks. Someone will look. — Concierge'
    const checks = runDeterministicChecks(
      output,
      {
        contains: ['Concierge'],
        forbidden: ["I'll call"],
        ends_with_signoff: true,
        max_sentences: 2,
      },
      'Concierge',
    )
    expect(checks).toHaveLength(4)
    expect(checks.every((c) => c.passed)).toBe(true)
  })

  test('skips absent assertions', () => {
    const checks = runDeterministicChecks(
      'x',
      { contains: ['x'] },
      'Concierge',
    )
    expect(checks).toHaveLength(1)
    expect(checks[0]?.kind).toBe('contains')
  })
})
