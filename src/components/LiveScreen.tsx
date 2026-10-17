import { AnimatePresence, motion } from 'framer-motion'
import { useLayoutEffect, useRef, useState } from 'react'
import type { Screen } from '../lib/agent'
import { ISSUERS, cardShort, fmt, fmtShort, toGel } from '../lib/wallet'

export interface LiveStep { id: string; label: string; detail?: string; status: 'active' | 'done' | 'failed' }

interface Props {
  screen: Screen | null
  steps: LiveStep[]
  title: string
  position: string // "2 / 3"
}

/** The agent's own screen: a mini browser showing what it is doing on the merchant's site. */
export default function LiveScreen({ screen, steps, title, position }: Props) {
  return (
    <motion.section
      className="live"
      initial={{ opacity: 0, x: -24, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -24, scale: 0.98, transition: { duration: 0.35 } }}
      transition={{ type: 'spring', stiffness: 220, damping: 26 }}
    >
      <div className="live-head">
        <span className="live-dot" /> AGENT LIVE <span className="live-title">{title}</span>
        <span className="live-pos">{position}</span>
      </div>
      <div className="browser">
        <div className="b-bar">
          <span className="b-lights"><i /><i /><i /></span>
          <span className="b-url">
            <svg viewBox="0 0 16 16"><path d="M5 7V5a3 3 0 0 1 6 0v2M4 7h8v6H4z" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
            <motion.span key={screen?.url} initial={{ opacity: 0.3 }} animate={{ opacity: 1 }}>{screen?.url ?? 'about:blank'}</motion.span>
          </span>
        </div>
        <div className="b-view">
          <AnimatePresence mode="popLayout">
            {screen && (
              <motion.div
                key={screen.view + (screen.view === 'checkout' ? '' : screen.site)}
                className="b-page"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3 }}
              >
                <Page screen={screen} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <ol className="live-steps">
        {steps.slice(-3).map((s) => (
          <motion.li key={s.id} layout className={`step ${s.status}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}>
            <span className="step-icon">{s.status === 'done' ? '✓' : s.status === 'failed' ? '!' : ''}</span>
            <span className="step-text">{s.label}{s.detail && <em>{s.detail}</em>}</span>
          </motion.li>
        ))}
      </ol>
    </motion.section>
  )
}

function SiteHeader({ site }: { site: string }) {
  const swoop = site === 'swoop.ge'
  return (
    <div className={`site-head ${swoop ? 'swoop' : ''}`}>
      <b>{swoop ? 'swoop' : site.split('.')[0]}</b>
      <span>{swoop ? 'შეთავაზებები · offers' : site}</span>
    </div>
  )
}

function Page({ screen: s }: { screen: Screen }) {
  switch (s.view) {
    case 'search':
      return (
        <>
          <SiteHeader site={s.site} />
          <div className="search-box">
            <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.4" /></svg>
            <span>{s.query}<i className="caret" /></span>
          </div>
          <div className="skeleton-grid">{Array.from({ length: 4 }, (_, i) => <i key={i} />)}</div>
        </>
      )
    case 'results':
      return <Results screen={s} />
    case 'offer':
      return (
        <>
          <SiteHeader site={s.site} />
          <div className="offer">
            {s.offer.image ? <img src={s.offer.image} alt="" /> : <div className="img-ph" />}
            <div className="offer-title">{s.offer.title}</div>
            <div className="offer-merchant">{s.offer.merchant}{s.offer.address && ` · ${s.offer.address}`}</div>
            <div className="offer-row">
              <div className="price">
                <b>{fmtShort(s.offer.price)}</b>
                {s.offer.oldPrice > s.offer.price && <s>{fmtShort(s.offer.oldPrice)}</s>}
              </div>
              <div className="qty">
                <span>−</span>
                <motion.b key={s.qty} initial={{ scale: 1.6, color: '#fff' }} animate={{ scale: 1 }}>{s.qty}</motion.b>
                <motion.span key={`p${s.qty}`} className="press" initial={{ scale: 0.8, background: 'rgba(255,255,255,0.5)' }} animate={{ scale: 1, background: 'rgba(255,255,255,0.08)' }}>+</motion.span>
              </div>
            </div>
            <div className="buy-btn">Buy · {fmt(s.offer.price * s.qty)}</div>
          </div>
        </>
      )
    case 'lookup':
      return (
        <>
          <SiteHeader site={s.site} />
          <div className="form">
            <div className="form-title">Pay your bill</div>
            <div className="form-sub">{s.provider}</div>
            <label>Customer number<span>{s.account}<i className="caret" /></span></label>
            <div className="buy-btn dim">Check</div>
          </div>
        </>
      )
    case 'bill':
      return (
        <>
          <SiteHeader site={s.site} />
          <div className="form">
            <div className="form-title">{s.provider}</div>
            <div className="form-sub">Account {s.account} · {s.period}</div>
            <div className="bill-amount">{s.amount ? fmt(s.amount) : 'Paid ✓'}</div>
            <div className="form-sub">{s.amount ? 'Amount due' : 'Nothing due this month'}</div>
          </div>
        </>
      )
    case 'form':
      return (
        <>
          <SiteHeader site={s.site} />
          <div className="form">
            <div className="form-title">{s.title}</div>
            {s.fields.map(([k, v]) => <label key={k}>{k}<span>{v}</span></label>)}
          </div>
        </>
      )
    case 'checkout':
      return <Checkout screen={s} />
    case 'done':
      return (
        <div className="done-page">
          <motion.div className="done-check" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }}>✓</motion.div>
          <div className="form-title">Order confirmed</div>
          <div className="form-sub">{s.merchant} · {fmt(s.total)}</div>
          {s.codes && <div className="done-codes">{s.codes.map((c) => <code key={c.code}>{c.code}</code>)}</div>}
        </div>
      )
  }
}

function Results({ screen: s }: { screen: Extract<Screen, { view: 'results' }> }) {
  const grid = useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    if (s.pick == null || !grid.current) return
    const el = grid.current.querySelector<HTMLElement>(`[data-id="${s.pick}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    setCursor({ x: el.offsetLeft + el.offsetWidth * 0.6, y: el.offsetTop + el.offsetHeight * 0.45 })
  }, [s.pick])

  return (
    <>
      <SiteHeader site={s.site} />
      <div className="results-meta">“{s.term}” · {s.results.length} offers {s.live ? <span className="live-tag">LIVE</span> : <span className="live-tag off">OFFLINE</span>}</div>
      <div className="results" ref={grid}>
        {s.results.map((o, i) => (
          <motion.div
            key={o.id}
            data-id={o.id}
            className={`result ${s.pick === o.id ? 'pick' : s.pick != null ? 'dim' : ''}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            {o.image ? <img src={o.image} alt="" loading="lazy" /> : <div className="img-ph" />}
            <div className="r-t">{o.title}</div>
            <div className="r-m">{o.merchant}</div>
            <div className="r-p"><b>{fmtShort(o.price)}</b>{o.discount > 0 && <span>−{o.discount}%</span>}</div>
            {s.pick === o.id && <div className="pick-tag">AGENT PICK</div>}
          </motion.div>
        ))}
        {cursor && (
          <motion.svg className="cursor" viewBox="0 0 20 20" initial={{ x: 20, y: 0, opacity: 0 }} animate={{ x: cursor.x, y: cursor.y, opacity: 1 }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
            <path d="M3 2l13 7-6 1.5L7 17z" fill="#fff" stroke="#000" strokeWidth="1" />
          </motion.svg>
        )}
      </div>
    </>
  )
}

function Checkout({ screen: s }: { screen: Extract<Screen, { view: 'checkout' }> }) {
  const label = { review: s.legs.length ? 'Allocating across your cards' : 'Checking combined balance', authorizing: 'Authorizing…', paid: 'Paid', declined: 'Not enough funds' }[s.stage]
  return (
    <div className="checkout">
      <div className="co-head">
        <div>
          <div className="form-sub">Checkout · {s.merchant}</div>
          <div className="bill-amount">{fmt(s.total)}</div>
        </div>
        <span className={`co-stage ${s.stage}`}>{label}</span>
      </div>
      <div className="co-label">PAY WITH ALDE · COMBINED BALANCE</div>
      <div className="co-cards">
        {s.cards.map((c) => {
          const leg = s.legs.find((l) => l.cardId === c.id)
          const avail = toGel(c)
          return (
            <div key={c.id} className={`co-card ${leg ? 'used' : ''} ${c.paused ? 'paused' : ''}`} style={{ '--c': ISSUERS[c.issuer].color } as React.CSSProperties}>
              <i className="co-dot" />
              <div className="co-name">
                <div>{cardShort(c)} <span>•{c.last4}</span></div>
                <small>{c.paused ? 'paused' : fmt(c.balance, c.currency)}</small>
              </div>
              <div className="co-bar"><motion.i initial={{ width: 0 }} animate={{ width: leg && avail ? `${Math.min(100, (leg.amountGel / avail) * 100)}%` : 0 }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} /></div>
              <div className="co-amt">{leg ? `−${fmtShort(leg.amountGel)}` : '—'}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
