# 方案 · app-tool 契约(应用工具)

> 状态:**待审(方案级,未落码)** · 2026-07-10
> 前置:`docs/proposal-agent-native.md` v2(P0 收官 / P1 收齐)· 撤销债 arc 已清零(第56–66 轮)
> 本文只定**契约与取舍**。落码分期见 §7,每期一刀一送审。

---

## 0. 一句话

**让应用把「工具」交给平台,而不是自己执行它** —— 应用声明工具的**形状**(schema)、它要读的**集合**、以及结果的**呈现规格**;平台负责取数(经既有 D3 闸)、在**无 profile 的隔离上下文**里跑应用的纯计算、校验结果、再用平台的沙箱渲染。

---

## 1. 事实基础(代码坐实,不靠记忆)

| 事实 | 位置 |
|---|---|
| 能力契约 `Capability { id, kind, permissions, available, schema, invoke }` | `src-tauri/src/capability.rs:130` |
| `CallCx` **只有 `app: &AppHandle`** —— 结构上没有 profile | `capability.rs:121` |
| `invoke_raw` 三重闸:`available` → **破坏性能力直接拒绝** → `invoke` | `capability.rs:227-244` |
| D3 在 `tool_schemas` 把 `query_data.collection.enum` **运行时裁剪**为 `静态 QUERYABLE ∩ readable_set` | `capability.rs:195-210` |
| 三墙沙箱**已存在**:`iframe sandbox="allow-scripts"`(无 `allow-same-origin` ⇒ null 起源)+ srcdoc CSP + 专属 `MessageChannel` | `web/platform/capability/widgets/render.js:7,135,180,223` |
| 「**收规格不收执行**」契约先例:应用 return spec,**平台**自驱 guardrail,`source` 置于 spread 之后不可伪造 | `web/platform/shell/widget-actions.js:25-31` |
| 路线 B 打样(**唯一许可的一枚**):`jobseek_market_value` 是 Rust Capability,红线净 | `src-tauri/src/jobseek.rs` |
| **6 处 `aiRun` 一次模型调用都没有** —— `intake-action.js` 里 AI 调用数 = **0**;`aiRun` 是假进度条 + `resultFn()` 本地确定性函数 | `intake-action.js:252-261` |

**⚠ 最后一条是本方案的地基,也是我此前表述不精确的地方。** 「6 处 aiRun 真化」不是「把 mock 换成真工具」,而是两件不同的事:

- **(i) 让模型真的参与**(简历改写 / 面试反馈 / 出题 / 差距计划 / 重写建议)—— 这些的产出是**模型写的文字**,不是计算结果;
- **(ii) 让这些能力从「页面按钮」变成「Agent 窗口里模型可调的工具」**(AI-Native 的正面含义)。

**(i) 今天就能做**(`rt.ai.complete` / `streamReply` 已通,提示组装在 Rust 侧且结构上不含 profile),**不需要任何新契约**。
**(ii) 才是契约要解的问题。**

---

## 2. 为什么必须先有契约(三笔债,同一把钥匙)

1. **路线 A 破口(第51轮 [应改])**:`manifest.tools[].run()` 若在**前端 JS** 执行、结果直喂模型,它能读 `rt.profile.getAll()`,并绕过 `invoke_raw` / `query_data` 的 D3 闸 —— 而这两道今天由 Rust **结构性**强制。
2. **路线 B 封顶(第52轮 standing)**:契约落地前**不新增** `src-tauri/src/<app>.rs` 应用工具。6 枚工具 ⇒ 路线 B 用不了。
3. **`jobseek.rs` 的 #6 i18n 债(第51轮记债)**:Rust 侧生成 HTML ⇒ CN-only,因为 **locale 是前端态**(`localStorage 'jh-lang'`),Rust 够不到。**「呈现移回前端」正是契约的形状** —— 这笔债由契约顺带清掉,而不是在 Rust 里硬塞 i18n。

---

## 3. 必须保住的四条不变式(任何设计都要逐条论证)

