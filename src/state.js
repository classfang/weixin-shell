import { mkdir, open, readFile, rename, chmod, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function writePrivate(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); }
  finally { await file.close(); }
  await rename(temp, path);
  // 同步目录项，保证在开始执行命令之前持久化重命名。
  const dir = await open(join(path, '..'), 'r');
  try { await dir.sync(); } finally { await dir.close(); }
}
export class State {
  static async open(dir) {
    await mkdir(dir, { recursive: true, mode: 0o700 }); await chmod(dir, 0o700);
    const state = new State(); state.path = join(dir, 'state.json');
    try { state.data = JSON.parse(await readFile(state.path, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; state.data = { cursor: '', jobs: {} }; }
    if (typeof state.data.cursor !== 'string' || !state.data.jobs || typeof state.data.jobs !== 'object' || Array.isArray(state.data.jobs)) throw Error('状态文件格式错误，停止以防重复执行');
    return state;
  }
  async save() { await writePrivate(this.path, this.data); }
}
export async function acquireLock(dir) {
  const path = join(dir, 'process.lock');
  // 不自动删除旧锁，避免多个启动进程竞争删除正在使用的锁。
  let file;
  try { file = await open(path, 'wx', 0o600); }
  catch (e) { if (e.code === 'EEXIST') throw Error(`已有实例或遗留锁：${path}；确认旧进程已退出后删除该文件`); throw e; }
  await file.writeFile(String(process.pid)); await file.close();
  return () => unlink(path);
}
