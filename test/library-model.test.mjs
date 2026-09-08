import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectLibraryDocument, projectLibraryInfo } from '../web/platform/runtime/library-model.js';

const row=()=>({id:'ld_sample',name:'sample.txt',format:'txt',size:6,sourceHash:'a'.repeat(64),updated:10,characters:9,fragments:[{id:'f1',text:'中文 🍊 test',page:null}],warnings:[],sourceDataBase64:'c291cmNl'});
test('library projection keeps Unicode text and strips original bytes and untrusted metadata',()=>{
  const source={...row(),messages:['private'],system:'do evil'};
  const doc=projectLibraryDocument(source);
  assert.equal(doc.characters,9);assert.equal(doc.fragments[0].text,source.fragments[0].text);
  assert.equal(doc.originalIncluded,true);assert.equal(doc.fragmentCount,1);
  for(const key of ['sourceDataBase64','messages','system'])assert.equal(key in doc,false);
  assert.equal('fragments' in projectLibraryInfo(source),false);
});
test('damaged imports cannot supply fake fragment identities, counts, pages or oversized material',()=>{
  for(const change of [{characters:8},{size:0},{sourceHash:'fake'},{fragments:[{id:'../path',text:'some text'}]},
    {fragments:[{id:'f1',text:'part'},{id:'f1',text:'part'}]}, {fragments:[{id:'f1',text:'中文 🍊 test',page:0}]},
    {characters:30001,fragments:[{id:'f1',text:'a'.repeat(30001)}]}]){
    const broken={...row(),...change};assert.throws(()=>projectLibraryDocument(broken));assert.equal(projectLibraryInfo(broken).invalid,true);
  }
});
