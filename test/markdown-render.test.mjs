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
  // 注:本渲染器不保护行内码内容免于后续行内标记(如 `**x**` 会变粗体)—— 属保真瑕疵,非安全问题;
  //   安全不变式是「内容照样被 esc 转义、无原始标签」。此处只钉安全侧。
  const out = renderMarkdown('`<img onerror=x>`');
  assert.ok(out.includes('<code>'), '应产生行内码');
  assert.ok(!/<img/i.test(out), '行内码内的 <img 不得成为真标签');
  assert.ok(out.includes('&lt;img'), '应转义为实体');
});
