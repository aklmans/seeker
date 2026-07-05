// @ts-nocheck —— 抽壳序4-b 过渡:通用集合数据引擎,引用 rt.db + SeekerShell.collId 契约 + jobsPersistOn/markOnboarded(过渡留 index.html);类型化留 3.y;逻辑零改动。
/** 平台 · 通用集合数据引擎 collPersistOn/seededColl/markSeededColl/withCollId/persistColl/hydrateColl。
 *  ★红线:只处理通用集合(rt.db.upsert/list),隐私表(profile)走独立 rt.profile、永不经此
 *  —— persist 永不把 profile 写通用 AI 可读集(合 D3 / profile 硬隔离)。集合 id 键经 SeekerShell.collId 契约问应用(§1 纯净、无 jobseek knowledge)。
 *  过渡依赖:jobsPersistOn(持久化条件)/markOnboarded(onboarding 状态)留 index.html、运行时调,归属后续刀定。挂全局+载序前置零回归(约束⑤)。 */
function collPersistOn(){ return jobsPersistOn(); } // 同条件:桌面 + SeekerRT
// 种子守卫:首启把内存 mock 作种子写一次;之后(含"清空所有数据"后)不再播种,演示数据不复活。
function seededColl(name){ try{ return localStorage.getItem('jh-seeded-'+name)==='1'; }catch(_e){ return false; } }
function markSeededColl(name){ try{ localStorage.setItem('jh-seeded-'+name,'1'); }catch(_e){} }
/** 给无 id 的集合补 id(skills 用 name 作天然键);其余(actions/iv_records)已有数值 id。 */
function withCollId(name, r){
  if(r && r.id!=null) return r;
  const id = window.SeekerShell.collId(name, r);           // 集合 id 键规则经契约问应用(如 skills→name);平台无 jobseek knowledge
  return Object.assign({ id: id!=null ? id : ('r_'+Date.now()+'_'+Math.random().toString(36).slice(2,6)) }, r);
}
/** 整集合 upsert(变更后调用)。 @param {string} name @param {any[]} arr */
function persistColl(name, arr){
  if(!collPersistOn()) return;
  for(const r of arr){ window.SeekerRT.db.upsert(name, withCollId(name, r)).catch(e=>console.error('[data] upsert '+name, e)); }
}
/** 水合:载仓库;首启把内存 mock 作种子写入;再用仓库内容替换内存数组(就地)。 */
async function hydrateColl(name, arr){
  if(!collPersistOn()) return;
  try{
    const rows = await window.SeekerRT.db.list(name);
    arr.length=0;                                    // 不再静默播种:首启 DB 空 → 内存也空 → 各视图空态/落地页
    if(rows.length){ markOnboarded(); arr.push(...rows); } // 有数据 = 已上手,水合
  }catch(e){ console.error('[data] hydrate '+name, e); }
}
