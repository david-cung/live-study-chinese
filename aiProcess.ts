import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

let running: { child: ChildProcess; stop: (error: Error) => void } | null = null;
let cleanupFailed = false;

export function aiProcessStats() {
  return { active: running ? 1 : 0, pid: running?.child.pid ?? null, cleanupFailed };
}

export function stopAiProcess() {
  running?.stop(new Error('Ứng dụng đang dừng'));
}

// A separate process group lets us kill only the CLI and descendants launched
// for this request. Never kill unrelated Cursor/editor processes by name.
export function runAiProcess(options: {
  bin: string; args: string[]; cwd: string; input: string;
  timeoutMs?: number; maxOutputBytes?: number;
}): Promise<string> {
  if (running || cleanupFailed) return Promise.reject(new Error('AI đang chạy hoặc chưa dọn xong tiến trình trước'));
  const win = process.platform === 'win32';
  const child = spawn(win ? `"${options.bin}"` : options.bin, win ? options.args.map((a) => `"${a}"`) : options.args, {
    cwd: options.cwd, shell: win, windowsHide: true, detached: !win,
  });
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let bytes = 0;
    let failure: Error | null = null;
    let closed = false;
    let cleaned = false;
    let cleaning = false;
    let code: number | null = null;
    let signalError: Error | null = null;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let force: ReturnType<typeof setTimeout> | undefined;
    let drain: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => stop(new Error('AI trả lời quá 25 giây')), options.timeoutMs ?? 25000);

    const finish = () => {
      if (!closed || !cleaned) return;
      clearTimeout(timeout);
      clearTimeout(poll);
      clearTimeout(force);
      clearTimeout(drain);
      child.stdin?.removeAllListeners();
      child.stdout?.removeAllListeners();
      child.stderr?.removeAllListeners();
      running = null;
      if (failure) reject(failure);
      else if (code === 0) resolve(stdout);
      else reject(new Error((stderr || stdout).trim().split('\n').slice(-2).join(' ').slice(0, 200) || `cursor-agent thoát với mã ${code}`));
    };
    const signalGroup = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ESRCH') signalError = err as Error;
      }
    };
    const clean = () => {
      if (cleaning) return;
      cleaning = true;
      clearTimeout(timeout);
      if (!child.pid) { cleaned = true; finish(); return; }
      drain = setTimeout(() => {
        if (closed && cleaned) return;
        // A daemon that deliberately leaves the group may still hold a pipe.
        // Bound our own resources, report failed cleanup, and fail closed.
        cleanupFailed = true;
        failure ??= new Error('Không dọn xong tiến trình AI; hãy khởi động lại ứng dụng');
        child.stdin?.destroy();
        child.stdout?.destroy();
        child.stderr?.destroy();
        closed = true;
        cleaned = true;
        finish();
      }, 5500);
      if (win) {
        // On timeout the shell must still be alive when taskkill enumerates its
        // tree. Do not reject/release the single-flight lock before it exits.
        if (!closed || failure) {
          execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, (error) => {
            if (error && !closed) { failure ??= error; cleanupFailed = true; }
            cleaned = true;
            finish();
          });
        } else { cleaned = true; finish(); }
        return;
      }
      signalGroup('SIGTERM');
      const deadline = Date.now() + 5000;
      force = setTimeout(() => signalGroup('SIGKILL'), 500);
      const check = () => {
        try {
          process.kill(-child.pid!, 0);
          if (Date.now() < deadline) { poll = setTimeout(check, 25); return; }
          cleanupFailed = true;
          failure ??= signalError ?? new Error('Không dọn được nhóm tiến trình AI; hãy khởi động lại ứng dụng');
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
            // macOS can briefly report EPERM while an orphaned process group
            // is being reaped. Require disappearance, rather than treating
            // that transition as success or immediately disabling AI.
            if (Date.now() < deadline) { poll = setTimeout(check, 25); return; }
            cleanupFailed = true;
            failure ??= err as Error;
          }
        }
        clearTimeout(force);
        cleaned = true;
        finish();
      };
      check();
    };
    function stop(error: Error) {
      failure ??= error;
      child.stdin?.destroy();
      clean();
    }
    running = { child, stop };
    const output = (data: Buffer, which: 'stdout' | 'stderr') => {
      if (failure) return;
      bytes += data.length;
      if (bytes > (options.maxOutputBytes ?? 64 * 1024)) { stop(new Error('AI trả về quá nhiều dữ liệu')); return; }
      if (which === 'stdout') stdout += stdoutDecoder.write(data);
      else stderr += stderrDecoder.write(data);
    };
    child.stdout?.on('data', (d: Buffer) => output(d, 'stdout'));
    child.stderr?.on('data', (d: Buffer) => output(d, 'stderr'));
    child.stdin?.on('error', (err) => stop(err));
    child.on('error', (err) => stop(new Error(`Không chạy được ${options.bin}: ${err.message}. Đã cài Cursor CLI và đăng nhập chưa?`)));
    // A descendant may inherit stdout, so `close` alone isn't sufficient:
    // terminate remaining descendants as soon as the CLI itself exits.
    child.on('exit', () => clean());
    child.on('close', (exitCode) => {
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      code = exitCode;
      closed = true;
      clean();
      finish();
    });
    child.stdin?.end(options.input);
  });
}
