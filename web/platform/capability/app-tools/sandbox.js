// @ts-check
/**
 * app-tool 计算沙箱(T1)—— 平台层,业务无关,两端通用。
 *
 * 应用声明的 `compute` 纯函数 `(input, rows) => output` 在**独立最小 srcDoc** 的三墙隔离里执行:
 *   墙1 `iframe sandbox="allow-scripts"`(不加 allow-same-origin → null 起源,够不到父 DOM / rt / 存储);
 *   墙2 srcDoc 内 CSP `default-src 'none'`(掐断一切网络:fetch / XHR / import / WebSocket 全死);
 *   墙3 父窗口零信任:**只有 input → result 一条往返,没有 `window.seeker.action` 回父通道**。
 *
 * ★与 widgets/render.js 的 `buildSrcDoc` **刻意不共享**:那条 BRIDGE 提供 `window.seeker.action(...)`
 *   —— 一条让沙箱内容回父窗口「提意图」的通道(widget 交互需要),外加主题 / resize / 设计样式。
 *   计算沙箱**一样都不要**:compute 不渲染 UI、不与用户交互,任何多余的入站/出站面都是攻击面。
 *   故这里是一份**最小 srcDoc**:CSP + compute 源 + 一段只做 `run → result` 的 bridge。
 *
 * 输出经 `output` schema **校验 + 投影**(validate.js `projectToSchema`,**可信父代码**)后才交回:
 * 只回按 schema 重建的副本、丢弃未声明字段(**输出 = schema,非 ⊇**),校验失败 ⇒ 报错、绝不喂模型(I4)。
 *
 * 诚实边界:真正的隔离(null 起源 / CSP 掐网 / 无回父通道)由浏览器 iframe 保证,**不可纯 node 单测**
 *   —— 同 show_widget 的沙箱。对抗性验证在真浏览器里跑(见 T1 送审记录)。本模块的可 node 测部分
 *   是 validate.js;沙箱本体走 preview 真机对抗验证。
 */
import { projectToSchema } from './validate.js';

/** 计算沙箱 CSP:掐断一切网络;仅允许内联脚本(注入 compute 源 + bridge)。**无 style/img** —— 计算不渲染。 */
const COMPUTE_CSP = "default-src 'none'; script-src 'unsafe-inline'";

/** 硬超时上限(ms):平台封顶,任何调用方请求都被 `min` 夹住,防单次 compute 挂住调用者。 */
const MAX_TIMEOUT_MS = 60000;
/** 默认超时(ms):调用方未指定时用。 */
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * 沙箱内 bridge(运行在隔离上下文里):**只做** 端口握手 + 收 `run` + 跑 compute + 回 `result`。
 * 没有 `window.seeker`、没有 action 通道、没有 resize/主题/错误上抛之外的任何出站。
 */
const COMPUTE_BRIDGE =
  '(function(){var port=null;' +
  'function reply(m){if(port){try{port.postMessage(m);}catch(e){}}}' +
  'function errStr(e){try{return String((e&&e.message)||e||"compute error").slice(0,500);}catch(_){return "compute error";}}' +
  'window.addEventListener("message",function(e){' +
  'if(e.source!==window.parent)return;' + // 墙3:只认父窗口握手,拒绝自投递 / 他源
  'if(e.data==="__seeker_compute_port"&&e.ports&&e.ports[0]){port=e.ports[0];' +
  'port.onmessage=function(ev){var d=ev.data;if(!d||typeof d!=="object"||d.type!=="run")return;' +
  'if(typeof __seeker_compute!=="function"){reply({type:"result",ok:false,error:"compute 模块未定义函数"});return;}' +
  'var out;try{out=__seeker_compute(d.input,d.rows);}catch(err){reply({type:"result",ok:false,error:errStr(err)});return;}' +
  // 支持同步或返回 Promise 的 compute;两条路都只回一条 result。
  'try{Promise.resolve(out).then(function(v){reply({type:"result",ok:true,output:v});},function(err){reply({type:"result",ok:false,error:errStr(err)});});}' +
  'catch(err){reply({type:"result",ok:false,error:errStr(err)});}' +
  '};}});' +
  '})();';

/**
 * 把 app 的 compute 源码包进**独立最小 srcDoc**(三墙 + 最小 bridge,无 action 通道)。
 * `computeSource` 是一段求值为函数 `(input, rows) => output` 的 JS 表达式源码。
 * @param {string} computeSource
 * @returns {string}
 */
export function buildComputeSrcDoc(computeSource) {
  // 防 `</script>` 提前闭合脚本标签(沙箱内无逃逸可言,纯为保模板完整;同 render.js 的 `<\/script>` 手法)。
  const safe = String(computeSource == null ? '' : computeSource).replace(/<\/(script)/gi, '<\\/$1');
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${COMPUTE_CSP}">` +
    '</head><body>' +
    // compute 源先于 bridge 求值:求值失败(语法错)⇒ __seeker_compute 保持 null,bridge 如实报「未定义函数」。
    '<script>var __seeker_compute=null;try{__seeker_compute=(' + safe + ');}catch(e){}<\/script>' +
    '<script>' + COMPUTE_BRIDGE + '<\/script>' +
    '</body></html>'
  );
}

