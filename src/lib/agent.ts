// The payment agent: turns casual text into intents, then executes them step by step while
// streaming what it "sees" (a live browser screen) to the UI. `interpret` is deterministic so the
// demo works offline; it is the single seam to swap for an LLM planner.

import { BILLERS, MOBILE_OPERATORS, type Biller } from './catalog'
import { searchSwoop, type SwoopOffer } from './swoop'
import {
  ISSUERS, active, cardShort, fmt, fmtShort, planSplit, totalGel,
  type Card, type Issuer, type SplitLeg,
} from './wallet'

export type Phase = 'idle' | 'listening' | 'thinking' | 'paying' | 'done' | 'error'

export type Intent =
  | { kind: 'bills'; billers: Biller[]; all: boolean; payWith?: string }
  | { kind: 'voucher'; activity: string; venue?: string; qty: number; payWith?: string }
  | { kind: 'topup'; operator: string; amount: number; phone: string; payWith?: string }
  | { kind: 'transfer'; to: string; amount: number; payWith?: string }
  | { kind: 'prefer'; cardId: string }
  | { kind: 'pause'; cardId: string; paused: boolean }
  | { kind: 'add-card'; issuer: Issuer; amount: number }
  | { kind: 'remove-card'; cardId: string }
  | { kind: 'balance' }
  | { kind: 'vouchers' }
  | { kind: 'history' }
  | { kind: 'unknown' }

export interface ReceiptLine { label: string; qty: number; unit: number }

export interface Receipt {
  ref: string
  merchant: string
  domain: string
  url?: string
  image?: string
  lines: ReceiptLine[]
  total: number
  legs: SplitLeg[]
  cards: Card[] // snapshot so the receipt still renders if a card is later removed
  codes?: { code: string; label: string }[]
  at: number
}

export type Screen = { site: string; url: string } & (
  | { view: 'search'; query: string }
  | { view: 'results'; term: string; results: SwoopOffer[]; pick?: SwoopOffer['id']; live: boolean }
  | { view: 'offer'; offer: SwoopOffer; qty: number }
  | { view: 'lookup'; provider: string; account: string }
  | { view: 'bill'; provider: string; account: string; amount: number; period: string }
  | { view: 'form'; title: string; fields: [string, string][] }
  | { view: 'checkout'; merchant: string; total: number; legs: SplitLeg[]; cards: Card[]; stage: 'review' | 'authorizing' | 'paid' | 'declined' }
  | { view: 'done'; merchant: string; total: number; codes?: Receipt['codes'] }
)

export type AgentEvent =
  | { type: 'phase'; phase: Phase }
  | { type: 'step'; id: string; label: string; detail?: string; status: 'active' | 'done' | 'failed' }
  | { type: 'screen'; screen: Screen | null }
  | { type: 'say'; text: string }
  | { type: 'receipt'; receipt: Receipt; paidBillIds?: string[] }
  | { type: 'wallet'; cards: Card[] }

export interface PastOp { label: string; receipt?: Receipt; at: number }

export interface AgentContext {
  cards: Card[]
  paidBills: string[]
  history: PastOp[]
}

// ---------- language ----------

const NUM_WORDS: Record<string, number> = {
  one: 1, single: 1, two: 2, couple: 2, pair: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, ორი: 2, სამი: 3, ერთი: 1,
}

function lev(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

const tokenize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}.,₾$ ]+/gu, ' ').split(/\s+/).filter(Boolean)

/** Fuzzy word match tolerant of casual typos ("twoo", "skatting"). */
function like(token: string, word: string) {
  if (token === word || token.startsWith(word) || (word.length > 4 && word.startsWith(token) && token.length >= 4)) return true
  return token.length >= 4 && word.length >= 4 && lev(token, word) <= (word.length > 6 ? 2 : 1)
}

const hits = (tokens: string[], raw: string, keywords: string[]) =>
  keywords.filter((k) => (/[^\p{ASCII}]/u.test(k) ? raw.includes(k) : tokens.some((t) => like(t, k)))).length

