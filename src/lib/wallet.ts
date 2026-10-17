// Unified wallet: several funding accounts behave like one balance.
// All money is kept in integer minor units (tetri / cents) to avoid float drift.

export type Issuer = 'BOG' | 'TBC' | 'LIBERTY' | 'CREDO' | 'CRYPTO' | 'SOLANA'
export type Currency = 'GEL' | 'USDT' | 'USD'

export interface Card {
  id: string
  issuer: Issuer
  name: string
  last4: string
  currency: Currency
  balance: number // minor units in card currency
  paused?: boolean // excluded from the combined balance
}

export interface SplitLeg {
  cardId: string
  amountGel: number // minor units, GEL
  amountNative: number // minor units, card currency
}

export const RATES: Record<Currency, number> = { GEL: 1, USDT: 2.71, USD: 2.71 }

export const ISSUERS: Record<Issuer, { label: string; short: string; color: string; accent: string; currency: Currency }> = {
  BOG: { label: 'Bank of Georgia', short: 'BOG', color: '#ff6a13', accent: '#ffb27a', currency: 'GEL' },
  TBC: { label: 'TBC Bank', short: 'TBC', color: '#00a3e0', accent: '#7fd6ff', currency: 'GEL' },
  LIBERTY: { label: 'Liberty Bank', short: 'Liberty', color: '#e2001a', accent: '#ff8a96', currency: 'GEL' },
  CREDO: { label: 'Credo Bank', short: 'Credo', color: '#7ac143', accent: '#c4ee9f', currency: 'GEL' },
  CRYPTO: { label: 'Crypto · USDT', short: 'USDT', color: '#26a17b', accent: '#9ff0d2', currency: 'USDT' },
  SOLANA: { label: 'Solana wallet', short: 'Solana', color: '#9945ff', accent: '#d2b2ff', currency: 'USD' },
}

export const DEFAULT_CARDS: Card[] = [
  { id: 'c-bog', issuer: 'BOG', name: 'BOG Visa Gold', last4: '4417', currency: 'GEL', balance: 25000 },
  { id: 'c-tbc', issuer: 'TBC', name: 'TBC Mastercard', last4: '9032', currency: 'GEL', balance: 18000 },
  { id: 'c-usdt', issuer: 'CRYPTO', name: 'USDT Card', last4: '0x7F', currency: 'USDT', balance: 15000 },
  { id: 'c-sol', issuer: 'SOLANA', name: 'Solana Account', last4: '9xQe', currency: 'USD', balance: 11100 },
]

export const toGel = (card: Card, minor = card.balance) => Math.floor(minor * RATES[card.currency])
export const fromGel = (card: Card, gelMinor: number) => Math.ceil(gelMinor / RATES[card.currency])

export const active = (cards: Card[]) => cards.filter((c) => !c.paused)
export const totalGel = (cards: Card[]) => active(cards).reduce((s, c) => s + toGel(c), 0)

/**
 * Waterfall split: drain active cards in the user's priority order until the amount is covered.
 * `preferId` moves one card to the front for this payment only. Returns null when funds are short.
 */
export function planSplit(cards: Card[], amountGel: number, preferId?: string): SplitLeg[] | null {
  const order = active(cards).sort((a, b) => (a.id === preferId ? -1 : b.id === preferId ? 1 : 0))
  if (order.reduce((s, c) => s + toGel(c), 0) < amountGel) return null
  const legs: SplitLeg[] = []
  let rest = amountGel
  for (const card of order) {
    if (rest <= 0) break
    const available = toGel(card)
    if (available <= 0) continue
    const take = Math.min(available, rest)
    legs.push({ cardId: card.id, amountGel: take, amountNative: Math.min(card.balance, fromGel(card, take)) })
    rest -= take
  }
  return legs
}

export function applySplit(cards: Card[], legs: SplitLeg[]): Card[] {
  return cards.map((c) => {
    const leg = legs.find((l) => l.cardId === c.id)
    return leg ? { ...c, balance: Math.max(0, c.balance - leg.amountNative) } : c
  })
}

const num = (minor: number, digits = 2) =>
  (minor / 100).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: 2 })

export const fmt = (minor: number, currency: Currency = 'GEL') =>
  currency === 'GEL' ? `₾${num(minor)}` : currency === 'USD' ? `$${num(minor)}` : `${num(minor)} USDT`

export const fmtShort = (minor: number) => `₾${num(minor, minor % 100 ? 2 : 0)}`

export const cardShort = (c: Card) => ISSUERS[c.issuer].short
