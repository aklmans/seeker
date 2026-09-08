// @ts-check
export const EXPORT_RATIOS={auto:0,square:1,landscape:4/3,wide:16/9,portrait:3/4,story:9/16};
/** @param {{[k:string]:unknown}} [raw] */
export function presentation(raw={}){
  const text=(/** @type {string} */k,/** @type {number} */max)=>typeof raw[k]==='string'?String(raw[k]).slice(0,max):'';
  return {ratio:Object.hasOwn(EXPORT_RATIOS,String(raw.ratio))?String(raw.ratio):'auto',title:raw.includeTitle===true?text('title',200):'',source:raw.includeSource===true?text('source',300):'',byline:raw.includeByline===true?text('byline',80):''};
}
/** All source pixels fit inside the chosen ratio. Long content is reduced, never cropped.
 * @param {number} sourceWidth @param {number} sourceHeight @param {number} width @param {number} height @param {number} margin @param {number} header @param {number} footer */
export function fitExportContent(sourceWidth,sourceHeight,width,height,margin,header,footer){
  if(![sourceWidth,sourceHeight,width,height].every(n=>Number.isFinite(n)&&n>0)||width>4800||height>32000||width*height>24000000)throw Error('导出尺寸超出限制 / Export dimensions exceed limits');
  const availableWidth=width-margin*2,availableHeight=height-margin*2-header-footer;
  if(availableWidth<40||availableHeight<40)throw Error('标题或署名过长，请精简或选择原始比例 / Shorten captions or use original ratio');
  const scale=Math.min(availableWidth/sourceWidth,availableHeight/sourceHeight);
  return {x:(width-sourceWidth*scale)/2,y:margin+header+(availableHeight-sourceHeight*scale)/2,width:sourceWidth*scale,height:sourceHeight*scale,scale};
}
