import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

// 独立进程组便于超时或退出时清理子进程；启用交互式 Shell 也不提供 PTY。
export function runCommand(command, { cwd, timeoutMs = 60000, maxBytes = 24000, shell = '/bin/sh', shellArgs = ['-c'], signal } = {}) {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(shell, [...shellArgs, command], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = { stdout: '', stderr: '', code: null, signal: null, timedOut: false, truncated: false, aborted: false };
    const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
    let total = 0;
    const kill = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') child.kill('SIGKILL'); } } };
    const terminate = () => {
      kill();
      // 脱离进程组的后代可能仍持有管道；终止收集，避免 close 永远不触发。
      child.stdout.destroy(); child.stderr.destroy();
    };
    const timer = setTimeout(() => { result.timedOut = true; terminate(); }, timeoutMs);
    const abort = () => { result.aborted = true; terminate(); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    for (const name of ['stdout', 'stderr']) child[name].on('data', data => {
      const available = Math.max(0, maxBytes - total);
      result[name] += decoders[name].write(data.subarray(0, available));
      total += Math.min(data.length, available);
      if (data.length > available) { result.truncated = true; terminate(); }
    });
    child.on('error', error => { result.stderr = `无法启动 Shell：${error.message}`; });
    child.on('close', (code, sig) => {
      // Shell 已退出时，仍可能存在关闭了输出管道的同组后台子进程。
      kill();
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      // 不补齐被截断的半个 UTF-8 字符，以保持输出字节上限。
      result.code = code; result.signal = sig; result.durationMs = Date.now() - started;
      resolve(result);
    });
  });
}
