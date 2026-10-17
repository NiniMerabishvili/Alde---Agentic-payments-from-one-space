import { motion } from 'framer-motion'
import { useEffect } from 'react'
import ReceiptView from './Receipt'
import type { Op } from '../App'

/** Details of one operation from the ring: what was asked, what the agent did, the receipt. */
export default function Drawer({ op, onClose }: { op: Op; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  return (
    <>
      <motion.div className="drawer-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.aside
        className="drawer"
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      >
        <div className="d-head">
          <div>
            <div className={`d-status ${op.status}`}>{op.status === 'done' ? 'COMPLETED' : op.status === 'failed' ? 'NEEDS ATTENTION' : op.status.toUpperCase()}</div>
            <div className="d-title">{op.label}</div>
            <div className="d-req">“{op.request}” · {new Date(op.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
          </div>
          <button className="d-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {op.say && <p className="say">{op.say}</p>}
        {op.receipt && <ReceiptView receipt={op.receipt} />}
        {op.steps.length > 0 && (
          <ol className="steps">
            {op.steps.map((s) => (
              <li key={s.id} className={`step ${s.status}`}>
                <span className="step-icon">{s.status === 'done' ? '✓' : s.status === 'failed' ? '!' : ''}</span>
                <span className="step-text">{s.label}{s.detail && <em>{s.detail}</em>}</span>
              </li>
            ))}
          </ol>
        )}
      </motion.aside>
    </>
  )
}
