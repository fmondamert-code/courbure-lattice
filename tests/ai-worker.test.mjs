// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAIRequest} from '../server/ai-worker.mjs';
import {DEFAULT} from '../web/core.mjs';

const site='https://studio.example',key='fixture-user-key-abcdef';
const draft={version:1,action:'propose_geometry',design:{...DEFAULT,envelope:'curved'}};
const input={model:'gpt-6-luna',prompt:'Use a curved part envelope.',action:'propose_geometry',context:{design:{...DEFAULT}}};
const msg={type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(draft)}]};
function request(body=input,extra={},path='/api/ai/propose') {
  return new Request(site+path,{method:'POST',headers:{origin:site,authorization:'Bearer '+key,'content-type':'application/json',...extra},body:JSON.stringify(body)});
}
function result(output=[msg],rest={}) {
  return Response.json({status:'completed',output,usage:{input_tokens:100,output_tokens:80,total_tokens:180},...rest});
}
const noUpstream=()=>assert.fail('Unexpected upstream call');

test('BYOK uses one user credential, the fixed official Responses route, strict schema and explicit usage',async()=>{
  let calls=0;
  const res=await handleAIRequest(request(),{OPENAI_API_KEY:'unused-operator-key'},async(url,opts)=>{
    calls++;
    assert.equal(url,'https://api.openai.com/v1/responses');
    assert.equal(opts.headers.Authorization,'Bearer '+key);
    assert.equal(opts.redirect,'error');
    const body=JSON.parse(opts.body);
    assert.equal(body.model,'gpt-6-luna');
    assert.equal(body.store,false);
    assert.equal(body.max_output_tokens,1200);
    assert.deepEqual(body.reasoning,{effort:'none'});
    assert.equal(body.text.format.type,'json_schema');
    assert.equal(body.text.format.strict,true);
    assert.equal(body.text.format.schema.additionalProperties,false);
    assert.equal(body.text.format.schema.properties.action.enum[0],input.action);
    assert.deepEqual(body.text.format.schema.properties.design.anyOf[1],{type:'null'});
    assert.deepEqual(JSON.parse(body.input),{prompt:input.prompt,action:input.action,context:input.context});
    assert.ok(!opts.body.includes(key)&&!opts.body.includes('unused-operator-key'));
    return result();
  });
  assert.equal(res.status,200);assert.equal(calls,1);assert.equal(res.headers.get('cache-control'),'no-store');
  const text=await res.text();assert.ok(!text.includes(key));assert.ok(!text.includes(input.prompt));
  assert.deepEqual(JSON.parse(text),{proposal:draft,provider:'openai',model:'gpt-6-luna',usage:{input_tokens:100,output_tokens:80,total_tokens:180}});
});

test('privacy boundary refuses foreign origins, absent keys, other models, raw geometry and unknown actions before calling any provider',async()=>{
  for(const [req,status] of [
    [request(input,{origin:'https://other.example'}),403],[request(input,{origin:'null'}),403],
    [request(input,{origin:''}),403],[request(input,{authorization:''}),401],
    [request(input,{'content-type':'text/plain'}),415],[request({...input,model:'arbitrary'}),400],
    [request({...input,action:'execute_command'}),400],[request({...input,apiKey:key}),400],
    [request({...input,endpoint:'https://elsewhere.invalid'}),400],
    [request({...input,context:{design:{...DEFAULT,positions:[1,2,3]}}}),400],
    [request({...input,context:{file:'sensitive.stl'}}),400],
    [request({...input,action:'propose_inverse'}),400],
    [request({...input,context:{...input.context,objective:{mass_kg:1,drop_m:.2,stroke_mm:5,max_force_n:400,size_mm:36,height_mm:30,soft_contact:false}}}),400],
    [request({...input,prompt:'Please use '+key}),400],
    [request({...input,prompt:'é'.repeat(4097)}),413],
    [request({...input,prompt:'x'.repeat(33000)}),413],
  ]) {
    const res=await handleAIRequest(req,{OPENAI_API_KEY:key},noUpstream);
    assert.equal(res.status,status);
    assert.ok(!(await res.text()).includes(key));
  }
  const health=await handleAIRequest(request({}, {authorization:''},'/api/ai/health'),{},noUpstream);
  assert.equal(health.status,200);assert.deepEqual((await health.json()).models,['gpt-6-luna']);
  const original=request();
  const repeated=new Request(original,{body:JSON.stringify(input).replace('"prompt":','"prompt":"first value","prompt":')});
  assert.equal((await handleAIRequest(repeated,{},noUpstream)).status,400);
});

