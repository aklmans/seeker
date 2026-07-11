// @ts-check
/**
 * app-tool 输出校验 + 投影(T1)—— JSON Schema **子集**,在**可信父代码**里执行。
 * —— 平台层,业务无关。
 *
 * 两个出口,服务两种需要:
 *
 * - `validateAgainstSchema(value, schema)` —— **只校验**(标准 JSON Schema 子集语义):
 *   type / properties / required / items / enum / additionalProperties。用于「值是否合规」的判断
 *   (如将来 T2 校验模型入参 `parameters`)。`additionalProperties` 省略时**容忍多余属性**(标准语义)。
 *
 * - `projectToSchema(value, schema)` —— **校验 + 投影**(app-tool 输出的**安全闸**,不变式 I4):
 *   在校验之上,**按声明重建一份副本**,只保留 schema 声明的属性;**未声明的字段结构上到不了模型**。
 *   这修正了「校验通过 ⇒ 原样回传」的破口:app 若 `return {...row, score}` 而 schema 只声明 `score`,
 *   投影后模型**只看得到 `score`**,`row` 里超范围的字段(可能含 D3 用户数据 / 外部注入文本)**被丢弃**。
 *   —— 与本平台一路的 default-deny 同纪律(reads 必填 / `undefined`→拒 / `onConfirm` 缺省):
 *   **未声明 ⇒ 不放行**,而非退回 JSON Schema 的「省略即容许」宽松默认。
 *
 * 投影的额外属性规则(object):`properties` 声明的 → 递归投影保留;`additionalProperties` 为**子 schema**
 * → 校验通过后保留;`=== true`(应用**主动**声明容许额外)→ 原样保留;`=== false` → **拒绝**(报错);
 * **省略(最常见的手滑场景)→ 丢弃**。故 bare `{type:'object'}`(无 properties/AP)会投影成 `{}` ——
 * 这是**有意的 default-deny**,提示作者去声明输出形状(T2 注册期应再加 schema 良构检查)。
 *
 * 形状从严(两个出口都生效,闭合「properties-only 无 type」footgun):schema 若带 `properties`/`required`/
 * `additionalProperties` ⇒ 值**必须是 object**;若带 `items` ⇒ 值**必须是 array**;否则如实报错。
 */

/** @param {any} o @param {string} k */
function hasOwn(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k);
}

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
  return ka.every((k) => hasOwn(b, k) && deepEqual(a[k], b[k]));
}

/**
 * 单一递归:`project=false` 只校验(标准语义)、`project=true` 校验 + 投影(重建安全副本)。
 * 两模式共享 type/enum/required/形状/递归逻辑,只在「额外属性」处分野 —— 单一真相源,不会漂移。
 * @param {any} value
 * @param {any} schema
 * @param {string} path
 * @param {boolean} project
 * @returns {{ok:true,value:any}|{ok:false,error:string}}
 */
function walk(value, schema, path, project) {
  // 空 / 非对象 schema(`{}` / `true`)⇒ 不约束、原样返回。
  if (!schema || typeof schema !== 'object') return { ok: true, value };

  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((/** @type {any} */ e) => deepEqual(e, value))) {
      return fail(path, '不在 enum 允许值内');
    }
  }

  // 形状意图:显式 type,或(无 type 时)由结构关键字推断 —— 闭合「properties 无 type」footgun。
  const hasObjKw = schema.properties !== undefined || schema.required !== undefined || schema.additionalProperties !== undefined;
  const hasArrKw = schema.items !== undefined;
  const wantsObject = schema.type === 'object' || (schema.type === undefined && hasObjKw);
  const wantsArray = schema.type === 'array' || (schema.type === undefined && hasArrKw && !hasObjKw);

  if (schema.type !== undefined) {
    const at = jsonType(value);
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((/** @type {string} */ t) => typeMatches(at, t))) {
      return fail(path, `类型应为 ${types.join('|')},实为 ${at}`);
    }
  }

  const t = jsonType(value);

  if (wantsObject) {
    if (t !== 'object') return fail(path, `应为 object,实为 ${t}`); // ★形状从严
    const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    if (Array.isArray(schema.required)) {
      for (const k of schema.required) {
        if (!hasOwn(value, k)) return fail(path, `缺少必填属性 "${k}"`);
      }
    }
    /** @type {any} */
    const out = project ? {} : value;
    for (const k of Object.keys(value)) {
      if (hasOwn(props, k)) {
        const r = walk(value[k], props[k], path + '.' + k, project);
        if (!r.ok) return r;
        if (project) out[k] = r.value;
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        const r = walk(value[k], schema.additionalProperties, path + '.' + k, project);
        if (!r.ok) return r;
        if (project) out[k] = r.value;
      } else if (schema.additionalProperties === false) {
        return fail(path, `不允许的额外属性 "${k}"`); // 应用显式声明「无额外」⇒ 违反即报错(两模式一致)
      } else if (schema.additionalProperties === true) {
        if (project) out[k] = value[k]; // 应用主动容许额外 ⇒ 保留
      }
      // 其余(additionalProperties 省略):校验模式容忍(标准语义);**投影模式丢弃**(default-deny)。
    }
    return { ok: true, value: out };
  }

  if (wantsArray) {
    if (t !== 'array') return fail(path, `应为 array,实为 ${t}`); // ★形状从严
    if (schema.items && typeof schema.items === 'object') {
      /** @type {any[]} */
      const out = project ? [] : value;
      for (let i = 0; i < value.length; i++) {
        const r = walk(value[i], schema.items, path + '[' + i + ']', project);
        if (!r.ok) return r;
        if (project) out[i] = r.value;
      }
      return { ok: true, value: out };
    }
    return { ok: true, value };
  }

  return { ok: true, value };
}

/**
 * **只校验** `value` 是否满足 `schema`(标准 JSON Schema 子集语义;`additionalProperties` 省略容忍多余)。
 * @param {any} value
 * @param {any} schema
 * @returns {{ok:true}|{ok:false,error:string}}
 */
export function validateAgainstSchema(value, schema) {
  const r = walk(value, schema, '$', false);
  return r.ok ? { ok: true } : r;
}

/**
 * **校验 + 投影**:app-tool 输出的安全闸(I4)。返回按 schema 重建的副本,**未声明字段被丢弃**,
 * 结构上到不了模型。校验失败(类型 / 形状 / 必填 / enum / 显式 `additionalProperties:false` 违反)⇒ 报错。
 * @param {any} value
 * @param {any} schema
 * @returns {{ok:true,value:any}|{ok:false,error:string}}
 */
export function projectToSchema(value, schema) {
  return walk(value, schema, '$', true);
}