function parseQty(tokens: string[]): number {
  for (const t of tokens) {
    const m = t.match(/^(?:x)?(\d{1,2})(?:x)?$/)
    if (m && +m[1] > 0 && +m[1] < 50) return +m[1]
  }
  for (const t of tokens) {
    if (t in NUM_WORDS) return NUM_WORDS[t]
    const w = Object.keys(NUM_WORDS).find((k) => k.length >= 3 && t.length >= 4 && lev(t, k) === 1)
    if (w) return NUM_WORDS[w]
  }
  return 1
}

function parseAmount(raw: string): number | null {
  const s = raw.toLowerCase()
  const m =
    s.match(/(?:₾|gel|lari)\s*(\d+(?:[.,]\d{1,2})?)/) ??
    s.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:₾|gel|lari|lar|ლარ|\$|usd|usdt|dollars?)/) ??
    s.match(/(?:for|with|of)\s+(\d+(?:[.,]\d{1,2})?)\b/)
  return m ? Math.round(parseFloat(m[1].replace(',', '.')) * 100) : null
}

const CARD_WORDS: [Issuer, RegExp][] = [
  ['BOG', /\b(bog|bank of georgia|georgian bank|საქართველოს ბანკ)/i],
  ['TBC', /\b(tbc|თიბისი)/i],
  ['LIBERTY', /\bliberty/i],
  ['CREDO', /\bcredo/i],
  ['SOLANA', /\b(solana|sol|phantom)\b/i],
  ['CRYPTO', /\b(usdt|tether|crypto)/i],
]

function findCard(text: string, cards: Card[]): Card | undefined {
  for (const [issuer, re] of CARD_WORDS) {
    if (!re.test(text)) continue
    return cards.find((c) => c.issuer === issuer) ?? (issuer === 'CRYPTO' ? cards.find((c) => c.issuer === 'SOLANA') : undefined)
  }
}

/** "pay gas from TBC", "use solana for this" → card for this payment only. */
function payWith(text: string, cards: Card[]) {
  const m = text.match(/\b(?:from|with|using|via|by|on)\s+(?:my\s+)?([\p{L}\s]{2,30})$/iu) ?? text.match(/\b(?:from|with|using|via)\s+(?:my\s+)?(\p{L}+)/iu)
  return m ? findCard(m[1], cards)?.id : undefined
}

const ACTIVITY_WORDS = ['ice', 'skating', 'skate', 'bowling', 'cinema', 'movie', 'spa', 'sauna', 'massage', 'pool', 'swimming', 'pizza', 'sushi', 'burger', 'paintball', 'karting', 'kart', 'quest', 'yoga', 'hotel', 'horse', 'escape', 'gym', 'fitness', 'dinner']
const FILLER = new Set(['buy', 'me', 'get', 'write', 'purchase', 'order', 'book', 'grab', 'voucher', 'vouchers', 'ticket', 'tickets', 'coupon', 'coupons', 'from', 'on', 'at', 'in', 'the', 'a', 'an', 'for', 'of', 'swoop', 'swoop.ge', 'website', 'site', 'web', 'please', 'pls', 'some', 'my', 'us', 'and', 'with', 'to', 'session', 'sessions', 'deal', 'deals', 'offer', 'offers'])

const COMMON = new Set(['please', 'would', 'like', 'want', 'need', 'could', 'your', 'some', 'this', 'that', 'them', 'they', 'there', 'here', 'also', 'just', 'really', 'today', 'tomorrow', 'tonight', 'now', 'right', 'away', 'quickly', 'cheap', 'cheapest', 'best', 'good', 'nice', 'friends', 'friend', 'family', 'kids', 'people', 'persons', 'person', 'twice', 'about', 'something'])

