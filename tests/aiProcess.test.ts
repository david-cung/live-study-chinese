import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAiProcess, aiProcessStats } from '../aiProcess';

const run = (source: string, cwd: string, timeoutMs = 3000, maxOutputBytes = 65536) => runAiProcess({
  bin: process.execPath, args: ['-e', source], input: 'hello', cwd, timeoutMs, maxOutputBytes,
});

test('AI output, single-flight lock, failure, and timeout cleanup', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'live-ai-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const first = run("process.stdin.resume(); process.stdin.on('end', () => setTimeout(() => console.log('reply'), 30))", cwd);
  await assert.rejects(run('console.log("overlap")', cwd), /chưa dọn/);
  assert.equal((await first).trim(), 'reply');
  assert.equal(aiProcessStats().active, 0);
  await assert.rejects(run("process.stderr.write('broken'); process.exitCode = 2", cwd), /broken/);
  assert.equal(aiProcessStats().active, 0);
  await assert.rejects(run("process.stdout.write('x'.repeat(100000)); setInterval(() => {}, 1000)", cwd, 3000, 1024), /quá nhiều/);
  assert.equal(aiProcessStats().active, 0);
  await assert.rejects(run("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)", cwd, 150), /quá 25 giây/);
  assert.equal(aiProcessStats().active, 0);
  assert.equal(aiProcessStats().cleanupFailed, false);
  assert.equal((await run("console.log('next request')", cwd)).trim(), 'next request');
  await assert.rejects(runAiProcess({ bin: path.join(cwd, 'missing-cli'), args: [], cwd, input: '' }), /Không chạy được/);
  assert.equal(aiProcessStats().active, 0);
  const multibyte = "const b = Buffer.from('Chào bạn 中文'); process.stdout.write(b.subarray(0, 3)); setTimeout(() => process.stdout.write(b.subarray(3)), 30);";
  assert.equal(await run(multibyte, cwd), 'Chào bạn 中文');
});

test('POSIX cleanup removes inherited-pipe descendants before allowing the next request', { skip: process.platform === 'win32' }, async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'live-ai-tree-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const childScript = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)";
  const source = `const {spawn} = require('node:child_process');
    const {writeFileSync} = require('node:fs');
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], {stdio: 'inherit'});
    writeFileSync('child.pid', String(child.pid));
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);`;
  await assert.rejects(run(source, cwd, 300), /quá 25 giây/);
  const pid = Number(await readFile(path.join(cwd, 'child.pid'), 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assert.equal(aiProcessStats().active, 0);
  assert.equal(aiProcessStats().cleanupFailed, false);
  assert.equal((await run("console.log('clean')", cwd)).trim(), 'clean');
});

test('POSIX cleans up descendants even if the top-level CLI exits successfully', { skip: process.platform === 'win32' }, async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'live-ai-exit-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const source = `const {spawn} = require('node:child_process');
    const {writeFileSync} = require('node:fs');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'inherit'});
    writeFileSync('child.pid', String(child.pid));
    console.log('reply'); process.exit(0);`;
  assert.equal((await run(source, cwd)).trim(), 'reply');
  const pid = Number(await readFile(path.join(cwd, 'child.pid'), 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assert.equal(aiProcessStats().active, 0);
});
