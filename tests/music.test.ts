import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MusicSynth } from '../src/music';

class Parameter {
  value = 0;
  setValueAtTime() {}
  setTargetAtTime() {}
  exponentialRampToValueAtTime() {}
}

class Node {
  gain = new Parameter();
  frequency = new Parameter();
  detune = new Parameter();
  buffer: unknown = null;
  type = '';
  onended: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private ctx: Context) { ctx.nodes.add(this); }
  connect(destination: Node | Parameter) { return destination; }
  disconnect() { this.ctx.nodes.delete(this); }
  start() {}
  stop(at = this.ctx.currentTime) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.onended?.(), Math.max(0, at - this.ctx.currentTime) * 1000);
  }
}

class Context {
  readonly nodes = new Set<Node>();
  readonly destination = new Node(this);
  readonly sampleRate = 8000;
  private start = Date.now();
  get currentTime() { return (Date.now() - this.start) / 1000; }
  createGain() { return new Node(this); }
  createConvolver() { return new Node(this); }
  createOscillator() { return new Node(this); }
  createBiquadFilter() { return new Node(this); }
  createBufferSource() { return new Node(this); }
  createBuffer(channels: number, length: number) {
    const samples = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (index: number) => samples[index] };
  }
}

test('synthesized music releases completed voices and disconnects the full graph when stopped', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: 1000000 });
  for (const style of ['ballad', 'vui'] as const) {
    const ctx = new Context();
    const synth = new MusicSynth(ctx as unknown as AudioContext, ctx.destination as unknown as AudioNode, style);
    synth.start();
    for (let second = 0; second < 600; second++) {
      t.mock.timers.tick(1000);
      // An unbounded graph grows on every note; a live graph only contains
      // voices still sounding and the small shared reverb/output graph.
      assert.ok(ctx.nodes.size < 400, `live graph grew to ${ctx.nodes.size} nodes`);
    }
    synth.stop();
    t.mock.timers.tick(10000);
    assert.equal(ctx.nodes.size, 1); // external destination only
    synth.stop();
    t.mock.timers.tick(10000);
    assert.equal(ctx.nodes.size, 1);
  }
});
