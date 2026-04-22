import { describe, expect, test } from 'vitest'
import {
  formatCostCents,
  formatLatencyMs,
  formatRelativeTime,
  formatStakesCents,
  formatTokens,
} from './format'

describe('formatCostCents', () => {
  test('positive integer cents', () => {
    expect(formatCostCents(1234)).toBe('$12.34')
  })
  test('zero cents renders $0.00 (Haiku-class loses sub-cent precision — UI adds Langfuse hint)', () => {
    expect(formatCostCents(0)).toBe('$0.00')
  })
  test('null → em dash', () => {
    expect(formatCostCents(null)).toBe('—')
    expect(formatCostCents(undefined)).toBe('—')
  })
  test('NaN → em dash', () => {
    expect(formatCostCents(Number.NaN)).toBe('—')
  })
})

describe('formatStakesCents (bigint-safe)', () => {
  test('small bigint → $X.XX', () => {
    expect(formatStakesCents(50_000n)).toBe('$500.00')
  })
  test('accepts number', () => {
    expect(formatStakesCents(2500)).toBe('$25.00')
  })
  test('null → em dash', () => {
    expect(formatStakesCents(null)).toBe('—')
  })
  test('beyond MAX_SAFE_INTEGER renders >$cap not silently truncates', () => {
    const overflow = BigInt(Number.MAX_SAFE_INTEGER) + 1n
    expect(formatStakesCents(overflow)).toMatch(/^>/)
  })
  test('negative bigint within safe range', () => {
    expect(formatStakesCents(-12345n)).toBe('-$123.45')
  })
})

describe('formatLatencyMs', () => {
  test('sub-second → ms', () => {
    expect(formatLatencyMs(245)).toBe('245ms')
  })
  test('rounds fractional ms', () => {
    expect(formatLatencyMs(245.7)).toBe('246ms')
  })
  test('seconds', () => {
    expect(formatLatencyMs(1234)).toBe('1.2s')
  })
  test('minute + seconds', () => {
    expect(formatLatencyMs(75_000)).toBe('1m15s')
  })
  test('exact minute → Xm', () => {
    expect(formatLatencyMs(60_000)).toBe('1m')
  })
  test('null → em dash', () => {
    expect(formatLatencyMs(null)).toBe('—')
  })
})

describe('formatRelativeTime', () => {
  const now = new Date('2026-04-22T04:00:00Z')

  test('just now (seconds)', () => {
    expect(formatRelativeTime(new Date('2026-04-22T03:59:30Z'), now)).toMatch(/30.*ago|now/i)
  })
  test('minutes ago', () => {
    expect(formatRelativeTime(new Date('2026-04-22T03:45:00Z'), now)).toMatch(/15.*minute.*ago/i)
  })
  test('hours ago', () => {
    expect(formatRelativeTime(new Date('2026-04-22T01:00:00Z'), now)).toMatch(/3.*hour.*ago/i)
  })
  test('yesterday', () => {
    // Intl.RelativeTimeFormat with numeric='auto' produces "yesterday" for -1 day
    expect(formatRelativeTime(new Date('2026-04-21T04:00:00Z'), now)).toMatch(/yesterday|day/i)
  })
  test('older than a week → absolute ISO', () => {
    const value = new Date('2026-04-10T12:34:56Z')
    expect(formatRelativeTime(value, now)).toBe('2026-04-10 12:34')
  })
  test('null → em dash', () => {
    expect(formatRelativeTime(null, now)).toBe('—')
  })
  test('invalid date → em dash', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('—')
  })
})

describe('formatTokens', () => {
  test('both populated', () => {
    expect(formatTokens(60, 22)).toBe('60 in · 22 out')
  })
  test('thousands formatting', () => {
    expect(formatTokens(1234, 567)).toBe('1,234 in · 567 out')
  })
  test('missing output renders as ?', () => {
    expect(formatTokens(60, null)).toBe('60 in · ? out')
  })
  test('both null → em dash', () => {
    expect(formatTokens(null, null)).toBe('—')
  })
})
