// @ts-check
/**
 * 应用壳注册表(多应用平台 · 阶段1)。契约见 ./types.d.ts(SeekerShellApi)。
 * classic IIFE(同 platform/keys/keys.js 先例):单体 INIT 在解析期同步消费,
 * ES module(隐式 defer)时序赶不上,故与消费方同为 classic、head 内先于内联脚本定义。
 * 阶段1:enabled 恒 true(开关状态阶段2 接 settings KV);组合函数已按启用集过滤,接上即生效。
 * 注册表 DOM-free:只做组合,渲染由消费方(index.html 过渡态 / 阶段3 的壳模块)执行。
 */
(function () {
  'use strict';
  /** @typedef {import('./types').AppManifest} AppManifest */
  /** @typedef {import('./types').ShellPage} ShellPage */
  /** @typedef {import('./types').ShellOwn} ShellOwn */
  /** @typedef {import('./types').LString} LString */
  /** @typedef {import('./types').CardSpec} CardSpec */

  /** @type {AppManifest[]} 注册序即导航序 */
  const apps = [];
  /** @type {ShellOwn} 壳自持页面/分组/集合(设置页等;排应用之后) */
  let shellOwn = { pages: [], groups: {}, collections: [] };
  /** @type {Record<string, boolean>} 启用状态(缺省启用;阶段2 接 settings KV 持久化) */
  const enabledState = {};

  /** @param {AppManifest} m */
  function register(m) {
    if (!m || typeof m.id !== 'string' || !/^[a-z][a-z0-9]*$/.test(m.id)) {
      throw new Error('AppManifest.id 非法:' + (m && m.id));
    }
    if (apps.some((a) => a.id === m.id)) throw new Error('应用重复注册:' + m.id);
    if (!Array.isArray(m.pages)) throw new Error('AppManifest.pages 必须是数组:' + m.id);
    apps.push(m);
  }

  function list() {
    return apps.slice();
  }

  /** @param {string} id */
  function enabled(id) {
    return enabledState[id] !== false;
  }

  function enabledApps() {
    return apps.filter((a) => enabled(a.id));
  }

  /** @param {ShellOwn} own */
  function setShell(own) {
    shellOwn = {
      pages: (own.pages || []).slice(),
      groups: own.groups || {},
      collections: (own.collections || []).slice(),
    };
  }

  /** @returns {ShellPage[]} */
  function pages() {
    return enabledApps()
      .flatMap((a) => a.pages)
      .concat(shellOwn.pages);
  }

  /** @returns {Record<string, LString>} */
  function groups() {
    /** @type {Record<string, LString>} */
    const out = {};
    enabledApps().forEach((a) => Object.assign(out, a.groups || {}));
    Object.assign(out, shellOwn.groups || {});
    return out;
  }

  /** @returns {Record<string, CardSpec>} */
  function cards() {
    /** @type {Record<string, CardSpec>} */
    const out = {};
    enabledApps().forEach((a) => Object.assign(out, a.cards || {}));
    return out;
  }

  /** 框定链:首个改写生效(与单体 frameQuery「未命中原样返回」同约)。 @param {string} text */
  function frameQuery(text) {
    for (const a of enabledApps()) {
      if (typeof a.frameQuery === 'function') {
        const r = a.frameQuery(text);
        if (typeof r === 'string' && r !== text) return r;
      }
    }
    return text;
  }

  /** @returns {string[]} */
  function collections() {
    const out = new Set(shellOwn.collections || []);
    enabledApps().forEach((a) => (a.collections || []).forEach((c) => out.add(c)));
    return [...out];
  }

  /** @type {import('./types').SeekerShellApi} */
  const api = { register, list, enabled, setShell, pages, groups, cards, frameQuery, collections };
  /** @type {any} */ (window).SeekerShell = api;
})();
