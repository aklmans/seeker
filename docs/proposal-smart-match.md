# 方案 · 智能匹配真化(schema-first + app-tool/generative 拆分)

> 承评审第76轮次序裁定(智能匹配 schema 刀 → 真化,首选)+ 第76轮四盯点。
> **契约优先(§6)**:真化前先定 canonical match-result 契约 + app-tool-vs-generative 拆分。
> 相关:[proposal-app-tool-contract.md](proposal-app-tool-contract.md)(路线 C · T0–T3 已落)、块(i) 三站点真化先例(出题/改写/反馈)。

---

## 0. 一句话

智能匹配的**「分」真化为确定性技能重叠公式**(承重排序键、必须可复现)、**「理由/改写」真化为 AI 判断**(`ai_generate` 无工具);schema-first 钉死 canonical match-result,两条通道**语义不合并**(分永不 AI 产、理由永不公式产)。

---

## 1. 事实基础(量出来的,不靠记忆)

`runMatch` → `aiRun`(**假动画**)→ `matchReadout(j)`(**全确定性**)。逐项:

| 部件 | 现状 | 真/假 | 承重? |
|---|---|---|---|
| **match 分** `j.match` | data.js 里**静态 demo 数**(7.5/7.0…);新岗位 `match:0`(cards.js:125) | **静态 mock,非计算** | ★是:copilot 排序 `sort(b.match-a.match)`(copilot-actions.js:125)· overview 均值(overview.js:20)· cards.js:200 · chat |
| **strengths** | `j.need.filter(有 skill 且 lvl≥3)` | **真**(基于实际 skills) | 否 |
| **gaps** `topGapsOf` | `j.need.filter(无 skill 或 lvl<3)` | **真** | 否 |
| **rewrites** `genRewrites` | **硬编码 2 对**(假 QPS「10w+/99.99%」+ `${kw}` 内插) | **mock** | 否 |
| **plan** `planFor` | `PLAN_LIB` 确定性 lookup | 确定性(通用) | 否 |

**关键洞察(测量推翻预设)**:「智能匹配真化 = 真 AI 分析出分」的预设**站不住** —— **分是承重排序键**,AI 分每次不同 ⇒ 岗位排序抖动、用户困惑。**承重排序键必须可复现 ⇒ 分该走确定性公式,不该走 AI**(与撤销/契约 arc「承重结构要结构化保证」同源)。真正需要 AI 的是**定性**部分(为何匹配、gap 怎么补、简历怎么改)。

> 这与 market-value 的教训同构:那里我量出「48 是静态 mock 非公式副本」;这里量出「match 分是静态 mock 非 AI 判断」。**先量,别按预设的『真化 = 全上 AI』一刀切。**

---

## 2. 核心决定 · app-tool / generative 拆分(评审第76轮要的那个决定)

**两条通道,语义不合并(同第64轮 resolve/onConfirm 之鉴):**

### 通道 A · 分 = 确定性公式 `computeMatch(job, skills)`
- **公式**(打样级、可调):每个 `job.need` 技能 —— 有且 lvl≥3 → 满分、lvl 1-2 → 半分、缺 → 0;`score = 10 × Σ信用 / need.length`。
- **为什么确定性**:①承重排序键**必须可复现**;②基于**真实 skills** ⇒ 比静态 demo 真(新岗位从 `0` 变成有依据的分);③零 AI 成本/延迟、幂等。
- **复用形态**(同 `computeMarketValue`):纯函数,UI(matchReadout/排序/overview)**直调**;**可选**再包成 **route-C app-tool** `jobseek_job_match`(reads:['jobs','skills'])—— 模型可问「我和某岗多匹配」,且**第一次在真实复杂工具(读两个集合)上验 T0–T3 契约**。
- **★评审盯点②(app-tool 时)**:D3 双点闸(reads:['jobs','skills'] 上架 filter + query_data 硬拒)+ 输出 `projectToSchema` + Untrusted 框定;用现成 test lane 双向阳性对照。

