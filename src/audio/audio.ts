/**
 * Procedural audio via WebAudio — a low space drone plus interaction SFX.
 * No audio files: everything is synthesized, so the site stays asset-free.
 * The AudioContext is created lazily on the first user-enabled toggle
 * (browser autoplay policy friendly) and starts muted.
 */
class GalaxyAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private droneOn = false
  private noiseBuf: AudioBuffer | null = null
  enabled = false

  setEnabled(on: boolean) {
    this.enabled = on
    if (on) {
      this.ensure()
      this.ctx?.resume().catch(() => {})
      this.fadeMaster(0.5)
      this.startDrone()
    } else {
      this.fadeMaster(0)
    }
  }

  private ensure() {
    if (this.ctx) return
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctx()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0
      this.master.connect(this.ctx.destination)

      const len = this.ctx.sampleRate * 2
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const data = this.noiseBuf.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    } catch {
      this.ctx = null
    }
  }

  private fadeMaster(target: number) {
    if (!this.ctx || !this.master) return
    const t = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(t)
    this.master.gain.setTargetAtTime(target, t, 0.8)
  }

  private startDrone() {
    if (!this.ctx || !this.master || this.droneOn) return
    this.droneOn = true
    // two slightly detuned lows beating against each other = deep space hum
    for (const freq of [48, 48.7, 96.2]) {
      const osc = this.ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq
      const g = this.ctx.createGain()
      g.gain.value = freq > 90 ? 0.008 : 0.02
      osc.connect(g).connect(this.master)
      osc.start()
    }
    // filtered noise "solar wind"
    if (this.noiseBuf) {
      const src = this.ctx.createBufferSource()
      src.buffer = this.noiseBuf
      src.loop = true
      const lp = this.ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 220
      const g = this.ctx.createGain()
      g.gain.value = 0.012
      src.connect(lp).connect(g).connect(this.master)
      src.start()
    }
  }

  /** hyperspace whoosh — bandpassed noise sweeping up then settling */
  whoosh() {
    if (!this.enabled) return
    this.ensure()
    if (!this.ctx || !this.master || !this.noiseBuf) return
    const t = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 1.1
    bp.frequency.setValueAtTime(140, t)
    bp.frequency.exponentialRampToValueAtTime(1800, t + 0.9)
    bp.frequency.exponentialRampToValueAtTime(320, t + 1.9)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.7)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2)
    src.connect(bp).connect(g).connect(this.master)
    src.start(t)
    src.stop(t + 2.1)
  }

  /** tiny UI blip for selections */
  blip() {
    if (!this.enabled) return
    this.ensure()
    if (!this.ctx || !this.master) return
    const t = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(720, t)
    osc.frequency.exponentialRampToValueAtTime(1180, t + 0.07)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.06, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14)
    osc.connect(g).connect(this.master)
    osc.start(t)
    osc.stop(t + 0.16)
  }
}

export const audio = new GalaxyAudio()
