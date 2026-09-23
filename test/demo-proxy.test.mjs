import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import test from 'node:test';

const cwd=new URL('..',import.meta.url).pathname;

async function freePort(){
  const server=createServer();
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const address=server.address();
  const port=typeof address==='object'&&address?address.port:0;
  await new Promise(resolve=>server.close(resolve));
  return port;
}

function waitFor(child,stream,pattern){
  return new Promise((resolve,reject)=>{
    let text='';
    const timer=setTimeout(()=>reject(new Error(`proxy did not become ready: ${text}`)),5000);
    const target=child[stream];
    const onData=chunk=>{
      text+=chunk.toString();
      if(pattern.test(text)){
        clearTimeout(timer);target.off('data',onData);resolve(text);
      }
    };
    target.on('data',onData);
    child.once('exit',code=>{clearTimeout(timer);reject(new Error(`proxy exited ${code}: ${text}`));});
  });
}

async function stop(child){
  if(child.exitCode!==null)return;
  child.kill('SIGTERM');
  await Promise.race([once(child,'exit'),new Promise(resolve=>setTimeout(resolve,2000))]);
  if(child.exitCode===null)child.kill('SIGKILL');
}

async function fixture(publicDemo,accessCodes,ratePerMin='10'){
  const upstreamRequests=[];
  const upstream=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    upstreamRequests.push(JSON.parse(raw));
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.end('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n');
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const upstreamAddress=upstream.address();
  const upstreamPort=typeof upstreamAddress==='object'&&upstreamAddress?upstreamAddress.port:0;
  const port=await freePort();
  const child=spawn(process.execPath,['server/demo-proxy.mjs'],{
    cwd,
    env:{...process.env,PORT:String(port),WEB_DIR:'../web',UPSTREAM_BASE:`http://127.0.0.1:${upstreamPort}`,UPSTREAM_KEY:'test-key',MODEL:'test-model',ACCESS_CODES:accessCodes,PUBLIC_DEMO:String(publicDemo),RATE_PER_MIN:ratePerMin,DAILY_REQ_CAP:'20'},
    stdio:['ignore','pipe','pipe'],
  });
  await waitFor(child,'stdout',/listening/);
  return {child,port,upstream,upstreamRequests};
}

test('公开演示必须显式开启，无码聊天不接收浏览器凭据并保留限速',async()=>{
  const fx=await fixture(true,'','1');
  try{
    const health=await fetch(`http://127.0.0.1:${fx.port}/api/health`).then(r=>r.json());
    assert.deepEqual(health,{ok:true,chatAccess:'public'});
    const response=await fetch(`http://127.0.0.1:${fx.port}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'hi'}]})});
    assert.equal(response.status,200);
    assert.match(await response.text(),/hello/);
    assert.equal(fx.upstreamRequests.length,1);
    assert.deepEqual(fx.upstreamRequests[0].messages.map(m=>m.role),['system','user']);
    const limited=await fetch(`http://127.0.0.1:${fx.port}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'again'}]})});
    assert.equal(limited.status,429);
    assert.deepEqual(await limited.json(),{error:'rate'});
  }finally{await stop(fx.child);await new Promise(resolve=>fx.upstream.close(resolve));}
});

test('访问码模式保持 fail-closed，健康探针让前端知道仍需门票',async()=>{
  const fx=await fixture(false,'ticket');
  try{
    const health=await fetch(`http://127.0.0.1:${fx.port}/api/health`).then(r=>r.json());
    assert.deepEqual(health,{ok:true,chatAccess:'code'});
    const denied=await fetch(`http://127.0.0.1:${fx.port}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'hi'}]})});
    assert.equal(denied.status,401);
    const allowed=await fetch(`http://127.0.0.1:${fx.port}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:'ticket',messages:[{role:'user',content:'hi'}]})});
    assert.equal(allowed.status,200);
  }finally{await stop(fx.child);await new Promise(resolve=>fx.upstream.close(resolve));}
});

test('没有访问码也没有显式公开开关时代理拒绝启动',async()=>{
  const child=spawn(process.execPath,['server/demo-proxy.mjs'],{
    cwd,
    env:{...process.env,PORT:String(await freePort()),WEB_DIR:'../web',UPSTREAM_BASE:'http://127.0.0.1:1',UPSTREAM_KEY:'test-key',MODEL:'test-model',ACCESS_CODES:'',PUBLIC_DEMO:'false'},
    stdio:['ignore','pipe','pipe'],
  });
  let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
  const [code]=await once(child,'exit');
  assert.equal(code,1);
  assert.match(stderr,/ACCESS_CODES.*PUBLIC_DEMO/);
});
