// Mock merchant network the agent can operate on (stand-ins for real biller / Swoop integrations).

export interface Biller {
  id: string
  kind: 'water' | 'electricity' | 'gas' | 'internet' | 'mobile' | 'trash'
  provider: string
  domain: string
  account: string
  amount: number // GEL minor units for the current month
  keywords: string[]
}

export const BILLERS: Biller[] = [
  { id: 'gwp', kind: 'water', provider: 'GWP · Georgian Water & Power', domain: 'gwp.ge', account: '1029-4471', amount: 1480, keywords: ['water', 'gwp', 'წყალ', 'вода'] },
  { id: 'telasi', kind: 'electricity', provider: 'Telasi', domain: 'telasi.ge', account: '6630-218', amount: 4235, keywords: ['electric', 'electricity', 'telasi', 'დენ', 'свет'] },
  { id: 'tbe', kind: 'gas', provider: 'Tbilisi Energy', domain: 'te.ge', account: 'TE-882014', amount: 2790, keywords: ['gas', 'heating', 'გაზ', 'газ'] },
  { id: 'magti', kind: 'internet', provider: 'Magti Fiber', domain: 'magticom.ge', account: 'MF-551203', amount: 3500, keywords: ['internet', 'wifi', 'fiber', 'magti', 'ინტერნეტ'] },
  { id: 'cleaning', kind: 'trash', provider: 'Tbilservice Group', domain: 'tbilservice.ge', account: 'TS-77310', amount: 450, keywords: ['trash', 'garbage', 'cleaning', 'დასუფთავ'] },
]

export interface Offer {
  id: string
  title: string
  venue: string
  price: number // per voucher, GEL minor units
  oldPrice: number
  keywords: string[]
  emoji: string
}

export const SWOOP_OFFERS: Offer[] = [
  { id: 'sw-ice', title: 'Ice skating · 1 session + skate rental', venue: 'Leadersport Arena', price: 1200, oldPrice: 2000, keywords: ['ice', 'skating', 'skate', 'leadersport', 'leader', 'arena', 'ციგურ'], emoji: '⛸' },
  { id: 'sw-bowling', title: 'Bowling · 1 hour lane', venue: 'Leadersport Arena', price: 2500, oldPrice: 4000, keywords: ['bowling', 'leadersport'], emoji: '🎳' },
  { id: 'sw-cinema', title: 'Cinema ticket · any 2D session', venue: 'Cavea East Point', price: 900, oldPrice: 1400, keywords: ['cinema', 'movie', 'film', 'cavea', 'კინო'], emoji: '🎬' },
  { id: 'sw-spa', title: 'Spa day · pool + sauna', venue: 'Biltmore Wellness', price: 6900, oldPrice: 12000, keywords: ['spa', 'sauna', 'pool', 'massage', 'wellness'], emoji: '🧖' },
  { id: 'sw-paint', title: 'Paintball · 300 balls', venue: 'Paintball Club Tbilisi', price: 1900, oldPrice: 3500, keywords: ['paintball'], emoji: '🎯' },
  { id: 'sw-pizza', title: 'Large pizza + drink', venue: 'Pizza Hut Vake', price: 1500, oldPrice: 2600, keywords: ['pizza', 'food', 'dinner', 'lunch'], emoji: '🍕' },
  { id: 'sw-karting', title: 'Karting · 10 minutes', venue: 'Kartodrome Tbilisi', price: 3000, oldPrice: 4500, keywords: ['kart', 'karting', 'race', 'racing'], emoji: '🏎' },
]

export const MOBILE_OPERATORS = [
  { id: 'magti-m', name: 'Magti', keywords: ['magti'] },
  { id: 'silknet', name: 'Silknet', keywords: ['silknet', 'geocell'] },
  { id: 'beeline', name: 'Cellfie', keywords: ['cellfie', 'beeline'] },
]
