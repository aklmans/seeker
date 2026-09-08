// @ts-check
/** Safe projection for viewing desktop file backups in the Web runtime. Original bytes stay in the DB. */
/** @param {any} row @returns {import('./types').LibraryDocument} */
export function projectLibraryDocument(row) {
  const fail=()=>{throw new Error('资料记录损坏，请重新导入 / Damaged document record. Import the file again.');};
  if(!row || typeof row.id!=='string' || typeof row.name!=='string' || !row.name || row.name.length>512 || !['txt','md','pdf','docx'].includes(row.format) || !Number.isSafeInteger(row.size) || row.size<1 || row.size>10485760 || typeof row.sourceHash!=='string' || !/^[a-f0-9]{64}$/i.test(row.sourceHash) || !Array.isArray(row.fragments) || !row.fragments.length || row.fragments.length>250)fail();
  /** @type {Set<string>} */ const ids=new Set();
  /** @type {import('./types').SourceFragment[]} */ const fragments=[];
  let characters=0;
  for(const f of row.fragments){
    if(!f || typeof f.id!=='string' || !/^f\d+$/.test(f.id) || f.id.length>30 || ids.has(f.id) || typeof f.text!=='string' || !f.text || (f.page!=null && (!Number.isInteger(f.page)||f.page<1||f.page>200)))fail();
    ids.add(f.id);characters+=[...f.text].length;
    if(characters>30000)fail();
    fragments.push({id:f.id,text:f.text,page:f.page??null});
  }
  if(characters!==row.characters || fragments.every(f=>!f.text.trim()))fail();
  return {id:row.id,name:row.name,format:row.format,size:row.size,sourceHash:row.sourceHash,characters,fragmentCount:fragments.length,updated:typeof row.updated==='number'?row.updated:0,originalIncluded:typeof row.sourceDataBase64==='string'&&row.sourceDataBase64.length>0&&row.sourceDataBase64.length<=13981016,fragments,warnings:Array.isArray(row.warnings)?row.warnings.filter((/** @type {unknown} */w)=>typeof w==='string'):[]};
}
/** @param {any} row @returns {import('./types').LibraryDocumentInfo} */
export function projectLibraryInfo(row) {
  try{const {fragments,warnings,...info}=projectLibraryDocument(row);return info;}
  catch{return {id:String(row?.id||''),name:typeof row?.name==='string'?row.name:'无法读取的资料 / Unreadable document',format:'unknown',size:0,sourceHash:'',characters:0,fragmentCount:0,updated:0,originalIncluded:false,invalid:true};}
}
