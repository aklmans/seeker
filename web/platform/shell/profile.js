// @ts-nocheck —— 抽壳序5-a 过渡:profile 通道(rt.profile · 红线隔离)。逻辑零改动。
/** 平台 · profile 通道(个人隐私字段落盘/水合)—— ★★双红线:
 *  ① profile 硬隔离:persistProfileField 只经 rt.profile.set、hydrateProfile 只经 rt.profile.getAll,**绝不串 rt.db**
 *     —— 与 data-store.js 的通用集合引擎(rt.db)**物理分离 = 模块边界即红线边界**;后端 capability.rs QUERYABLE 不含 profile,AI 永不读/写 profile。
 *  ② 设置不可经对话改:profile 只经设置页 data-pf 输入改(见 renderSettings),Agent 只引导去设置页(见 copReply 拦截)。
 *  依赖(运行时全局):settingsPersistOn(持久化条件,index.html)、renderSettings/current(index.html)。
 *  PROFILE(个人信息对象=壳级用户身份,对应 rt.profile 单一共享仓库)第19轮裁定移平台、本文件自持(序5-b;平台→apps §1 债已清——jobseek resumes.js / index.html renderSettings 读 PROFILE = apps→平台,允许)。
 *  ⚠ rt-ready 时序:classic <script src>、解析期注册 hydrateProfile 监听器 → 先于 deferred module dispatch@881(同第5轮时序法)。 */
/* 个人隐私信息 — 仅本地、来自「数据设置」,AI 不读取 / 不修改 */
const PROFILE={name:'(在数据设置填写)', phone:'138****8888', email:'y***@example.com', city:'北京', intent:'后端工程师', exp:'8 年'};
function persistProfileField(k, v){ if(settingsPersistOn()) window.SeekerRT.profile.set(k, String(v==null?'':v)).catch(e=>console.error('[data] profile set', e)); }
async function hydrateProfile(){
  if(!settingsPersistOn()) return;
  try{ const p=await window.SeekerRT.profile.getAll();
    if(p && typeof p==='object'){ Object.keys(p).forEach(k=>{ PROFILE[k]=p[k]; }); try{ if(current==='settings') renderSettings(); }catch(_e){} }
  }catch(e){ console.error('[data] hydrate profile', e); }
}
window.addEventListener('seeker-rt-ready', hydrateProfile);