function parseVoucher(text: string) {
  const tokens = tokenize(text).filter((t) => !(t in NUM_WORDS) && !/^\d+x?$/.test(t) && !Object.keys(NUM_WORDS).some((k) => k.length >= 3 && t.length >= 4 && lev(t, k) === 1))
  const activity = tokens.filter((t) => ACTIVITY_WORDS.some((a) => like(t, a)))
  // a venue is whatever distinctive words are left ("Leadersport Arena"), never short filler like "do", "out"
  const rest = tokens
    .map((t) => t.replace(/[.,]+$/, ''))
    .filter((t) => t.length >= 4 && !FILLER.has(t) && !COMMON.has(t) && !activity.includes(t) && !CARD_WORDS.some(([, re]) => re.test(t)))
  if (activity.length) return { activity: activity.join(' '), venue: rest.length ? rest.join(' ') : undefined }
  return { activity: rest.join(' '), venue: undefined }
}

export function interpret(text: string, cards: Card[] = []): Intent {
  const raw = text.toLowerCase()
  const tokens = tokenize(text)
  const has = (...words: string[]) => hits(tokens, raw, words) > 0
  const card = findCard(text, cards)

  // --- wallet control, all by voice/text ---
  if (card && /\b(main|primary|first|default|priority|top)\b/.test(raw) && !has('pay', 'buy'))
    return { kind: 'prefer', cardId: card.id }
  if (card && /\b(don'?t use|do not use|stop using|pause|disable|freeze|exclude|skip)\b/.test(raw)) return { kind: 'pause', cardId: card.id, paused: true }
  if (card && /\b(resume|enable|unfreeze|use .* again|start using|include)\b/.test(raw)) return { kind: 'pause', cardId: card.id, paused: false }
  if (card && /\b(remove|delete|unlink|disconnect)\b/.test(raw)) return { kind: 'remove-card', cardId: card.id }
  if (/\b(add|link|connect)\b/.test(raw) && /\b(card|account|wallet)\b/.test(raw)) {
    const issuer = CARD_WORDS.find(([, re]) => re.test(text))?.[0]
    if (issuer) return { kind: 'add-card', issuer, amount: parseAmount(text) ?? 5000 }
  }
  if (has('vouchers', 'codes', 'tickets') && /\b(my|show|list|where)\b/.test(raw) && !has('buy', 'get', 'order', 'write')) return { kind: 'vouchers' }
  if (/\b(history|spent|spend|transactions|what did i (pay|buy))\b/.test(raw)) return { kind: 'history' }
  if ((has('balance') || /\bhow much (money )?(do i have|is left|left)\b/.test(raw)) && !has('pay', 'buy')) return { kind: 'balance' }

  const via = payWith(text, cards)

  // --- payments ---
  if (has('top', 'topup', 'recharge', 'refill', 'შევსებ') || (has('mobile', 'phone') && has('add', 'put'))) {
    const op = MOBILE_OPERATORS.find((o) => hits(tokens, raw, o.keywords)) ?? MOBILE_OPERATORS[0]
    const phone = raw.match(/5\d{2}[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{2}/)?.[0]?.replace(/\D/g, '') ?? '599123456'
    return { kind: 'topup', operator: op.name, amount: parseAmount(text) ?? 1000, phone, payWith: via }
  }

  const to = text.match(/\b(?:send|transfer|give)\b.*?\bto\s+([\p{Lu}\p{L}][\p{L}'-]+)/iu)
  if (to && parseAmount(text)) return { kind: 'transfer', to: to[1][0].toUpperCase() + to[1].slice(1), amount: parseAmount(text)!, payWith: via }

  const billers = BILLERS.filter((b) => hits(tokens, raw, b.keywords))
  if (has('all', 'every', 'everything', 'utilities', 'ყველა') && has('bill', 'bills', 'utilities', 'ქვითარ'))
    return { kind: 'bills', billers: BILLERS, all: true, payWith: via }
  if (billers.length && !has('swoop', 'voucher')) return { kind: 'bills', billers, all: false, payWith: via }

  const shop = has('swoop', 'voucher', 'ticket', 'coupon', 'buy', 'book', 'write', 'order', 'purchase', 'ვაუჩერ', 'იყიდე')
  const activityHit = tokens.some((t) => ACTIVITY_WORDS.some((a) => like(t, a)))
  if (shop || activityHit) {
    const { activity, venue } = parseVoucher(text)
    if (activity || venue) return { kind: 'voucher', activity: activity || venue!, venue: activity ? venue : undefined, qty: parseQty(tokens), payWith: via }
  }
  return { kind: 'unknown' }
}

/** Split one message into separate operations: "buy ice skating vouchers, pay water bill and gas bill". */
export function splitTasks(text: string, cards: Card[] = []): string[] {
  const parts = text
    .split(/\s*(?:,(?!\d)|;|\n|\+|&|\band then\b|\bthen\b|\balso\b|\band\b|\bდა\b)\s*/i)
    .map((p) => p.trim())
    .filter((p) => p && interpret(p, cards).kind !== 'unknown')
  return parts.length ? parts : [text.trim()]
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** Short name for an operation pill. */
export function describe(text: string, cards: Card[] = []): string {
  const i = interpret(text, cards)
  const c = (id: string) => cards.find((x) => x.id === id)
  const name = (id: string) => (c(id) ? cardShort(c(id)!) : 'card')
  switch (i.kind) {
    case 'voucher': return `${cap(i.activity)}${i.qty > 1 ? ` ×${i.qty}` : ''}`
    case 'bills': return i.all ? 'All bills' : `${i.billers.map((b) => cap(b.kind)).join(' + ')} bill${i.billers.length > 1 ? 's' : ''}`
    case 'topup': return `${i.operator} ${fmtShort(i.amount)}`
    case 'transfer': return `${fmtShort(i.amount)} → ${i.to}`
    case 'prefer': return `${name(i.cardId)} → #1`
    case 'pause': return `${i.paused ? 'Pause' : 'Resume'} ${name(i.cardId)}`
    case 'add-card': return `Link ${ISSUERS[i.issuer].short}`
    case 'remove-card': return `Remove ${name(i.cardId)}`
    case 'balance': return 'Balance'
    case 'vouchers': return 'My vouchers'
    case 'history': return 'History'
    default: return 'Request'
  }
}

/** Requests that only answer a question; they don't stay around the heart afterwards. */
export const isQuery = (text: string, cards: Card[]) => ['balance', 'vouchers', 'history', 'unknown'].includes(interpret(text, cards).kind)

// ---------- execution ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const rid = (n: number) => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')
const month = () => new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })

function describeLegs(cards: Card[], legs: SplitLeg[]) {
  return legs
    .map((l) => {
      const c = cards.find((x) => x.id === l.cardId)!
      const native = c.currency === 'GEL' ? '' : ` (${fmt(l.amountNative, c.currency)})`
      return `${cardShort(c)} ${fmtShort(l.amountGel)}${native}`
    })
    .join(' + ')
}

/** Types text into a field on the live screen, character by character. */
async function* typeInto(text: string, make: (partial: string) => Screen): AsyncGenerator<AgentEvent> {
  for (let i = 1; i <= text.length; i += Math.max(1, Math.round(text.length / 14))) {
    yield { type: 'screen', screen: make(text.slice(0, i)) }
    await sleep(45)
  }
  yield { type: 'screen', screen: make(text) }
}

async function* pay(
  ctx: AgentContext,
  where: { site: string; url: string },
  merchant: string,
  lines: ReceiptLine[],
  opts: {
    preferId?: string
    image?: string
    link?: string
    codes?: () => Receipt['codes']
    paidBillIds?: string[]
    doneText: (legs: string) => string
  },
): AsyncGenerator<AgentEvent> {
  const total = lines.reduce((s, l) => s + l.qty * l.unit, 0)
  const cards = ctx.cards
  const checkout = (stage: 'review' | 'authorizing' | 'paid' | 'declined', legs: SplitLeg[] = []): AgentEvent =>
    ({ type: 'screen', screen: { ...where, url: `${where.site}/checkout`, view: 'checkout', merchant, total, legs, cards, stage } })

  yield { type: 'phase', phase: 'paying' }
  const prefer = cards.find((c) => c.id === opts.preferId)
  yield { type: 'step', id: 'split', label: 'Splitting across your cards', detail: prefer ? `${cardShort(prefer)} first, as you asked` : undefined, status: 'active' }
  yield checkout('review')
  await sleep(700)
  const legs = planSplit(cards, total, opts.preferId)
  if (!legs) {
    const short = total - totalGel(cards)
    yield checkout('declined')
    yield { type: 'step', id: 'split', label: 'Splitting across your cards', detail: `Short by ${fmt(short)}`, status: 'failed' }
    yield { type: 'phase', phase: 'error' }
    yield { type: 'say', text: `I stopped before paying ${merchant}: it costs ${fmt(total)} and your active cards hold ${fmt(totalGel(cards))}. Link or resume a card and ask me again.` }
    return
  }
  const split = describeLegs(cards, legs)
  yield checkout('review', legs)
  yield { type: 'step', id: 'split', label: 'Split across your cards', detail: split, status: 'done' }
  await sleep(900)
  yield { type: 'step', id: 'auth', label: `Authorizing ${fmt(total)}`, status: 'active' }
  yield checkout('authorizing', legs)
  await sleep(1000)
  yield checkout('paid', legs)
  yield {
    type: 'step', id: 'auth', label: `Paid ${fmt(total)} on ${where.site}`,
    detail: legs.length > 1 ? `${legs.length} charges, approved by agent token` : 'Approved by agent token', status: 'done',
  }
  const receipt: Receipt = {
    ref: `AL-${rid(6)}`, merchant, domain: where.site, url: opts.link, image: opts.image, lines, total, legs, cards,
    codes: opts.codes?.(), at: Date.now(),
  }
  yield { type: 'receipt', receipt, paidBillIds: opts.paidBillIds }
  await sleep(600)
  yield { type: 'screen', screen: { ...where, url: `${where.site}/order/${receipt.ref}`, view: 'done', merchant, total, codes: receipt.codes } }
  yield { type: 'phase', phase: 'done' }
  yield { type: 'say', text: opts.doneText(split) }
  await sleep(1400)
}

/** Latin → Georgian transliteration, so "Arena" can match "არენა" in merchant names. */
const KA: Record<string, string> = { a: 'ა', b: 'ბ', g: 'გ', d: 'დ', e: 'ე', v: 'ვ', z: 'ზ', t: 'თ', i: 'ი', k: 'კ', l: 'ლ', m: 'მ', n: 'ნ', o: 'ო', p: 'პ', r: 'რ', s: 'ს', u: 'უ', f: 'ფ', q: 'ქ', h: 'ჰ', c: 'ც', j: 'ჯ', x: 'ხ', y: 'ი', w: 'ვ' }
const toKa = (s: string) => s.toLowerCase().replace(/[a-z]/g, (ch) => KA[ch] ?? '')

// words every venue shares; only the distinctive part of a name ("Leadersport") should decide a match
const GENERIC = new Set(['arena', 'center', 'centre', 'club', 'park', 'hall', 'sport', 'sports', 'complex', 'cafe', 'restaurant', 'tbilisi', 'batumi', 'mall', 'studio', 'hotel'])

function venueMatch(o: SwoopOffer, venue: string) {
  const hay = `${o.merchant} ${o.title}`.toLowerCase()
  const words = venue.split(/\s+/).filter((w) => w.length >= 4 && !GENERIC.has(w))
  return words.length > 0 && words.some((w) => hay.includes(w) || hay.includes(toKa(w).slice(0, 5)))
}

export async function* run(text: string, ctx: AgentContext): AsyncGenerator<AgentEvent> {
  yield { type: 'phase', phase: 'thinking' }
  const intent = interpret(text, ctx.cards)
  const card = (id: string) => ctx.cards.find((c) => c.id === id)!
  await sleep(400)

  switch (intent.kind) {
    case 'balance': {
      const list = active(ctx.cards).map((c) => `${cardShort(c)} ${fmt(c.balance, c.currency)}`).join(', ')
      const paused = ctx.cards.filter((c) => c.paused).map(cardShort)
      yield { type: 'phase', phase: 'done' }
      yield { type: 'say', text: `You have ${fmt(totalGel(ctx.cards))} combined: ${list}.${paused.length ? ` Paused: ${paused.join(', ')}.` : ''}` }
      return
    }

    case 'history': {
      const paid = ctx.history.filter((h) => h.receipt)
      const sum = paid.reduce((s, h) => s + h.receipt!.total, 0)
      yield { type: 'phase', phase: 'done' }
      yield {
        type: 'say',
        text: paid.length
          ? `You've made ${paid.length} payment${paid.length > 1 ? 's' : ''} for ${fmt(sum)} in total: ${paid.slice(-5).map((h) => `${h.label} ${fmtShort(h.receipt!.total)}`).join(', ')}. Tap any operation around me for the receipt.`
          : "You haven't paid anything with me yet.",
      }
      return
    }

    case 'vouchers': {
      const codes = ctx.history.flatMap((h) => (h.receipt?.codes ?? []).map((c) => `${c.code} (${h.label})`))
      yield { type: 'phase', phase: 'done' }
      yield { type: 'say', text: codes.length ? `Your vouchers: ${codes.join(', ')}. Tap the operation around me to see the QR codes.` : "You don't have any vouchers yet. Ask me to buy one on Swoop." }
      return
    }

    case 'unknown': {
      yield { type: 'phase', phase: 'idle' }
      yield { type: 'say', text: 'I can buy vouchers on Swoop, pay bills, top up phones, send money and manage your cards. For example: "buy two ice skating vouchers on Swoop and pay my water bill".' }
      return
    }

    case 'prefer': {
      const c = card(intent.cardId)
      const cards = [c, ...ctx.cards.filter((x) => x.id !== c.id)]
      yield { type: 'step', id: 'w', label: 'Updated payment order', detail: cards.map(cardShort).join(' → '), status: 'done' }
      yield { type: 'wallet', cards }
      yield { type: 'phase', phase: 'done' }
      yield { type: 'say', text: `${ISSUERS[c.issuer].label} is now your main card. Payments draw from it first: ${cards.map(cardShort).join(' → ')}.` }
      await sleep(1200)
      return
    }

    case 'pause': {
      const c = card(intent.cardId)
      const cards = ctx.cards.map((x) => (x.id === c.id ? { ...x, paused: intent.paused } : x))
      yield { type: 'step', id: 'w', label: `${intent.paused ? 'Paused' : 'Resumed'} ${cardShort(c)}`, status: 'done' }
      yield { type: 'wallet', cards }
      yield { type: 'phase', phase: 'done' }
      yield { type: 'say', text: intent.paused ? `I won't use ${cardShort(c)} until you tell me to. Combined balance is now ${fmt(totalGel(cards))}.` : `${cardShort(c)} is back in your combined balance: ${fmt(totalGel(cards))}.` }
      await sleep(1200)
      return
    }

    case 'remove-card': {
      const c = card(intent.cardId)
      const cards = ctx.cards.filter((x) => x.id !== c.id)
      yield { type: 'step', id: 'w', label: `Unlinked ${cardShort(c)} •${c.last4}`, status: 'done' }
      yield { type: 'wallet', cards }
      yield { type: 'phase', phase: 'done' }
      yield { type: 'say', text: `${ISSUERS[c.issuer].label} is unlinked. Combined balance: ${fmt(totalGel(cards))}.` }
      await sleep(1200)
      return
    }

    case 'add-card': {
      const meta = ISSUERS[intent.issuer]
      yield { type: 'step', id: 'w', label: `Linking ${meta.label}`, detail: 'Open banking consent', status: 'active' }
      await sleep(1100)
      const c: Card = {
        id: `c-${Date.now()}`, issuer: intent.issuer, name: `${meta.short} ${meta.currency === 'GEL' ? 'Card' : 'Wallet'}`,
        last4: String(Math.floor(1000 + Math.random() * 9000)), currency: meta.currency, balance: intent.amount, // amount is said in the card's own currency
      }
      const cards = [...ctx.cards, c]
      yield { type: 'step', id: 'w', label: `Linked ${meta.label}`, detail: `${fmt(c.balance, c.currency)} added to your balance`, status: 'done' }
      yield { type: 'wallet', cards }
      yield { type: 'phase', phase: 'done' }
      yield { type: 'say', text: `${meta.label} is linked with ${fmt(c.balance, c.currency)}. Combined balance: ${fmt(totalGel(cards))}.` }
      await sleep(1200)
      return
    }

    case 'voucher': {
      const { activity, venue, qty } = intent
      const site = { site: 'swoop.ge', url: 'swoop.ge' }
      yield { type: 'step', id: 'parse', label: 'Understood', detail: `${qty} × ${activity}${venue ? ` · ${cap(venue)}` : ''}`, status: 'done' }
      yield { type: 'step', id: 'search', label: 'Opening swoop.ge', status: 'active' }
      const found = searchSwoop(activity) // network runs while we "type"
      yield* typeInto(activity, (q) => ({ ...site, url: `swoop.ge/search?keyword=${q}`, view: 'search', query: q }))
      const { term, offers, live } = await found
      if (!offers.length) {
        yield { type: 'step', id: 'search', label: `Searched swoop.ge for "${activity}"`, detail: 'No offers found', status: 'failed' }
        yield { type: 'phase', phase: 'error' }
        yield { type: 'say', text: `Swoop has no "${activity}" offers right now, so I didn't buy anything.` }
        return
      }
      const results = offers.slice(0, 8)
      yield { type: 'screen', screen: { ...site, url: `swoop.ge/search?keyword=${term}`, view: 'results', term, results, live } }
      yield { type: 'step', id: 'search', label: `Found ${offers.length} ${live ? 'live ' : ''}offers on swoop.ge`, detail: `Search: "${term}"`, status: 'done' }
      await sleep(1100)

      // venue first, then the cheapest single entry
      const atVenue = venue ? results.filter((o) => venueMatch(o, venue)) : []
      const pool = atVenue.length ? atVenue : results
      const pick = [...pool].sort((a, b) => a.price - b.price)[0]
      yield { type: 'screen', screen: { ...site, url: `swoop.ge/search?keyword=${term}`, view: 'results', term, results, pick: pick.id, live } }
      const swapped = venue && !atVenue.length
      yield {
        type: 'step', id: 'pick', label: `Chose ${pick.merchant || 'offer'}`,
        detail: `${fmtShort(pick.price)} each${pick.discount ? ` (−${pick.discount}%)` : ''}${swapped ? ` · ${cap(venue!)} isn't listed, closest match` : ''}`, status: 'done',
      }
      await sleep(1000)

      const offerUrl = pick.url.replace('https://', '')
      for (let q = 1; q <= qty; q++) {
        yield { type: 'screen', screen: { ...site, url: offerUrl, view: 'offer', offer: pick, qty: q } }
        await sleep(q === 1 ? 900 : 380)
      }
      yield { type: 'step', id: 'cart', label: `Added ${qty} voucher${qty > 1 ? 's' : ''} to cart`, detail: `Total ${fmt(pick.price * qty)}`, status: 'done' }
      await sleep(500)

      yield* pay(ctx, site, `Swoop · ${pick.merchant || cap(activity)}`, [{ label: pick.title, qty, unit: pick.price }], {
        preferId: intent.payWith,
        image: pick.image,
        link: pick.url,
        codes: () => Array.from({ length: qty }, (_, i) => ({ code: `SWP-${rid(4)}-${rid(4)}`, label: `Voucher ${i + 1} of ${qty}` })),
        doneText: (split) =>
          `Bought ${qty} ${activity} voucher${qty > 1 ? 's' : ''} at ${pick.merchant || 'Swoop'} for ${fmt(pick.price * qty)}, paid as ${split}.${swapped ? ` ${cap(venue!)} has no Swoop listing today, so I chose the closest match.` : ''} Codes are in the receipt.`,
      })
      return
    }

    case 'bills': {
      const due = intent.billers.filter((b) => !ctx.paidBills.includes(b.id))
      const label = intent.all ? 'all utility bills' : intent.billers.map((b) => `${b.kind} bill`).join(', ')
      yield { type: 'step', id: 'parse', label: 'Understood', detail: `Pay ${label} · ${month()}`, status: 'done' }
      for (const b of intent.billers) {
        yield { type: 'step', id: `look-${b.id}`, label: `Checking ${b.domain}`, status: 'active' }
        yield* typeInto(b.account, (a) => ({ site: b.domain, url: `${b.domain}/pay`, view: 'lookup', provider: b.provider, account: a }))
        await sleep(500)
        const paid = !due.includes(b)
        yield { type: 'screen', screen: { site: b.domain, url: `${b.domain}/pay?account=${b.account}`, view: 'bill', provider: b.provider, account: b.account, amount: paid ? 0 : b.amount, period: month() } }
        yield { type: 'step', id: `look-${b.id}`, label: `${b.provider.split(' · ')[0]}`, detail: paid ? 'Already paid this month' : `${fmt(b.amount)} due`, status: 'done' }
        await sleep(800)
      }
      if (!due.length) {
        yield { type: 'phase', phase: 'done' }
        yield { type: 'say', text: `Nothing to pay: your ${label} for ${month()} ${intent.billers.length > 1 ? 'are' : 'is'} already paid.` }
        await sleep(1200)
        return
      }
      const one = due.length === 1 ? due[0] : null
      yield* pay(ctx, one ? { site: one.domain, url: one.domain } : { site: 'alde.pay', url: 'alde.pay/bills' }, one ? one.provider : `${due.length} utility providers`,
        due.map((b) => ({ label: `${b.provider} · acc ${b.account}`, qty: 1, unit: b.amount })), {
          preferId: intent.payWith,
          paidBillIds: due.map((b) => b.id),
          doneText: (split) =>
            one
              ? `Paid your ${one.kind} bill for ${month()}: ${fmt(one.amount)}, as ${split}.`
              : `Paid ${due.length} bills for ${fmt(due.reduce((s, b) => s + b.amount, 0))}, as ${split}.`,
        })
      return
    }

    case 'topup': {
      const p = intent.phone.replace(/(\d{3})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4')
      const site = `${intent.operator.toLowerCase()}.ge`
      yield { type: 'step', id: 'parse', label: 'Understood', detail: `Top up ${intent.operator} +995 ${p} with ${fmtShort(intent.amount)}`, status: 'done' }
      yield* typeInto(p, (v) => ({ site, url: `${site}/topup`, view: 'form', title: `${intent.operator} top-up`, fields: [['Number', `+995 ${v}`], ['Amount', fmt(intent.amount)]] }))
      yield { type: 'step', id: 'verify', label: `Number verified with ${intent.operator}`, status: 'done' }
      await sleep(600)
      yield* pay(ctx, { site, url: site }, `${intent.operator} top-up`, [{ label: `Top-up +995 ${p}`, qty: 1, unit: intent.amount }], {
        preferId: intent.payWith,
        doneText: (split) => `Added ${fmt(intent.amount)} to +995 ${p}, as ${split}.`,
      })
      return
    }

    case 'transfer': {
      const site = 'alde.pay'
      yield { type: 'step', id: 'parse', label: 'Understood', detail: `Send ${fmtShort(intent.amount)} to ${intent.to}`, status: 'done' }
      yield* typeInto(intent.to, (v) => ({ site, url: `${site}/send`, view: 'form', title: 'Instant transfer', fields: [['To', v], ['IBAN', 'GE29 TB00 •••• 4410'], ['Amount', fmt(intent.amount)]] }))
      yield { type: 'step', id: 'contact', label: `Found ${intent.to} in contacts`, detail: 'GE29 TB00 •••• 4410', status: 'done' }
      await sleep(600)
      yield* pay(ctx, { site, url: site }, `Transfer to ${intent.to}`, [{ label: `To ${intent.to}`, qty: 1, unit: intent.amount }], {
        preferId: intent.payWith,
        doneText: (split) => `Sent ${fmt(intent.amount)} to ${intent.to}, as ${split}. It arrives instantly.`,
      })
      return
    }
  }
}