- **I1 · profile 结构性不可达** —— 应用工具的执行上下文里**没有** `rt`,因而没有 `rt.profile`。不是「约定不读」,是**够不到**。
- **I2 · D3 三层闸不旁路** —— 应用**不自己取数**;它声明 `reads: [...]`,由**平台**经既有 `query_data` 能力取(`静态 QUERYABLE ∩ readable_set` 硬底)。应用拿到的行**已经被裁剪过**。
- **I3 · 破坏性收规格不收执行** —— 工具永不执行破坏性动作;它 `return` 一份 `WidgetActionSpec`,由平台驱动 guardrail(`source` 由平台注入,不可伪造)。沿用 `widget-actions.js` 的既有形状。
- **I4 · 结果经平台校验后才进模型/DOM** —— 工具输出按声明的 `output` schema 校验;进 DOM 走平台的三墙沙箱(或 `cEsc` 文本位),**绝不 `innerHTML` 裸拼**。

> **诚实前置**:今天 `apps/` 是**仓内一等公民代码**,不是第三方插件。故 I1/I2 的价值**不是防恶意应用**(那时游戏已经结束),而是**结构性地防止应用层意外成为破口** —— 正是第51轮 [应改] 所要求的。若将来允许第三方应用,I1–I4 是必要而**不充分**的,届时需另立威胁模型。**别把它当成沙箱化的第三方插件系统来宣传。**

---

## 4. 三个候选设计

### A · 前端桥(第51轮已被判 [应改],此处仅存档)
`manifest.tools[].run()` 在前端执行,结果直喂模型。
**否决**:直接违反 I1 与 I2(`run()` 能读 profile、能自己发 `rt.db.list`)。

### B · 应用工具即 Rust Capability(现状打样)
每个应用工具是 `src-tauri/src/<app>.rs` 里的一个 `Capability`。
- ✅ I1(`CallCx` 无 profile)· ✅ I2(同一 `invoke_raw`)· ✅ I3(`Permission::Destructive` 被 `invoke_raw` 拒)
- ❌ **§1 物理分离**:业务逻辑进平台 Rust。已记债(`jobseek.rs`)。
- ❌ **#6 i18n**:呈现在 Rust ⇒ locale 够不到 ⇒ CN-only。
- ❌ 每加一个工具就要改 Rust、重编译、重签名。

### C · **声明 + 隔离纯计算 + 平台呈现(推荐)**

应用在 `manifest.tools[]` 里声明:

```js
{
  name: 'jobseek_market_value',
  description: '按你的技能矩阵估算市场价值区间(仅供参考)',
  parameters: { /* JSON Schema —— 给模型看 */ },
  reads: ['skills'],                 // ★平台据此取数,应用不自己取
  compute: 'tools/market-value.js',  // ★纯函数模块:(input, rows) => output
  output: { /* JSON Schema —— 平台校验 */ },
  render: 'tools/market-value-view.js', // ★前端渲染(tt() 可用 ⇒ #6 债消失)
}
```

**执行链**(每一步都对应一条不变式):

```
模型请求工具
  → Rust 工具循环:识别为 app-tool,发事件 ai_app_tool { callId, name, input }
  → 前端平台壳(不是应用):
      ① 按 manifest.reads 调 rt.capability.invoke('query_data', …)   ← I2:走既有 D3 闸
      ② 起隔离上下文(三墙沙箱 iframe,srcDoc 里只有 compute 模块)   ← I1:无 rt / 无 window.SeekerRT / null 起源
         postMessage({ input, rows })  →  等 { ok, output } 或超时
      ③ 按 manifest.output 校验 output                               ← I4
      ④ 若 output 含 destructive spec → 交 guardrail,平台注入 source ← I3
      ⑤ render(output) 在前端渲染(tt() 双语)                        ← #6 债清
  → invoke('ai_app_tool_result', { callId, result })
  → Rust 工具循环把 result 回灌模型
```