/**
 * 在隔离沙箱里跑一次 compute,校验输出,返回 `{ok:true, output}` 或 `{ok:false, error}`。
 * **绝不 reject** —— 一切失败面(语法错 / 抛异常 / 超时 / 校验失败 / 端口建立失败)都翻成
 * `{ok:false, error}`,由上层(T2 工具循环)当作模型可见的工具错误。
 *
 * @param {{
 *   computeSource: string,
 *   input?: any,
 *   rows?: any,
 *   output?: any,        // output JSON Schema(子集);缺失 ⇒ fail-closed(见下)
 *   timeoutMs?: number,  // 调用方请求;被 min(请求, 平台上限 MAX_TIMEOUT_MS) 夹住
 *   doc?: Document,      // 注入宿主文档(测试可传;默认 document)
 * }} spec
 * @returns {Promise<{ok:true,output:any}|{ok:false,error:string}>}
 */
export function runComputeSandbox(spec) {
  // ★I4 fail-closed:工具没声明 output schema ⇒ 无从校验 ⇒ 拒绝,绝不把未校验输出喂回模型。
  //   与「reads 必填 / 省略即拒」同纪律 —— 缺省绝不给「放行」的默认语义。
  if (!spec || !spec.output || typeof spec.output !== 'object') {
    return Promise.resolve({ ok: false, error: '工具未声明 output schema,拒绝喂回模型' });
  }
  const doc = spec.doc || document;
  const timeoutMs = Math.max(
    1,
    Math.min(MAX_TIMEOUT_MS, typeof spec.timeoutMs === 'number' && spec.timeoutMs > 0 ? spec.timeoutMs : DEFAULT_TIMEOUT_MS),
  );

  return new Promise((resolve) => {
    let done = false;
    /** @type {MessagePort | null} */
    let port = null;

    const frame = doc.createElement('iframe');
    // 墙1:仅 allow-scripts —— 不加 allow-same-origin(否则隔离失效)、不加 forms/popups/top-navigation。
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;left:-9999px;';
    // 墙2:srcDoc 内含 CSP default-src 'none'。
    frame.setAttribute('srcdoc', buildComputeSrcDoc(spec.computeSource));

    /** @param {{ok:true,output:any}|{ok:false,error:string}} res */
    function settle(res) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (port) {
        try { port.close(); } catch (_e) { /* ignore */ }
        port = null;
      }
      if (frame.parentNode) frame.remove();
      resolve(res);
    }

    const timer = setTimeout(
      () => settle({ ok: false, error: 'compute 超时(未执行任何操作)' }),
      timeoutMs,
    );

    frame.addEventListener('load', () => {
      try {
        const ch = new MessageChannel();
        ch.port1.onmessage = (e) => {
          const msg = e.data;
          // 墙3:只认 { type:'result' } 结构;其余入站一律忽略(不给沙箱任何别的回父语义)。
          if (!msg || typeof msg !== 'object' || msg.type !== 'result') return;
          if (!msg.ok) {
            settle({ ok: false, error: typeof msg.error === 'string' ? msg.error : 'compute 失败' });
            return;
          }
          // ★I4:输出经 schema **校验 + 投影**(可信父代码)。校验失败 ⇒ 报错;通过 ⇒ 只回**按 schema
          //   重建的副本**(projectToSchema),未声明字段被丢弃 —— 绝不把原始 output(可能夹带超范围
          //   的 D3 用户数据 / 外部注入)交回模型。这把 I4 从「输出 ⊇ schema」收紧到「输出 = schema」。
          const v = projectToSchema(msg.output, spec.output);
          if (!v.ok) {
            settle({ ok: false, error: '输出不合 schema:' + v.error });
            return;
          }
          settle({ ok: true, output: v.value });
        };
        port = ch.port1;
        const cw = frame.contentWindow;
        if (!cw) {
          settle({ ok: false, error: '沙箱窗口不可用' });
          return;
        }
        // 交端口给沙箱(null 起源 ⇒ targetOrigin 只能 '*';安全靠 bridge 的 e.source===parent 校验)。
        cw.postMessage('__seeker_compute_port', '*', [ch.port2]);
        // run 载荷经端口投递(port2 未 start 前会缓冲,bridge 设 onmessage 即取到,无丢唤醒)。
        ch.port1.postMessage({ type: 'run', input: spec.input ?? null, rows: spec.rows ?? null });
      } catch (_e) {
        settle({ ok: false, error: '沙箱端口建立失败' });
      }
    });

    (doc.body || doc.documentElement).appendChild(frame);
  });
}
