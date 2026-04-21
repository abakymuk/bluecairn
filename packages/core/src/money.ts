/**
 * Money is represented as integer cents (bigint) throughout the codebase.
 * See DATA-MODEL.md § Design principles #3 and ARCHITECTURE.md.
 *
 * Never use `number` for money. Never use `numeric` or `decimal` strings.
 * All arithmetic happens in cents; conversion to dollars is presentation-only.
 */

declare const MoneyBrand: unique symbol
export type Money = bigint & { readonly [MoneyBrand]: never }

export const Money = (cents: bigint | number): Money => {
  const n = typeof cents === 'number' ? BigInt(Math.round(cents)) : cents
  if (n < 0n) throw new Error(`Money cannot be negative: got ${n}`)
  return n as Money
}

export const centsToDollars = (cents: Money): number => {
  return Number(cents) / 100
}

export const dollarsToCents = (dollars: number): Money => {
  if (!Number.isFinite(dollars)) throw new Error(`Invalid dollar amount: ${dollars}`)
  return Money(BigInt(Math.round(dollars * 100)))
}

export const formatMoney = (cents: Money, currency = 'USD'): string => {
  const dollars = centsToDollars(cents)
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(dollars)
}

export const addMoney = (a: Money, b: Money): Money => Money(a + b)
export const subMoney = (a: Money, b: Money): Money => {
  if (a < b) throw new Error(`Money underflow: ${a} - ${b}`)
  return Money(a - b)
}