- ✅ I1:隔离上下文里**没有** `rt`(srcDoc 里不注入任何桥;null 起源够不到父 DOM)。
- ✅ I2:取数由平台发起,走 `invoke_raw`。**应用连集合名都只能从 `reads` 里声明,而 `reads` 又被 manifest 的 `collections` 与 D3 可读集夹住。**
- ✅ I3:`compute` 返回**规格**;平台驱动 guardrail。
- ✅ I4:输出经 schema 校验;呈现走平台。
- ✅ §1:业务逻辑与文案全在 `apps/<appId>/`;平台不识任何 app 符号。
- ✅ #6:呈现在前端 ⇒ `tt()` 可用。
- ⚠ **代价**:引入一条**新的跨进程协议**(Rust ↔ 前端 ↔ 隔离上下文),含超时 / 取消 / 重入 / 前端被关闭等失败面。**这是本方案最大的风险,§8 逐条列出。**

### 取舍表

| | A 前端桥 | B Rust Capability | **C 声明+隔离+平台呈现** |
|---|---|---|---|
| I1 profile 不可达 | ❌ | ✅ | ✅ |
| I2 D3 不旁路 | ❌ | ✅ | ✅ |
| I3 收规格不收执行 | ⚠ 靠约定 | ✅ 结构 | ✅ 结构 |
| §1 platform/apps 分离 | ✅ | ❌ | ✅ |
| #6 i18n | ✅ | ❌ | ✅ |
| 新增工具成本 | 低 | 高(改 Rust+重编) | 低(改 manifest) |
| 新失败面 | — | — | ⚠ **跨进程协议** |

---

## 5. 推荐

**取 C。** 它是唯一同时满足 I1–I4 与 §1 的形状,并顺带清掉 #6 与「路线 B 封顶」两笔债。
代价是一条新协议 —— 但那条协议的失败面是**可枚举、可测试**的(超时 / 取消 / 重入 / 校验失败),而 A 的失败面是**隐私红线**,B 的失败面是**架构原则**。**宁可承担可测的复杂度,不承担不可测的原则损失。**

---

## 6. 契约草案(供评审逐条挑)

```ts
/** 应用声明的一枚工具。平台据此:向模型暴露 schema、取数、隔离执行、校验、呈现。 */
export interface AppToolSpec {
  /** 全局唯一;**必须 `<appId>_` 前缀**(与集合白名单同纪律)。 */
  name: string;
  /** 给模型看的一句话。**必须应用自持的可信文案**(同 greeting 第50轮裁决)。 */
  description: string;
  /** 给模型看的入参 JSON Schema。 */
  parameters: object;
  /** 本工具要读的集合。**必须 ⊆ manifest.collections**,且运行时再 ∩ D3 可读集。 */
  reads: string[];
  /** 纯函数模块路径:`(input, rows) => output`。**在隔离上下文里执行,没有 rt / window / 网络。** */
  compute: string;
  /** 输出 JSON Schema。平台据此校验;校验失败 ⇒ 工具调用如实报错,绝不喂给模型。 */
  output: object;
  /** 前端渲染器:`(output) => HTMLElement | WidgetSpec`。可用 `tt()`。 */
  render: string;
  /** 可选:破坏性提议。**只收规格,平台驱动 guardrail**(同 widgetActions)。 */
  destructive?: (output: unknown) => WidgetActionSpec | undefined;
}
```

**跨进程协议(新增,须审)**

| 方向 | 载荷 | 备注 |
|---|---|---|
| Rust → 前端 | `ai_app_tool { callId, name, input }` | 事件;`callId` 由 Rust 生成,单调唯一(同 `UNDO_TOKEN_SEQ` 纪律) |
| 前端 → Rust | `ai_app_tool_result { callId, ok, output? , error? }` | 命令;`callId` 不匹配 ⇒ **响亮拒绝**,绝不静默 |
| 超时 | Rust 侧 deadline(默认 20s)⇒ 向模型回 `error: 工具超时` | **不得挂死工具循环** |
| 取消 | 复用 `ai_cancel`:清掉挂起的 callId | |

