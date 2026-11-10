// Background music generated in the browser: no recording, so nothing for TikTok's copyright scan to match.
export type SynthStyle = 'ballad' | 'vui';

const NOTE = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

// Chord roots/qualities as MIDI triads (key of C / A minor)
const PROGRESSIONS: Record<SynthStyle, number[][]> = {
  ballad: [
    [48, 52, 55], // C
    [47, 55, 59], // G/B
    [45, 52, 57], // Am
    [40, 47, 55], // Em
    [41, 48, 53], // F
    [36, 48, 52], // C/E-ish
    [38, 50, 53], // Dm
    [43, 50, 55], // G
  ],
  vui: [
    [48, 52, 55], // C
    [43, 50, 55], // G
    [45, 52, 57], // Am
    [41, 48, 53], // F
  ],
};
const PENTA = [60, 62, 64, 67, 69, 72, 74, 76];

export class MusicSynth {
  private ctx: AudioContext;
  private out: GainNode;
  private reverb: ConvolverNode;
  private wet: GainNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  private noise: AudioBuffer;
  style: SynthStyle;

  constructor(ctx: AudioContext, destination: AudioNode, style: SynthStyle) {
    this.ctx = ctx;
    this.style = style;
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.6);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.35;
    this.reverb.connect(this.wet).connect(this.out);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  private get bpm() {
    return this.style === 'ballad' ? 70 : 104;
  }

  start() {
    if (this.timer) return;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.timer = setInterval(() => this.schedule(), 50);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    setTimeout(() => this.out.disconnect(), 1500);
  }

  // Eighth-note grid, scheduled a little ahead of the audio clock
  private schedule() {
    const eighth = 30 / this.bpm;
    while (this.nextTime < this.ctx.currentTime + 0.25) {
      this.playStep(this.step, this.nextTime, eighth);
      this.nextTime += eighth;
      this.step++;
    }
  }

  private playStep(step: number, t: number, eighth: number) {
    const prog = PROGRESSIONS[this.style];
    const bar = Math.floor(step / 8);
    const pos = step % 8;
    const chord = prog[bar % prog.length];
    const ballad = this.style === 'ballad';

    if (pos === 0) {
      this.pad(chord, t, eighth * 8);
      this.bass(chord[0] - 12, t, eighth * (ballad ? 6 : 3));
    }
    if (!ballad && pos === 4) this.bass(chord[0] - 12, t, eighth * 3);

    // Piano arpeggio
    const arp = ballad ? [0, 1, 2, 1, 0 + 12, 1, 2, 1] : [0, 2, 1, 2, 0 + 12, 2, 1, 2];
    const a = arp[pos];
    const midi = a >= 12 ? chord[0] + 12 + 12 : chord[a] + 12;
    this.pluck(midi, t, ballad ? 0.11 : 0.08, ballad ? 1.6 : 0.9);

    // A simple melody now and then
    if (pos % 2 === 0 && Math.random() < (ballad ? 0.45 : 0.5)) {
      const pool = PENTA.filter((n) => chord.some((c) => (n - c) % 12 === 0) || Math.random() < 0.3);
      const n = pool[Math.floor(Math.random() * pool.length)] ?? 72;
      this.lead(n + 12, t, eighth * (ballad ? 2 : 1.5));
    }

    if (!ballad) {
      if (pos === 0 || pos === 4) this.kick(t);
      if (pos === 2 || pos === 6) this.clap(t);
      this.hat(t, pos % 2 === 1 ? 0.05 : 0.025);
    } else if (pos === 0) {
      this.kick(t, 0.35);
    }
  }

  private env(t: number, peak: number, attack: number, release: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
    return g;
  }

  private send(node: AudioNode, dry = 1) {
    const g = this.ctx.createGain();
    g.gain.value = dry;
    node.connect(g).connect(this.out);
    node.connect(this.reverb);
  }

  private pad(chord: number[], t: number, len: number) {
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const g = this.env(t, 0.05, len * 0.3, len * 0.85);
    filter.connect(g);
    this.send(g, 0.8);
    for (const n of chord) {
      for (const detune of [-6, 6]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = NOTE(n + 12);
        o.detune.value = detune;
        o.connect(filter);
        o.start(t);
        o.stop(t + len * 1.2);
      }
    }
  }

  private bass(midi: number, t: number, len: number) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = NOTE(midi);
    const g = this.env(t, 0.22, 0.02, len);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + len + 0.1);
  }

  private pluck(midi: number, t: number, peak: number, release: number) {
    const o = this.ctx.createOscillator();
    const o2 = this.ctx.createOscillator();
    o.type = 'triangle';
    o2.type = 'sine';
    o.frequency.value = NOTE(midi);
    o2.frequency.value = NOTE(midi) * 2;
    const g = this.env(t, peak, 0.005, release);
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2).connect(g);
    this.send(g);
    o.start(t);
    o2.start(t);
    o.stop(t + release + 0.1);
    o2.stop(t + release + 0.1);
  }

  private lead(midi: number, t: number, len: number) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = NOTE(midi);
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 5;
    lfoGain.gain.value = 4;
    lfo.connect(lfoGain).connect(o.frequency);
    const g = this.env(t, 0.06, 0.04, len);
    o.connect(g);
    this.send(g, 0.7);
    o.start(t);
    lfo.start(t);
    o.stop(t + len + 0.1);
    lfo.stop(t + len + 0.1);
  }

  private kick(t: number, peak = 0.5) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = this.env(t, peak, 0.003, 0.25);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.3);
  }

  private noiseHit(t: number, freq: number, peak: number, release: number, type: BiquadFilterType) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.env(t, peak, 0.002, release);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + release + 0.05);
  }

  private hat(t: number, peak: number) {
    this.noiseHit(t, 8000, peak, 0.05, 'highpass');
  }

  private clap(t: number) {
    this.noiseHit(t, 1500, 0.12, 0.15, 'bandpass');
  }

  private impulse(seconds: number) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }
}
