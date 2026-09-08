// @ts-check
import {normalizeStyle} from './style.js';
import {decodeCreationPNG} from '../runtime/creation-export.js';
import {tt} from '../shell/i18n.js';
import {presentation,fitExportContent,EXPORT_RATIOS} from './presentation-model.js';
/** @param {{png:string,width:number,height:number}} rendered @param {{[k:string]:unknown}} input @param {{[k:string]:unknown}} [style] */
export async function composePresentation(rendered,input,style={}){
  const p=presentation(input);if(p.ratio==='auto'&&!p.title&&!p.source&&!p.byline)return rendered;
  const s=normalizeStyle(style),source=await decodeCreationPNG(rendered.png),ratio=/** @type {any} */(EXPORT_RATIOS)[p.ratio];
  const width=ratio?1600:Math.max(640,source.width),margin=Math.round(width*.035),fontSize=Math.round(Math.min(40,Math.max(24,width*.025))),lineHeight=fontSize*1.45;
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas unavailable');
  const font={sans:'system-ui,sans-serif',serif:'Georgia,"Songti SC",serif',mono:'Menlo,"Microsoft YaHei",monospace'}[s.font]||'sans-serif';
  ctx.font=`${fontSize}px ${font}`;
  const lines=(/** @type {string} */text)=>{const out=[];let line='';for(const char of text){if(char==='\n'||(line&&ctx.measureText(line+char).width>width-margin*2)){out.push(line);line='';if(char==='\n')continue;}line+=char;}if(line)out.push(line);return out;};
  const titleLines=lines(p.title),footerLines=[...lines(p.source?tt('来源：','Source: ')+p.source:''),...lines(p.byline?tt('署名：','By: ')+p.byline:'')];
  const header=titleLines.length?(titleLines.length+0.6)*lineHeight:0,footer=footerLines.length?(footerLines.length+0.6)*lineHeight:0;
  const height=ratio?Math.round(width/ratio):Math.ceil(source.height*(width-margin*2)/source.width+header+footer+margin*2);
  const box=fitExportContent(source.width,source.height,width,height,margin,header,footer);
  canvas.width=width;canvas.height=height;ctx.fillStyle=s.background;ctx.fillRect(0,0,width,height);ctx.drawImage(source.image,box.x,box.y,box.width,box.height);
  ctx.fillStyle=s.foreground;ctx.font=`${fontSize}px ${font}`;ctx.textBaseline='top';
  titleLines.forEach((line,i)=>ctx.fillText(line,margin,margin+i*lineHeight));footerLines.forEach((line,i)=>ctx.fillText(line,margin,height-margin-footer+lineHeight*.6+i*lineHeight));
  const png=canvas.toDataURL('image/png');canvas.width=canvas.height=0;return {png,width,height};
}
