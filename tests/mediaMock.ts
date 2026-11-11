import type { TestContext } from 'node:test';

export class MockAudio extends EventTarget {
  static live = new Set<MockAudio>();
  static peak = 0;
  static block = false;
  static playing: MockAudio | null = null;
  src: string;
  preload = '';
  volume = 1;
  paused = true;
  loads = 0;

  constructor(src: string) {
    super();
    this.src = src;
    MockAudio.live.add(this);
    MockAudio.peak = Math.max(MockAudio.peak, MockAudio.live.size);
  }
  play() {
    if (MockAudio.block) return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    this.paused = false;
    MockAudio.playing = this;
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  }
  pause() { this.paused = true; if (MockAudio.playing === this) MockAudio.playing = null; }
  removeAttribute(name: string) { if (name === 'src') { this.src = ''; MockAudio.live.delete(this); } }
  load() { this.loads++; }
  end() { this.dispatchEvent(new Event('ended')); }
}

export function installMedia(t: TestContext) {
  MockAudio.live.clear();
  MockAudio.peak = 0;
  MockAudio.block = false;
  MockAudio.playing = null;
  const win = new EventTarget();
  for (const [key, value] of Object.entries({ window: win, Audio: MockAudio })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key); });
  }
  return win;
}
