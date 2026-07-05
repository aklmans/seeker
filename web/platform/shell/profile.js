// @ts-nocheck —— 抽壳序5-a 过渡:profile 通道(rt.profile · 红线隔离)。逻辑零改动。
/** 平台 · profile 通道(个人隐私字段落盘/水合)—— ★★双红线:
 *  ① profile 硬隔离:persistProfileField 只经 rt.profile.set、hydrateProfile 只经 rt.profile.getAll,**绝不串 rt.db**
 *     —— 与 data-store.js 的通用集合引擎(rt.db)**物理分离 = 模块边界即红线边界**;后端 capability.rs QUERYABLE 不含 profile,AI 永不读/写 profile。
 *  ② 设置不可经对话改:profile 只经设置页 data-pf 输入改(见 renderSettings),Agent 只引导去设置页(见 copReply 拦截)。
 *  依赖(运行时全局):settingsPersistOn(持久化条件,index.html)、renderSettings/current(index.html)、
 *  PROFILE(个人信息对象 · ★第19轮裁定:应移平台=壳级用户身份[对应 rt.profile 单一共享仓库、非 per-app],序5-完成前必清——平台模块 profile.js 现具名引用 jobseek intake-action.js:127 的 PROFILE = 平台→apps §1 债,对安全无损;5-b 移 PROFILE→本文件)。
 *  ⚠ rt-ready 时序:classic <script src>、解析期注册 hydrateProfile 监听器 → 先于 deferred module dispatch@881(同第5轮时序法)。 */
function persistProfileField(k, v){ if(settingsPersistOn()) window.SeekerRT.profile.set(k, String(v==null?'':v)).catch(e=>console.error('[data] profile set', e)); }
async function hydrateProfile(){
  if(!settingsPersistOn()) return;
  try{ const p=await window.SeekerRT.profile.getAll();
    if(p && typeof p==='object'){ Object.keys(p).forEach(k=>{ PROFILE[k]=p[k]; }); try{ if(current==='settings') renderSettings(); }catch(_e){} }
  }catch(e){ console.error('[data] hydrate profile', e); }
}
window.addEventListener('seeker-rt-ready', hydrateProfile);
