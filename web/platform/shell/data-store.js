// @ts-nocheck —— 3.y 步3 中层:通用集合数据引擎 + 持久化条件/壳 onboarding 状态 classic 全局 → ES module(export)+ 过渡 window 桥。逻辑逐字节。
/** 平台 · 通用集合数据引擎 collPersistOn/seededColl/markSeededColl/withCollId/persistColl/hydrateColl + persistMsg。
 *  ★红线(逐字保留):只处理通用集合(rt.db.upsert/list),隐私表(profile)走独立 rt.profile、永不经此
 *  —— persist 永不把 profile 写通用 AI 可读集(合 D3 / profile 硬隔离)。集合 id 键经 SeekerShell.collId 契约问应用(§1 纯净、无 jobseek knowledge)。
 *  依赖 isDesktop/window.SeekerRT(运行时全局)。classic 消费者(persistence/settings/copilot-chrome/cards/assets 等)按全局名调不变。
 *  __msgSeq(message 序号,persistMsg 内 ++)= 模块内私有、外部不消费 → 不上桥(无分裂)。 */
/* ---- 持久化条件 + 壳 onboarding 状态(归属:平台):jobsPersistOn(桌面+SeekerRT)+ onboarded/markOnboarded。
   ★归平台理据:hydrateColl(本引擎,通用集合)按"有数据→已上手"调 markOnboarded = **shell 级 onboarding**(非 jobseek 专属),
   留平台避免平台→apps 反向依赖('jh-seeded-jobs' 是旧版迁移键、逐字保留)。demo 态(demoMode/setDemoMode/SEED/captureSeed)= jobseek,留 apps。 ---- */
import { isDesktop } from './shell-keys.js';
export function jobsPersistOn(){ return typeof isDesktop==='function' && isDesktop() && !!window.SeekerRT; }
export function onboarded(){ try{ return localStorage.getItem('jh-onboarded')==='1' || localStorage.getItem('jh-seeded-jobs')==='1'; }catch(_e){ return false; } }
export function markOnboarded(){ try{ localStorage.setItem('jh-onboarded','1'); }catch(_e){} }
export function collPersistOn(){ return jobsPersistOn(); } // 同条件:桌面 + SeekerRT
// 种子守卫:首启把内存 mock 作种子写一次;之后(含"清空所有数据"后)不再播种,演示数据不复活。
export function seededColl(name){ try{ return localStorage.getItem('jh-seeded-'+name)==='1'; }catch(_e){ return false; } }
export function markSeededColl(name){ try{ localStorage.setItem('jh-seeded-'+name,'1'); }catch(_e){} }
/** 给无 id 的集合补 id(skills 用 name 作天然键);其余(actions/iv_records)已有数值 id。 */
export function withCollId(name, r){
  if(r && r.id!=null) return r;
  const id = window.SeekerShell.collId(name, r);           // 集合 id 键规则经契约问应用(如 skills→name);平台无 jobseek knowledge
  return Object.assign({ id: id!=null ? id : ('r_'+Date.now()+'_'+Math.random().toString(36).slice(2,6)) }, r);
}
/** 整集合 upsert(变更后调用)。 @param {string} name @param {any[]} arr */
export function persistColl(name, arr){
  if(!collPersistOn()) return;
  for(const r of arr){ window.SeekerRT.db.upsert(name, withCollId(name, r)).catch(e=>console.error('[data] upsert '+name, e)); }
}
/** 水合:载仓库;首启把内存 mock 作种子写入;再用仓库内容替换内存数组(就地)。 */
export async function hydrateColl(name, arr){
  if(!collPersistOn()) return;
  try{
    const rows = await window.SeekerRT.db.list(name);
    arr.length=0;                                    // 不再静默播种:首启 DB 空 → 内存也空 → 各视图空态/落地页
    if(rows.length){ markOnboarded(); arr.push(...rows); } // 有数据 = 已上手,水合
  }catch(e){ console.error('[data] hydrate '+name, e); }
}

/* ===== messages 对话历史持久化(domain)。只存「可见对话」纯文本(user / AI 流式结果),
   不存招呼语 / 建议 chip / 富卡片 / widget(皆为临时 UI;widget 会话内重渲)。surface=cop|agent。
   隐私:messages 已移出后端 QUERYABLE → AI 不可 query_data('messages') 挖掘历史(经 History 拿上下文)。 */
let __msgSeq=0;  // 模块内私有(persistMsg 内 ++)、外部不消费 → 不上桥,无分裂
export function persistMsg(surface, role, text, cards){
  if(!collPersistOn()) return;
  text = String(text==null?'':text);
  const hasCards = Array.isArray(cards) && cards.length>0;
  if(!text.trim() && !hasCards) return;                 // 纯空且无卡才跳过(纯卡片回复仍持久)
  const ts = Date.now();
  const rec = { id:'m_'+ts+'_'+(__msgSeq++), surface:surface, role:role, text:text, ts:ts };
  if(hasCards) rec.cards = cards;                        // 可持久化卡指令 [{kind,data}](view 卡;不含 resume-edit 提案)
  window.SeekerRT.db.upsert('messages', rec).catch(e=>console.error('[data] persist msg', e));
}
/* 过渡 window 兼容桥:classic 消费者(persistence/settings/copilot-chrome/cards/assets/demo-seed 等)按全局名调不变;逐个改 import 后摘。
   函数纯(仅读 localStorage/window.SeekerRT + mutate 传入 arr);__msgSeq 私有不上桥 → dual-publish 安全。 */
