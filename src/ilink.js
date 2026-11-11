import { randomBytes, randomUUID } from 'node:crypto';
export const DEFAULT_BASE = 'https://ilinkai.weixin.qq.com';
export function apiBase(value, allowHttp = false) {
  const url = new URL(value);
  if ((url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) throw Error('API 地址必须使用 HTTPS 且不含凭证、查询或片段');
  return url.origin;
}
export class ILink {
  constructor({ baseUrl = DEFAULT_BASE, token, signal, allowHttp = false, version = '3.0.1/weixin-shell-0.1.0' } = {}) {
    this.allowHttp = allowHttp; this.baseUrl = apiBase(baseUrl, allowHttp); this.token = token; this.signal = signal; this.version = version;
  }
  async request(path, { body, base = this.baseUrl, auth = true, timeout = 15000 } = {}) {
    const headers = { 'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': String(0x00030001) };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'; headers.AuthorizationType = 'ilink_bot_token';
      headers['X-WECHAT-UIN'] = Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64');
    }
    if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;
    const signal = this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
    const response = await fetch(new URL(path, apiBase(base, this.allowHttp)), { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), signal, redirect: 'error' });
    if (!response.ok) throw Error(`iLink HTTP ${response.status}`);
    const result = await response.json();
    for (const key of ['ret', 'errcode']) if (result[key] !== undefined && Number(result[key]) !== 0) {
      const error = Error(`iLink ${key}=${result[key]}`); error.code = Number(result[key]); throw error;
    }
    return result;
  }
  post(path, body, timeout) { return this.request(path, { body: { ...body, base_info: { channel_version: this.version, bot_agent: 'weixin-shell/0.1.0' } }, timeout }); }
  getQr() { return this.request('/ilink/bot/get_bot_qrcode?bot_type=3', { base: DEFAULT_BASE, body: { local_token_list: [] }, auth: false }); }
  qrStatus(qr, pin, base = DEFAULT_BASE) {
    const query = new URLSearchParams({ qrcode: qr }); if (pin) query.set('verify_code', pin);
    return this.request(`/ilink/bot/get_qrcode_status?${query}`, { base, auth: false, timeout: 35000 });
  }
  getUpdates(cursor) { return this.post('/ilink/bot/getupdates', { get_updates_buf: cursor }, 40000); }
  sendText(user, context, text, clientId = randomUUID()) {
    return this.post('/ilink/bot/sendmessage', { msg: { from_user_id: '', to_user_id: user, client_id: clientId, message_type: 2, message_state: 2, context_token: context, item_list: [{ type: 1, text_item: { text } }] } });
  }
}
