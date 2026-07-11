# 方案 · 智能匹配真化(schema-first + app-tool/generative 拆分)

> 承评审第76轮次序裁定(智能匹配 schema 刀 → 真化,首选)+ 四盯点;用户拍板「页面算真分 + 真化改写」。
> **契约优先(§6)**。相关:[proposal-app-tool-contract.md](proposal-app-tool-contract.md)、块(i) 三站点真化先例。

---

## ★ 先量再改:原 premise 被推翻(留档)

**本方案初稿断言「match 分是静态 mock,真化为确定性公式替换 `j.match`」—— 落码前量清,错了。**
`j.match` **不是 mock,是用户 intake 表单的自评滑块**(intake-job.js:89 `scoreInput('match','匹配','我现在的能力对得上吗?')`,与 兴趣/成长/机会 并列)。**用 computeMatch 覆盖它 = 覆盖用户输入,错。**

这是 market-value(「48 是静态 mock」)/ivScore(「分是承重非 AI」)之后**同类测量教训第三次**:**别按「真化=全上 AI/公式」的预设一刀切,先量清每个字段的真实来源。**

---

## 1. 事实基础(量出来的)

智能匹配页 `matchReadout(j)` 四部分:

| 部件 | 真相 | 处置 |
|---|---|---|
| **综合匹配度** | 显示 `j.match×10` = **用户 intake 自评滑块**,但页面标「AI 会给出匹配度」= **错位**(把主观自评当客观分析展示) | **★真化重点** |
| gaps `topGapsOf` | `need.filter(缺 或 lvl<3)`,**真实**(基于实际 skills) | 保留(computeMatch 单一来源) |
| strengths | `need.filter(lvl≥3)`,真实 | 保留 |
| **rewrites** `genRewrites` | **硬编码 2 对假数据**(「10w+ QPS / 99.99%」+ `${kw}` 内插) | ★真化(AI / 复用 resumeGenerate) |
| plan `planFor` | 确定性 lookup(通用) | 保留 |

**唯一真·假的是 rewrites**;「分」是用户主观自评(合法),只是被「AI 分析」标签错误包装。

---

## 2. 设计 · 页面算真分 + 真化改写(用户拍板)

**两通道语义分离(第76轮:混合别合并,同第64轮 resolve/onConfirm):**

### 通道 A · 智能匹配页算**客观**分 `computeMatch(job, skills)`(确定性)
- **与 `j.match` 不是一回事**:`j.match` = 用户**主观**自评(「我觉得对得上吗」);`computeMatch` = 基于**真实 skills** 的**客观**技能重叠。页面显示「综合匹配度 · **基于你的技能**」诚实标注,**不覆盖** `j.match`(用户自评仍归其滑块;**排序/overview 仍用 `j.match`** = 用户输入)。
- **公式**:每 `need` 技能 —— 有且 lvl≥3 满分、lvl 1-2 半分、缺 0;`score=10×Σ信用/need 数`。可复现、零 AI 成本;新岗位从「无客观分」变成有依据。**打样级**,呈现标「基于你的技能/示意」。
- **复用形态**(同 `computeMarketValue`):纯函数 UI 直调;**可选** route-C app-tool `jobseek_job_match`(reads:['jobs','skills'])—— 模型可问匹配度、**首次真实复杂工具验 T0–T3**。

### 通道 B · 改写 / gap 理由 = AI 判断 `ai_generate`(无工具)
- rewrites(现硬编码假 QPS)→ **复用已真化的 `resumeGenerate`**(match 页「简历这样改」链接过去,不重复造 AI 改写);或轻量 AI gap 理由。
- **信任(同反馈刀)**:JD+简历 untrusted、instruction 纯常量、schema 硬闸失败诚实降级不造假;地基 `ai_generate` 无工具。

### gaps/strengths/plan = 保持确定性(已真);`j.match` 滑块 + 排序 = 保持用户输入(不动)

---

## 3. Canonical match-result 契约 + fail-safe(schema-first)

```ts
interface MatchResult {
  // ── 通道 A:确定性(computeMatch)──
  score: number;                 // 0-10,客观技能重叠(≠ 用户自评 j.match)
  matched: string[]; partial: string[]; missing: string[];
  gaps: string[];                // need 序的非满分(= topGapsOf 等价,单一来源)
  // ── 通道 B:AI(M3 可选;缺省 = 未生成)──
  reasoning?: string;
}
```
`normMatchResult(raw)`(零 import、node 可测、fail-safe 绝不抛):score 钳 0-10、集合有界、reasoning 截断 —— 供 M3 校验 AI 产出 + 外部来源兜底。**分永不 AI 产、reasoning 永不公式产**(承重不信 AI,同反馈刀 overall 平台重算)。

---

## 4. 分期(每刀一 commit 一送审)

| 刀 | 内容 | 状态 |
|---|---|---|
| **M1 · schema 刀 + 页面算真分** | `match-result.js`(零 import):`computeMatch`+`normMatchResult`+`MATCH_REASONING_SCHEMA`。`matchReadout` 分/缺口/强项走 computeMatch、标「基于你的技能」;`j.match`/排序/overview **不动**。node 测公式+fail-safe+变异+零-import 守卫;preview 驱动验分=computeMatch(≠j.match)。 | **落地 `<pending>`** |
| **M2(可选)· match app-tool** | computeMatch 包 route-C app-tool `jobseek_job_match`(reads:['jobs','skills']);首次真实复杂工具验 T0–T3。 | 待 |
| **M3(可选)· 改写/理由真化** | match 页「简历这样改」链 resumeGenerate;或 `ai_generate` 产 gap 理由(untrusted+硬闸)。 | 待 |

---

## 5. 推荐 & 诚实边界

**M1 先行**(已落):页面显客观 computeMatch 分、诚实标注、不碰用户自评 —— 智能匹配页从「把主观当客观」变诚实。M2/M3 可选后续。

- **关键取舍**:分是**客观技能重叠**(computeMatch)与**用户主观自评**(j.match)**两个不同的量**,并存、各归其位,不互相覆盖。
- `computeMatch` 是**打样级**(技能重叠加权),非真实招聘匹配模型;呈现标「基于你的技能/示意」。
- M2 app-tool 读两个集合,reads 的 D3 交集正确性比 market-value(读一个)更需论证。
- **端到端真模型(M3)需 BYO**;preview 以 stub 验契约面。
