import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as flush } from 'node:timers/promises';
import { SoundEngine } from '../src/sound';
import { SocialBuffer, pruneCooldowns } from '../retention';
import { TtsService, AudioCache } from '../ttsCache';
import { CommentRouter } from '../comments';
import { Quiz } from '../quiz';
import { installMedia, MockAudio } from './mediaMock';

test('two simulated hours: voice bursts, unique TTS, cooldowns, social rushes, Q&A and disposal', async (t) => {
  const sound = new SoundEngine();
  t.after(() => sound.shutdown());
  installMedia(t);
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1000000 });
  const router = new CommentRouter(new Quiz(() => {}, {}), () => {}, { enabled: false });
  t.after(() => router.dispose());
  sound.setMusic({ on: false, style: 'files', volume: 0.1 });
  sound['becomeHolder']();
  const cache = new AudioCache(32 * 1024 * 1024, 300);
  const tts = new TtsService(cache);
  const cooldown = new Map<string, number>();
  const social = new SocialBuffer();
  let maxCacheBytes = 0;
  let maxCooldown = 0;
  let socialCount = 0;
  let expired = 0;
  for (let second = 0; second < 7200; second++) {
    t.mock.timers.tick(1000);
    const user = { username: `viewer-${second}`, nickname: 'Student', avatar: '' };
    cooldown.set(user.username, Date.now());
    router.handle(user, 'điểm');
    social.add(user.nickname, second % 2 ? 'follow' : 'share');
    sound.setQuestion(Math.floor(second / 24));
    sound.group(() => {
      sound.say(`Vietnamese ${second}`, true);
      sound.say(`中文${second}`, true, undefined, 'zh');
    }, Math.floor(second / 24));
    if (second % 60 === 0) {
      for (let burst = 0; burst < 200; burst++) {
        social.add('New viewer', 'follow');
        sound.group(() => { sound.say('gift vi', true); sound.say('gift zh', true, undefined, 'zh'); });
      }
    }
    if (MockAudio.playing && second % 2 === 0) {
      if (second % 100 === 0) { MockAudio.playing.dispatchEvent(new Event('error')); expired++; }
      else MockAudio.playing.end();
    }
    await tts.get(`unique-${second}`, async () => Buffer.alloc(128 * 1024));
    if (second % 30 === 0) pruneCooldowns(cooldown, 120000);
    if (second % 8 === 0) {
      const batch = social.take();
      socialCount += batch.items.length + batch.extra.follow + batch.extra.share;
    }
    maxCacheBytes = Math.max(maxCacheBytes, cache.bytes);
    maxCooldown = Math.max(maxCooldown, cooldown.size);
    assert.ok(sound.stats().priority <= 24);
    assert.ok(sound.stats().ordinary <= 6);
    assert.ok(MockAudio.live.size <= 2);
    assert.ok(social.stats().named <= 24);
    assert.ok(cache.bytes <= 32 * 1024 * 1024);
    assert.ok(cache.size <= 300);
  }
  while (MockAudio.playing) MockAudio.playing.end();
  while (social.size) {
    const batch = social.take();
    socialCount += batch.items.length + batch.extra.follow + batch.extra.share;
  }
  t.mock.timers.tick(150000);
  pruneCooldowns(cooldown, 120000);
  await flush();
  assert.equal(MockAudio.live.size, 0);
  assert.equal(cooldown.size, 0);
  assert.equal(router.stats().quickCooldowns, 0);
  assert.equal(tts.stats().pending, 0);
  assert.equal(tts.stats().active, 0);
  assert.equal(socialCount, 7200 + 120 * 200);
  assert.ok(MockAudio.peak <= 2);
  console.info(JSON.stringify({ simulatedHours: 2, peakVoiceAudio: MockAudio.peak, maxCacheBytes,
    maxCooldown, socialEvents: socialCount, audioErrors: expired, retainedAudioAfterDrain: MockAudio.live.size }));
});
