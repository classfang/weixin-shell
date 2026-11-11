import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const modules = () => Promise.all(['runner', 'state', 'bridge', 'ilink', 'login'].map(x => import(`../src/${x}.js`)));
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'weixin-shell-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const message = (id, text, user = 'owner') => ({ message_id: id, from_user_id: user, message_type: 1, context_token: 'ctx', item_list: [{ type: 1, text_item: { text } }] });

test('CLI 读取启动目录的 .env，已有环境变量优先', async t => {
  const { spawnSync } = await import('node:child_process');
  const cwd = await fixture(t);
  const cli = new URL('../src/cli.js', import.meta.url).pathname;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('WEIXIN_')));
  await writeFile(join(cwd, '.env'), 'WEIXIN_TIMEOUT_MS=0\nWEIXIN_STATE_DIR=./state\n');
  const invalid = spawnSync(process.execPath, [cli, 'start'], { cwd, env, encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /WEIXIN_TIMEOUT_MS/);
  const overridden = spawnSync(process.execPath, [cli, 'start'], {
    cwd, env: { ...env, WEIXIN_TIMEOUT_MS: '1000' }, encoding: 'utf8'
  });
  assert.equal(overridden.status, 1);
  assert.match(overridden.stderr, /尚未登录/);
  assert.ok((await stat(join(cwd, 'state'))).isDirectory());
  await assert.rejects(stat(join(cwd, 'state', 'process.lock')), { code: 'ENOENT' });
});

