// On-device speech recognition (Whisper via transformers.js). Used where the browser's
// Web Speech API is missing or blocked (Brave, Firefox, Mullvad...).
import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

const MODEL = 'Xenova/whisper-base.en'
let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null

function load() {
  asr ??= pipeline('automatic-speech-recognition', MODEL, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p: { status: string; progress?: number; file?: string }) => {
      if (p.status === 'progress' && p.file?.endsWith('.onnx')) self.postMessage({ type: 'progress', progress: p.progress ?? 0 })
    },
  }) as Promise<AutomaticSpeechRecognitionPipeline>
  return asr
}

self.onmessage = async (e: MessageEvent<{ type: 'load' } | { type: 'transcribe'; id: number; audio: Float32Array }>) => {
  try {
    const model = await load()
    if (e.data.type === 'load') return self.postMessage({ type: 'ready' })
    const out = (await model(e.data.audio)) as { text: string }
    self.postMessage({ type: 'text', id: e.data.id, text: out.text })
  } catch (err) {
    asr = null
    self.postMessage({ type: 'error', id: e.data.type === 'transcribe' ? e.data.id : 0, message: String(err) })
  }
}
