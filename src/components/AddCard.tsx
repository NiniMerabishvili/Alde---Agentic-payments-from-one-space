import { motion } from 'framer-motion'
import { useState } from 'react'
import { ISSUERS, type Card, type Issuer } from '../lib/wallet'

export default function AddCard({ onClose, onAdd }: { onClose: () => void; onAdd: (c: Card) => void }) {
  const [issuer, setIssuer] = useState<Issuer>('LIBERTY')
  const [last4, setLast4] = useState('')
  const [amount, setAmount] = useState('')
  const [linking, setLinking] = useState(false)
  const meta = ISSUERS[issuer]

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setLinking(true)
    setTimeout(() => {
      onAdd({
        id: `c-${Date.now()}`,
        issuer,
        name: issuer === 'CRYPTO' ? 'USDT Wallet' : `${meta.label.split(' ')[0]} Card`,
        last4: last4.padStart(4, '0').slice(-4) || String(Math.floor(1000 + Math.random() * 9000)),
        currency: meta.currency,
        balance: Math.round((parseFloat(amount.replace(',', '.')) || 50) * 100),
      })
    }, 1100)
  }

  return (
    <motion.div className="modal-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.form
        className="modal"
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        initial={{ y: 30, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      >
        <div className="modal-title">LINK A CARD</div>
        <p className="modal-sub">It joins your combined balance and goes to the bottom of the payment order.</p>
        <div className="issuers">
          {(Object.keys(ISSUERS) as Issuer[]).map((k) => (
            <button type="button" key={k} className={`issuer ${k === issuer ? 'on' : ''}`} style={{ '--c': ISSUERS[k].color } as React.CSSProperties} onClick={() => setIssuer(k)}>
              <i /> {ISSUERS[k].label}
            </button>
          ))}
        </div>
        <div className="fields">
          <label>
            <span>{issuer === 'CRYPTO' ? 'WALLET TAIL' : 'LAST 4 DIGITS'}</span>
            <input value={last4} onChange={(e) => setLast4(e.target.value.slice(0, 4))} placeholder="1234" />
          </label>
          <label>
            <span>BALANCE ({meta.currency})</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50.00" inputMode="decimal" />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="solid" disabled={linking}>{linking ? 'Linking securely…' : 'Link card'}</button>
        </div>
      </motion.form>
    </motion.div>
  )
}
