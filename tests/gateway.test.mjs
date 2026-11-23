// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {configFromEnv,createGatewayServer} from '../scripts/ai-gateway.mjs';
import {DEFAULT} from '../web/core.mjs';

const origin='http://127.0.0.1:5173';
const draft={version:1,action:'propose_geometry',design:{...DEFAULT}};
const sample={prompt:'Use the current geometry as a starting point.',action:draft.action,context:{design:{...DEFAULT}}};
const localKey='test-only-model-token';
async function listen(server,t) {
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  return 'http://127.0.0.1:'+server.address().port;
}
function post(url,body=sample,extraHeaders={}) {
  return fetch(url+'/propose',{method:'POST',headers:{origin,'Content-Type':'application/json',...extraHeaders},body:JSON.stringify(body)});
}
function config(base,extra={}) {return configFromEnv({COURBURE_AI_BASE_URL:base,COURBURE_AI_API_KEY:localKey,...extra});}
function ollamaReply(proposal=draft) {return {done:true,done_reason:'stop',message:{role:'assistant',content:JSON.stringify(proposal)}};}

test('local provider configuration limits destinations and requires explicit official credentials',()=>{
  const defaults=configFromEnv({});
  assert.equal(defaults.endpoint,'http://127.0.0.1:11434/api/chat');
  assert.equal(defaults.provider,'ollama');
  for(const base of ['https://example.org','http://127.0.0.1.example.org:11434','http://u:p@localhost:11434','file:///tmp/model','http://localhost:11434/#x']) assert.throws(()=>config(base));
  assert.throws(()=>config('http://127.0.0.1',{COURBURE_AI_MODEL:'example:cloud'}));
  assert.throws(()=>configFromEnv({COURBURE_AI_PROVIDER:'openai',COURBURE_AI_MODEL:'gpt-6-luna'}));
  assert.throws(()=>config('http://127.0.0.1',{COURBURE_AI_PROVIDER:'openai',COURBURE_AI_MODEL:'gpt-6-luna'}));
  assert.equal(configFromEnv({COURBURE_AI_PROVIDER:'openai',COURBURE_AI_MODEL:'gpt-6-luna',COURBURE_AI_API_KEY:localKey}).endpoint,'https://api.openai.com/v1/responses');
});

test('Ollama request, preflight and health work with exact browser origins and a local HTTP mock',async t=>{
  let calls=0;
  const peer=await listen(createServer(async(req,res)=>{
    calls++;assert.equal(req.url,'/api/chat');assert.equal(req.headers.authorization,'Bearer '+localKey);
    const parts=[];for await(const p of req) parts.push(p);
    const body=JSON.parse(Buffer.concat(parts));
    assert.equal(body.format.additionalProperties,false);assert.equal(body.stream,false);assert.ok(!('tools'in body));
    assert.deepEqual(JSON.parse(body.messages[1].content),sample);
    res.end(JSON.stringify(ollamaReply()));
  }),t);
  const url=await listen(createGatewayServer(config(peer)),t);
  const health=await fetch(url+'/health',{headers:{origin}});assert.equal(health.status,200);assert.equal((await health.json()).provider,'ollama');assert.equal(calls,0);
  const preflight=await fetch(url+'/propose',{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'content-type','access-control-request-private-network':'true'}});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-private-network'),'true');
  for(const badOrigin of ['https://unknown.example','null','']) {
    const denied=await post(url,sample,{origin:badOrigin});
    assert.equal(denied.status,403);assert.equal(denied.headers.has('access-control-allow-origin'),false);
  }
  assert.equal((await post(url,{...sample,endpoint:'http://127.0.0.1/test'})).status,400);
  assert.equal((await post(url,{...sample,context:{positions:[1,2,3]}})).status,400);
  assert.equal((await post(url,{...sample,context:{design:{...DEFAULT,vertices:[1,2,3]}}})).status,400);
  assert.equal((await post(url,{...sample,prompt:'é'.repeat(4097)})).status,413);
  assert.equal((await post(url,{...sample,prompt:'x'.repeat(33000)})).status,413);
  assert.equal((await post(url,sample,{'content-type':'text/plain'})).status,415);
  assert.equal(calls,0);
  const good=await post(url,{...sample,expected_provider:'ollama',expected_model:'qwen3:4b'}); assert.equal(good.status,200);assert.equal(good.headers.get('access-control-allow-origin'),origin);
  const result=await good.text();assert.deepEqual(JSON.parse(result).proposal,draft);assert.ok(!result.includes(localKey));assert.equal(calls,1);
});

