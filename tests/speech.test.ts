import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SpeechQueue, type SpeechGroup } from '../src/speechQueue';

const message = (prefix: string, count: number, urgent = false, question?: number): SpeechGroup => ({
  lines: Array.from({ length: count }, (_, i) => ({ text: `${prefix}${i}`, lang: i % 2 ? 'zh' : 'vi' })), urgent, question,
});

test('overload drops complete waiting messages and finishes an active message together', () => {
  const queue = new SpeechQueue();
  queue.add(message('active', 3));
  assert.equal(queue.take()?.text, 'active0');
  queue.add(message('old', 4));
  queue.add(message('recent', 4));
  queue.add(message('urgent', 2, true));
  assert.equal(queue.stats().ordinary, 4);
  assert.equal(queue.take()?.text, 'active1');
  assert.equal(queue.take()?.text, 'active2');
  assert.equal(queue.take()?.text, 'urgent0');
  assert.equal(queue.take()?.text, 'urgent1');
  assert.equal(queue.take()?.text, 'recent0');
});

test('protect current quiz under gift bursts, cancel stale quiz on next question', () => {
  const queue = new SpeechQueue();
  queue.setQuestion(1);
  queue.add(message('quiz', 3, true, 1));
  for (let i = 0; i < 1000; i++) queue.add(message(`gift${i}`, 4, true));
  assert.ok(queue.stats().priority <= 24);
  assert.equal(queue.take()?.text, 'quiz0');
  assert.equal(queue.setQuestion(2), true);
  assert.ok(!queue.peek()?.text.startsWith('quiz'));
  queue.clear();
  assert.equal(queue.peek(), undefined);
});

test('repeated same-question announcements and oversize messages stay bounded', () => {
  const queue = new SpeechQueue();
  queue.setQuestion(1);
  for (let i = 0; i < 1000; i++) queue.add(message('quiz', 3, true, 1));
  assert.equal(queue.stats().priority, 24);
  queue.add(message('oversize', 25, true));
  assert.equal(queue.stats().priority, 24);
  queue.setQuestion(null);
  assert.equal(queue.stats().priority, 0);
});

test('quiz speech goes ahead of a gift backlog and resumes a partially spoken gift afterwards', () => {
  const queue = new SpeechQueue();
  queue.add(message('gift', 3, true));
  assert.equal(queue.take()?.text, 'gift0');
  queue.add(message('waiting-gift', 3, true));
  queue.setQuestion(1);
  queue.add(message('quiz', 2, true, 1));
  assert.equal(queue.peek()?.text, 'quiz0');
  assert.equal(queue.take()?.text, 'quiz0');
  assert.equal(queue.take()?.text, 'quiz1');
  assert.equal(queue.peek()?.text, 'gift1');
  assert.equal(queue.take()?.text, 'gift1');
  assert.equal(queue.take()?.text, 'gift2');
  assert.equal(queue.take()?.text, 'waiting-gift0');
});
