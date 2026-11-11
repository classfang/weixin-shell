import { setTimeout as sleep } from 'node:timers/promises';
import { apiBase, DEFAULT_BASE } from './ilink.js';

export async function login({ api, showQr, askPin, pause = () => sleep(1000), timeoutMs = 480000 }) {
  const end = Date.now() + timeoutMs;
  let base = DEFAULT_BASE, pin, qr, refresh = 0;
  while (Date.now() < end) {
    if (!qr) {
      if (++refresh > 3) throw Error('二维码多次过期，请重新登录');
      qr = await api.getQr();
      if (!qr.qrcode || !qr.qrcode_img_content) throw Error('微信未返回有效二维码');
      await showQr(qr.qrcode_img_content); base = DEFAULT_BASE; pin = undefined;
    }
    let result;
    try { result = await api.qrStatus(qr.qrcode, pin, base); }
    catch (e) { if (api.signal?.aborted) throw e; if (e.code !== undefined) throw e; await pause(); continue; }
    const status = result.status || '';
    if (status.includes('need_verifycode')) { pin = (await askPin()).trim(); if (!/^\d{4,12}$/.test(pin)) throw Error('验证码格式错误，请重新登录'); }
    else if (status === 'confirmed') {
      if (!result.bot_token || !result.ilink_user_id || !result.ilink_bot_id) throw Error('登录响应缺少凭证或绑定者，停止');
      return { token: result.bot_token, owner: result.ilink_user_id, botId: result.ilink_bot_id, baseUrl: apiBase(result.baseurl || base) };
    } else if (status === 'scaned_but_redirect') {
      if (!result.redirect_host) throw Error('登录重定向缺少地址');
      base = apiBase(`https://${result.redirect_host}`);
    } else if (status === 'scaned') pin = undefined;
    else if (status === 'expired' || status === 'verify_code_blocked') qr = undefined;
    else if (status === 'binded_redirect') throw Error('该机器人已绑定其他实例，请先在微信解除绑定再重试');
    else if (status !== 'wait') throw Error('未知登录状态，请核对当前 iLink 协议');
    await pause();
  }
  throw Error('扫码登录超时，请重试');
}