test('a changed local gateway destination requires reconnection before the model receives any data',async t=>{
  let calls=0;
  const cloud=configFromEnv({COURBURE_AI_PROVIDER:'openai',COURBURE_AI_MODEL:'gpt-6-luna',COURBURE_AI_API_KEY:localKey});
  const url=await listen(createGatewayServer(cloud,async()=>{calls++;throw Error('Unexpected provider call');}),t);
  for(const [fields,status] of [
    [{expected_provider:'ollama',expected_model:'qwen3:4b'},409],
    [{expected_provider:'openai',expected_model:'previous-model'},409],
    [{expected_provider:'openai'},400],[{expected_model:'gpt-6-luna'},400],
    [{expected_provider:'openai',expected_model:null},400],
  ]) assert.equal((await post(url,{...sample,...fields})).status,status);
  assert.equal(calls,0);
});

test('compatible provider uses the fixed local path and fails closed on malformed or oversized results',async t=>{
  let mode='valid';
  const peer=await listen(createServer(async(req,res)=>{
    assert.equal(req.url,'/v1/chat/completions');
    for await(const _ of req) {}
    if(mode==='redirect'){res.writeHead(307,{Location:'http://127.0.0.1:1/elsewhere'});res.end();return;}
    if(mode==='large'){res.write('x'.repeat(70000));res.end('x'.repeat(70000));return;}
    if(mode==='provider-error'){res.writeHead(403);res.end(localKey);return;}
    const content=mode==='invalid'?'{bad json':JSON.stringify(mode==='extra'?{...draft,tool:'execute'}:draft);
    const choice={finish_reason:mode==='truncated'?'length':'stop',message:{role:mode==='wrong-role'?'user':'assistant',content}};
    res.end(JSON.stringify({choices:mode==='multiple'?[choice,choice]:[choice]}));
  }),t);
  const url=await listen(createGatewayServer(config(peer+'/v1',{COURBURE_AI_PROVIDER:'openai-compatible',COURBURE_AI_MODEL:'local-test'})),t);
  assert.equal((await post(url)).status,200);
  for(mode of ['extra','invalid','large','provider-error','redirect','truncated','wrong-role','multiple']) {
    const response=await post(url);assert.equal(response.status,502);assert.ok(!(await response.text()).includes(localKey));
  }
});

test('Ollama distinguishes a clarification request from unfinished or ambiguous model output',async t=>{
  let reply;
  const url=await listen(createGatewayServer(config('http://127.0.0.1'),async()=>new Response(reply)),t);
  reply=JSON.stringify(ollamaReply({...draft,design:null}));
  assert.equal((await post(url)).status,422);
  for(const override of [{done:false},{done_reason:'length'},{message:{...ollamaReply().message,role:'user'}}]) {
    reply=JSON.stringify({...ollamaReply(),...override});
    assert.equal((await post(url)).status,502);
  }
  reply=JSON.stringify(ollamaReply()).replace('"done":true','"done":false,"done":true');
  assert.equal((await post(url)).status,502);
});

test('a stalled local model times out and releases the single proposal slot',async t=>{
  let entered;const started=new Promise(resolve=>{entered=resolve;});
  const peer=await listen(createServer((req,res)=>{req.resume();entered();res.writeHead(200);res.write('{');}),t);
  const url=await listen(createGatewayServer(config(peer,{COURBURE_AI_TIMEOUT_MS:'250'})),t);
  const pending=post(url);await started;
  assert.equal((await post(url)).status,429);
  const timed=await pending;assert.equal(timed.status,504);
  assert.equal((await post(url)).status,504);
});

test('the local deadline includes uploading and releases the slot before another request',async t=>{
  let calls=0;
  const gateway=createGatewayServer(config('http://127.0.0.1',{COURBURE_AI_TIMEOUT_MS:'150'}),async()=>{
    calls++;
    return Response.json(ollamaReply());
  });
  const url=await listen(gateway,t);
  const upload=httpRequest(url+'/propose',{method:'POST',headers:{origin,'content-type':'application/json'}});
  const received=once(upload,'response',{signal:AbortSignal.timeout(3000)});
  upload.write('{');
  try {
    const [response]=await received;
    assert.equal(response.statusCode,504);
    response.resume();
  } finally {upload.destroy();}
  assert.equal(calls,0);
  assert.equal((await post(url)).status,200);
  assert.equal(calls,1);
});
