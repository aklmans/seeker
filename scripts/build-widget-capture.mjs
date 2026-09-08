import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('web/vendor',{recursive:true});
await build({entryPoints:['scripts/widget-capture-entry.js'],bundle:true,minify:true,format:'iife',outfile:'web/vendor/widget-capture.txt',legalComments:'eof'});
for(const name of ['html2canvas','text-segmentation','css-line-break','utrie','base64-arraybuffer'])
  await copyFile(`node_modules/${name}/LICENSE`,`web/vendor/${name}-LICENSE.txt`);
