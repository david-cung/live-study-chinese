import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, cp, rm, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import type { QuizState } from '../src/types';
import { questionAnswer } from '../src/quizModes';

test('production serves built stage, bounds event bursts, releases SSE clients, and shuts down', { timeout: 20000 }, async (t) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const dir = await mkdtemp(path.join(os.tmpdir(), 'live-production-test-'));
  // A fixture working directory prevents test commands from touching the
  // operator's settings, real TikTok account, or live server on port 3002.
  await cp(path.join(root, 'content'), path.join(dir, 'content'), { recursive: true });
  await writeFile(path.join(dir, 'settings.json'), JSON.stringify({ ai: { enabled: false }, music: { on: false, style: 'files' }, autoTalkMinutes: 0 }));
  await cp(path.join(root, 'dist'), path.join(dir, 'dist'), { recursive: true });
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  let generated = 0;
  const requestedVoices: string[] = [];
  const speechServer = createHttpServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer fixture-key');
    if (req.url === '/v1/voices') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'female', name: 'Nữ', gender: 'female' }, { id: 'male', name: 'Nam', gender: 'male' }] }));
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requestedVoices.push(body.voice);
    generated++;
    const audio = Buffer.alloc(48);
    audio.write('RIFF'); audio.writeUInt32LE(40, 4); audio.write('WAVEfmt ', 8);
    audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
    audio.writeUInt32LE(48000, 24); audio.writeUInt32LE(96000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
    audio.write('data', 36); audio.writeUInt32LE(4, 40);
    res.setHeader('Content-Type', 'audio/wav'); res.end(audio);
  });
  speechServer.listen(0, '127.0.0.1');
  await once(speechServer, 'listening');
  t.after(() => new Promise<void>((resolve) => speechServer.close(() => resolve())));
  const speechPort = (speechServer.address() as { port: number }).port;
  const child = spawn(process.execPath, ['--import', pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href, path.join(root, 'scripts/start.ts')], {
    cwd: dir, env: { ...process.env, PORT: String(port), MEMORY_DIAGNOSTICS: '1', VIENEU_BASE_URL: `http://127.0.0.1:${speechPort}/v1`, VIENEU_API_KEY: 'fixture-key' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log = (log + d).slice(-4000); });
  child.stderr.on('data', (d) => { log = (log + d).slice(-4000); });
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null) { child.kill('SIGTERM'); await exited; }
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; ; attempt++) {
    try { const response = await fetch(`${base}/api/status`); if (response.ok) break; }
    catch { /* startup */ }
    assert.ok(attempt < 100 && child.exitCode === null, log);
    await delay(50);
  }
  const stage = await (await fetch(`${base}/?view=stage`)).text();
  assert.ok(stage.includes('/assets/'));
  assert.ok(!stage.includes('/@vite/client'));
  const control = async (text: string) => {
    const response = await fetch(`${base}/api/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test', text }) });
    assert.equal(response.status, 200);
    await response.body?.cancel();
  };
  for (let i = 0; i < 50; i++) await Promise.all(['follow', 'share', 'gift', 'likes', 'chat:điểm'].map(control));
  const snapshot = await (await fetch(`${base}/api/diagnostics`)).json();
  assert.ok(snapshot.social.named <= 24);
  assert.ok(snapshot.social.extraFollow + snapshot.social.extraShare > 0);
  assert.equal(snapshot.ai.active, 0);
  assert.ok(snapshot.comments.outbox <= 6);
  assert.ok(snapshot.session.followed <= 8);
  assert.ok(snapshot.session.named <= 8);
  assert.ok(snapshot.session.scores <= 8);
  assert.equal(snapshot.tts.cacheBytes, 0);
  assert.ok(!JSON.stringify(snapshot).includes('Student'));
  const abort = new AbortController();
  const events = await fetch(`${base}/api/events`, { signal: abort.signal });
  const reader = events.body!.getReader();
  const initial = new TextDecoder().decode((await reader.read()).value);
  assert.ok(initial.includes('event: status'));
  assert.ok(initial.includes('"action":"setTeacher","text":"female"'));
  assert.equal((await (await fetch(`${base}/api/diagnostics`)).json()).sseClients, 1);
  abort.abort();
  await reader.cancel().catch(() => {});
  for (const choice of ['male', 'female', 'male']) {
    const response = await fetch(`${base}/api/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'setTeacher', text: choice }) });
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(await readFile(path.join(dir, 'settings.json'), 'utf8')).teacher, choice);
  }
  const invalidTeacher = await fetch(`${base}/api/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'setTeacher', text: '../other' }) });
  assert.equal(invalidTeacher.status, 400);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'settings.json'), 'utf8')).teacher, 'male');
  const voices = await (await fetch(`${base}/api/voice?refresh=1`)).json();
  assert.equal(voices.status, 'ready');
  assert.equal(voices.voices.length, 2);
  assert.ok(!JSON.stringify(voices).includes('fixture-key'));
  const saveVoice = await fetch(`${base}/api/voice`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'vieneu', maleVoice: 'male', femaleVoice: 'female' }) });
  assert.equal(saveVoice.status, 200);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'settings.json'), 'utf8')).voice.maleVoice, 'male');
  const badVoice = await fetch(`${base}/api/voice`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'bad' }) });
  assert.equal(badVoice.status, 400);
  for (let i = 0; i < 2; i++) {
    const audio = await fetch(`${base}/api/tts?lang=vi&text=Xin%20chao`);
    assert.ok(audio.headers.get('content-type')?.startsWith('audio/wav'));
    assert.equal(audio.headers.get('x-tts-provider'), 'vieneu');
    assert.equal(audio.headers.get('cache-control'), 'no-store');
    assert.equal((await audio.arrayBuffer()).byteLength, 48);
  }
  assert.equal(generated, 1);
  assert.deepEqual(requestedVoices, ['male']);
  for (let attempt = 0; ; attempt++) {
    const clients = (await (await fetch(`${base}/api/diagnostics`)).json()).sseClients;
    if (!clients) break;
    assert.ok(attempt < 20);
    await delay(25);
  }
  const snapshotQuiz = async (): Promise<QuizState> => {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(`${base}/api/events`, { signal: controller.signal });
      const stream = response.body!.getReader();
      const decoder = new TextDecoder();
      let data = '';
      while (true) {
        const chunk = await stream.read();
        assert.ok(!chunk.done, 'SSE ended before quiz snapshot');
        data += decoder.decode(chunk.value, { stream: true });
        const match = /event: quiz\ndata: ([^\n]+)\n\n/.exec(data);
        if (match) return JSON.parse(match[1]);
      }
    } finally { clearTimeout(deadline); controller.abort(); }
  };
  for (const kind of ['fill', 'pinyin', 'reverse']) {
    for (const text of [`mode:${kind}`, 'skip']) {
      const response = await fetch(`${base}/api/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'quiz', text }) });
      assert.equal(response.status, 200);
      await response.body?.cancel();
    }
    const state = await snapshotQuiz();
    assert.equal(state.mode, kind);
    assert.equal(state.question?.kind, kind);
    assert.equal(state.question?.options.length, 4);
    assert.ok(state.question?.options.includes(questionAnswer(state.question)));
    if (kind === 'fill') assert.ok(state.question?.context?.sentence.includes('___'));
  }
  const invalidMode = await fetch(`${base}/api/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'quiz', text: 'mode:invalid' }) });
  assert.equal(invalidMode.status, 400);
  await invalidMode.body?.cancel();
  const settings = JSON.parse(await readFile(path.join(dir, 'settings.json'), 'utf8'));
  assert.equal(settings.ai.enabled, false);
  assert.equal(settings.quiz.mode, 'reverse');
  const command = async (text: string, expectedStatus = 200) => {
    const response = await fetch(`${base}/api/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'quiz', text }) });
    assert.equal(response.status, expectedStatus);
    await response.body?.cancel();
  };
  await command('activity:exam');
  for (const level of ['hsk1', 'hsk2', 'hsk3', 'hsk4', 'hsk5']) {
    await command(`lesson:${level}`);
    await command('start');
    let state = await snapshotQuiz();
    assert.equal(state.activity, 'exam');
    assert.equal(state.exam?.level, level);
    assert.equal(state.question?.endsAt, 0);
    assert.equal(state.question?.exam?.transcript, undefined);
    const audio = await (await fetch(`${base}/api/exam-listening/${state.question!.no}`)).json();
    assert.ok(audio.transcript.length > 0);
    await command(`openExam:${state.question!.no}`);
    state = await snapshotQuiz();
    assert.ok(state.question!.endsAt > Date.now());
    await command('skip');
    state = await snapshotQuiz();
    assert.equal(state.phase, 'reveal');
    assert.ok(state.question?.exam?.explanation);
    assert.equal(state.question?.exam?.transcript, audio.transcript);
  }
  await command('lesson:../other', 400);
  await command('activity:invalid', 400);
  const examSettings = JSON.parse(await readFile(path.join(dir, 'settings.json'), 'utf8'));
  assert.equal(examSettings.quiz.activity, 'exam');
  assert.equal(examSettings.quiz.examLevel, 'hsk5');
  await command('activity:study');
  assert.equal((await snapshotQuiz()).activity, 'study');
  child.kill('SIGTERM');
  const [code, signal] = await exited;
  // Windows terminates the process directly; POSIX delivers SIGTERM to the shutdown handler.
  if (process.platform === 'win32') assert.ok(code === 0 || (code === null && signal === 'SIGTERM'), log);
  else assert.equal(code, 0, log);
});
