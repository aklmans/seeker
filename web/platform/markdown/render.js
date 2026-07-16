// @ts-check
/**
 * 安全 Markdown 渲染(平台 · 业务无关)—— 把**不可信的模型输出**渲染成受限 HTML。
 *
 * 威胁模型:AI 流式文本是不可信内容(同 show_widget / RAG 的「Untrusted」红线)。
 * 策略:**先转义所有 HTML(& < > " '),再在转义后的文本上用正则插入固定白名单标签**。
 * 原始 HTML 标签一律被转义成实体(无法生效);链接仅允许 http/https;不产生任何
 * script / style / 事件属性 / 任意属性。覆盖 AI 常用语法:标题、粗体、斜体、行内码、
 * 代码块、有/无序列表、引用、分隔线、段落、软换行、链接。(表格暂不支持,按纯文本降级。)
 */

/** 转义 HTML 特殊字符(含属性上下文用的引号)。 @param {string} t */
function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 行内标记:**先转义**,再插入白名单行内标签。行内码内容用占位符保护、不被后续标记再解析。 @param {string} raw */
function inline(raw) {
  // 先转义;再剥除输入里的 NUL(U+0000)—— 下面拿它当行内码的私有占位符,剥掉即杜绝用户伪造占位。
  let t = esc(raw).replace(/\u0000/g, '');
  // 行内码 `code`:先抽出、留占位(内容已 esc 转义),使其内部的 * _ [ ] ( ) 不被后续行内规则再解析。
  /** @type {string[]} */
  const codes = [];
  t = t.replace(/`([^`\n]+)`/g, (_m, c) => {
    codes.push(c);
    return '\u0000' + (codes.length - 1) + '\u0000'; // NUL 包裹的索引:用户输入已剥 NUL ⇒ 不可伪造
  });
  // 粗体 **x** / __x__
  t = t.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
  // 斜体 *x* / _x_(非空白起始,避免误吞乘号/下划线)
  t = t.replace(/\*(\S[^*\n]*?)\*/g, '<em>$1</em>');
  t = t.replace(/(^|[\s(])_(\S[^_\n]*?)_/g, '$1<em>$2</em>');
  // 链接 [text](http...) —— 仅 http/https;url 已被 esc 转义(引号→实体),无法逃逸属性
  t = t.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, txt, url) => '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + txt + '</a>');
  // 还原行内码:占位符 → <code>已转义内容</code>。内容全经 esc(无裸 " < > &),包进任何上下文都无法逃逸。
  t = t.replace(/\u0000(\d+)\u0000/g, (_m, i) => '<code>' + (codes[+i] || '') + '</code>');
  return t;
}

/**
 * Markdown → 安全 HTML。容忍未闭合构造(流式中途也能渲染)。
 * @param {string} src
 * @returns {string}
 */
export function renderMarkdown(src) {
  const lines = String(src == null ? '' : src).split('\n');
  let html = '';
  let i = 0;
  let inUl = false;
  let inOl = false;
  const closeLists = () => {
    if (inUl) { html += '</ul>'; inUl = false; }
    if (inOl) { html += '</ol>'; inOl = false; }
  };
  // 表格分隔行:仅由 -:|空白 组成且含 -(用于探测表格起始)
  /** @param {string} l */
  const isDelim = (l) => l != null && /\|/.test(l) && /^[\s|:-]+$/.test(l) && /-/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    // 代码围栏 ```lang(块内只转义、不解析);容忍未闭合
    const fence = line.match(/^\s*```/);
    if (fence) {
      closeLists();
      i++;
      let code = '';
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { code += lines[i] + '\n'; i++; }
      if (i < lines.length) i++; // 跳过闭合围栏(若有)
      html += '<pre><code>' + esc(code.replace(/\n$/, '')) + '</code></pre>';
      continue;
    }
    // 标题 # .. ######
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeLists(); const lvl = h[1].length; html += '<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>'; i++; continue; }
    // 分隔线
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { closeLists(); html += '<hr>'; i++; continue; }
    // 引用
    if (/^\s*>\s?/.test(line)) { closeLists(); html += '<blockquote>' + inline(line.replace(/^\s*>\s?/, '')) + '</blockquote>'; i++; continue; }
    // GFM 表格:含 | 的表头行 + 分隔行;单元格走 inline()(转义安全)
    if (line.indexOf('|') >= 0 && isDelim(lines[i + 1])) {
      closeLists();
      /** @param {string} row @returns {string[]} */
      const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const aligns = cells(lines[i + 1]).map((c) => { const L = /^:/.test(c), R = /:$/.test(c); return L && R ? 'center' : R ? 'right' : L ? 'left' : ''; });
      /** @param {string} tag @param {string} c @param {number} k */
      const cellTag = (tag, c, k) => '<' + tag + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '') + '>' + inline(c) + '</' + tag + '>';
      const head = '<tr>' + cells(line).map((c, k) => cellTag('th', c, k)).join('') + '</tr>';
      i += 2;
      let body = '';
      while (i < lines.length && lines[i].indexOf('|') >= 0 && !/^\s*$/.test(lines[i])) {
        body += '<tr>' + cells(lines[i]).map((c, k) => cellTag('td', c, k)).join('') + '</tr>';
        i++;
      }
      html += '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
      continue;
    }
    // 无序列表
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) { if (inOl) { html += '</ol>'; inOl = false; } if (!inUl) { html += '<ul>'; inUl = true; } html += '<li>' + inline(ul[1]) + '</li>'; i++; continue; }
    // 有序列表
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) { if (inUl) { html += '</ul>'; inUl = false; } if (!inOl) { html += '<ol>'; inOl = true; } html += '<li>' + inline(ol[1]) + '</li>'; i++; continue; }
    // 空行 → 关列表 / 段落分隔
    if (/^\s*$/.test(line)) { closeLists(); i++; continue; }
    // 段落:合并连续普通行(软换行 → <br>)
    closeLists();
    let para = line;
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) &&
      !/^\s*(#{1,6}\s|```|>\s?|[-*+]\s|\d+\.\s|(---|\*\*\*|___)\s*$)/.test(lines[i]) &&
      !(lines[i].indexOf('|') >= 0 && isDelim(lines[i + 1]))) {  // 遇表格起始则断段
      para += '\n' + lines[i]; i++;
    }
    html += '<p>' + inline(para).replace(/\n/g, '<br>') + '</p>';
  }
  closeLists();
  return html;
}
