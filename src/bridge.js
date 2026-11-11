import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { runCommand } from './runner.js';

const HELP = '/exec <命令>：在主机执行 Shell 命令\n/status：查看主机状态\n/help：显示帮助\n每条命令使用独立 Shell，cd 和环境变量不跨消息保留。';
// 按 UTF-8 字节分段，同时保留完整字符。
function chunks(text, limit = 3000) {
  const parts = []; let part = '', bytes = 0;
  for (const c of text) { const size = Buffer.byteLength(c); if (bytes + size > limit) { parts.push(part); part = ''; bytes = 0; } part += c; bytes += size; }
  if (part) parts.push(part); return parts;
}
export class Bridge {
  constructor(options) { Object.assign(this, options); }
  async deliver(job) {
    for (const part of job.parts) {
      if (part.sent) continue;
      await this.api.sendText(job.user, job.context, part.text, part.id);
      part.sent = true; await this.state.save();
    }
    job.status = 'sent'; await this.state.save();
  }
  async complete(job, text) {
    job.status = 'pending'; job.parts = chunks(text).map(text => ({ text, id: randomUUID(), sent: false }));
    await this.state.save(); await this.deliver(job);
  }
  async recover() {
    for (const job of Object.values(this.state.data.jobs)) {
      if (job.user !== this.owner) continue;
      if (job.status === 'running') await this.complete(job, '命令执行记录已中断，结果未知；为避免重复操作，不自动重新执行。请检查主机状态。');
      else if (job.status === 'pending') await this.deliver(job);
    }
  }
  async handle(msg) {
    if (msg.message_state !== undefined && msg.message_state !== 2) return;
    if (msg.message_type !== 1 || msg.from_user_id !== this.owner || msg.group_id || !msg.context_token) return;
    const id = msg.message_id ?? msg.client_id;
    if (id === undefined || id === null || id === '') return;
    const key = `${msg.from_user_id}:${id}`;
    const previous = this.state.data.jobs[key];
    if (previous) { if (previous.status === 'pending') await this.deliver(previous); return; }
    const text = (msg.item_list || []).filter(item => item.type === 1).map(item => item.text_item?.text || '').join('\n').trim();
    if (!text) return;
    const job = { status: 'running', user: msg.from_user_id, context: msg.context_token, createdAt: new Date().toISOString() };
    this.state.data.jobs[key] = job;
    await this.state.save();
    if (text === '/status') return this.complete(job, `主机：${hostname()}\n目录：${this.cwd}\n运行时间：${Math.floor(process.uptime())} 秒`);
    const match = /^\/exec\s+([\s\S]+)$/.exec(text);
    if (!match) return this.complete(job, HELP);
    const r = await runCommand(match[1], this);
    const flags = [r.timedOut && '超时，已终止', r.truncated && '输出超过上限，已终止', r.aborted && '服务停止，已终止'].filter(Boolean);
    const output = `退出码：${r.code ?? '-'}${r.signal ? ` (${r.signal})` : ''}\n耗时：${r.durationMs} ms${flags.length ? `\n${flags.join('；')}` : ''}\n\n标准输出：\n${r.stdout || '（空）'}\n\n标准错误：\n${r.stderr || '（空）'}`;
    await this.complete(job, output);
  }
}
