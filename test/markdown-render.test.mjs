// 平台安全 Markdown 渲染器回归测试。
// ★背景:renderMarkdown 现在渲染**用户/AI 内容**到笔记/Prompt/Skill/项目卡片 + 编辑预览面
//   (blast radius 大幅扩大)。它是 build-from-esc:先转义所有 HTML(& < > " '),再在**已转义**
//   文本上用正则插白名单标签 ⇒ 原始 HTML 变实体、无 script/事件属性、链接仅 http(s)。
// ★纪律:每条断言都要能变红 —— 既有「注入被中和」的否定断言,也有「合法语法确实生效」的
//   肯定对照(控制组);若渲染器被弱化(如去掉引号转义、放开 javascript: 链接),对应断言即红。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../web/platform/markdown/render.js';

test('★XSS:原始 <img onerror> 被转义成实体,不产生真标签', () => {
  const out = renderMarkdown('<img src=x onerror=alert(1)>');
  // 关键不变式:没有真标签形成(<img 不出现);onerror=… 只作为 &lt;img…&gt; 里的转义文本存在 = 无害
  assert.ok(!/<img/i.test(out), '不得出现真的 <img 标签');
  assert.ok(out.includes('&lt;img'), '应转义为 &lt;img 实体(literal 文本)');
});

test('★XSS:<script> 被中和', () => {
  const out = renderMarkdown('hello <script>alert(1)</script> world');
  assert.ok(!/<script/i.test(out), '不得出现真的 <script 标签');
  assert.ok(out.includes('&lt;script&gt;'), '应转义为实体');
});

test('★XSS:javascript: 链接不生成 <a>(仅 http/https 白名单)', () => {
  const out = renderMarkdown('[click me](javascript:alert(1))');
  assert.ok(!/<a\s/i.test(out), 'javascript: 不在白名单 → 不得生成锚点');
  assert.ok(!/href=/i.test(out), '不得出现任何 href');
});

test('★XSS:data: 链接不生成 <a>', () => {
  const out = renderMarkdown('[x](data:text/html,<script>alert(1)</script>)');
  assert.ok(!/<a\s/i.test(out), 'data: 不在白名单 → 不得生成锚点');
  assert.ok(!/<script/i.test(out), '内嵌 script 仍被转义');
});

test('★XSS:URL 内的引号被转义,无法逃逸 href 属性(去掉引号转义即红)', () => {
  const out = renderMarkdown('[x](https://evil.com/"onmouseover="alert(1))');
  // esc() 已把 " → &quot;,故属性里是 onmouseover=&quot; 而非真属性分隔符
  assert.ok(!/onmouseover="/.test(out), '不得出现真正的 onmouseover 事件属性');
  assert.ok(out.includes('&quot;'), 'URL 里的引号应为 &quot; 实体');
});

test('★控制组:合法 http 链接确实生成受限锚点(rel/target 齐)', () => {
  const out = renderMarkdown('[ok](https://example.com)');
  assert.ok(/<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">ok<\/a>/.test(out),
    '合法链接应生成带 rel=noopener 的锚点');
});

test('★控制组:粗体 / 标题 / 列表 / 行内码 确实渲染(证明测试可区分)', () => {
  assert.ok(renderMarkdown('**bold**').includes('<strong>bold</strong>'), '粗体');
  assert.ok(renderMarkdown('# Title').includes('<h1>Title</h1>'), '一级标题');
  assert.ok(renderMarkdown('- a\n- b').includes('<ul><li>a</li><li>b</li></ul>'), '无序列表');
  assert.ok(renderMarkdown('`code`').includes('<code>code</code>'), '行内码');
});

test('★控制组:表格渲染(单元格内容仍走转义)', () => {
  const out = renderMarkdown('| a | b |\n| --- | --- |\n| <x> | 2 |');
  assert.ok(/<table>/.test(out) && /<th>a<\/th>/.test(out), '应生成表格与表头');
  assert.ok(out.includes('&lt;x&gt;'), '单元格内的 <x> 仍被转义,不产生标签');
});

test('★边界:null / 非字符串 / 空 不抛,返回字符串', () => {
  assert.equal(typeof renderMarkdown(/** @type {any} */ (null)), 'string');
  assert.equal(typeof renderMarkdown(/** @type {any} */ (undefined)), 'string');
  assert.equal(renderMarkdown(''), '');
});

test('★行内码内容仍被转义(原始标签无法逃逸)', () => {
  const out = renderMarkdown('`<img onerror=x>`');
  assert.ok(out.includes('<code>'), '应产生行内码');
  assert.ok(!/<img/i.test(out), '行内码内的 <img 不得成为真标签');
  assert.ok(out.includes('&lt;img'), '应转义为实体');
});

// ===== 行内码保真:内部标记不被再解析(占位符保护;去掉保护即红)=====
test('★保真:行内码内的 **粗体** 不被解析(保留字面)', () => {
  const out = renderMarkdown('`**not bold**`');
  assert.equal(out, '<p><code>**not bold**</code></p>', '星号应原样落在 code 内');
  assert.ok(!out.includes('<strong>'), '不得渲染成粗体');
});

test('★保真:行内码内的链接语法不被解析(不泄漏 <a>)', () => {
  const out = renderMarkdown('`[x](http://y)`');
  assert.equal(out, '<p><code>[x](http://y)</code></p>', '链接语法应原样落在 code 内');
  assert.ok(!/<a\s/i.test(out), '不得在行内码里生成锚点');
});

test('★保真:行内码不吞空格,普通粗体仍生效(控制组)', () => {
  assert.equal(renderMarkdown('a `code` b'), '<p>a <code>code</code> b</p>', '两侧空格保留');
  assert.equal(renderMarkdown('**real**'), '<p><strong>real</strong></p>', 'code 外的粗体照常');
});

test('★安全:用户无法用输入里的 NUL 伪造行内码占位符', () => {
  // 占位符是 NUL 包裹的索引;inline() 先剥除输入中的 NUL ⇒ 伪造的「NUL0NUL」无从命中还原正则,
  //   更不会复制到已存在的 codes[0]。否则可借此把任意已转义片段重复注入(虽仍转义,但语义错乱)。
  const NUL = String.fromCharCode(0);
  assert.equal(renderMarkdown(NUL + '0' + NUL), '<p>0</p>', '无真码时:伪造占位符被中和为纯文本');
  assert.equal(renderMarkdown('`X` ' + NUL + '0' + NUL), '<p><code>X</code> 0</p>',
    '有真码 codes[0]=X 时:伪造仍不复制它');
  // 输出里绝不残留 NUL
  assert.ok(!renderMarkdown('`a` `b` c' + NUL).includes(NUL), '输出不含 NUL');
});
