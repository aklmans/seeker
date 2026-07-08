# 批10 · 账本清空终局刀 —— 清点与方案(2026-07-07,待批准)

> 3.y 类型化收官刀。三路并行静态清点(tokenizer 全仓扫描,非估算)已完成;本方案**只清点与规划,未动代码**。
> 上游:批1-9 全过审(第26-40轮);index.html classic inline 实码已清零(第40轮里程碑)。

---

## 0. 清点总账(实测,订正旧估算)

**过渡 window 桥:198 个符号**(旧账"余 70 桥"系早期按**桥语句行**估算;批1-9 新增大量单行多符号桥——如 intake-action.js:256 一行 28 符号。本次按**符号**计,权威):
- platform 82 · apps/jobseek 113(assets **0**,批7 Option B import-native)· index.html SHELL BOOT 3。
- 全仓**零** `window.X` 显式读——全部消费是裸名全局解析 → 每个 flip 都是「加 import + 删桥行」,无 `window.` 改写。

分类(a/b/c/d):
| 类 | 数 | 含义 | 处置 |
|---|---|---|---|
| (a) 死桥 | **10** | 零外部消费者 | 直接删(GENERAL/META/KEYWORDS/PIPELINE@data.js、seedDemoData、hydrateBizColls、agentGreet/cmdFilterList/copSend@copilot-chrome、clearAllCollections@shell-state) |
| (b) 可 import 化 | **136** | 消费者全是 .js module | flip 消费者 → 删桥 |
| (b)+classic 阻塞 | **6** | 被 classic ai-engine.js 裸读(aiHTML/displayText/toolStatusText/aiErrHTML/persistMsg/setState) | ai-engine 转 module 后解锁 |
| (c) index.html 块内消费 | **23** | SHELL BOOT/INIT 消费(两块已是 module → 可加 import) | 块内加 import → 删桥 |
| (d) window 解析强制 | **25** | 内联 onclick(38 静态站点)/ cBtn oc-串(18)/ CACT `window[name]` 分发(6) | **本批保留**,单列后续(见 §4) |

**两本 d.ts 账本**:
- `monolith-globals.d.ts` 27 条:**26 条随 jobseek/manifest.js 一次 import-flip 全销**(全部定义模块已有 export;manifest 是唯一 @ts-check 裸读者)。第 27 条 `setState` 另有一个 @ts-check 消费者 **platform/shell/i18n.js:11/13/15**——跨层泄漏(apps 侧账本在给平台文件供 ambient),须同批 flip i18n.js → 账本**整删**。
- `shell-globals.d.ts`(仅 tt):jobseek/manifest.js:58 flip 后**整删**。
- tsconfig.json 顺带清 stale `web/domain/**` include。

**ai-engine.js(最后一个 classic 外链)**:顶层零外部读、3 符号消费者全 runtime(copilot-chrome ×2 / intake-job ×1,均 module)→ **转 module 零 parse-time 风险**;`aiLangHint` 零外部消费者 → 私有;两消费者同刀 flip import → **零桥收官**;其自身 7 个裸依赖全可 import(runtime 读、无 tag-order)。

**§1 层级债(不可 import 化,~10 符号)**:平台读 jobseek 全局——nav.js:52-60 renderTopActions 懒闭包 7 个(openResumeModal/resumeGenerate/resumeState/renderResumes/openNewJob/openMarketValue/openNewAction)、shell-keys.js:23 contextNew 2 个、widget-actions.js delete-job 分支 3 个(JOBS/renderJobs/renderOverview)。**走契约不走 import**(§1 应用间/跨层禁 import 业务符号),单列批11。

**保留(契约,非过渡桥)**:SeekerShell/SeekerKeys/SeekerRT/SeekerGuardrail/SeekerWidgets/SeekerMarkdown/__wgtExecuted/iframe 侧 window.seeker。

---

## 1. 批10 范围裁定(★请批准)

**批10 = 纯机械账本清空**(import-flip + 删桥 + 删账本 + ai-engine 转 module),**一维一刀、行为零改**。
**不含**:(d) 25 桥的绑定改造(inline onclick → 委派/程序绑定)与 §1 契约化——二者是**行为面/契约面设计**,单列**批11**(见 §4),避免与机械清空混刀。

**批10 完成态**:198 → **~35 桥**(25 d + ~10 §1,有重叠),每个残留桥**就地注释白名单化**(标注 why:inline-onclick / CACT-dispatch / §1-待契约);两本 d.ts 删净;classic 清零(ai-engine 转 module);tsc/node 净 + preview 净方法 + 真机金标准。

