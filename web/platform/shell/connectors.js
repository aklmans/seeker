/** 平台 · 连接器(MCP)管理 —— P1-b:从 `settings.js` 的 module-private 模态 `openMcpManager`
 *  **搬迁**至能力中心,提为一等公民**内联视图**(不再是设置页深处的模态)。
 *
 *  **零新后端**:复用既有 `rt.mcp.*`(list/add/remove/setEnabled/setAuth/setEnv/probe)。
 *
 *  ★红线逐字保留(搬迁 = 零逻辑改动,仅模态外壳 → 内联宿主):
 *   - **密钥(§4-2)**:令牌 / env 值只经 `rt.mcp.setAuth`·`setEnv` **直送系统钥匙串**;前端**只见
 *     `configured/empty` 状态、绝不持明文、绝不落盘**(列表只渲染 `authConfigured` 与 `envConfigured[].status`)。
 *   - **破坏性(§4-3)**:删除服务器走 `platform/guardrail` 的 `confirmDestructive`(预览 + 确认)。
 *   - **知情同意(§4-4)**:本地 = 在本机运行该程序;远程 = 连接你填的 HTTP 端点;只加可信来源;
 *     AI 每次调用其工具都先问你;返回内容当作**不可信数据**(Untrusted、防注入)。
 *   - **转义(不变式 · 评审第55轮 [应改] 收口后为真)**:用户数据**一律**经平台唯一转义器 `cEsc`(`&<>"`)
 *     进 DOM,**两条 sink 都算**:① `innerHTML` 渲染(含 `data-*` **属性位** —— 原 `escA` 的职责,cEsc 是其超集);
 *     ② **`toast()` 路径** —— `toast`→`el`→`template.innerHTML` 是 **HTML sink**(toast.js:9 / dom.js:9),
 *     故 `toast(… + cEsc(name))`(同 `copilot-actions.js:38` 既有纪律:「否则只是把注入点从 onclick 移到此 toast」)。
 *     原 `esc`/`escA` 两个 bespoke 转义器随本刀消除(承第54轮 [建议])。
 *     **唯一免转义处(有意)**:`guardrail.confirmDestructive` 的 `detail` 走 `textContent`
 *     (`platform/guardrail/index.js:71`),故传裸名安全 —— 勿"顺手"给它加转义,那会把 `&amp;` 显给用户。
 *
 *  ★读/写界(§4-2 + 评审第53轮 [应改]A):本视图是**「给人看」的前端管理面** —— 端点 / 命令 / 密钥状态
 *   只呈现给**用户**,**永不进模型上下文**(能力中心页顶 lock-note 已把此印成用户承诺)。写(增删启停 /
 *   填密钥)只在此管理面、**不经对话**。模型侧若将来要读 connector 状态,须走「静态最小投影」新红线。 */
import { cEsc } from './copilot-chrome.js';
import { tt } from './i18n.js';
import { errText, toast } from './toast.js';

const parseArgs = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);

