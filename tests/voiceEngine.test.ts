import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VoiceEngine, finalizeWav } from '../voiceEngine';
import { DEFAULT_VOICE_SETTINGS, validVoiceSettings } from '../src/voiceSettings';

const wav = () => {
  const b = Buffer.alloc(48);
  b.write('RIFF'); b.writeUInt32LE(40, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(48000, 24); b.writeUInt32LE(96000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(4, 40);
  return b;
};
const voices = { data: [{ id: 'nu', name: 'Giọng nữ', gender: 'female' }, { id: 'nam', name: 'Giọng nam', gender: 'male' }] };

test('VieNeu routes Vietnamese by teacher, caches/deduplicates WAV and keeps Chinese on its own engine', async () => {
  const requests: { input: string; voice: string; response_format: string }[] = [];
  let legacy = 0;
  const engine = new VoiceEngine(undefined, {
    legacy: async () => { legacy++; return Buffer.from('mp3'); },
    fetch: (async (url, init) => {
      if (String(url).endsWith('/voices')) return Response.json(voices);
      assert.ok(String(url).endsWith('/v1/audio/speech'));
      requests.push(JSON.parse(String(init!.body)));
      return new Response(wav());
    }) as typeof fetch,
  });
  const both = await Promise.all([engine.synthesize('Xin chào', 'vi', 'female'), engine.synthesize('Xin chào', 'vi', 'female')]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].voice, 'nu');
  assert.equal(requests[0].response_format, 'wav');
  assert.equal(both[0].contentType, 'audio/wav');
  await engine.synthesize('Xin chào', 'vi', 'male');
  assert.equal(requests[1].voice, 'nam');
  await engine.synthesize('Xin chào', 'vi', 'female');
  assert.equal(requests.length, 2);
  const chinese = await engine.synthesize('你好', 'zh', 'male');
  assert.equal(chinese.contentType, 'audio/mpeg');
  assert.equal(legacy, 1);
  assert.equal(engine.stats().pending, 0);
});

test('fallback is temporary, never cached as VieNeu, and checking recovers a restarted model', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  let healthy = false, requests = 0, fallback = 0;
  const engine = new VoiceEngine(DEFAULT_VOICE_SETTINGS, {
    legacy: async () => { fallback++; return Buffer.from('fallback'); },
    fetch: (async (url) => {
      requests++;
      if (!healthy) throw new Error('offline');
      return String(url).endsWith('/voices') ? Response.json(voices) : new Response(wav());
    }) as typeof fetch,
  });
  assert.equal((await engine.synthesize('Lớp học', 'vi', 'female')).provider, 'edge');
  assert.equal(engine.state().status, 'unavailable');
  await engine.synthesize('Lớp học', 'vi', 'female');
  assert.equal(requests, 1);
  assert.equal(fallback, 1);
  healthy = true;
  await engine.refresh();
  assert.equal((await engine.synthesize('Lớp học', 'vi', 'female')).provider, 'vieneu');
  assert.equal(engine.state().status, 'ready');
});

test('bad audio falls back without caching it; voice and provider changes use different audio', async () => {
  let bad = true, lastVoice = '', preferred = 0;
  const engine = new VoiceEngine(undefined, {
    apiKey: 'test-key', legacy: async () => Buffer.from('fallback'),
    fetch: (async (url, init) => {
      assert.equal((init!.headers as Record<string, string>).Authorization, 'Bearer test-key');
      if (String(url).endsWith('/voices')) return Response.json(voices);
      preferred++;
      lastVoice = JSON.parse(String(init!.body)).voice;
      return bad ? Response.json({ error: 'not audio' }) : new Response(wav());
    }) as typeof fetch,
  });
  assert.equal((await engine.synthesize('Thử giọng', 'vi', 'female')).provider, 'edge');
  bad = false;
  await engine.refresh();
  engine.update({ provider: 'vieneu', femaleVoice: 'custom', maleVoice: '' });
  assert.equal((await engine.synthesize('Thử giọng', 'vi', 'female')).provider, 'vieneu');
  assert.equal(lastVoice, 'custom');
  engine.update({ provider: 'edge', femaleVoice: 'custom', maleVoice: '' });
  assert.equal((await engine.synthesize('Thử giọng', 'vi', 'female')).provider, 'edge');
  assert.equal(preferred, 2);
  assert.ok(!JSON.stringify(engine.state()).includes('test-key'));
  assert.throws(() => engine.update({ provider: 'other' }));
  assert.equal(validVoiceSettings({ provider: 'vieneu', femaleVoice: '\n', maleVoice: '' }), false);
});

test('streamed WAV headers are finalized, while empty/truncated/non-WAV bodies are rejected', () => {
  const original = wav();
  original.writeUInt32LE(0xffffffff, 4);
  original.writeUInt32LE(0xffffffff, 40);
  const fixed = finalizeWav(original);
  assert.equal(fixed.readUInt32LE(4), 40);
  assert.equal(fixed.readUInt32LE(40), 4);
  assert.equal(original.readUInt32LE(40), 0xffffffff);
  assert.throws(() => finalizeWav(Buffer.from('not a wav')));
  const empty = wav(); empty.writeUInt32LE(0, 40);
  assert.throws(() => finalizeWav(empty));
  const truncated = wav(); truncated.writeUInt32LE(10, 40);
  assert.throws(() => finalizeWav(truncated));
});
