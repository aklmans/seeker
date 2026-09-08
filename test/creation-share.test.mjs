import {test} from 'node:test';
import assert from 'node:assert/strict';
import {offlineDocument} from '../web/platform/runtime/offline-document.js';
import {presentation,fitExportContent,EXPORT_RATIOS} from '../web/platform/creations/presentation-model.js';
test('presentation excludes unchecked text, bounds fields and fits every source pixel without cropping',()=>{
  assert.deepEqual(presentation({title:'private',source:'private',byline:'private',ratio:'bad'}),{ratio:'auto',title:'',source:'',byline:''});
  assert.equal(presentation({includeByline:true,byline:'x'.repeat(81)}).byline.length,80);
  for(const ratio of Object.values(EXPORT_RATIOS).filter(Boolean)){
    const width=1600,height=Math.round(width/ratio),box=fitExportContent(800,10000,width,height,50,80,120);
    assert.ok(box.x>=50&&box.y>=130);assert.ok(box.x+box.width<=width-50);assert.ok(box.y+box.height<=height-170);assert.ok(Math.abs(box.height/box.width-10000/800)<1e-10);
  }
  assert.throws(()=>fitExportContent(800,600,1600,900,50,600,600));
});
test('offline source and title cannot break into the outer document',()=>{
  const html=offlineDocument('\"><script>bad</script>','\"></iframe><script>bad</script><button onclick="this.textContent=42">Go</button>');
  assert.equal((html.match(/<iframe /g)||[]).length,1);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('allow-same-origin'));assert.ok(html.includes('sandbox="allow-scripts"'));assert.ok(html.includes('frame-src about:'));assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));
  assert.throws(()=>offlineDocument('too big','x'.repeat(262145)));
});
