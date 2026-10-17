import { motion } from 'framer-motion'
import type { Receipt as R } from '../lib/agent'
import { ISSUERS, cardShort, fmt, fmtShort } from '../lib/wallet'

const Finder = ({ x, y }: { x: number; y: number }) => (
  <g>
    <rect x={x + 0.5} y={y + 0.5} width={6} height={6} fill="none" stroke="currentColor" strokeWidth={1} />
    <rect x={x + 2} y={y + 2} width={3} height={3} />
  </g>
)

/** Decorative QR-style glyph derived from the voucher code. */
function Glyph({ seed }: { seed: string }) {
  const n = 21
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296
  const finder = (x: number, y: number) =>
    [[0, 0], [n - 7, 0], [0, n - 7]].some(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7)
  const cells: React.ReactNode[] = []
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) if (!finder(x, y) && rnd() > 0.52) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />)
  return (
    <svg viewBox={`-1 -1 ${n + 2} ${n + 2}`} className="glyph" fill="currentColor" shapeRendering="crispEdges">
      {cells}
      <Finder x={0} y={0} /><Finder x={n - 7} y={0} /><Finder x={0} y={n - 7} />
    </svg>
  )
}

export default function Receipt({ receipt }: { receipt: R }) {
  const cards = receipt.cards
  const time = new Date(receipt.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return (
    <motion.div className="receipt" initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 24 }}>
      <div className="r-head">
        <div>
          <div className="r-merchant">{receipt.merchant}</div>
          <div className="r-meta">{receipt.domain} · {receipt.ref} · {time}</div>
        </div>
        <div className="r-paid">PAID</div>
      </div>
      {receipt.image && <img className="r-img" src={receipt.image} alt="" />}

      <div className="r-lines">
        {receipt.lines.map((l, i) => (
          <div className="r-line" key={i}>
            <span>{l.qty > 1 ? `${l.qty} × ` : ''}{l.label}</span>
            <span>{fmt(l.qty * l.unit)}</span>
          </div>
        ))}
        <div className="r-line r-total"><span>Total</span><span>{fmt(receipt.total)}</span></div>
      </div>

      <div className="r-split">
        <div className="r-split-label">PAID FROM YOUR COMBINED BALANCE</div>
        <div className="r-bar">
          {receipt.legs.map((l, i) => {
            const c = cards.find((x) => x.id === l.cardId)
            return (
              <motion.i
                key={l.cardId}
                style={{ background: c ? ISSUERS[c.issuer].color : '#888' }}
                initial={{ flexGrow: 0.0001 }}
                animate={{ flexGrow: l.amountGel }}
                transition={{ delay: 0.25 + i * 0.18, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              />
            )
          })}
        </div>
        <div className="r-legs">
          {receipt.legs.map((l) => {
            const c = cards.find((x) => x.id === l.cardId)
            return (
              <span key={l.cardId}>
                <i style={{ background: c ? ISSUERS[c.issuer].color : '#888' }} />
                {c ? cardShort(c) : 'Card'} •{c?.last4} <b>{fmtShort(l.amountGel)}</b>
              </span>
            )
          })}
        </div>
      </div>

      {receipt.url && <a className="r-link" href={receipt.url} target="_blank" rel="noreferrer">Open offer on {receipt.domain} ↗</a>}

      {receipt.codes && (
        <div className="r-codes">
          {receipt.codes.map((v, i) => (
            <motion.div key={v.code} className="voucher" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 + i * 0.12 }}>
              <Glyph seed={v.code} />
              <div>
                <div className="v-label">{v.label}</div>
                <div className="v-code">{v.code}</div>
                <button className="v-copy" onClick={() => navigator.clipboard?.writeText(v.code)}>Copy code</button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  )
}
