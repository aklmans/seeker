// @ts-check
/**
 * app-tool 输出校验(T1)—— JSON Schema **子集**,在**可信父代码**里执行。
 * —— 平台层,业务无关。
 *
 * 目的单一(不变式 I4):隔离沙箱里 compute 算出的返回值,必须严丝合缝对上应用声明的
 * `output` schema,**否则如实报错、绝不喂给模型**。校验点**必须在沙箱之外**(沙箱是不可信
 * 计算),故本模块跑在父窗口。
 *
 * 只覆盖工具输出实际会用到的关键字:`type`(单个或数组)/ `properties` / `required` /
 * `items` / `enum` / `additionalProperties`(bool 或子 schema)。**不追求完整 JSON Schema**
 * —— 表达力天花板换来的是「校验从严、可读、无依赖」:未知类型 / 缺失必填 / `false` 下的多余
 * 属性一律拒。缺失的关键字按 JSON Schema 语义「不约束」(空 schema `{}` = 放行任意值)。
 */

/** @param {any} v @returns {string} JSON Schema 语义的类型名(integer 单列)。 */
function jsonType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isFinite(v) && Number.isInteger(v) ? 'integer' : 'number';
  return typeof v; // 'string' | 'boolean' | 'object' | 'undefined' | 'function' | ...
}

/** type 关键字匹配:`number` 容纳 integer;其余精确。 @param {string} actual @param {string} expected */
function typeMatches(actual, expected) {
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  return actual === expected;
}

/** @param {string} path @param {string} msg @returns {{ok:false,error:string}} */
function fail(path, msg) {
  return { ok: false, error: path + ' ' + msg };
}

/** 结构相等(用于 enum 成员比较;仅 JSON 值)。 @param {any} a @param {any} b @returns {boolean} */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

/**
 * 递归校验。
 * @param {any} value 待校验值
 * @param {any} schema JSON Schema(子集)节点
 * @param {string} path 出错定位路径
 * @returns {{ok:true}|{ok:false,error:string}}
 */
function walk(value, schema, path) {
  // 空 / 非对象 schema ⇒ 不约束(JSON Schema:`{}`/`true` 放行任意)。顶层「必须有 schema」由
  // 调用点(sandbox.runComputeSandbox)fail-closed 把守,不在此处 —— 此处要支持嵌套的可选子 schema。
  if (!schema || typeof schema !== 'object') return { ok: true };

  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((/** @type {any} */ e) => deepEqual(e, value))) {
      return fail(path, '不在 enum 允许值内');
    }
  }

  if (schema.type !== undefined) {
    const at = jsonType(value);
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((/** @type {string} */ t) => typeMatches(at, t))) {
      return fail(path, `类型应为 ${types.join('|')},实为 ${at}`);
    }
  }

  const t = jsonType(value);

  if (t === 'object') {
    const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    if (Array.isArray(schema.required)) {
      for (const k of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(value, k)) {
          return fail(path, `缺少必填属性 "${k}"`);
        }
      }
    }
    for (const k of Object.keys(value)) {
      if (Object.prototype.hasOwnProperty.call(props, k)) {
        const r = walk(value[k], props[k], path + '.' + k);
        if (!r.ok) return r;
      } else if (schema.additionalProperties === false) {
        return fail(path, `不允许的额外属性 "${k}"`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        const r = walk(value[k], schema.additionalProperties, path + '.' + k);
        if (!r.ok) return r;
      }
    }
  }

  if (t === 'array' && schema.items && typeof schema.items === 'object') {
    for (let i = 0; i < value.length; i++) {
      const r = walk(value[i], schema.items, path + '[' + i + ']');
      if (!r.ok) return r;
    }
  }

  return { ok: true };
}

/**
 * 校验 `value` 是否满足 `schema`(JSON Schema 子集)。
 * @param {any} value
 * @param {any} schema
 * @returns {{ok:true}|{ok:false,error:string}}
 */
export function validateAgainstSchema(value, schema) {
  return walk(value, schema, '$');
}
