// Captures mic audio on the audio thread, resamples it to 16 kHz mono, and posts
// 20 ms Int16 frames (320 samples) to the main thread — the exact format Sira's
// stream expects. Resampling happens here because not every browser will open
// an AudioContext at 16 kHz (Safari opens at the device rate and ignores the
// request); linear interpolation is plenty for speech.
class SiraCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.targetRate = 16000
    this.frame = 320
    this.buf = new Int16Array(this.frame)
    this.n = 0
    // Fractional read position into the incoming block stream, carried across
    // process() calls so the resampler never drops or repeats samples.
    this.pos = 0
    this.prev = 0
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    const ratio = sampleRate / this.targetRate
    if (ratio <= 1.0001 && ratio >= 0.9999) {
      for (let i = 0; i < ch.length; i++) this.push(ch[i])
      return true
    }
    // Resample: walk the input at `ratio` steps, interpolating between samples.
    // Index -1 refers to the last sample of the previous block.
    let pos = this.pos
    while (pos < ch.length) {
      const i = Math.floor(pos)
      const frac = pos - i
      const a = i - 1 >= 0 ? ch[i - 1] : this.prev
      const b = ch[i]
      this.push(a + (b - a) * frac)
      pos += ratio
    }
    this.pos = pos - ch.length
    this.prev = ch[ch.length - 1]
    return true
  }
  push(sample) {
    const s = Math.max(-1, Math.min(1, sample))
    this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff
    if (this.n === this.frame) {
      this.port.postMessage(this.buf.buffer, [this.buf.buffer])
      this.buf = new Int16Array(this.frame)
      this.n = 0
    }
  }
}
registerProcessor("sira-capture", SiraCaptureProcessor)
