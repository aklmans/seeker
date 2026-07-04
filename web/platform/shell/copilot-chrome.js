// @ts-nocheck —— 抽壳序3-a 过渡:Copilot 面板机制,引用 $/el(序1)+ copSend(序3-b 前向);类型化留 3.y;逻辑零改动。
/** 平台 · Copilot 面板机制 copEl/copOpen/copClose/copToggle/copScroll/copAppend + UI 模板 cCard/cAct/cBtn/cSuggs。
 *  依赖 $/el;cSuggs onclick 调 copSend(序3-b)、cBtn onclick 字符串(运行时);jobseek 专属响应(aiSuggs/copMatch/copReply)留 index.html/apps。
 *  挂全局 + 载序前置(在序1/序2 后;消费者运行时调)→ 零回归(约束⑤)。 */
function copEl(){return $('#copPanel');}
function copOpen(){copEl().classList.add('open'); setTimeout(()=>$('#copInput').focus(),260);}
function copClose(){copEl().classList.remove('open');}
function copToggle(){copEl().classList.contains('open')?copClose():copOpen();}
function copScroll(){const m=$('#copMsgs'); m.scrollTop=m.scrollHeight;}
function copAppend(role, html){const d=el(`<div class="cop-msg ${role}">${html}</div>`); $('#copMsgs').appendChild(d); copScroll(); return d;}
const cCard=(t,m)=>`<div class="cop-card"><div class="cct">${t}</div>${m?`<div class="ccm">${m}</div>`:''}</div>`;
const cAct=(arr)=>arr.length?`<div class="cop-actions">${arr.join('')}</div>`:'';
const cBtn=(l,oc,acc)=>`<button class="btn ${acc?'btn-accent':''}" onclick="${oc}">${l}</button>`;
const cSuggs=(arr)=>`<div class="cop-sugg">${arr.map(s=>`<button onclick="copSend('${s}')">${s}</button>`).join('')}</div>`;