---

## 7. 分期(每期一刀一送审)

| 期 | 内容 | 判据 |
|---|---|---|
| **T0** | 协议骨架:`ai_app_tool` 事件 + `ai_app_tool_result` 命令 + deadline + callId 唯一 + 取消。**无应用工具**,用一枚平台内置的 `echo` 工具打样 | 超时 / 重入 / 错配 callId / 取消 四条失败面各有测试与阳性对照 |
| **T1** | 隔离上下文(复用三墙沙箱)+ `compute` 执行 + `output` schema 校验 | **对抗性验证**:compute 里 `window.SeekerRT` / `rt.profile` / `fetch` 全部 `undefined`/被 CSP 拦;校验失败不喂模型 |
| **T2** | `manifest.tools[]` 契约 + 平台取数(`reads` ∩ D3)+ 前端 `render` | 正向断言:模型只看得到 `reads` 内的集合;`profile` 推不进去 |
| **T3** | **迁移** `jobseek_market_value`:Rust → app-tool。**删 `src-tauri/src/jobseek.rs`** | 行为等价 + #6 债消失(EN 全切无 CN 残留)+ 路线 B 封顶解除 |
| **T4** | jobseek 其余能力按需上契约(**先做 (i) 让模型真的参与**,再决定哪些值得成为工具) | 每枚工具单独送审 |

**T0–T2 是纯平台工作,不碰 apps;T3 是第一次真迁移,也是契约的验收。**

---

## 8. 未决问题(请评审裁)

1. **隔离上下文用 iframe 还是 Worker?**
   - iframe:复用现成三墙沙箱(`render.js`)、null 起源、CSP;但它是为「渲染不可信 HTML」设计的,拿来跑纯计算略重。
   - Worker:更贴「纯计算」,但 `Worker` 拿得到 `fetch` / `indexedDB`(需靠 CSP `connect-src 'none'` 与不注入桥来收);且 Worker 里 `self` 上没有 `rt`,I1 自然成立。
   - **我倾向 iframe**(复用已过审的三墙 + 无需新建威胁模型),但它更重。**请裁。**

2. **`compute` 是应用自带的 JS 模块,还是更保守的声明式 DSL?**
   DSL(如 `{op:'sum', field:'lvl', weight:1.6}`)零代码执行,但表达力弱,且会长成一门语言。**我倾向 JS 模块 + 隔离**,理由是 §3 的诚实前置(apps 是仓内代码,隔离防的是意外不是恶意)。**请裁。**

3. **超时后模型看到什么?** 我倾向 `error: 工具超时(未执行任何操作)` —— **必须说清「没执行」**,否则模型可能重试一次已经发生的副作用。但 app-tool 是纯计算、无副作用,所以重试安全。**若将来允许有副作用的 app-tool,这条要重新审。**

4. **`reads` 为空的工具**(纯计算,不取数)是否允许?我倾向允许(如单位换算),但要在 schema 上显式 `reads: []` 而非省略 —— **省略与空数组不得同义**(勿留隐式默认)。

5. **本方案是否需要 `Permission::Destructive` 的 app-tool?** 我倾向**明确禁止**:app-tool 恒为只读 + 返回规格。破坏性一律走 `widgetActions` 既有路径。**这样 `invoke_raw` 的破坏性拒绝闸对 app-tool 天然成立。**

---

## 9. 诚实边界

- 本文**未落一行码**。§6 的类型与 §7 的分期都可能在落码时被事实推翻 —— 按 `reviewer-onboarding.md` §4-⑧,**先量再改**。
- 「6 处 aiRun 真化」被本方案**拆成两件事**((i) 让模型真的参与 / (ii) 变成模型可调的工具)。**(i) 不阻塞于本契约**,可以先做、先让用户感知。
- 三墙沙箱今天服务于「渲染不可信 HTML」。把它复用为「执行应用纯计算」是**新的用途**,其威胁模型必须**重新论证**,不能靠「它已经过审」搭便车。