test('rejects incomplete, forbidden-action, malformed and oversized responses and redacts provider messages',async()=>{
  const badDraft={...draft,execute:'never'};
  const wrongObjective={version:1,action:'propose_inverse',objective:{mass_kg:1,drop_m:0.1,stroke_mm:6,max_force_n:200,size_mm:36,height_mm:30,soft_contact:false}};
  const textItem=text=>({...msg,content:[{type:'output_text',text}]});
  const replies=[
    result([textItem(JSON.stringify(badDraft))]),result([textItem(JSON.stringify(wrongObjective))]),
    result([textItem(JSON.stringify(draft).replace('"version":1','"version":1,"version":1'))]),
    result([textItem(key)]),result([msg,{type:'function_call',name:'send'}]),result([msg,msg]),result([{type:'reasoning'}]),
    result([{...msg,content:{0:msg.content[0],length:1}}]),
    new Response(JSON.stringify({status:'completed',output:[msg]}).replace('"output":','"output":[],"output":')),
    result([msg],{status:'incomplete'}),new Response(key,{status:401}),
    new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(70_000));c.enqueue(new Uint8Array(70_000));c.close();}})),
  ];
  for(const reply of replies) {
    const expected=reply.status===401?401:502;
    const res=await handleAIRequest(request(),{},async()=>reply);
    assert.equal(res.status,expected);assert.ok(!(await res.text()).includes(key));
  }
  let calls=0;
  const rejected=await handleAIRequest(request(),{},async()=>{calls++;throw Error(key);});
  assert.equal(calls,1);assert.ok(!(await rejected.text()).includes(key));
});

test('a strict model can request clarification without producing an applicable proposal',async()=>{
  const clarification=JSON.stringify({version:1,action:input.action,design:null});
  const message={...msg,content:[{type:'output_text',text:clarification}]};
  const response=await handleAIRequest(request(),{},async()=>result([message]));
  assert.equal(response.status,422);
  assert.deepEqual(Object.keys(await response.json()),['error']);
  assert.equal((await handleAIRequest(request(),{},async()=>result([message,msg]))).status,502);
});

test('provider timeout aborts the outstanding fetch without a retry',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let started;const entering=new Promise(resolve=>{started=resolve;});let calls=0;
  const pending=handleAIRequest(request(),{},async(url,{signal})=>{
    calls++;started();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error(key)),{once:true}));
  });
  await entering;t.mock.timers.tick(45000);
  const response=await pending;assert.equal(calls,1);assert.equal(response.status,504);
  assert.ok(!(await response.text()).includes(key));
});

test('the overall deadline cancels an incomplete upload and frees the concurrency slot',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let cancelled=false;
  const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"prompt":'));},cancel(){cancelled=true;}});
  const slow=new Request(site+'/api/ai/propose',{method:'POST',headers:{origin:site,authorization:'Bearer '+key,'content-type':'application/json'},body:stream,duplex:'half'});
  const pending=handleAIRequest(slow,{},noUpstream);
  t.mock.timers.tick(45000);
  assert.equal((await pending).status,504);assert.ok(cancelled);
  const next=await handleAIRequest(request(),{},async()=>result());assert.equal(next.status,200);
});
