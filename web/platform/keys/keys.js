// @ts-check
/**
 * Seeker · 应用内快捷键(A 层) —— 集中式注册 / 分发 / 帮助数据。
 *
 * 平台层、**业务无关**:本模块只负责
 *   · Mod → ⌘(mac)/ Ctrl(win)平台映射;
 *   · **单一**全局 keydown 监听与分发(不散落在各组件);
 *   · 输入态守卫(textarea/input 聚焦时除"允许项"外不劫持;Mod+Z 在输入态让位文本撤销);
 *   · Esc **逐层**链;
 *   · 帮助浮层所需的分组数据。
 * 具体动作(去哪一页、开哪个弹窗)由业务侧注册时以 `run` 传入——模块不认识业务。
 * 纯前端,网页与桌面通用;不引入 Tauri global-shortcut(那是 B 层 / M6)。
 *
 * 暴露为 `window.SeekerKeys`(经典脚本,先于内联 bootstrap 加载)。
 *
 * @typedef {{ zh: string, en: string }} Bil
 * @typedef {Object} Shortcut
 * @property {string}        id
 * @property {string}        combo          组合串,如 'Mod+Shift+D' / 'Mod+1' / 'Mod+/'
 * @property {Bil}           [group]        帮助浮层分组
 * @property {Bil}           [label]        帮助浮层文案(双语);缺省则不进帮助
 * @property {() => void}    [run]          触发动作;缺省=仅信息行(进帮助但不分发,如已有的输入内按键)
 * @property {() => boolean} [when]         守卫:返回 false 则跳过本键(不拦截,让默认/浏览器行为继续)
 * @property {boolean}       [allowInInput] 输入态是否仍可触发(默认 false)
 * @property {string}        [display]      帮助浮层显示用键位(覆盖自动格式化,给 '/'、'Enter' 等信息行用)
 */
(function () {
  'use strict';
  var navAny = /** @type {any} */ (navigator);
  var IS_MAC = /Mac|iPhone|iPad|iPod/.test(navAny.platform || navAny.userAgent || '');

  /** @type {Shortcut[]} */
  var list = [];
  /** @type {{ priority: number, fn: () => boolean }[]} */
  var escapers = [];

  /** @param {string} combo */
  function parse(combo) {
    var mod = false, shift = false, alt = false, key = '';
    combo.split('+').forEach(function (raw) {
      var p = raw.trim().toLowerCase();
      if (p === 'mod') mod = true;
      else if (p === 'shift') shift = true;
      else if (p === 'alt' || p === 'option') alt = true;
      else key = p;
    });
    return { mod: mod, shift: shift, alt: alt, key: key };
  }

  /** @param {KeyboardEvent} e @param {string} combo */
  function matches(e, combo) {
    var c = parse(combo);
    var modOk = c.mod ? (IS_MAC ? e.metaKey : e.ctrlKey) : (!e.metaKey && !e.ctrlKey);
    if (!modOk) return false;
    if (c.shift !== e.shiftKey) return false;
    if (c.alt !== e.altKey) return false;
    return (e.key || '').toLowerCase() === c.key;
  }

  /** @param {Element | null} elRaw */
  function isEditable(elRaw) {
    var el = /** @type {HTMLElement | null} */ (elRaw);
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
  }

  /** 展示用键位:mac 拼 ⌘⇧K,其它拼 Ctrl+Shift+K。 @param {string} combo */
  function fmt(combo) {
    var c = parse(combo);
    /** @type {string[]} */
    var seg = [];
    if (c.mod) seg.push(IS_MAC ? '⌘' : 'Ctrl');
    if (c.alt) seg.push(IS_MAC ? '⌥' : 'Alt');
    if (c.shift) seg.push(IS_MAC ? '⇧' : 'Shift');
    var k = c.key;
    if (k === 'escape') k = 'Esc';
    else if (k.length === 1) k = k.toUpperCase();
    seg.push(k);
    return IS_MAC ? seg.join('') : seg.join('+');
  }

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    // Esc 始终走逐层链(即便输入态);首个返回 true 的处理器消费之。
    if (e.key === 'Escape') {
      for (var i = 0; i < escapers.length; i++) {
        if (escapers[i].fn()) { e.preventDefault(); return; }
      }
      return;
    }
    var editable = isEditable(document.activeElement);
    for (var j = 0; j < list.length; j++) {
      var s = list[j];
      if (!s.run) continue;                       // 信息行,不分发
      if (!matches(e, s.combo)) continue;
      if (s.when && !s.when()) continue;          // 守卫不满足 → 让位默认行为(如本页无搜索框时 Mod+F 交还浏览器查找)
      if (editable && !s.allowInInput) return;     // 输入态:不劫持(让浏览器/文本处理,如 Mod+Z 文本撤销)
      e.preventDefault();
      s.run();
      return;
    }
  }

  var api = {
    isMac: IS_MAC,
    fmt: fmt,
    /** @param {Shortcut} s */
    register: function (s) { list.push(s); return api; },
    /** @param {Shortcut[]} arr */
    registerAll: function (arr) { arr.forEach(function (s) { list.push(s); }); return api; },
    /** 注册一个 Esc 逐层处理器;fn 返回 true 表示"已消费、停止冒泡到下一层"。
     *  @param {() => boolean} fn @param {number} [priority] 越大越先 */
    registerEscape: function (fn, priority) {
      escapers.push({ fn: fn, priority: priority || 0 });
      escapers.sort(function (a, b) { return b.priority - a.priority; });
      return api;
    },
    /** 帮助浮层分组数据(按注册顺序成组)。
     *  @returns {{ group: Bil, items: { fmt: string, label: Bil }[] }[]} */
    groups: function () {
      /** @type {{ group: Bil, items: { fmt: string, label: Bil }[] }[]} */
      var out = [];
      list.forEach(function (s) {
        if (!s.label) return;
        var g = s.group || { zh: '其他', en: 'Other' };
        var bucket = null;
        for (var i = 0; i < out.length; i++) { if (out[i].group.zh === g.zh) { bucket = out[i]; break; } }
        if (!bucket) { bucket = { group: g, items: [] }; out.push(bucket); }
        bucket.items.push({ fmt: s.display || fmt(s.combo), label: s.label });
      });
      return out;
    },
    /** 安装唯一的全局 keydown 监听。 */
    attach: function () { document.addEventListener('keydown', onKeydown); return api; }
  };

  /** @type {any} */ (window).SeekerKeys = api;
})();