### 通道 B · 理由 / gap 分析 / 改写 = AI 判断 `ai_generate`(无工具)
- **定性、不可复现可接受**:为何匹配、最该补的 gap 与理由、针对岗位的简历改写建议。
- **★信任(同反馈刀)**:JD + 候选人简历全走 `untrusted`,instruction 纯常量,schema 硬闸失败**诚实降级不造假**;地基 = `ai_generate` 结构性无工具。
- **★改写与 resumeGenerate 重叠 → 不重复真化**:match 页的「简历这样改」预览**链接到已真化的 `resumeGenerate`**(生成完整定制简历),而非再造一个 AI 改写;match 页只保留 AI 的**gap 理由**这一新增定性输出。

### gaps / strengths / plan = 保持确定性(已真)
`topGapsOf` / strengths filter / `planFor` 已基于真实数据,不动。

---

## 3. Canonical match-result 契约 + fail-safe(schema-first)

**两通道结构分离**(分永不 AI 产、理由永不公式产):

```ts
interface MatchResult {
  // ── 通道 A:确定性(computeMatch)──
  score: number;          // 0-10,承重排序键
  matched: string[];      // need ∩ 有(lvl≥3)
  partial: string[];      // need ∩ 有(lvl 1-2)
  missing: string[];      // need ∩ 缺
  // ── 通道 B:AI(可选,ai_generate;缺省 = 未生成)──
  reasoning?: string;     // 为何匹配 / 最高杠杆 gap 的理由(定性)
}
```

- **`normMatchResult(raw)`**(同 `normIvFeedback` 纪律,零 import、node 可测):score 钳 0-10、matched/partial/missing 强制字符串数组有界、reasoning 截断;**fail-safe 绝不抛**(承重消费者:排序 `sort(b.score-a.score)` 不 NaN、overview 均值不炸)。
- **wire(AI 产)只含 reasoning**(定性),**分与集合由公式产、AI 永不自报**(承重不信 AI:同反馈刀「overall 平台重算不信输入」)。AI wire 经 `MATCH_REASONING_SCHEMA` 硬闸。

---

## 4. 分期(多刀,每刀一 commit 一送审)

| 刀 | 内容 | 判据 |
|---|---|---|
| **M1 · schema 刀** | `match-result.js`(零 import):`computeMatch(job,skills)` 公式 + `normMatchResult` + `MatchResult`/`MATCH_REASONING_SCHEMA`。matchReadout/copilot 排序/overview **走 `computeMatch`**(替静态 `j.match`)—— **分即刻变真**(确定性、承重可复现)。node 测公式 + fail-safe + 变异 + 零-import 源守卫;preview 驱动 match 页 + 排序零回归。 | 分基于真实 skills;承重排序稳定、可复现;fail-safe |
| **M2(可选)· match app-tool** | `computeMatch` 包成 route-C app-tool `jobseek_job_match`(reads:['jobs','skills']);模型可问匹配度。**首次真实复杂工具验 T0–T3**。 | D3 双点闸双向阳性对照;输出 project+框定;删无 |
| **M3(可选)· AI 理由真化** | `ai_generate` 产 gap 理由(reasoning);JD+简历 untrusted、schema 硬闸诚实降级。match 页「简历这样改」**链** resumeGenerate(不重复)。 | 信任分层 + 硬闸(同反馈刀);无工具地基 |

**M1 是主体**(分变真、承重可复现,低风险高价值);M2/M3 可选后续。

---

## 5. 推荐

**取 M1 先行**:分走确定性 `computeMatch`(承重排序键可复现),schema-first 钉 canonical + fail-safe。M2(app-tool)顺带在真实复杂工具上验 T0–T3 契约(价值双份);M3(AI 理由)补定性、改写复用 resumeGenerate。

**关键取舍**:**分不上 AI** —— 承重排序键的可复现性 > AI 分的「更懂 JD」。AI 用在定性(理由/改写)那些「不可复现可接受」的地方。**这是 market-value/ivScore 两次测量教训的第三次应用:真化 ≠ 全上 AI,承重结构要确定性/结构化保证。**

---

## 6. 诚实边界

- 本文**未落一行码**。§4 分期与 §2 公式都可能在落码时被事实推翻 —— 先量再改。
- `computeMatch` 公式是**打样级**(技能重叠加权),非真实招聘匹配模型;呈现须诚实标注「示意/参考」(同 market-value 的「打样公式,非真实定价模型」)。
- M2 app-tool 复用三墙沙箱是新用途(读两个集合),威胁模型比 market-value(读一个)更需论证 reads 的 D3 交集正确。
