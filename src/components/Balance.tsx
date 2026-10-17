import { AnimatePresence, motion, animate, useMotionValue, useTransform } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { ISSUERS, cardShort, fmt, fmtShort, toGel, totalGel, type Card, type SplitLeg } from '../lib/wallet'

interface Props {
  cards: Card[]
  debit: { legs: SplitLeg[]; key: number } | null
  forceOpen: boolean
  onMove: (id: string, dir: -1 | 1) => void
  onRemove: (id: string) => void
  onPause: (id: string) => void
  onAdd: () => void
  onReset: () => void
}

function AnimatedTotal({ value }: { value: number }) {
  const mv = useMotionValue(value)
  const text = useTransform(mv, (v) => fmt(Math.round(v)))
  useEffect(() => {
    const c = animate(mv, value, { duration: 1.1, ease: [0.22, 1, 0.36, 1] })
    return c.stop
  }, [value, mv])
  return <motion.span>{text}</motion.span>
}

export default function Balance({ cards, debit, forceOpen, onMove, onRemove, onPause, onAdd, onReset }: Props) {
  const [hover, setHover] = useState(false)
  const [pinned, setPinned] = useState(false)
  const closeTimer = useRef<number>(0)
  const open = hover || pinned || forceOpen
  const total = totalGel(cards)

  const enter = () => { clearTimeout(closeTimer.current); setHover(true) }
  const leave = () => { closeTimer.current = window.setTimeout(() => setHover(false), 180) }

  return (
    <div className="balance" onMouseEnter={enter} onMouseLeave={leave}>
      <button className={`balance-head ${open ? 'is-open' : ''}`} onClick={() => setPinned((p) => !p)} aria-expanded={open}>
        <span className="balance-label">
          <span className="dot" /> TOTAL BALANCE · {cards.filter((c) => !c.paused).length} ACCOUNTS
        </span>
        <span className="balance-value"><AnimatedTotal value={total} /></span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="cards"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.2, delay: 0.1 } }}
          >
            <div className="cards-hint">PAYMENTS DRAW TOP → BOTTOM</div>
            {cards.map((c, i) => {
              const meta = ISSUERS[c.issuer]
              const leg = debit?.legs.find((l) => l.cardId === c.id)
              const share = total && !c.paused ? toGel(c) / total : 0
              return (
                <motion.div
                  layout
                  key={c.id}
                  className={`card ${c.paused ? 'paused' : ''}`}
                  style={{ '--c': meta.color, '--a': meta.accent } as React.CSSProperties}
                  initial={{ opacity: 0, y: -28 - i * 14, rotateX: -40, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -18 - i * 8, rotateX: -30, transition: { duration: 0.22, delay: (cards.length - i) * 0.03 } }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26, delay: i * 0.065 }}
                >
                  <div className="card-rank">{String(i + 1).padStart(2, '0')}</div>
                  <div className="card-body">
                    <div className="card-top">
                      <span className="card-issuer">{cardShort(c)}{c.paused && <em> · PAUSED</em>}</span>
                      <AnimatePresence mode="wait" initial={false}>
                        {leg ? (
                          <motion.span key={debit!.key} className="card-debit" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                            −{fmt(leg.amountNative, c.currency)}
                          </motion.span>
                        ) : (
                          <motion.span key="num" className="card-num" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>•••• {c.last4}</motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                    <div className="card-name">{c.name}</div>
                    <div className="card-bottom">
                      <span className="card-bal">{fmt(c.balance, c.currency)}</span>
                      {c.currency !== 'GEL' && <span className="card-eq">≈ {fmtShort(toGel(c))}</span>}
                    </div>
                    <div className="card-share"><i style={{ width: `${share * 100}%` }} /></div>
                  </div>
                  <div className="card-actions">
                    <button disabled={i === 0} onClick={() => onMove(c.id, -1)} aria-label="Raise priority">↑</button>
                    <button disabled={i === cards.length - 1} onClick={() => onMove(c.id, 1)} aria-label="Lower priority">↓</button>
                    <button onClick={() => onPause(c.id)} aria-label={c.paused ? 'Resume card' : 'Pause card'}>{c.paused ? '▶' : 'Ⅱ'}</button>
                    <button onClick={() => onRemove(c.id)} aria-label="Remove card">×</button>
                  </div>
                </motion.div>
              )
            })}
            <motion.div
              className="cards-foot"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0, transition: { delay: cards.length * 0.065 + 0.05 } }}
            >
              <button className="add" onClick={onAdd}>+ Link a card</button>
              <button className="reset" onClick={onReset}>Reset demo</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
