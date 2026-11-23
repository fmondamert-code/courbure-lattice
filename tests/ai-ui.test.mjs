// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {setupAI} from '../web/ai-ui.mjs';
import {DEFAULT} from '../web/core.mjs';

test('disconnect wins over pending health checks and hosted requests keep only the selected context',async t=>{
  const elements=new Map();
  function element(id){
    if(!elements.has(id)){
      const handlers=new Map();
      elements.set(id,{value:'',addEventListener:(event,fn)=>handlers.set(event,fn),
        click:()=>handlers.get('click')?.(),close:()=>handlers.get('close')?.()});
    }
    return elements.get(id);
  }
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:element}});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
  const objective={mass_kg:0.5,drop_m:0.5,stroke_mm:15,max_force_n:450,size_mm:36,height_mm:30,soft_contact:true};
  const key='sk-thisIsOnlyATestFixture',requests=[];
  let resolveHealth,cancelled=false,now=10000;
  t.mock.method(Date,'now',()=>now);
  t.mock.method(globalThis,'fetch',async(path,opts)=>{
    requests.push({path,opts});
    if(requests.length===1)return new Promise(resolve=>{resolveHealth=resolve;});
    if(path==='/api/ai/health')return Response.json({provider:'openai'});
    return new Response(new ReadableStream({
      start(controller){controller.enqueue(new Uint8Array(100000));controller.enqueue(new Uint8Array(40000));},
      cancel(){cancelled=true;},
    }));
  });
  setupAI({getObjective:()=>objective,getDesignSpec:()=>DEFAULT,getEnvelope:()=>null,
    isBusy:()=>false,setBusy(){},onGeometry:()=>assert.fail('Unexpected automatic apply'),onObjective:()=>assert.fail('Unexpected automatic apply')});
  element('ai-provider').value='openai';
  element('ai-key').value=key;
  const pending=element('ai-save-connection').click();
  element('ai-disconnect').click();
  resolveHealth(Response.json({provider:'openai'}));
  await pending;
  assert.equal(element('ai-connection-status').textContent,'No AI connected');
  assert.equal(element('ai-key').value,'');
  element('ai-key').value=key;
  await element('ai-save-connection').click();
  assert.equal(Object.hasOwn(requests.at(-1).opts,'headers'),false);
  element('ai-prompt').value='Test instruction';
  for(const [action,record] of [['propose_geometry','design'],['propose_inverse','objective']]){
    now+=3000;cancelled=false;element('ai-action').value=action;
    await element('ai-propose').click();
    const {path,opts}=requests.at(-1);
    assert.equal(path,'/api/ai/propose');assert.equal(opts.headers.Authorization,'Bearer '+key);
    assert.ok(!opts.body.includes(key));
    assert.deepEqual(Object.keys(JSON.parse(opts.body).context),[record]);
    assert.ok(cancelled);assert.match(element('ai-progress').textContent,/exceeded its limit/);
    assert.ok(element('ai-proposal').hidden);
  }
  for(const {opts} of requests){
    assert.equal(opts.mode,'same-origin');assert.equal(opts.redirect,'error');assert.equal(opts.referrerPolicy,'strict-origin');
  }
});