test('真实 Shell 返回标准输出、错误输出和非零退出码', async t => {
  const [{ runCommand }] = await modules();
  const r = await runCommand('printf hello; printf problem >&2; exit 7', { cwd: await fixture(t), timeoutMs: 1000, maxBytes: 1000 });
  assert.equal(r.stdout, 'hello'); assert.equal(r.stderr, 'problem'); assert.equal(r.code, 7);
});
test('配置 Shell 参数后可通过桥接执行启动文件中的别名，命令保持原文', async t => {
  const [, { State }, { Bridge }] = await modules();
  const cwd = await fixture(t);
  const rc = join(cwd, '自定义 bashrc');
  await writeFile(rc, "alias ll='printf alias-ok'\n");
  const replies = [];
  const bridge = new Bridge({
    state: await State.open(cwd), api: { sendText: async (...args) => replies.push(args) },
    owner: 'owner', cwd, timeoutMs: 3000, maxBytes: 2000,
    shell: '/bin/bash', shellArgs: ['--noprofile', '--rcfile', rc, '-i', '-c']
  });
  await bridge.handle(message('alias', '/exec ll; printf "\\n%s" \'带 空格 "引号"\''));
  assert.match(replies[0][2], /退出码：0/);
  assert.ok(replies[0][2].includes('alias-ok\n带 空格 "引号"'));
});
test('CLI 拒绝无效的 Shell 参数配置，接受 .env 中的 JSON 参数数组', async t => {
  const { spawnSync } = await import('node:child_process');
  const cwd = await fixture(t);
  const cli = new URL('../src/cli.js', import.meta.url).pathname;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('WEIXIN_')));
  for (const value of ['-i -c', 'null', '{}', '[]', '[1]', '["-i",""]']) {
    const result = spawnSync(process.execPath, [cli, 'start'], {
      cwd, env: { ...env, WEIXIN_STATE_DIR: join(cwd, 'state'), WEIXIN_SHELL_ARGS: value }, encoding: 'utf8'
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /WEIXIN_SHELL_ARGS/, `未拒绝配置：${value}`);
  }
  await writeFile(join(cwd, '.env'), 'WEIXIN_STATE_DIR=./state\nWEIXIN_SHELL_ARGS=\'["-i","-c"]\'\n');
  const valid = spawnSync(process.execPath, [cli, 'start'], { cwd, env, encoding: 'utf8' });
  assert.equal(valid.status, 1);
  assert.match(valid.stderr, /尚未登录/);
});
test('超时终止命令，超量输出受限', async t => {
  const [{ runCommand }] = await modules(); const cwd = await fixture(t);
  const r = await runCommand('sleep 5', { cwd, timeoutMs: 60, maxBytes: 100 });
  assert.equal(r.timedOut, true);
  const large = await runCommand("yes x", { cwd, timeoutMs: 1000, maxBytes: 100 });
  assert.equal(large.truncated, true); assert.ok(Buffer.byteLength(large.stdout + large.stderr) <= 100);
});
test('未授权消息不能执行，重启后重复消息也只执行一次', async t => {
  const [, { State }, { Bridge }] = await modules(); const cwd = await fixture(t);
  const state = await State.open(cwd); const replies = [];
  const api = { sendText: async (...args) => replies.push(args) };
  let b = new Bridge({ state, api, owner: 'owner', cwd, timeoutMs: 1000, maxBytes: 1000 });
  await b.handle(message(1, '/exec touch forbidden', 'stranger'));
  await assert.rejects(stat(join(cwd, 'forbidden')), { code: 'ENOENT' });
  await b.handle(message(2, '/exec printf x >> count'));
  b = new Bridge({ state: await State.open(cwd), api, owner: 'owner', cwd, timeoutMs: 1000, maxBytes: 1000 });
  await b.handle(message(2, '/exec printf x >> count'));
  assert.equal(await readFile(join(cwd, 'count'), 'utf8'), 'x'); assert.equal(replies.length, 1);
});
test('发送失败保留结果，重启只补发而不重新运行命令', async t => {
  const [, { State }, { Bridge }] = await modules(); const cwd = await fixture(t);
  const opts = { owner: 'owner', cwd, timeoutMs: 1000, maxBytes: 1000 };
  const b = new Bridge({ ...opts, state: await State.open(cwd), api: { sendText: async () => { throw Error('offline'); } } });
  await assert.rejects(b.handle(message(3, '/exec printf x >> count')), /offline/);
  const replies = [];
  const next = new Bridge({ ...opts, state: await State.open(cwd), api: { sendText: async (...a) => replies.push(a) } });
  await next.recover();
  assert.equal(await readFile(join(cwd, 'count'), 'utf8'), 'x'); assert.equal(replies.length, 1);
  await next.recover(); assert.equal(replies.length, 1);
});
test('已落盘但未完成的命令在重启时报告中断，不重新执行', async t => {
  const [, { State }, { Bridge }] = await modules(); const cwd = await fixture(t);
  const state = await State.open(cwd);
  state.data.jobs['owner:4'] = { status: 'running', user: 'owner', context: 'ctx' }; await state.save();
  const replies = [];
  await new Bridge({ state: await State.open(cwd), api: { sendText: async (...a) => replies.push(a) }, owner: 'owner', cwd }).recover();
  assert.match(replies[0][2], /中断/);
});
test('iLink 请求携带凭证、游标和回复上下文，业务错误不能作为成功', async t => {
  const [, , , { ILink }] = await modules(); const seen = [];
  const server = createServer(async (req, res) => {
    let text = ''; for await (const part of req) text += part;
    seen.push({ path: req.url, headers: req.headers, body: JSON.parse(text) });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url.endsWith('getupdates') ? { ret: 0, msgs: [], get_updates_buf: 'next' } : { ret: 9, errmsg: 'denied' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const api = new ILink({ baseUrl: `http://127.0.0.1:${server.address().port}`, token: 'secret', allowHttp: true });
  assert.equal((await api.getUpdates('cursor')).get_updates_buf, 'next');
  await assert.rejects(api.sendText('owner', 'ctx', 'hello', 'stable-id'), /9/);
  assert.equal(seen[0].headers.authorization, 'Bearer secret'); assert.equal(seen[0].body.get_updates_buf, 'cursor');
  assert.equal(seen[1].body.msg.context_token, 'ctx'); assert.equal(seen[1].body.msg.client_id, 'stable-id');
});
test('扫码登录支持验证码和后端重定向，返回绑定者信息', async () => {
  const [, , , , { login }] = await modules(); const calls = []; let n = 0;
  const result = await login({
    api: { getQr: async () => ({ qrcode: 'qr', qrcode_img_content: 'image' }), qrStatus: async (qr, pin, base) => {
      calls.push({ qr, pin, base });
      return [{ status: 'confirmed_but_need_verifycode' }, { status: 'scaned_but_redirect', redirect_host: 'new.weixin.qq.com' }, { status: 'confirmed', bot_token: 'token', ilink_user_id: 'owner', ilink_bot_id: 'bot', baseurl: 'https://new.weixin.qq.com' }][n++];
    } }, showQr: async () => {}, askPin: async () => '1234', pause: async () => {}
  });
  assert.equal(calls[1].pin, '1234'); assert.equal(calls[2].base, 'https://new.weixin.qq.com'); assert.equal(result.owner, 'owner');
});

test('大段中文结果分段发送，拼接后内容完整且每段字节受限', async t => {
  const [, { State }, { Bridge }] = await modules(); const cwd = await fixture(t); const parts = [];
  const b = new Bridge({ state: await State.open(cwd), api: { sendText: async (user, context, text) => parts.push(text) }, owner: 'owner', cwd, timeoutMs: 1000, maxBytes: 20000 });
  await b.handle(message(7, '/exec node -e \'process.stdout.write("测试🙂".repeat(800))\''));
  assert.ok(parts.length > 1); assert.ok(parts.every(x => Buffer.byteLength(x) <= 3000));
  assert.ok(parts.join('').includes('测试🙂'.repeat(800)));
});
test('同一数据目录禁止并发实例，释放后可以重新启动', async t => {
  const { acquireLock } = await import('../src/state.js'); const dir = await fixture(t);
  const release = await acquireLock(dir); await assert.rejects(acquireLock(dir), /实例|锁/);
  await release(); await (await acquireLock(dir))();
});
test('CLI 帮助正常退出，未登录时启动失败且释放锁', async t => {
  const { spawnSync } = await import('node:child_process'); const dir = await fixture(t);
  const cli = new URL('../src/cli.js', import.meta.url).pathname;
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /login/);
  const start = spawnSync(process.execPath, [cli, 'start'], { env: { ...process.env, WEIXIN_STATE_DIR: dir }, encoding: 'utf8' });
  assert.equal(start.status, 1); assert.match(start.stderr, /登录/);
  await assert.rejects(stat(join(dir, 'process.lock')), { code: 'ENOENT' });
});

test('切换绑定者后不补发旧绑定者的待发结果，生成中的消息不执行', async t => {
  const [, { State }, { Bridge }] = await modules(); const cwd = await fixture(t);
  const state = await State.open(cwd); state.data.jobs['old:1'] = { status: 'running', user: 'old', context: 'old-context' }; await state.save();
  const replies = [];
  const b = new Bridge({ state, api: { sendText: async (...a) => replies.push(a) }, owner: 'owner', cwd });
  await b.recover();
  await b.handle({ ...message(9, '/exec touch partial'), message_state: 1 });
  assert.equal(replies.length, 0); await assert.rejects(stat(join(cwd, 'partial')), { code: 'ENOENT' });
});

test('Shell 提前退出后清理同组后台进程，避免绕过超时和关闭控制', async t => {
  const [{ runCommand }] = await modules(); const cwd = await fixture(t);
  await runCommand('(sleep 0.2; touch survived) >/dev/null 2>&1 &', { cwd, timeoutMs: 1000 });
  await new Promise(resolve => setTimeout(resolve, 400));
  await assert.rejects(stat(join(cwd, 'survived')), { code: 'ENOENT' });
});

test('脱离进程组的后代持有输出管道时，超时和停止仍能结束等待', async t => {
  const [{ runCommand }] = await modules();
  for (const mode of ['timeout', 'abort']) await t.test(mode, async t => {
    const cwd = await fixture(t);
    const program = 'const {spawn}=require("node:child_process");const c=spawn(process.execPath,["-e","setTimeout(()=>{},3000)"],{detached:true,stdio:["ignore",1,2]});require("node:fs").writeFileSync("detached.pid",String(c.pid));c.unref();';
    const quotedNode = "'" + process.execPath.replaceAll("'", "'\\''") + "'";
    const controller = new AbortController();
    const timer = mode === 'abort' ? setTimeout(() => controller.abort(), 500) : undefined;
    try {
      const result = await runCommand(`${quotedNode} -e '${program}'`, {
        cwd, timeoutMs: mode === 'timeout' ? 500 : 10000, signal: controller.signal
      });
      assert.ok(Number(await readFile(join(cwd, 'detached.pid'), 'utf8')) > 0, '必须实际启动持有管道的后代进程');
      assert.equal(result.timedOut, mode === 'timeout');
      assert.equal(result.aborted, mode === 'abort');
      assert.ok(result.durationMs < 2000, `结束等待耗时 ${result.durationMs} ms`);
    } finally {
      clearTimeout(timer);
      try { process.kill(Number(await readFile(join(cwd, 'detached.pid'), 'utf8')), 'SIGKILL'); }
      catch (e) { if (!['ENOENT', 'ESRCH'].includes(e.code)) throw e; }
    }
  });
});
