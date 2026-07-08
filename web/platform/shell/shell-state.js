// @ts-nocheck —— 批9a:壳核心状态 + 设置/数据框架从 index.html inline 抽出为 module(逻辑零改动)。读 isDesktop/SeekerRT/SeekerShell/markOnboarded/tt/toast/SeekerGuardrail 仍运行时全局(待批9b/10 转 import 再 @ts-check)。
/** 平台 · 壳核心状态 + 设置/数据持久化框架(原 index.html inline 抽出 · 批9a)。
 *  ★载序:PAGES/GROUPS 被 SHELL BOOT module-eval 急读 window.PAGES/GROUPS(index.html:1243/1244)→ 本 module tag 须早于 SHELL BOOT(现置于 shell 基元区、nav.js 后);
 *    无 classic parse-time 读者(原 inline 定义处亦无顶层读、消费全在函数体或 SHELL BOOT deferred module)→ 抽到 deferred module 安全。
 *  PAGES/GROUPS/setState/WEIGHTS = mutated-property(push/length=0/.k=/[i]=、引用稳定)→ dual-publish 同引用免访问器。
 *  设置持久化走 localStorage(jh-settings);profile 走 rt.profile(见 profile.js);清空走 guardrail(破坏性红线:预览+确认+可撤销+清前备份)。 */

/* ============ NAV STATE ============ */
/* 多应用平台(阶段1):导航项/分组由壳组合 —— apps/jobseek/manifest.js 注册业务页、壳自持设置页(SHELL BOOT setShell + 填充)。PAGES/GROUPS 保名空置,消费方(buildNav/buildPages/go/initKeys/setLang/rerenderPages)零改动。 */
export const PAGES=[];
export const GROUPS={};

/* ============ SETTINGS STATE ============ */
export let setState={theme:'light', fontsize:'14', goal:20, trainCounts:true, lang:'zh', density:'standard', motion:'on', autobackup:'on', period:'2026 年 6 月', salary:'30 — 60 万'};
export const WEIGHTS=[['兴趣分',40],['成长分',30],['匹配分',20],['机会分',10]];

/* ===== 数据设置持久化(除非用户清除,持续保留)。profile 落盘(rt.profile · 隔离);
   目标/权重/外观偏好走 localStorage(jh-settings);theme/lang 沿用各自既有键。 ===== */
export function settingsPersistOn(){ return typeof isDesktop==='function' && isDesktop() && !!window.SeekerRT; }
export function saveSettings(){
  try{ localStorage.setItem('jh-settings', JSON.stringify({
    fontsize:setState.fontsize, goal:setState.goal, trainCounts:setState.trainCounts, density:setState.density,
    motion:setState.motion, autobackup:setState.autobackup, period:setState.period, salary:setState.salary,
    weights:WEIGHTS.map(w=>w[1])
  })); }catch(_e){}
}
export function hydrateSettings(){
  try{ const s=JSON.parse(localStorage.getItem('jh-settings')||'null'); if(!s) return;
    ['fontsize','goal','trainCounts','density','motion','autobackup','period','salary'].forEach(k=>{ if(s[k]!=null) setState[k]=s[k]; });
    if(Array.isArray(s.weights)) s.weights.forEach((v,i)=>{ if(WEIGHTS[i]!=null && typeof v==='number') WEIGHTS[i][1]=v; });
  }catch(_e){}
}
// 清空所有业务数据(#业务打磨):清前自动备份;种子守卫保证清后不再播种演示数据。
// 阶段4-0(第22轮[建议]落地):集合清单经 SeekerShell.collections() 契约枚举(全部已注册应用∪壳自持,存在性口径)
// —— 新应用集合自动纳入,「清空全部数据」永不静默漏集合(§4-3 可撤销完整性);
// app-local 状态复位经 SeekerShell.notifyDataCleared() 契约(第9契约,如 jobseek 退演示模式),平台零 setDemoMode 直调。
export async function clearAllCollections(){ // 抽出便于安全测试 + 不依赖 reload
  const rt=window.SeekerRT; if(!rt) return;
  try{ await rt.db.backup(); }catch(_e){}                 // 清前自动备份(可日后导入恢复)
  for(const c of window.SeekerShell.collections()){
    try{ const rows=await rt.db.list(c); for(const r of rows){ try{ await rt.db.remove(c, r.id); }catch(_e){} } }catch(_e){}
  }
}
export function clearAllDataFlow(){
  const G=window.SeekerGuardrail;
  if(!G||!G.confirmDestructive||!window.SeekerRT){ toast(tt('该端暂不支持','Not supported here')); return; }
  const n=window.SeekerShell.collections().length;
  G.confirmDestructive({
    title:tt('清空所有业务数据?','Clear all data?'),
    detail:tt('将删除全部应用的业务数据与对话历史(共 '+n+' 个数据集合,含已停用应用)。个人信息与设置不受影响。清空前会自动存一份备份,可日后导入恢复。','Deletes all apps\' business data and chat history ('+n+' collections, including disabled apps). Personal info and settings stay. A backup is saved first — you can re-import it later.'),
    confirmLabel:tt('清空','Clear'),
    onConfirm:async()=>{ await clearAllCollections(); window.SeekerShell.notifyDataCleared(); markOnboarded(); toast(tt('已清空 · 备份已存,正在刷新…','Cleared · backup saved, reloading…')); setTimeout(()=>{ try{ location.reload(); }catch(_e){} }, 700); },
  });
}

/* 过渡 window 桥:消费者(SHELL BOOT/nav.js/settings.js/profile.js/settings-jobseek.js/demo-seed.js + index.html initKeys/shellReassemble)裸全局读不变;批10 改 import 后摘。
   ★PAGES/GROUPS 于 module-eval 即设桥(供 SHELL BOOT 急读 @1243/1244);setState/WEIGHTS/4 函数同(runtime 消费、桥就绪即可)。
   ★批10a:clearAllCollections 桥删——唯一消费者是同文件 clearAllDataFlow(模块词法,死桥)。 */
window.PAGES=PAGES; window.GROUPS=GROUPS; window.setState=setState; window.WEIGHTS=WEIGHTS;
window.settingsPersistOn=settingsPersistOn; window.saveSettings=saveSettings; window.hydrateSettings=hydrateSettings; window.clearAllDataFlow=clearAllDataFlow;
