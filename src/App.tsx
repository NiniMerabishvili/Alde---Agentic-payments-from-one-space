import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import AddCard from './components/AddCard'
import Balance from './components/Balance'
import Comet from './components/Comet'
import Drawer from './components/Drawer'
import LiveScreen, { type LiveStep } from './components/LiveScreen'
import { describe, isQuery, run, splitTasks, type Phase, type Receipt, type Screen } from './lib/agent'
import { startVoice, warmUp, type VoiceSession, type VoiceStatus } from './lib/voice'
import { DEFAULT_CARDS, applySplit, type Card, type SplitLeg } from './lib/wallet'

export interface Op {
  id: string
  request: string
  label: string
  status: 'pending' | 'active' | 'done' | 'failed'
  query: boolean // questions like "balance" leave the ring once answered
  steps: LiveStep[]
  say?: string
  receipt?: Receipt
  at: number
}

interface Memory { cards: Card[]; paidBills: string[]; ops: Op[] }

const STORE = 'alde.v2'
const fresh = (): Memory => ({ cards: DEFAULT_CARDS, paidBills: [], ops: [] })
const load = (): Memory => {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? '') as Memory
    if (!Array.isArray(s.cards)) return fresh()
    // anything interrupted by a refresh is marked, not silently re-run (it could double-pay)
    const ops = (s.ops ?? []).map((o) => (o.status === 'pending' || o.status === 'active' ? { ...o, status: 'failed' as const, say: o.say ?? 'Interrupted by a page reload. Ask me again if you still need it.' } : o))
    return { cards: s.cards, paidBills: s.paidBills ?? [], ops }
  } catch {
    return fresh()
  }
}

const RING_MAX = 6
const isPhone = () => window.innerWidth <= 720

