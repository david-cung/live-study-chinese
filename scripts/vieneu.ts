import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = path.join(root, '.vieneu');
const python = path.join(runtime, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const certFile = path.join(runtime, 'system-ca.pem');
const env: NodeJS.ProcessEnv = { ...process.env, UV_CACHE_DIR: path.join(runtime, 'uv-cache'), HF_HOME: path.join(runtime, 'models'), PYTHONUNBUFFERED: '1',
  UV_CONCURRENT_DOWNLOADS: process.env.UV_CONCURRENT_DOWNLOADS || '2', UV_CONCURRENT_INSTALLS: process.env.UV_CONCURRENT_INSTALLS || '1', UV_LINK_MODE: 'copy' };
if (fs.existsSync(certFile)) {
  env.SSL_CERT_FILE ||= certFile;
  env.REQUESTS_CA_BUNDLE ||= certFile;
}
const has = (exe: string) => spawnSync(exe, ['--version'], { stdio: 'ignore', windowsHide: true }).status === 0;
async function run(exe: string, args: string[]) {
  const child = spawn(exe, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
  const stop = () => child.kill('SIGTERM');
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 || signal === 'SIGTERM' ? resolve() : reject(new Error(`Command exited ${code}`)));
    });
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}

try {
  if (process.argv[2] === 'setup') {
    fs.mkdirSync(runtime, { recursive: true });
    const installed = fs.existsSync(python) && spawnSync(python, ['-c', 'import vieneu; import importlib.metadata; assert importlib.metadata.version("vieneu") == "3.8.4"'], { env, stdio: 'ignore', windowsHide: true }).status === 0;
    if (installed) { console.info('VieNeu 3.8.4 đã được cài trong project.'); process.exit(0); }
    if (has('uv')) {
      if (!fs.existsSync(python)) await run('uv', ['venv', '--python', '3.11', path.join(runtime, 'venv')]);
    } else {
      const executable = ['python3', 'python', 'py'].find(has);
      if (!executable) throw new Error('Cần Python 3.10+ hoặc uv để cài VieNeu.');
      if (!fs.existsSync(python)) await run(executable, ['-m', 'venv', path.join(runtime, 'venv')]);
    }
    if (process.platform === 'win32' && !process.env.SSL_CERT_FILE && !process.env.REQUESTS_CA_BUNDLE) {
      await run(python, [path.join(root, 'scripts/system_certs.py'), certFile]);
      env.SSL_CERT_FILE = certFile;
      env.REQUESTS_CA_BUNDLE = certFile;
    }
    await run(python, ['-m', 'ensurepip', '--upgrade']);
    await run(python, ['-m', 'pip', 'install', '-r', path.join(root, 'scripts/requirements-vieneu.txt'), ...(env.SSL_CERT_FILE ? ['--cert', env.SSL_CERT_FILE] : [])]);
    console.info('Đã cài bộ giọng Việt. Chạy npm run voice:start để tải model và mở giọng.');
  } else if (process.argv[2] === 'start') {
    if (!fs.existsSync(python)) throw new Error('Chạy npm run voice:setup trước để cài bộ giọng Việt.');
    const port = Number(process.env.VIENEU_PORT || 8000);
    const existing = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) }).then((r) => r.json()).catch(() => null);
    if (existing?.service === 'live-study-chinese-vieneu') console.info(`Bộ giọng Việt đã mở (${existing.status}) tại cổng ${port}.`);
    else await run(python, [path.join(root, 'scripts/vieneu_server.py'), '--port', String(port)]);
  } else throw new Error('Dùng npm run voice:setup hoặc npm run voice:start.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Không khởi động được VieNeu.');
  process.exitCode = 1;
}
