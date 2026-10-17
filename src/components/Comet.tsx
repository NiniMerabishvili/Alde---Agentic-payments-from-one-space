import { useEffect, useRef } from 'react'
import type { Phase } from '../lib/agent'

interface Props {
  phase: Phase
  compact: boolean
  level: number // 0..1 voice / typing energy
}

const TAIL: Record<Phase, [number, number, number]> = {
  idle: [255, 45, 45],
  listening: [255, 70, 60],
  thinking: [255, 40, 70],
  paying: [255, 120, 40],
  done: [60, 230, 160],
  error: [255, 30, 30],
}

/** The heart of the UI: a glowing comet whose motion mirrors what the agent is doing. */
export default function Comet({ phase, compact, level }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef({ phase, compact, level })
  useEffect(() => { state.current = { phase, compact, level } }, [phase, compact, level])

  useEffect(() => {
    const cv = canvas.current!
    const ctx = cv.getContext('2d')!
    let w = 0, h = 0, dpr = 1, raf = 0
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = cv.clientWidth; h = cv.clientHeight
      cv.width = w * dpr; cv.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const stars = Array.from({ length: 70 }, () => ({ a: Math.random() * Math.PI * 2, r: 0.55 + Math.random() * 0.9, s: 0.4 + Math.random() * 1.2, tw: Math.random() * 6 }))
    const pos = { x: w / 2, y: h / 2 }, vel = { x: 0, y: 0 }
    const trail: { x: number; y: number }[] = []
    let t = 0, last = performance.now(), cy = h * 0.42, scale = 1, energy = 0, shock = 0, prevPhase: Phase = 'idle'
    const tint = [...TAIL.idle]

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now
      const { phase, compact, level } = state.current
      if (phase !== prevPhase) { if (phase === 'done' || phase === 'error') shock = 1; prevPhase = phase }
      t += dt
      const busy = phase === 'thinking' || phase === 'paying'
      energy += ((busy ? 1 : phase === 'listening' ? 0.45 + level * 0.5 : 0) - energy) * Math.min(1, dt * 3)
      cy += ((compact ? h * 0.24 : h * 0.44) - cy) * Math.min(1, dt * 2.5)
      scale += ((compact ? 0.78 : 1) - scale) * Math.min(1, dt * 2.5)
      for (let i = 0; i < 3; i++) tint[i] += (TAIL[phase][i] - tint[i]) * Math.min(1, dt * 3)

      const cx = w / 2
      const R = Math.min(w, h) * 0.2 * scale
      // target path: slow lissajous when idle, tight fast orbit when working
      const speed = 0.35 + energy * 2.1
      const orbitR = R * (1 - energy * 0.45)
      const tx = cx + Math.cos(t * speed) * orbitR * (1.15 - energy * 0.15)
      const ty = cy + Math.sin(t * speed * (busy ? 1 : 1.6)) * orbitR * (busy ? 1 : 0.55)
      const k = 6 + energy * 14, damp = 0.86
      vel.x = (vel.x + (tx - pos.x) * k * dt) * damp
      vel.y = (vel.y + (ty - pos.y) * k * dt) * damp
      if (phase === 'error' && shock > 0.4) pos.x += Math.sin(t * 90) * 3 * shock
      pos.x += vel.x * dt * 10; pos.y += vel.y * dt * 10
      trail.unshift({ x: pos.x, y: pos.y })
      if (trail.length > 34) trail.pop()

      ctx.clearRect(0, 0, w, h)

      // orbit rings
      ctx.save()
      ctx.translate(cx, cy)
      for (let i = 0; i < 3; i++) {
        ctx.beginPath()
        ctx.setLineDash(i === 1 ? [] : [1.5, 7])
        ctx.lineDashOffset = -t * (8 + i * 6) * (1 + energy * 4)
        ctx.strokeStyle = `rgba(255,255,255,${0.06 + energy * 0.08 - i * 0.015})`
        ctx.lineWidth = 1
        ctx.arc(0, 0, R * (0.9 + i * 0.42), 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.setLineDash([])
      // drifting stars
      for (const s of stars) {
        const a = s.a + t * 0.02 * s.s * (1 + energy * 3)
        const rr = R * s.r * 1.6
        const alpha = 0.15 + 0.35 * (0.5 + 0.5 * Math.sin(t * s.s + s.tw))
        ctx.fillStyle = `rgba(255,255,255,${alpha})`
        ctx.fillRect(Math.cos(a) * rr, Math.sin(a) * rr * 0.8, s.s, s.s)
      }
      // shockwave on completion
      if (shock > 0) {
        shock = Math.max(0, shock - dt * 0.9)
        ctx.beginPath()
        ctx.strokeStyle = `rgba(${tint.map(Math.round).join(',')},${shock * 0.6})`
        ctx.lineWidth = 2
        ctx.arc(pos.x - cx, pos.y - cy, (1 - shock) * R * 2.6 + 20, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.restore()

      // tail: soft smoky gradients along the path
      const head = 46 * scale * (1 + energy * 0.12 + level * 0.25)
      for (let i = trail.length - 1; i > 0; i--) {
        const p = trail[i], f = 1 - i / trail.length
        const r = head * (0.9 + (1 - f) * 1.6)
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r)
        const a = 0.2 * f * (0.75 + energy * 0.45)
        g.addColorStop(0, `rgba(${tint.map(Math.round).join(',')},${a})`)
        g.addColorStop(1, `rgba(${tint.map(Math.round).join(',')},0)`)
        ctx.fillStyle = g
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill()
      }
      // head glow + core
      const pulse = 1 + Math.sin(t * (busy ? 9 : 2)) * (busy ? 0.05 : 0.025)
      const glow = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, head * 2.4 * pulse)
      glow.addColorStop(0, 'rgba(255,255,255,0.35)')
      glow.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = glow
      ctx.beginPath(); ctx.arc(pos.x, pos.y, head * 2.4 * pulse, 0, Math.PI * 2); ctx.fill()
      const core = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, head * pulse)
      core.addColorStop(0, 'rgba(255,255,255,1)')
      core.addColorStop(0.62, 'rgba(250,250,252,0.97)')
      core.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = core
      ctx.beginPath(); ctx.arc(pos.x, pos.y, head * pulse, 0, Math.PI * 2); ctx.fill()

      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])

  return <canvas ref={canvas} className="comet" aria-hidden />
}
