// Live Swoop.ge search via its public JSON API (CORS-open), with an offline fallback.

import { SWOOP_OFFERS } from './catalog'

export interface SwoopOffer {
  id: number | string
  title: string
  merchant: string
  address: string
  price: number // GEL minor units, current (discounted) price
  oldPrice: number
  discount: number
  image?: string
  url: string
  sold?: number
}

const API = 'https://api.swoop.ge/api/search'

// English activity → extra search terms that Swoop indexes well (titles are mostly Georgian)
const TERMS: Record<string, string[]> = {
  skating: ['skating', 'ყინულის მოედანი'], ice: ['skating', 'ყინულის მოედანი'], skate: ['skating'],
  bowling: ['bowling', 'ბოულინგი'], cinema: ['კინოთეატრი', 'cinema'], movie: ['კინოთეატრი'],
  spa: ['spa'], sauna: ['საუნა', 'spa'], massage: ['massage', 'მასაჟი'], pool: ['აუზი'], swimming: ['აუზი'],
  pizza: ['pizza', 'პიცა'], sushi: ['სუში'], burger: ['ბურგერი'], paintball: ['პეინტბოლი'],
  karting: ['კარტინგი'], kart: ['კარტინგი'], quest: ['ქვესტი'], yoga: ['იოგა'], hotel: ['სასტუმრო'],
  horse: ['ცხენით'], escape: ['ქვესტი'], gym: ['ფიტნესი'], fitness: ['ფიტნესი'], dinner: ['ვახშამი'],
}

export function searchTerms(activity: string): string[] {
  const words = activity.toLowerCase().split(/\s+/)
  const mapped = words.flatMap((w) => Object.entries(TERMS).find(([k]) => w.startsWith(k))?.[1] ?? [])
  return [...new Set([...mapped, activity])].filter(Boolean)
}

interface RawOffer {
  id: number; name: string; price: number; discount_price: number; discount_percent: string
  image_path?: string; merchant_name?: string; merchant_address?: string; link: string; sold?: number
}

async function query(term: string, signal: AbortSignal): Promise<SwoopOffer[]> {
  const r = await fetch(`${API}?filter%5Bkeyword%5D=${encodeURIComponent(term)}`, { signal })
  if (!r.ok) throw new Error(`swoop ${r.status}`)
  const d = (await r.json()) as { offers?: RawOffer[] }
  return (d.offers ?? []).map((o) => ({
    id: o.id,
    title: o.name.trim(),
    merchant: (o.merchant_name ?? '').trim(),
    address: (o.merchant_address ?? '').trim(),
    price: Math.round((o.discount_price || o.price) * 100),
    oldPrice: Math.round(o.price * 100),
    discount: Number(o.discount_percent) || 0,
    image: o.image_path,
    url: `https://swoop.ge${o.link}`,
    sold: o.sold,
  }))
}

/** Returns live offers for an activity; `live: false` means the network failed and the demo catalog was used. */
export async function searchSwoop(activity: string): Promise<{ term: string; offers: SwoopOffer[]; live: boolean }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  try {
    for (const term of searchTerms(activity)) {
      const offers = await query(term, ctrl.signal)
      if (offers.length) return { term, offers, live: true }
    }
    return { term: activity, offers: [], live: true }
  } catch {
    const words = activity.toLowerCase().split(/\s+/)
    const offers = SWOOP_OFFERS.filter((o) => o.keywords.some((k) => words.some((w) => w.startsWith(k) || k.startsWith(w)))).map((o) => ({
      id: o.id, title: o.title, merchant: o.venue, address: 'Tbilisi', price: o.price, oldPrice: o.oldPrice,
      discount: Math.round((1 - o.price / o.oldPrice) * 100), url: 'https://swoop.ge',
    }))
    return { term: activity, offers, live: false }
  } finally {
    clearTimeout(timer)
  }
}
