class Rec extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / 16000
    this.pos = 0
    this.buf = new Int16Array(1600)
    this.n = 0
  }

  process(inputs) {
    let ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    let i = this.pos
    while (i < ch.length) {
      let s = Math.max(-1, Math.min(1, ch[Math.floor(i)]))
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff
      if (this.n == this.buf.length) {
        this.port.postMessage(this.buf.buffer, [this.buf.buffer])
        this.buf = new Int16Array(1600)
        this.n = 0
      }
      i += this.ratio
    }
    this.pos = i - ch.length
    return true
  }
}

registerProcessor('rec', Rec)
