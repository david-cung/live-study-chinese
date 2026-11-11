import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { test } from 'node:test';
import { setImmediate as flush } from 'node:timers/promises';
import { SoundEngine } from '../src/sound';
import { installMedia, MockAudio } from './mediaMock';

function enable(engine: SoundEngine) {
  engine.setMusic({ on: false, volume: 0.1, style: 'files' });
  engine['becomeHolder']();
}

test('voice burst uses at most two media resources and frees all listeners on completion/shutdown', (t) => {
  const engine = new SoundEngine();
  t.after(() => engine.shutdown());
  installMedia(t);
  enable(engine);
  for (let i = 0; i < 1000; i++) engine.group(() => {
    engine.say(`Vietnamese ${i}`, true);
    engine.say(`中文${i}`, true, undefined, 'zh');
  });
  assert.ok(MockAudio.peak <= 2);
  assert.ok(engine.stats().priority <= 24);
  const first = MockAudio.playing!;
  first.end();
  assert.equal(first.src, '');
  assert.equal(first.loads, 1);
  for (const event of ['playing', 'ended', 'error']) assert.equal(getEventListeners(first, event).length, 0);
  while (MockAudio.playing) MockAudio.playing.end();
  assert.equal(MockAudio.live.size, 0);
  assert.equal(engine.stats().activeAudio, 0);
  engine.say('stop me');
  engine.say('preload me');
  engine.shutdown();
  assert.equal(MockAudio.live.size, 0);
  assert.equal(engine.stats().ordinary, 0);
});

test('autoplay rejection keeps text only, retries once unlocked, and timeout cancels old playback', async (t) => {
  const engine = new SoundEngine();
  t.after(() => engine.shutdown());
  installMedia(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  enable(engine);
  MockAudio.block = true;
  engine.group(() => { engine.say('vi', true); engine.say('zh', true, undefined, 'zh'); });
  await flush();
  assert.equal(engine.blocked, true);
  assert.equal(MockAudio.live.size, 0);
  for (let i = 0; i < 1000; i++) engine.say(`new ${i}`, true);
  assert.ok(engine.stats().priority <= 24);
  assert.equal(MockAudio.live.size, 0);
  MockAudio.block = false;
  engine['setBlocked'](false);
  engine['next']();
  const current = MockAudio.playing!;
  assert.ok(current.src.includes('text=vi'));
  t.mock.timers.tick(30000);
  assert.equal(current.paused, true);
  assert.equal(current.src, '');
  assert.equal(getEventListeners(current, 'ended').length, 0);
  assert.ok(MockAudio.live.size <= 2);
  engine.shutdown();
  t.mock.timers.tick(60000);
  assert.equal(MockAudio.live.size, 0);
});

test('changing question cancels stale audio and its prefetch', (t) => {
  const engine = new SoundEngine();
  t.after(() => engine.shutdown());
  installMedia(t);
  enable(engine);
  engine.setQuestion(1);
  engine.group(() => { engine.say('question1', true); engine.say('old translation', true); }, 1);
  const old = MockAudio.playing!;
  engine.setQuestion(2);
  assert.equal(old.src, '');
  assert.equal(MockAudio.live.size, 0);
  engine.group(() => engine.say('question2', true), 2);
  assert.ok(MockAudio.playing!.src.includes('question2'));
});

test('new quiz speech interrupts a gift at a segment boundary and reuses at most one prefetch', (t) => {
  const engine = new SoundEngine();
  t.after(() => engine.shutdown());
  installMedia(t);
  enable(engine);
  engine.group(() => { engine.say('gift1', true); engine.say('gift2', true); });
  engine.group(() => {
    engine.setQuestion(1);
    engine.say('quiz', true);
  }, 1);
  MockAudio.playing!.end();
  assert.ok(MockAudio.playing!.src.includes('quiz'));
  MockAudio.playing!.end();
  assert.ok(MockAudio.playing!.src.includes('gift2'));
  assert.ok(MockAudio.peak <= 2);
});

test('late playlist fetch cannot restart music after shutdown', async (t) => {
  const engine = new SoundEngine();
  t.after(() => engine.shutdown());
  installMedia(t);
  let resolve!: (value: Response) => void;
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>((done) => { resolve = done; }));
  engine['becomeHolder']();
  engine.shutdown();
  resolve(new Response(JSON.stringify(['/music/song.mp3'])));
  await flush();
  assert.equal(MockAudio.live.size, 0);
});

test('volume changes keep playlist advancing, changing tracks releases the previous media', async (t) => {
  const engine = new SoundEngine();
  t.after(() => engine.shutdown());
  installMedia(t);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(['/music/one.mp3', '/music/two.mp3'])));
  engine['becomeHolder']();
  await flush();
  const first = MockAudio.playing!;
  engine.setMusic({ on: true, style: 'files', volume: 0.2 });
  await flush();
  first.end();
  await flush();
  assert.equal(first.src, '');
  assert.ok(MockAudio.playing!.src.endsWith('two.mp3'));
  engine.nextTrack();
  await flush();
  assert.equal(MockAudio.live.size, 1);
  engine.shutdown();
  assert.equal(MockAudio.live.size, 0);
});
