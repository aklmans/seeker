// @ts-check
import { tt } from '../../platform/shell/i18n.js';
import { MODES } from './writing-model.js';
import { renderWriting, openWriting } from './writing.js';
const icon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16M5 15 16 4l4 4L9 19H5zM14 6l4 4"/></svg>';
window.SeekerShell.register({
  id:'daily',name:{zh:'日常工具',en:'Everyday tools'},icon,
  blurb:{zh:'翻译、润色、总结和回复草稿，只处理本次文字',en:'Translate, polish, summarize and draft replies using only the text you select'},
  collections:[],aiReadable:'default-off',groups:{everyday:{zh:'日常',en:'EVERYDAY'}},
  pages:[{id:'tools',label:'工具',en:'Tools',abbr:'工',eyebrow:'TOOLS',primary:true,primaryOrder:20,workspace:true,group:'everyday',icon,render:renderWriting}],
  homeActions:()=>MODES.map(m=>({label:tt(m.zh,m.en),run:()=>openWriting(m.id)})),
});
