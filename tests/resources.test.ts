import assert from 'node:assert/strict';
import { setImmediate as flush } from 'node:timers/promises';
import { test } from 'node:test';
import { AudioCache, TtsService, TtsBusyError } from '../ttsCache';
import { SocialBuffer, pruneCooldowns } from '../retention';
import { LiveSession } from '../liveSession';
import { Quiz } from '../quiz';
import { CommentRouter } from '../comments';

test('audio cache evicts by LRU and bytes, including replacement and oversize audio', () => {
  const cache = new AudioCache(10, 3);
  cache.set('a', Buffer.alloc(4));
  cache.set('b', Buffer.alloc(4));
  cache.get('a');
  cache.set('c', Buffer.alloc(4));
  assert.equal(cache.get('b'), undefined);
  cache.set('a', Buffer.alloc(1));
  assert.equal(cache.bytes, 5);
  cache.set('c', Buffer.alloc(11));
  assert.equal(cache.bytes, 1);
  for (let i = 0; i < 10; i++) cache.set(String(i), Buffer.alloc(1));
  assert.equal(cache.size, 3);
  assert.equal(cache.bytes, 3);
});

test('TTS deduplicates requests, bounds running/waiting jobs, and releases failures', async () => {
  const service = new TtsService(new AudioCache(100, 10), 2, 1);
  const releases: (() => void)[] = [];
  let active = 0;
  let peak = 0;
  let calls = 0;
  const produce = async () => {
    calls++;
    peak = Math.max(peak, ++active);
    await new Promise<void>((resolve) => releases.push(resolve));
    active--;
    return Buffer.from('audio');
  };
  const a = service.get('a', produce);
  assert.equal(a, service.get('a', produce));
  const b = service.get('b', produce);
  const c = service.get('c', produce);
  await assert.rejects(service.get('d', produce), TtsBusyError);
  await flush();
  assert.equal(calls, 2);
  releases.shift()!();
  await a;
  await flush();
  assert.equal(calls, 3);
  releases.splice(0).forEach((release) => release());
  await Promise.all([b, c]);
  await flush();
  assert.equal(peak, 2);
  assert.equal(service.stats().pending, 0);
  assert.equal(service.stats().active, 0);
  await service.get('a', () => { throw new Error('cached key must not synthesize'); });
  await assert.rejects(service.get('error', () => { throw new Error('offline'); }), /offline/);
  await flush();
  assert.equal(service.stats().pending, 0);
  assert.equal((await service.get('error', async () => Buffer.from('retry'))).toString(), 'retry');
});

test('cooldowns expire and social rushes retain a fixed number of names', () => {
  const cooldown = new Map([['old', 1], ['recent', 99]]);
  pruneCooldowns(cooldown, 50, 100);
  assert.deepEqual([...cooldown.keys()], ['recent']);
  const social = new SocialBuffer(24);
  for (let i = 0; i < 10000; i++) social.add(`user-${i}`, i % 2 ? 'follow' : 'share');
  assert.equal(social.stats().named, 24);
  let count = 0;
  while (social.size) {
    const batch = social.take();
    count += batch.items.length + batch.extra.follow + batch.extra.share;
  }
  assert.equal(count, 10000);
  assert.equal(social.stats().named, 0);
});

test('same-room reconnect preserves session benefits and scores', () => {
  const session = new LiveSession();
  const quiz = new Quiz(() => {}, {});
  assert.equal(session.enter('teacher', 'room1'), true);
  const user = { username: 'student', nickname: 'Student' };
  session.named.add(user.username);
  session.followed.add(user.username);
  session.totalLikes = 1200;
  quiz.awardPoints(user, 5);
  quiz.vip(user.username);
  assert.equal(session.enter('teacher', 'room1'), false);
  assert.equal(session.enter('teacher', ''), false);
  assert.equal(session.named.has(user.username), true);
  assert.equal(session.followed.has(user.username), true);
  assert.equal(session.totalLikes, 1200);
  assert.equal(quiz.rankOf(user.username)?.points, 5);
  assert.equal(quiz.memoryStats().vip, 1);
  assert.equal(session.enter('teacher', 'room2'), true);
  assert.equal(session.named.size, 0);
  assert.equal(session.followed.size, 0);
  assert.equal(session.totalLikes, 0);
  quiz.clearSessionBenefits();
  assert.equal(quiz.memoryStats().vip, 0);
  assert.equal(quiz.rankOf(user.username)?.points, 5);
});

test('manual pins and approvals also respect the Q&A outbox bound', () => {
  const router = new CommentRouter(new Quiz(() => {}, {}), () => {}, { enabled: false });
  try {
    for (let i = 0; i < 1000; i++) router.pin({ username: String(i), nickname: 'Student', avatar: '' }, 'hello');
    assert.equal(router.stats().outbox, 6);
  } finally { router.dispose(); }
});
