# 业务层 module 化方案(3.y 收尾大块)

> 3.y 类型化的最后一大块:把 ≈13 个 classic 业务文件 + settings.js/profile.js + index.html inline 拆成 ES module,消费者逐步改 `import`。**做完则 profile 链② 解锁 + 账本清空大头自然落地**(二者同源)。
> 依据:4 路 + 3 路只读 agent 调查(settings/resumes/manifest/index.html inline + data 地基/逻辑层/页面 assets)。
> 前置里程碑:3.y 硬骨头(INIT/dispatch/注册链 3 个 parse-time 重排)全过审 + 真机金标准(见 review-log 第26–33轮)。

## 依赖图要点

**有状态 litmus(权威三分支:reassigned→访问器不上桥 / mutated→dual-publish 免访问器 / PROFILE→import 不上 window)**:
- **mutated-property(几乎全部,dual-publish `window.X=X` 免访问器)**:JOBS/SKILLS/ACTIONS(data.js)、RESUME_TAILORED/MASTER/IV_BANK/IV_RECORDS(intake-action.js)、ivState(interview)/matchState(match)/resumeState(resumes)、settingsState/MODEL(settings)、ASSETS_PROMPTS/ASSETS_NOTES(assets)、PAGES/GROUPS/setState/WEIGHTS(index.html inline)、PROFILE(mutated 但红线)。hydration 全 in-place(`arr.length=0;arr.push`)→ 引用永久稳定。
- **reassigned(仅 2 个,特殊)**:
  - `SEED`(demo-seed.js:9,`SEED=null`/`SEED={…}`)= **文件私有** → 不 export、不上桥、不访问器(最省)。
  - `ivRec`(interview.js:5,`=new SR()`/`=null`/`='demo'`)但**生命周期全在 resumes.js**(interview.js 从不读写)→ **裁定:所有权移进 resumes.js、删 interview.js:5**,消灭跨文件纠缠(否则需 setter 跨文件原子翻转)。
  - (页面层 actTab/selectedJob 虽 reassigned 但文件本地 → module-private 无桥;selectedJob 是死写。)

**硬时序坑(核心)**:`match.js:4`/`interview.js:4`/`resumes.js:4` 顶层 `let state={jobId:JOBS[0].id}` 在 parse-time 读 `data.js` 的 JOBS。**禁止 data.js-module + reader-classic 中间态**(reader parse-time 读 → data.js module-eval 后设 JOBS → ReferenceError,nav:86 同类)→ **data.js 必须与 match/interview/resumes 同批**(import 图定序)。cards.js 的 `SEEKER_CARDS` 被 manifest.js:61 module-eval 急读 → cards 须先 eval(doc 序 1059<1226 满足)。其余一切消费在函数体内(runtime)→ window 桥零回归。

**桥要求(零回归)**:render* 入口(manifest 箭头 + 运行时)、**CACT_ALLOWED 6 名**(agentDeleteJob/copDoneAct/copInterview/copMatch/copPlan/copResume,cAB dispatcher `window[name]` **硬上 window**)、内联 onclick 目标(go/openResumeModal/openMarketValue/openNewJob/openNewAction/…按 window 解析)、数据符号(dual-publish)。模块私有(不上桥):各文件内部辅助函数 + SEED + ivRec(移 resumes 后)。

**红线文件(加倍审)**:profile.js(PROFILE 双红线·收尾批8)、frame-query.js(联系方式框定 prompt 逐字)、copilot-actions.js(§4-4 转义 cEsc/jesc + CACT_ALLOWED)、intake-action.js(MASTER/RESUME_TAILORED 简历层绝不写 profile)。

**assets→module 送 shell-globals.d.ts 归西**:prompts/notes 是那 15 条 ambient 的唯一真消费者(其他 @ts-check 匹配是误判);转 import 后整个删(`el` 已多余;`closeModal` 内联 onclick 需留 window)。

`resume-modals.js` = **现成模板**(已 module + `import {openModal}` + window 桥)。manifest.js(已 module)引用这些文件全是 runtime 箭头 → 桥阶段 **manifest 零改**。

## 逐刀顺序(叶子先 / provider 后 / 红线后)

| 批 | 文件 | 风险 | 要点 |
|---|---|---|---|
| **1 页面层** | overview/jobs/skills/actions/analysis | 低(热身) | 状态文件本地不上桥、render* 上桥、无 parse-time 坑 |
| **2 数据叶子** | data-helpers → intake-job → cards | 低 | 全 mutated/const;cards 须 manifest 前 eval |
| **3 intake-action** | intake-action | 中(红线) | RESUME_TAILORED/MASTER dual-publish;绝不写 profile |
| **4 逻辑叶子** | frame-query / copilot-actions / demo-seed / settings-jobseek | 中(2 红线) | frame-query+copilot-actions 加倍审;SEED 私有;CACT_ALLOWED 硬上桥 |
| **5 ★interview+resumes** | 协调批 | 高 | ivRec 移进 resumes(删 interview:5)+ 循环 import(runtime 安全) |
| **6 ★data.js+match** | 协调批(核心时序刀) | 高 | JOBS→module + match/interview/resumes 改 `import {JOBS}`(import 图定序,同批A型) |
| **7 settings + assets** | settings.js / prompts / notes | 中 | assets→import → **删 shell-globals.d.ts** |
| **8 ★profile 收尾** | profile.js | 高(双红线) | PROFILE export 不上 window + settings/resumes 同刀改 `import {PROFILE}` |
| **9 index.html inline** | PAGES/GROUPS/setState/WEIGHTS + 内联函数 | 中 | 最后收口 |
| **10 账本清空** | 摘剩余桥 + 删 monolith-globals.d.ts | 低 | 消费者全 module 后自然清 |

**每刀共性**:`export` + 过渡 window 桥(mutated dual-publish / reassigned 私有 / render* 上桥)+ 逐字节零逻辑改 + node --check + tsc + 功能测(web 冒烟;高风险协调刀补真机 WKWebView 金标准)+ 逐刀 commit + review-log 送审。
