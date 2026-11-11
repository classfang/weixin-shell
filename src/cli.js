#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { ILink } from './ilink.js';
import { State, writePrivate, acquireLock } from './state.js';
import { Bridge } from './bridge.js';
import { login } from './login.js';

function number(name, fallback, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw Error(`${name} 必须为 1 到 ${max} 的整数`);
  return value;
}
async function main() {
  const action = process.argv[2] || '--help';
  if (['--help', '-h', 'help'].includes(action)) {
    console.log('weixin-shell：通过微信执行本机 Shell 命令\n\nweixin-shell login   扫码绑定本人微信\nweixin-shell start   启动命令桥接\nweixin-shell --help  显示帮助\n\n也可运行 npx @fangjunjie/weixin-shell <子命令>\n微信指令：/exec <命令>、/status、/help\n自动读取当前目录的 .env，已有环境变量优先。\n配置说明见 README.md 和 .env.example'); return;
  }
  if (!['login', 'start'].includes(action)) throw Error('未知子命令，请使用 login 或 start');
  // 所有安装方式均从启动目录读取配置，不覆盖终端已有的环境变量。
  try { process.loadEnvFile(); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (process.platform === 'win32') throw Error('当前版本支持 macOS / Linux；Windows 请使用 WSL');
  const dir = resolve(process.env.WEIXIN_STATE_DIR || join(homedir(), '.weixin-shell'));
  const cwd = resolve(process.env.WEIXIN_CWD || process.cwd());
  const timeoutMs = number('WEIXIN_TIMEOUT_MS', 60000, 3600000);
  const maxBytes = number('WEIXIN_MAX_OUTPUT_BYTES', 24000, 1048576);
  const shell = process.env.WEIXIN_SHELL || '/bin/sh';
  let shellArgs = ['-c'];
  if (process.env.WEIXIN_SHELL_ARGS !== undefined) {
    try { shellArgs = JSON.parse(process.env.WEIXIN_SHELL_ARGS); }
    catch { throw Error('WEIXIN_SHELL_ARGS 必须为非空字符串组成的 JSON 数组，例如 ["-i","-c"]'); }
    if (!Array.isArray(shellArgs) || shellArgs.length === 0 || shellArgs.some(arg => typeof arg !== 'string' || !arg.trim() || arg.includes('\0'))) {
      throw Error('WEIXIN_SHELL_ARGS 必须为非空字符串组成的 JSON 数组，例如 ["-i","-c"]');
    }
  }
  if (!(await stat(cwd)).isDirectory()) throw Error('工作目录不存在或不是目录');
  let state = await State.open(dir);
  const release = await acquireLock(dir);
  const controller = new AbortController();
  const stop = () => { console.log('正在停止服务…'); controller.abort(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    state = await State.open(dir);
    const authPath = join(dir, 'session.json');
    if (action === 'login') {
      const api = new ILink({ signal: controller.signal, version: process.env.WEIXIN_PROTOCOL_VERSION });
      const session = await login({
        api,
        pause: () => sleep(1000, undefined, { signal: controller.signal }),
        showQr: async content => {
          const { default: qr } = await import('qrcode-terminal');
          console.log('使用本人微信扫描下方二维码，并在手机上确认：');
          qr.generate(content, { small: true }); console.log(content);
        },
        askPin: async () => {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          try { return await rl.question('请输入手机显示的验证码：', { signal: controller.signal }); }
          finally { rl.close(); }
        }
      });
      // 重新绑定后重新拉取；保留历史记录以防旧消息重复执行。
      state.data.cursor = ''; await state.save();
      await writePrivate(authPath, session);
      console.log('绑定完成，凭证已保存在本机。运行 weixin-shell start（源码运行可用 npm start）启动桥接。'); return;
    }
    let session;
    try { session = JSON.parse(await readFile(authPath, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') throw Error('尚未登录，请先运行 weixin-shell login（源码运行可用 npm run login）'); throw Error('登录凭证损坏，请重新运行 weixin-shell login（源码运行可用 npm run login）'); }
    if (!session.token || !session.owner || !session.baseUrl) throw Error('登录凭证不完整，请重新登录');
    const api = new ILink({ baseUrl: session.baseUrl, token: session.token, signal: controller.signal, version: process.env.WEIXIN_PROTOCOL_VERSION });
    const bridge = new Bridge({ state, api, owner: session.owner, cwd, timeoutMs, maxBytes, shell, shellArgs, signal: controller.signal });
    console.log(`桥接已启动，工作目录：${cwd}；超时：${timeoutMs} ms。仅接受扫码绑定者的私聊指令。`);
    let failures = 0;
    while (!controller.signal.aborted) {
      try {
        await bridge.recover();
        const result = await api.getUpdates(state.data.cursor);
        if (result.msgs !== undefined && !Array.isArray(result.msgs)) throw Error('iLink 消息响应格式错误');
        for (const msg of result.msgs || []) {
          if (controller.signal.aborted) break;
          await bridge.handle(msg);
        }
        if (controller.signal.aborted) break;
        if (typeof result.get_updates_buf === 'string' && result.get_updates_buf) {
          state.data.cursor = result.get_updates_buf; await state.save();
        }
        failures = 0;
        await sleep(100, undefined, { signal: controller.signal });
      } catch (e) {
        if (controller.signal.aborted) break;
        if (e.code === -14 || e.code === 401 || e.code === 403 || /HTTP (401|403)/.test(e.message)) throw Error('微信会话失效或权限被拒绝，请重新运行 weixin-shell login（源码运行可用 npm run login）');
        // 文件系统故障必须停止，不能在无法持久化时继续接收命令。
        if (typeof e.code === 'string' && /^E[A-Z]+$/.test(e.code)) throw e;
        const delay = Math.min(30000, 1000 * 2 ** Math.min(failures++, 5));
        console.error(`通道请求失败（${e.message}），${delay / 1000} 秒后重试。`);
        await sleep(delay, undefined, { signal: controller.signal }).catch(() => {});
      }
    }
  } catch (e) { if (!controller.signal.aborted) throw e; }
  finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); await release(); }
}
main().catch(e => { console.error(`错误：${e.message}`); process.exitCode = 1; });