---

## 2. 子批切分(4 刀)

### 10a · 死桥清扫 + tsconfig stale(微)
删 10 死桥 + tsconfig `web/domain/**`。验:grep-0 + preview boot。(先例:僵尸桥清扫 12 个。)

### 10b · manifest import-hub flip + 双账本整删(中)
- jobseek/manifest.js:28 个裸全局 → import(26 jobseek 符号 + 平台 tt/setState——apps→platform 方向,§1 允许);`SEEKER_CARDS` eager 读由 import 图自定序(强于现 tag-order cards@993<manifest@1054)。
- platform/shell/i18n.js:`setState` → `import { setState } from './shell-state.js'`。
  - ★决策点:shell-state.js:52 自身裸调 `tt`(10d 将 flip)→ 届时形成 **i18n⇄shell-state 运行时环**(两侧读全在函数体、零 eager 互读)。**推荐:接受运行时环**(ESM 语义安全;备选 = setState 拆叶子 state 模块,churn 更大不推荐)。
- 删 `shell-globals.d.ts` 整文件 + `monolith-globals.d.ts` 整文件。验:tsc 0(账本删净后仍净=消费面精确)+ preview。

### 10c · ai-engine.js → module(红线刀,单送)
export `extractSeekerBlock`/`streamReply`、`aiLangHint` 私有;两消费者(copilot-chrome/intake-job)同刀 flip import;自身 7 依赖 flip import。**红线加倍审**:无 XSS/Untrusted 链逐字(aiHTML 路径/valid-gate/持久卡过滤)。同刀顺带删 ai-render 3 个 solo 桥(aiErrHTML/displayText/toolStatusText 唯一消费者就是 ai-engine)+ persistMsg 解锁。
⚠ 验证纪律:classic→module 同 URL = 裁定③(b) 缓存陷阱高发形;fresh server / asset:// 真机为判据;转后若留桥属 on-window module,只平直 reload 验。

### 10d · 全网 import 化(大头,可再对半拆 platform / jobseek 两 commit)
- (b) 136:全部消费者 flip import、删桥。jobseek 内网(data 8 + data-helpers 6 + intake-action ~26 + resumes 12 + copilot-actions/match/interview/pages/…)+ platform 网(copilot-chrome 21 + data-store 6 + nav 6 + shell-state 5 + …)。import 图自定序(⚠ eager `JOBS[0]` 读者 flip data.js import 后由图定序,较批6 tag-order 更强)。
- (c) 23:SHELL BOOT/INIT 两 module 块内加 import(含 index.html 自定义 3 桥 shellReassemble/shellPushAiReadable/openAppManager——INIT 消费,同块化或经 import)。
- (d)+§1 残留桥就地白名单注释。
- 验:node 全量 + tsc + preview 净方法全功能冒烟 + **真机金标准**(blast radius 最大)。

**送审节奏(沿既定)**:10a+10b 攒一组;10c 单送(红线);10d 单送(+真机);批9 型「先对齐后动刀」。

---

## 3. 验证与风险
- 每刀:node --check 全改动文件 + tsc 0 + preview 净方法(平直 reload;改动文件同 URL 内容变 → 按③(b) 定向单文件重验)+ 10c/10d 真机 asset://。
- 风险台账:①运行时环(i18n⇄shell-state,§2 决策点);②eager 读者(SEEKER_CARDS/JOBS[0])flip 后由 import 图定序=结构更强,但 10b/10d 须 LIVE 复验三态(matchState/ivState/resumeState.jobId===JOBS[0].id + cards()=11);③(d) 桥误删=点击静默失效 → 白名单注释 + 功能测点击链兜底;④分类边界符号(如 openNewAction 既 (b) 又 §1)按"最严类"处置=保桥。

## 4. 批11 预告(单列,不在本批)
(d) 绑定改造:两个平台委派(`[data-close]`@modal.js、`[data-go]`@nav.js)可廉价清 33/38 静态站点;cBtn→cAB 迁移;CACT `window[name]` 分发改注册 Map。**§1 契约化**(第40轮[建议] 挂账核对✓,三处清点完毕):①CACT_ALLOWED 6 名单 → manifest 声明 cAB handlers;②contextNew → manifest 声明 per-page「新建」;③wgtAction delete-job → SeekerShell 分发 per-app widget action;④nav renderTopActions 7 符号 → manifest 声明页级动作。涉 SeekerShell 契约扩展=约束② 必审,出独立方案。