/** 把连接器管理渲染进宿主元素(能力中心的 Connector 段)。表单接线一次,列表可重复 refresh。 */
export async function renderConnectors(box) {
  if (!box) return;
  const rt = window.SeekerRT;
  const G = window.SeekerGuardrail;

  box.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:6px;max-width:560px;">
      <div style="display:flex;gap:10px;align-items:center;">
        <span class="mono" style="font-size:10px;color:var(--ink-3);letter-spacing:.06em;">${tt('类型', 'TYPE')}</span>
        <div style="display:inline-flex;border:0.5px solid var(--border);border-radius:6px;overflow:hidden;">
          <button class="cc-mcp-mode" data-mode="stdio" style="border:0;background:transparent;padding:5px 16px;font-size:12px;cursor:pointer;">${tt('本地', 'Local')}</button>
          <button class="cc-mcp-mode" data-mode="http" style="border:0;border-left:0.5px solid var(--border);background:transparent;padding:5px 16px;font-size:12px;cursor:pointer;">${tt('远程', 'Remote')}</button>
        </div>
      </div>
      <input class="input" id="ccMcpName" placeholder="${tt('名称(如 filesystem)', 'Name (e.g. filesystem)')}">
      <div id="ccMcpLocal" style="display:flex;flex-direction:column;gap:8px;">
        <input class="input" id="ccMcpCmd" placeholder="${tt('命令(如 npx 或 node)', 'Command (e.g. npx or node)')}">
        <input class="input" id="ccMcpArgs" placeholder="${tt('参数,空格分隔(如 -y @modelcontextprotocol/server-filesystem ./docs)', 'Args, space-separated')}">
      </div>
      <div id="ccMcpRemote" style="display:none;flex-direction:column;gap:8px;">
        <input class="input" id="ccMcpUrl" placeholder="${tt('端点 URL(如 https://example.com/mcp)', 'Endpoint URL (e.g. https://example.com/mcp)')}">
        <input class="input" id="ccMcpToken" type="password" autocomplete="off" placeholder="${tt('鉴权令牌(可选 · 只存系统钥匙串)', 'Auth token (optional · system keychain only)')}">
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button class="btn btn-accent" id="ccMcpAddBtn">${tt('添加服务器', 'Add server')}</button>
        <button class="btn" id="ccMcpTestBtn">${tt('测试连接', 'Test connection')}</button>
        <span class="mono" id="ccMcpHint" style="font-size:11px;color:var(--ink-mute);"></span>
      </div>
    </div>
    <div class="lock-note" style="margin:2px 0 14px;max-width:660px;"><span class="li">🧩</span><span>${tt(
      '本地 = 在本机运行该程序;远程 = 连接你填的 HTTP 端点。只加你信任的来源;令牌只存系统钥匙串、绝不外发;AI 调用其工具时每次都会先问你,返回内容当作数据(不可信、防注入)。仅桌面端可用。',
      'Local runs the program on your machine; Remote connects to the HTTP endpoint you enter. Only add trusted sources; tokens live only in the system keychain and never leave it; the AI asks before each tool call and treats returned content as untrusted data. Desktop only.'
    )}</span></div>
    <div id="ccMcpList">${tt('加载中…', 'Loading…')}</div>`;

  const q = (sel) => box.querySelector(sel);
  const qa = (sel) => [...box.querySelectorAll(sel)];
  const val = (id) => { const e = q(id); return e ? e.value.trim() : ''; };
  const hint = q('#ccMcpHint');

  // 传输模式切换(选中态:暖橙文字 + 底线,不依赖 color-mix)。
  let mode = 'stdio';
  const setMode = (mo) => {
    mode = mo;
    const lo = q('#ccMcpLocal'), re = q('#ccMcpRemote');
    if (lo) lo.style.display = mo === 'stdio' ? 'flex' : 'none';
    if (re) re.style.display = mo === 'http' ? 'flex' : 'none';
    qa('.cc-mcp-mode').forEach((b) => {
      const on = b.dataset.mode === mo;
      b.style.color = on ? 'var(--accent)' : 'var(--ink-3)';
      b.style.fontWeight = on ? '600' : '400';
      b.style.boxShadow = on ? 'inset 0 -2px 0 var(--accent)' : 'none';
    });
    if (hint) hint.textContent = '';
  };
  qa('.cc-mcp-mode').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  setMode('stdio');

  const refresh = async () => {
    let rows = [];
    try { rows = await rt.mcp.list(); } catch (_e) {}
    const body = q('#ccMcpList');
    if (!body) return;
    body.innerHTML = rows.length
      ? rows.map((s) => {
          const http = s.transport === 'http';
          // 端点 / 命令仅呈现给用户(不进模型);经 cEsc 转义。
          const where = http ? cEsc(s.url || '') : (cEsc(s.command) + ' ' + cEsc((s.args || []).join(' ')));
          const ttag = `<span class="mono" style="font-size:9.5px;color:var(--ink-3);border:0.5px solid var(--border);border-radius:3px;padding:0 4px;">${http ? tt('远程', 'REMOTE') : tt('本地', 'LOCAL')}</span>`;
          const tools = (s.tools || []).map((t) => cEsc(t.name)).join('、');
          const status = s.error ? `<span style="color:var(--ink-3);">${tt('连接失败', 'Failed')}</span>`
            : s.enabled ? (s.connected ? `<span style="color:var(--status-done);">${s.toolCount} ${tt('工具', 'tools')}</span>` : tt('连接中…', 'Connecting…'))
            : `<span style="color:var(--ink-3);">${tt('已停用', 'Disabled')}</span>`;
          // 令牌状态:只报 configured/empty,永不回显值(红线)。
          const authLine = http ? `<div style="font-size:11px;color:var(--ink-2);margin-top:3px;">${s.authConfigured ? ('🔑 ' + tt('令牌已配置', 'Token set')) : tt('未配置令牌(无鉴权)', 'No token (unauthenticated)')}</div>` : '';
          // stdio 环境变量状态:只列已配变量名(值只在钥匙串、前端不见)+ 可点 × 清除。
          const envList = (s.envConfigured || []).filter((e) => e && e.status === 'configured');
          const envLine = !http ? `<div style="font-size:11px;color:var(--ink-2);margin-top:3px;">${envList.length
            ? '🔑 ' + envList.map((e) => `<span class="mono" style="font-size:10px;">${cEsc(e.var)}</span> <span data-mcpenvclear data-cn="${cEsc(s.name)}" data-cv="${cEsc(e.var)}" title="${tt('清除', 'Clear')}" style="cursor:pointer;color:var(--ink-3);padding:0 2px;">×</span>`).join('　')
            : tt('未配置环境变量', 'No env vars')}</div>` : '';
          return `<div style="padding:9px 0;border-bottom:0.5px solid var(--border);"><div style="display:flex;gap:10px;align-items:center;">
            <div style="flex:1;min-width:0;"><div style="font-size:13.5px;color:var(--ink);font-weight:500;">${ttag} ${cEsc(s.name)} · ${status}</div>
              <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-3);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${where}</div>
              ${tools ? `<div style="font-size:11px;color:var(--ink-2);margin-top:3px;">${tools}</div>` : ''}
              ${authLine}
              ${envLine}
              ${/* 服务器错误体 = 外部(不可信)内容:逐字 cEsc 转义后只呈现给用户,永不进模型。逐字保留原设置页行为(便于用户排错)。 */ ''}
              ${s.error ? `<div style="font-size:11px;color:var(--ink-3);margin-top:3px;">${cEsc(s.error)}</div>` : ''}</div>
            ${http ? `<button class="btn" data-mcpauth="${cEsc(s.name)}" style="padding:4px 10px;font-size:11px;flex-shrink:0;">${tt('令牌', 'Token')}</button>` : ''}
            ${!http ? `<button class="btn" data-mcpenv="${cEsc(s.name)}" style="padding:4px 10px;font-size:11px;flex-shrink:0;">${tt('变量', 'Env')}</button>` : ''}
            <button class="btn" data-mcptoggle="${cEsc(s.name)}" style="padding:4px 10px;font-size:11px;flex-shrink:0;">${s.enabled ? tt('停用', 'Disable') : tt('启用', 'Enable')}</button>
            <button class="btn" data-mcpdel="${cEsc(s.name)}" style="padding:4px 10px;font-size:11px;flex-shrink:0;">${tt('删除', 'Remove')}</button>
          </div>
          ${http ? `<div class="mcp-authedit" data-for="${cEsc(s.name)}" style="display:none;gap:6px;margin-top:8px;">
            <input class="input" type="password" autocomplete="off" placeholder="${tt('鉴权令牌(留空保存 = 清除)', 'Auth token (save empty = clear)')}" style="flex:1;">
            <button class="btn btn-accent" data-mcpauthsave="${cEsc(s.name)}" style="padding:4px 12px;font-size:11px;flex-shrink:0;">${tt('保存', 'Save')}</button>
          </div>` : ''}
          ${!http ? `<div class="mcp-envedit" data-for="${cEsc(s.name)}" style="display:none;gap:6px;margin-top:8px;">
            <input class="input" data-envvar autocomplete="off" placeholder="${tt('变量名(如 BRAVE_API_KEY)', 'Var name (e.g. BRAVE_API_KEY)')}" style="flex:1;">
            <input class="input" type="password" data-envval autocomplete="off" placeholder="${tt('值(留空 = 清除该变量)', 'Value (empty = clear)')}" style="flex:1;">
            <button class="btn btn-accent" data-mcpenvsave="${cEsc(s.name)}" style="padding:4px 12px;font-size:11px;flex-shrink:0;">${tt('保存', 'Save')}</button>
          </div>` : ''}
          </div>`;
        }).join('')
      : `<p style="color:var(--ink-3);padding:14px 0;">${tt('还没有连接器。添加一个,让 AI 用上外部工具(每次调用都会先问你)。', 'No connectors yet. Add one to give the AI external tools — it asks before each call.')}</p>`;

    qa('[data-mcptoggle]').forEach((b) => (b.onclick = async () => {
      const s = rows.find((x) => x.name === b.dataset.mcptoggle); if (!s) return;
      try { await rt.mcp.setEnabled(s.name, !s.enabled); } catch (e) { toast(errText(e)); }
      await refresh();
    }));
    // 删除 = 破坏性 → 必走 guardrail(预览 + 确认)。
    qa('[data-mcpdel]').forEach((b) => (b.onclick = () => {
      if (!G || !G.confirmDestructive) return;
      G.confirmDestructive({
        title: tt('删除 MCP 服务器?', 'Remove MCP server?'),
        detail: (tt('将移除并断开:', 'Remove and disconnect: ')) + b.dataset.mcpdel,
        confirmLabel: tt('删除', 'Remove'),
        onConfirm: async () => { try { await rt.mcp.remove(b.dataset.mcpdel); } catch (_e) {} await refresh(); },
      });
    }));
    // 令牌:展开/收起行内输入 → setAuth(留空保存 = 清除)。令牌直送钥匙串。
    const findEdit = (name) => qa('.mcp-authedit').find((x) => x.dataset.for === name);
    qa('[data-mcpauth]').forEach((b) => (b.onclick = () => {
      const bx = findEdit(b.dataset.mcpauth); if (bx) bx.style.display = bx.style.display === 'none' ? 'flex' : 'none';
    }));
    qa('[data-mcpauthsave]').forEach((b) => (b.onclick = async () => {
      const name = b.dataset.mcpauthsave, bx = findEdit(name), inp = bx && bx.querySelector('input');
      const has = !!(inp && inp.value.trim());
      try { await rt.mcp.setAuth(name, (inp && inp.value) || ''); toast(has ? tt('令牌已保存', 'Token saved') : tt('令牌已清除', 'Token cleared')); }
      catch (e) { toast(errText(e)); }
      await refresh();
    }));
    // 环境变量(stdio):展开行内「名 + 值」→ setEnv(值直送钥匙串;留空 = 清除该变量)。
    const findEnvEdit = (name) => qa('.mcp-envedit').find((x) => x.dataset.for === name);
    qa('[data-mcpenv]').forEach((b) => (b.onclick = () => {
      const bx = findEnvEdit(b.dataset.mcpenv); if (bx) bx.style.display = bx.style.display === 'none' ? 'flex' : 'none';
    }));
    qa('[data-mcpenvsave]').forEach((b) => (b.onclick = async () => {
      const name = b.dataset.mcpenvsave, bx = findEnvEdit(name);
      const vn = bx && bx.querySelector('[data-envvar]'), vv = bx && bx.querySelector('[data-envval]');
      const varName = (vn && vn.value.trim()) || '';
      if (!varName) { toast(tt('请填变量名', 'Enter a var name')); return; }
      const hasVal = !!(vv && vv.value.trim());
      // toast 经 el(innerHTML) 进 DOM(toast.js:9 → dom.js:9)⇒ 用户数据须 cEsc(同 copilot-actions.js:38 纪律)
      try { await rt.mcp.setEnv(name, varName, (vv && vv.value) || ''); toast((hasVal ? tt('已保存 ', 'Saved ') : tt('已清除 ', 'Cleared ')) + cEsc(varName)); }
      catch (e) { toast(errText(e)); }
      await refresh();
    }));
    qa('[data-mcpenvclear]').forEach((el) => (el.onclick = async () => {
      const name = el.dataset.cn, varName = el.dataset.cv;
      try { await rt.mcp.setEnv(name, varName, ''); toast(tt('已清除 ', 'Cleared ') + cEsc(varName)); }
      catch (e) { toast(errText(e)); }
      await refresh();
    }));
  };
  await refresh();

  const addBtn = q('#ccMcpAddBtn');
  if (addBtn) addBtn.onclick = async () => {
    const name = val('#ccMcpName');
    if (!name) { toast(tt('请填名称', 'Enter a name')); return; }
    addBtn.disabled = true;
    try {
      if (mode === 'http') {
        const url = val('#ccMcpUrl');
        if (!url) { toast(tt('请填端点 URL', 'Enter endpoint URL')); return; }
        await rt.mcp.add(name, { url });
        const token = val('#ccMcpToken'); // 令牌直送钥匙串,前端不留存
        if (token) { try { await rt.mcp.setAuth(name, token); } catch (e) { toast(errText(e)); } }
      } else {
        const cmd = val('#ccMcpCmd');
        if (!cmd) { toast(tt('请填命令', 'Enter command')); return; }
        await rt.mcp.add(name, { command: cmd, args: parseArgs(val('#ccMcpArgs')) });
      }
      toast(tt('已添加 ', 'Added ') + cEsc(name)); // toast = innerHTML sink,用户数据须 cEsc(见上)
      ['#ccMcpName', '#ccMcpCmd', '#ccMcpArgs', '#ccMcpUrl', '#ccMcpToken'].forEach((id) => { const e = q(id); if (e) e.value = ''; });
      if (hint) hint.textContent = '';
      await refresh();
    }
    catch (e) { toast(errText(e)); }
    finally { addBtn.disabled = false; }
  };

  const testBtn = q('#ccMcpTestBtn');
  if (testBtn) testBtn.onclick = async () => {
    testBtn.disabled = true;
    if (hint) hint.textContent = tt('连接中…', 'Connecting…');
    try {
      let r;
      if (mode === 'http') {
        const url = val('#ccMcpUrl');
        if (!url) { if (hint) hint.textContent = ''; toast(tt('请先填 URL', 'Enter URL first')); return; }
        const token = val('#ccMcpToken');
        r = await rt.mcp.probe({ url, token: token || undefined });
      } else {
        const cmd = val('#ccMcpCmd');
        if (!cmd) { if (hint) hint.textContent = ''; toast(tt('请先填命令', 'Enter command first')); return; }
        r = await rt.mcp.probe({ command: cmd, args: parseArgs(val('#ccMcpArgs')) });
      }
      if (hint) hint.textContent = tt('成功 · ', 'OK · ') + r.toolCount + tt(' 个工具', ' tools');
      toast(tt('连接成功 · ', 'Connected · ') + r.toolCount + tt(' 工具', ' tools'));
    }
    catch (e) { if (hint) hint.textContent = ''; toast(errText(e)); }
    finally { testBtn.disabled = false; }
  };
}
