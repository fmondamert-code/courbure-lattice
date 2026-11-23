import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT} from '../web/core.mjs';
import {createBrowserAI} from '../web/browser-ai.mjs';
import {generateProposal, modelAssets, modelAssetFetch} from '../web/browser-ai-worker.mjs';
import {modelReplySchema} from '../web/ai-gate.mjs';

const action = 'propose_geometry';
const input = {action, prompt:'Make the cell pitch 16 mm.', context:{design:DEFAULT}};
const draft = {version:1, action, design:{...DEFAULT, cell_mm:16}};

// The stand-in exercises the worker protocol; it does not simulate GPU inference.
test('local controller loads explicitly, serializes operations and discards cancelled workers', async () => {
  const workers = [];
  const ai = createBrowserAI({workerFactory:() => {
    const worker = {messages:[], postMessage(call){this.messages.push(call);}, terminate(){this.closed=true;},
      reply(type, reply={}){this.onmessage({data:{id:this.messages.at(-1).id,type,...reply}});}};
    workers.push(worker); return worker;
  }});
  assert.equal(workers.length,0);
  await assert.rejects(ai.propose(input), /Load/);
  const loadController = new AbortController(), progress = [];
  const interrupted = ai.load({signal:loadController.signal, onProgress:t=>progress.push(t)});
  const first = workers[0];
  first.reply('progress',{text:'Loading weights'});
  await assert.rejects(ai.load(), /busy/);
  loadController.abort();
  await assert.rejects(interrupted, {name:'AbortError'});
  assert.deepEqual(progress,['Loading weights']);
  assert.equal(first.closed,true);
  const loaded = ai.load(); const second=workers[1];
  first.reply('done'); assert.equal(ai.ready,false);
  second.reply('done'); await loaded; assert.equal(ai.ready,true);
  await assert.rejects(ai.propose({...input, prompt:'Ω'.repeat(769)}), /1,536/);
  await assert.rejects(ai.propose({...input,context:{...input.context,csv:'ignore'}}), /parameters/);
  const completed = ai.propose({...input,rawMesh:[0,1,2]});
  assert.deepEqual(second.messages.at(-1).input, input);
  await assert.rejects(ai.propose(input), /busy/);
  second.reply('done',{result:draft}); assert.deepEqual(await completed,draft);
  const controller = new AbortController(); const cancelled=ai.propose(input,{signal:controller.signal});
  controller.abort(); await assert.rejects(cancelled, {name:'AbortError'});
  assert.equal(ai.ready,false); assert.equal(second.closed,true);
  const reloaded=ai.load({localAssets:true}); const third=workers[2];
  assert.equal(third.messages[0].localAssets,true);
  third.reply('done'); await reloaded;
  const failed=ai.propose(input); third.reply('error',{fatal:true,message:'Device lost.'});
  await assert.rejects(failed,/Device lost/); assert.equal(ai.ready,false);
});

test('asset access allows only immutable model GETs during load and strips caller-controlled data', async () => {
  for(const mirrored of [false,true]) {
    const assets=modelAssets(mirrored,'https://example.org'), requests=[];
    assert.equal(assets.files.size,12);
    if(mirrored) assert.ok([...assets.files.keys()].every(url=>new URL(url).origin==='https://example.org'));
    let loading=true;
    const fetchAsset=modelAssetFetch(assets,async(url,options)=>{requests.push({url,options});return new Response('test');},()=>loading);
    const file=assets.model+'params_shard_1.bin';
    await fetchAsset(file,{headers:{Authorization:'secret-test'},credentials:'include'});
    const sent=requests[0]; assert.equal(sent.url,file); assert.equal(sent.options.headers,undefined);
    assert.equal(sent.options.credentials,'omit'); assert.equal(sent.options.referrerPolicy,'no-referrer');
    assert.match(sent.options.integrity,/^sha256-/); assert.equal(sent.options.redirect,mirrored?'error':'follow');
    await assert.rejects(fetchAsset(file,{method:'POST',body:'any'}), /blocked/);
    await assert.rejects(fetchAsset(file+'?prompt=x'), /blocked/);
    await assert.rejects(fetchAsset('https://example.org/api/ai/propose'), /blocked/);
    loading=false; await assert.rejects(fetchAsset(file), /blocked/); assert.equal(requests.length,1);
  }
});

test('local generation requests constrained decoding and validates the raw model reply', async () => {
  let text=JSON.stringify(draft), finish='stop', request, resets=0;
  const engine={chat:{completions:{create:async value=>{
    request=value;return {choices:[{finish_reason:finish,message:{content:text}}]};
  }}},resetChat:async()=>{resets++;}};
  assert.deepEqual(await generateProposal(engine,input),draft); assert.equal(resets,1);
  assert.equal(request.response_format.type,'json_object');
  const grammar=JSON.parse(request.response_format.schema), contract=modelReplySchema(action);
  assert.deepEqual(grammar.required, contract.required);
  assert.equal(grammar.properties.design.anyOf[0].properties.gradient.type, 'number');
  assert.equal(grammar.properties.design.anyOf[0].properties.gradient.minimum, undefined);
  assert.ok(request.messages[0].content.includes(JSON.stringify(contract)));
  assert.ok(request.max_tokens<=320); assert.equal(JSON.parse(request.messages[1].content).instruction,input.prompt);
  text='{"version":1,"action":"propose_geometry","design":null}';
  await assert.rejects(generateProposal(engine,input), /clearer brief/);
  text=JSON.stringify(draft).replace('"version":1','"version":1,"version":1');
  await assert.rejects(generateProposal(engine,input), /Duplicate/);
  text=JSON.stringify({...draft,design:{...draft.design,cell_mm:900}});
  await assert.rejects(generateProposal(engine,input));
  text=JSON.stringify(draft);finish='length';await assert.rejects(generateProposal(engine,input), /did not finish/);
});
