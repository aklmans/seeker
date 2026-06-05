// 验证 prod 资源路径(#6 · 配合 RELEASE.md)。
// 前提:已 `npm run build`,且带 CDP 端口跑起 release 二进制:
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'; .\src-tauri\target\release\app.exe
// 做法:起一个 mock SSE 端点,把 AI base_url 临时指向它,发一条 ai_chat,抓请求里的系统提示(messages[0]),
//   查是否含域 overlay 文案 —— 含 = load_overlay 在真实构建里经 BaseDirectory::Resource 加载成功。
// 安全:只临时改 base_url/model(验完还原),不动钥匙串 key(原无 key 设临时 dummy、用完清);release debug_assertions 关 = 纯 prod 路径(无 dev 回退)。
import { createServer } from 'node:http';
const PORT = 9488, MOCK = 'http://127.0.0.1:' + PORT;
let captured = null;
const server = createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d));
  req.on('end', () => {
    try { captured = JSON.parse(body); } catch (_e) {}
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: null }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n');
    res.write('data: [DONE]\n\n'); res.end();
  });
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const pages = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl) || pages[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const evalExpr = (e, aw = false) => new Promise((res) => { const mid = ++id; pending.set(mid, (m) => res(m.result && m.result.result ? m.result.result.value : JSON.stringify(m.result))); ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression: e, returnByValue: true, awaitPromise: aw } })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.addEventListener('open', async () => {
  for (let i = 0; i < 60; i++) { if (await evalExpr("!!(window.SeekerRT&&window.SeekerRT.ai)") === true) break; await sleep(250); }
  await evalExpr(`(async()=>{ try{
    const rt=window.SeekerRT, cfg=await rt.ai.getConfig(); const hadKey=cfg.keyStatus==='configured';
    if(!hadKey) await rt.secret.set('provider.openai.key','dummy-verify-key');
    await rt.ai.setConfig({ baseUrl:'${MOCK}', model:'verify-model' });
    await new Promise((resolve)=>{ rt.ai.stream({ userText:'你好' }, { onDone:()=>resolve(), onError:()=>resolve() }); });
    await rt.ai.setConfig({ baseUrl: cfg.baseUrl||'', model: cfg.model||'' });   // 还原
    try{ await rt.ai.removeModel('verify-model'); }catch(e){}
    if(!hadKey) await rt.secret.clear('provider.openai.key');
    return 'done';
  }catch(e){ return 'THROW:'+String(e); } })()`, true);
  await sleep(200);
  const sys = captured && captured.messages && captured.messages[0] ? String(captured.messages[0].content || '') : '';
  console.log('SYSCHK ' + JSON.stringify({
    gotRequest: !!captured,
    hasBaseline: /local-first|privacy|personal|不要/i.test(sys),
    hasOverlay: /job-hunt research assistant/i.test(sys),   // ← prod 资源路径成功的判据
    sysLen: sys.length,
  }));
  ws.close(); server.close();
  process.exit(/job-hunt research assistant/i.test(sys) ? 0 : 1);
});
ws.addEventListener('error', () => { console.log('WS_ERR (release app 是否带 --remote-debugging-port=9222 跑起?)'); server.close(); process.exit(3); });
setTimeout(() => { console.log('TIMEOUT'); try { server.close(); } catch (e) {} process.exit(4); }, 40000);
