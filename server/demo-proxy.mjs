// @ts-check
/**
 * 探索者 · Web 演示代理(自托管)—— 静态站 + 最小 AI 聊天转发,单文件零依赖(Node ≥ 18)。
 *
 * 定位:让 Web 演示版「真能对话」。**只做纯聊天转发** —— 不带工具循环 / 记忆 / query_data
 * (那些是桌面 Rust 核的能力,不搬);系统提示由**服务端自持**,客户端只能提交 user/assistant 轮。
 *
 * 红线(与桌面同源的纪律,落在服务端):
 *  - **上游 API key 只存服务器环境变量**,浏览器永远见不到、响应里不回显、日志不打印;
 *  - **不记录任何对话内容**(日志只有 时间/路由/状态/计数);
 *  - **fail-closed**:必需配置(UPSTREAM_* / MODEL / ACCESS_CODES)缺失即拒绝启动 ——
 *    尤其 ACCESS_CODES 为空不会「顺手全开」;
 *  - 三道闸:访问码(限朋友)→ 每 IP 每分钟限速 → 全局每日请求封顶(兵损可控)。
 *
 * 配置(环境变量):
 *   PORT=8787                 监听端口
 *   WEB_DIR=../web            静态根(相对本文件)
 *   UPSTREAM_BASE=…           OpenAI 兼容端点根(如 https://api.deepseek.com;不带 /chat/completions)
 *   UPSTREAM_KEY=…            上游 API key(只在这里)
 *   MODEL=…                   模型名(如 deepseek-chat)
 *   ACCESS_CODES=a,b,c        访问码列表(逗号分隔,发给朋友)
 *   RATE_PER_MIN=6            每 IP 每分钟请求上限
 *   DAILY_REQ_CAP=300         全局每日请求封顶(UTC 日切)
 *
 * 运行:node server/demo-proxy.mjs(建议 systemd 托管 + nginx 终止 TLS;见 docs/DEPLOY-DEMO.md)
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = (k, d) => (process.env[k] ?? d);

const PORT = Number(env('PORT', '8787'));
const WEB_DIR = path.resolve(__dirname, env('WEB_DIR', '../web'));
const UPSTREAM_BASE = env('UPSTREAM_BASE', '').replace(/\/+$/, '');
const UPSTREAM_KEY = env('UPSTREAM_KEY', '');
const MODEL = env('MODEL', '');
const ACCESS_CODES = new Set(env('ACCESS_CODES', '').split(',').map((s) => s.trim()).filter(Boolean));
const RATE_PER_MIN = Number(env('RATE_PER_MIN', '6'));
const DAILY_REQ_CAP = Number(env('DAILY_REQ_CAP', '300'));

// fail-closed:关键配置缺一不起(空 ACCESS_CODES 绝不等于「无门禁」)。
for (const [k, v] of [['UPSTREAM_BASE', UPSTREAM_BASE], ['UPSTREAM_KEY', UPSTREAM_KEY], ['MODEL', MODEL]]) {
  if (!v) { console.error(`[demo-proxy] 缺少必需环境变量 ${k},拒绝启动`); process.exit(1); }
}
if (ACCESS_CODES.size === 0) { console.error('[demo-proxy] ACCESS_CODES 为空,拒绝启动(fail-closed)'); process.exit(1); }

// 服务端自持的系统提示(客户端提交的 system 轮一律拒收 —— 防把代理当免费通用 API 白嫖/越狱面收窄)。
const SYSTEM_PROMPT = [
  '你是「探索者 · Seeker」Web 演示环境里的求职 Agent。用简洁、鼓励但不浮夸的中文回答(用户用英文则用英文)。',
  '这是演示环境:没有用户数据、没有工具、没有记忆 —— 涉及查数据/改简历文件/连接器等能力时,如实说明这些在桌面版,并建议下载体验。',
  '只围绕求职、职业发展与本产品作答;无关请求礼貌拒绝。',
].join('\n');

// ── 三道闸的账本(单进程内存态;重启清零,演示够用)────────────────
/** @type {Map<string, number[]>} */
const rateBook = new Map(); // ip → 最近请求时间戳
let dayKey = new Date().toISOString().slice(0, 10);
let dayCount = 0;
function gateDaily() {
  const k = new Date().toISOString().slice(0, 10);
  if (k !== dayKey) { dayKey = k; dayCount = 0; }
  if (dayCount >= DAILY_REQ_CAP) return false;
  dayCount += 1; return true;
}
/** @param {string} ip */
function gateRate(ip) {
  const now = Date.now();
  const arr = (rateBook.get(ip) || []).filter((t) => now - t < 60_000);
  if (arr.length >= RATE_PER_MIN) { rateBook.set(ip, arr); return false; }
  arr.push(now); rateBook.set(ip, arr); return true;
}

