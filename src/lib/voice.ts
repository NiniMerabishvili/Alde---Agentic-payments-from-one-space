// Voice input. Uses the browser's Web Speech API where it really works (Chrome, Edge, Safari),
// and falls back to on-device Whisper elsewhere: Brave ships the API but blocks its servers,
// which is why listening used to stop after about a second.

export type VoiceStatus = 'loading' | 'listening' | 'transcribing'

export interface VoiceHandlers {
  onStatus: (s: VoiceStatus, progress?: number) => void
  onLevel: (level: number) => void
  onPartial: (text: string) => void
}

export interface VoiceSession {
  stop: () => void // finish and transcribe what was said
  cancel: () => void
  result: Promise<string>
}

interface SR {
  lang: string; continuous: boolean; interimResults: boolean
  start(): void; stop(): void; abort(): void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}

const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }
const NativeSR = W.SpeechRecognition ?? W.webkitSpeechRecognition
const isBrave = 'brave' in navigator
let nativeBroken = isBrave || !NativeSR

const SILENCE_MS = 1600
const MAX_MS = 20000

// ---------- Whisper worker ----------

let worker: Worker | null = null
let ready = false
let seq = 0
const pending = new Map<number, (text: string) => void>()
let onProgress: ((p: number) => void) | null = null
let readyWaiters: (() => void)[] = []

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => {
    const d = e.data
    if (d.type === 'progress') onProgress?.(d.progress)
    if (d.type === 'ready') { ready = true; readyWaiters.forEach((f) => f()); readyWaiters = [] }
    if (d.type === 'text') { pending.get(d.id)?.(d.text); pending.delete(d.id) }
    if (d.type === 'error') { pending.get(d.id)?.(''); pending.delete(d.id); console.warn('whisper:', d.message) }
  }
  worker.postMessage({ type: 'load' })
  return worker
}

function whenReady() {
  return ready ? Promise.resolve() : new Promise<void>((r) => readyWaiters.push(r))
}

/** Start downloading the voice model early (e.g. on first hover of the mic). */
export function warmUp() {
  if (nativeBroken) getWorker()
}

function transcribe(audio: Float32Array) {
  const id = ++seq
  return new Promise<string>((resolve) => {
    pending.set(id, resolve)
    getWorker().postMessage({ type: 'transcribe', id, audio }, [audio.buffer])
  })
}

const clean = (t: string) =>
  t.replace(/\[[^\]]*\]|\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().replace(/^(you|thank you\.?|thanks for watching!?)$/i, '')

function recordWithWhisper(h: VoiceHandlers): VoiceSession {
  let stopFn = () => {}
  let cancelled = false
  const result = (async () => {
    getWorker()
    onProgress = (p) => { if (!ready) h.onStatus('loading', p) }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    ctx.createMediaStreamSource(stream).connect(analyser)
    const rec = new MediaRecorder(stream)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.start(250)
    h.onStatus('listening')

    const buf = new Float32Array(analyser.fftSize)
    const t0 = performance.now()
    let spoke = false, lastLoud = t0, raf = 0
    const done = new Promise<void>((resolve) => {
      stopFn = resolve
      const tick = () => {
        analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (const v of buf) sum += v * v
        const rms = Math.sqrt(sum / buf.length)
        h.onLevel(Math.min(1, rms * 12))
        const now = performance.now()
        if (rms > 0.02) { spoke = true; lastLoud = now }
        if ((spoke && now - lastLoud > SILENCE_MS) || now - t0 > MAX_MS || (!spoke && now - t0 > 8000)) return resolve()
        raf = requestAnimationFrame(tick)
      }
      tick()
    })
    await done
    cancelAnimationFrame(raf)
    h.onLevel(0)
    const stopped = new Promise((r) => (rec.onstop = r))
    rec.stop()
    await stopped
    stream.getTracks().forEach((t) => t.stop())
    await ctx.close()
    if (cancelled || !spoke) return ''

    h.onStatus(ready ? 'transcribing' : 'loading')
    const blob = new Blob(chunks, { type: rec.mimeType })
    const decoder = new AudioContext({ sampleRate: 16000 })
    const audio = await decoder.decodeAudioData(await blob.arrayBuffer())
    await decoder.close()
    await whenReady()
    h.onStatus('transcribing')
    return clean(await transcribe(audio.getChannelData(0).slice()))
  })()
  return { stop: () => stopFn(), cancel: () => { cancelled = true; stopFn() }, result }
}

function recordNative(h: VoiceHandlers): VoiceSession {
  const sr = new NativeSR!()
  sr.lang = 'en-US'
  sr.continuous = true
  sr.interimResults = true
  let text = '', silence = 0, cancelled = false, failed = false
  let level = 0
  const pulse = setInterval(() => h.onLevel((level *= 0.85)), 60)
  const result = new Promise<string>((resolve, reject) => {
    const arm = () => { clearTimeout(silence); silence = window.setTimeout(() => sr.stop(), text ? SILENCE_MS : 8000) }
    sr.onresult = (e) => {
      text = Array.from(e.results).map((r) => r[0].transcript).join(' ').trim()
      level = 0.8
      h.onPartial(text)
      arm()
    }
    sr.onerror = (e) => {
      if (['network', 'service-not-allowed', 'language-not-supported', 'audio-capture'].includes(e.error)) { failed = true; nativeBroken = true }
    }
    sr.onend = () => {
      clearTimeout(silence); clearInterval(pulse); h.onLevel(0)
      if (failed) reject(new Error('native-unavailable'))
      else resolve(cancelled ? '' : text)
    }
    arm()
  })
  sr.start()
  h.onStatus('listening')
  return { stop: () => sr.stop(), cancel: () => { cancelled = true; sr.abort() }, result }
}

export function startVoice(h: VoiceHandlers): VoiceSession {
  if (nativeBroken) return recordWithWhisper(h)
  const native = recordNative(h)
  let current: VoiceSession = native
  // If the browser's service turns out to be blocked, switch to Whisper transparently.
  const result = native.result.catch(() => {
    current = recordWithWhisper(h)
    return current.result
  })
  return { stop: () => current.stop(), cancel: () => current.cancel(), result }
}