export default function App() {
  const [mem, setMem] = useState(load)
  const memRef = useRef(mem)
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [screen, setScreen] = useState<Screen | null>(null)
  const [liveOpen, setLiveOpen] = useState(false)
  const [caption, setCaption] = useState<{ text: string; key: number } | null>(null)
  const [debit, setDebit] = useState<{ legs: SplitLeg[]; key: number } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [voice, setVoice] = useState<{ status: VoiceStatus; progress?: number } | null>(null)
  const [level, setLevel] = useState(0)
  const voiceRef = useRef<VoiceSession | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const running = useRef(false)

  /** Every state change goes through here so the agent loop always reads the latest memory. */
  const update = useCallback((fn: (m: Memory) => Memory) => {
    memRef.current = fn(memRef.current)
    setMem(memRef.current)
  }, [])
  const patchOp = useCallback((id: string, fn: (o: Op) => Partial<Op>) =>
    update((m) => ({ ...m, ops: m.ops.map((o) => (o.id === id ? { ...o, ...fn(o) } : o)) })), [update])

  useEffect(() => {
    const keep = mem.ops.filter((o) => !(o.query && (o.status === 'done' || o.status === 'failed'))).slice(-40)
    localStorage.setItem(STORE, JSON.stringify({ ...mem, ops: keep }))
  }, [mem])

  useEffect(() => {
    if (phase !== 'done' && phase !== 'error') return
    const t = setTimeout(() => setPhase('idle'), 2400)
    return () => clearTimeout(t)
  }, [phase])

  // ---------- the agent loop: works through queued operations one by one ----------
  const process = useCallback(async () => {
    if (running.current) return
    running.current = true
    setLiveOpen(true)
    for (;;) {
      const op = memRef.current.ops.find((o) => o.status === 'pending')
      if (!op) break
      patchOp(op.id, () => ({ status: 'active' }))
      setScreen(null)
      let outcome: Op['status'] = 'failed'
      const m = memRef.current
      const history = m.ops.filter((o) => o.status === 'done').map((o) => ({ label: o.label, receipt: o.receipt, at: o.at }))
      for await (const ev of run(op.request, { cards: m.cards, paidBills: m.paidBills, history })) {
        if (ev.type === 'phase') {
          setPhase(ev.phase)
          if (ev.phase === 'done') outcome = 'done'
          if (ev.phase === 'error' || ev.phase === 'idle') outcome = 'failed'
        } else if (ev.type === 'step') {
          patchOp(op.id, (o) => ({ steps: o.steps.some((s) => s.id === ev.id) ? o.steps.map((s) => (s.id === ev.id ? ev : s)) : [...o.steps, ev] }))
        } else if (ev.type === 'screen') {
          setScreen(ev.screen)
        } else if (ev.type === 'say') {
          patchOp(op.id, () => ({ say: ev.text }))
          setCaption({ text: ev.text, key: Date.now() })
        } else if (ev.type === 'wallet') {
          update((w) => ({ ...w, cards: ev.cards }))
        } else if (ev.type === 'receipt') {
          const { legs } = ev.receipt
          update((w) => ({ ...w, cards: applySplit(w.cards, legs), paidBills: [...w.paidBills, ...(ev.paidBillIds ?? [])] }))
          setDebit({ legs, key: Date.now() })
          patchOp(op.id, () => ({ receipt: ev.receipt }))
        }
      }
      patchOp(op.id, () => ({ status: outcome }))
    }
    running.current = false
    setTimeout(() => { if (!running.current) { setLiveOpen(false); setScreen(null); setDebit(null) } }, 1800)
  }, [patchOp, update])

  const send = useCallback((raw: string) => {
    const text = raw.trim()
    if (!text) return
    setInput('')
    const cards = memRef.current.cards
    const now = Date.now()
    const ops: Op[] = splitTasks(text, cards).map((t, i) => ({
      id: `${now}-${i}`, request: t, label: describe(t, cards), status: 'pending', query: isQuery(t, cards), steps: [], at: now + i,
    }))
    update((m) => ({ ...m, ops: [...m.ops, ...ops] }))
    setCaption(null)
    process()
  }, [process, update])

  // ---------- voice ----------
  const toggleVoice = async () => {
    if (voiceRef.current) { voiceRef.current.stop(); return }
    setInput('')
    const session = startVoice({
      onStatus: (status, progress) => setVoice({ status, progress }),
      onLevel: setLevel,
      onPartial: setInput,
    })
    voiceRef.current = session
    try {
      const text = await session.result
      if (text) send(text)
      else setCaption({ text: "I didn't catch that. Tap the heart and try again.", key: Date.now() })
    } catch (e) {
      const denied = e instanceof DOMException && e.name === 'NotAllowedError'
      setCaption({ text: denied ? 'Microphone access is blocked. Allow it in the address bar and tap again.' : 'Voice input failed on this device. You can type instead.', key: Date.now() })
    } finally {
      voiceRef.current = null
      setVoice(null)
      setLevel(0)
      inputRef.current?.focus()
    }
  }

  // ---------- derived view state ----------
  const busy = mem.ops.some((o) => o.status === 'active' || o.status === 'pending')
  const current = mem.ops.find((o) => o.status === 'active')
  const inflight = mem.ops.filter((o) => o.status === 'active' || o.status === 'pending')
  const finished = mem.ops.filter((o) => !o.query && (o.status === 'done' || o.status === 'failed'))
  const ring = [...finished.slice(-Math.max(0, RING_MAX - inflight.length)).slice(-RING_MAX), ...inflight]
  const batch = mem.ops.filter((o) => current && o.id.split('-')[0] === current.id.split('-')[0])
  const cometPhase: Phase = voice?.status === 'listening' ? 'listening' : busy ? phase : input ? 'listening' : phase
  const showLive = liveOpen && !!current
  const empty = ring.length === 0 && !showLive
  const selectedOp = mem.ops.find((o) => o.id === selected)
  const activeStep = current?.steps.findLast((s) => s.status === 'active')
  const hint = voice
    ? voice.status === 'loading' ? `LOADING VOICE MODEL${voice.progress ? ` ${Math.round(voice.progress)}%` : '…'}` : voice.status === 'transcribing' ? 'TRANSCRIBING…' : 'LISTENING · TAP TO STOP'
    : null

  return (
    <div className={`app phase-${cometPhase} ${empty ? 'is-empty' : ''} ${showLive ? 'has-live' : ''}`}>
      <div className="haze" aria-hidden><i /><i /><i /><i /></div>
      <div className="grid" aria-hidden />
      <Comet phase={cometPhase} compact={showLive && isPhone()} level={voice ? level : Math.min(1, input.length / 40)} />
      <div className="grain" aria-hidden />

      <header className="top">
        <div className="brand">
          <svg viewBox="0 0 12 12" className="mark"><rect x="0" y="0" width="4" height="4" /><rect x="4" y="4" width="4" height="4" /><rect x="8" y="0" width="4" height="4" opacity=".4" /><rect x="0" y="8" width="4" height="4" opacity=".4" /></svg>
          ALDE
        </div>
        <Balance
          cards={mem.cards}
          debit={debit}
          forceOpen={busy && !isPhone()}
          onMove={(id, dir) => update((m) => {
            const cards = [...m.cards]
            const i = cards.findIndex((c) => c.id === id)
            ;[cards[i], cards[i + dir]] = [cards[i + dir], cards[i]]
            return { ...m, cards }
          })}
          onPause={(id) => update((m) => ({ ...m, cards: m.cards.map((c) => (c.id === id ? { ...c, paused: !c.paused } : c)) }))}
          onRemove={(id) => update((m) => ({ ...m, cards: m.cards.filter((c) => c.id !== id) }))}
          onAdd={() => setAdding(true)}
          onReset={() => { if (!busy) { update(fresh); setCaption(null) } }}
        />
      </header>

      <AnimatePresence>
        {empty && (
          <motion.div className="hero" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14, filter: 'blur(6px)' }} transition={{ duration: 0.5 }}>
            <h1>TELL ME<br />WHAT TO PAY</h1>
            <p>One balance across all your cards. I find it, split the payment and pay, in seconds.</p>
          </motion.div>
        )}
      </AnimatePresence>

      <button className="orb-hit" onClick={toggleVoice} onMouseEnter={warmUp} aria-label="Talk to Alde">
        <AnimatePresence>{hint && <motion.span className="orb-hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{hint}</motion.span>}</AnimatePresence>
      </button>

      <div className="ops-ring">
        <AnimatePresence>
          {ring.map((o, i) => {
            const a = ring.length === 1 ? -90 : ring.length === 2 ? (i ? 0 : 180) : -90 + (360 / ring.length) * i
            return (
              <motion.button
                key={o.id}
                layout
                className={`op ${o.status}`}
                style={{ '--a': `${a}deg` } as React.CSSProperties}
                initial={{ opacity: 0, scale: 0.6, filter: 'blur(6px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 0.85, filter: 'blur(6px)', transition: { duration: 0.35 } }}
                transition={{ type: 'spring', stiffness: 200, damping: 22 }}
                onClick={() => setSelected(o.id)}
                title={o.request}
              >
                <span className="op-icon">{o.status === 'done' ? '✓' : o.status === 'failed' ? '!' : o.status === 'pending' ? '•' : ''}</span>
                {o.label}
                {o.receipt && <span className="op-amt">{`₾${(o.receipt.total / 100).toFixed(2)}`}</span>}
              </motion.button>
            )
          })}
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait">
        {(activeStep || caption) && !(showLive && isPhone()) && (
          <motion.div
            key={activeStep ? `s-${current?.id}-${activeStep.id}` : `c-${caption!.key}`}
            className={`caption ${activeStep ? 'working' : ''}`}
            initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
            transition={{ duration: 0.35 }}
          >
            {activeStep ? `${activeStep.label}…` : caption!.text}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showLive && current && (
          <LiveScreen
            screen={screen}
            steps={current.steps}
            title={current.label}
            position={batch.length > 1 ? `${batch.findIndex((o) => o.id === current.id) + 1} / ${batch.length}` : ''}
          />
        )}
      </AnimatePresence>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input) }}>
        <div className="field">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={busy ? 'Add another task, Alde will queue it…' : 'Tell Alde what to pay…'}
            autoFocus
          />
          <button type="button" className={`mic ${voice ? 'on' : ''}`} onClick={toggleVoice} onMouseEnter={warmUp} aria-label="Voice input">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          </button>
        </div>
        <button className="send" disabled={!input.trim()} aria-label="Send">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
        </button>
      </form>

      <AnimatePresence>{selectedOp && <Drawer op={selectedOp} onClose={() => setSelected(null)} />}</AnimatePresence>
      <AnimatePresence>{adding && <AddCard onClose={() => setAdding(false)} onAdd={(c) => { update((m) => ({ ...m, cards: [...m.cards, c] })); setAdding(false) }} />}</AnimatePresence>
    </div>
  )
}