// ── 请求体校验(allowlist 投影:只收 user/assistant 的 {role,content} 串)──────
/** @param {any} body @returns {{ok:true, messages:{role:string,content:string}[]}|{ok:false, err:string}} */
function validateBody(body) {
  if (!body || typeof body !== 'object') return { ok: false, err: 'bad_body' };
  const raw = body.messages;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 24) return { ok: false, err: 'bad_messages' };
  /** @type {{role:string,content:string}[]} */
  const out = [];
  let total = 0;
  for (const m of raw) {
    const role = m && m.role;
    const content = m && m.content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return { ok: false, err: 'bad_role' };
    if (content.length > 8000) return { ok: false, err: 'too_long' };
    total += content.length;
    out.push({ role, content }); // 投影:未声明字段一律丢弃
  }
  if (total > 24000) return { ok: false, err: 'too_long' };
  if (out[out.length - 1].role !== 'user') return { ok: false, err: 'bad_tail' };
  return { ok: true, messages: out };
}

/** @param {http.ServerResponse} res @param {number} code @param {any} obj */
function json(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(b) });
  res.end(b);
}

// ── /api/chat:校验 → 三道闸 → 转发上游(OpenAI 兼容,stream)→ 以简化 SSE 回推 ──
/** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
async function handleChat(req, res) {
  // 读体(≤128KB)
  /** @type {Buffer[]} */ const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 131072) { json(res, 413, { error: 'too_big' }); return; } chunks.push(c); }
  let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { json(res, 400, { error: 'bad_json' }); return; }

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!ACCESS_CODES.has(code)) { json(res, 401, { error: 'bad_code' }); return; }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
  if (!gateRate(ip)) { json(res, 429, { error: 'rate' }); return; }
  if (!gateDaily()) { json(res, 429, { error: 'daily' }); return; }

  const v = validateBody(body);
  if (!v.ok) { json(res, 400, { error: v.err }); return; }

  const ac = new AbortController();
  req.on('close', () => ac.abort()); // 浏览器断开 → 掐上游,不空烧
  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM_BASE}/chat/completions`, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${UPSTREAM_KEY}` },
      body: JSON.stringify({ model: MODEL, stream: true, messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...v.messages] }),
    });
  } catch { json(res, 502, { error: 'upstream_unreachable' }); return; }
  if (!upstream.ok || !upstream.body) {
    json(res, 502, { error: 'upstream_' + upstream.status }); // 不透传上游错误体(可能含敏感细节)
    return;
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no', // nginx 不缓冲,逐 token 到端
  });
  /** @param {any} obj */
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  // 解析上游 SSE:抽 choices[0].delta.content 逐段回推;上游任何解析失败按流终止处理。
  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') { send({ done: true }); res.end(); return; }
        try {
          const t = JSON.parse(payload)?.choices?.[0]?.delta?.content;
          if (typeof t === 'string' && t) send({ t });
        } catch { /* 跳过无法解析的行 */ }
      }
    }
    send({ done: true }); res.end();
  } catch {
    try { send({ error: 'stream_broken' }); res.end(); } catch { /* 客户端已断 */ }
  }
}

// ── 静态站(WEB_DIR;相对路径应用,'/' → index.html;路径穿越拒绝)──────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.woff2': 'font/woff2' };
/** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
async function handleStatic(req, res) {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const abs = path.normalize(path.join(WEB_DIR, p));
  if (!abs.startsWith(WEB_DIR + path.sep) && abs !== WEB_DIR) { json(res, 403, { error: 'forbidden' }); return; }
  try {
    const data = await readFile(abs);
    res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch { json(res, 404, { error: 'not_found' }); }
}

const server = http.createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];
  const started = Date.now();
  res.on('finish', () => {
    // 只记 路由/状态/耗时/日计数 —— 绝不记对话内容与访问码。
    console.log(`[demo-proxy] ${new Date().toISOString()} ${req.method} ${url} → ${res.statusCode} ${Date.now() - started}ms day=${dayCount}/${DAILY_REQ_CAP}`);
  });
  try {
    if (url === '/api/health' && req.method === 'GET') { json(res, 200, { ok: true }); return; }
    if (url === '/api/chat' && req.method === 'POST') { await handleChat(req, res); return; }
    if (req.method === 'GET' || req.method === 'HEAD') { await handleStatic(req, res); return; }
    json(res, 405, { error: 'method' });
  } catch (e) {
    console.error('[demo-proxy] 未捕获错误', e instanceof Error ? e.message : e);
    try { json(res, 500, { error: 'internal' }); } catch { /* 已发头 */ }
  }
});
server.listen(PORT, () => {
  console.log(`[demo-proxy] listening :${PORT}  web=${WEB_DIR}  model=${MODEL}  codes=${ACCESS_CODES.size}  rate=${RATE_PER_MIN}/min  daily=${DAILY_REQ_CAP}`);
});
