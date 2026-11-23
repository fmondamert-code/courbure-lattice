import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {MATERIAL_CSV_HEADER as H,parseMaterialCSV,materialSummary,exportMaterialCSV,materialResponse,gpuMaterialTable,packMaterialGpu} from '../web/material.mjs';

const make=rows=>H+'\n'+rows.join('\n')+'\n';
const linear=make(['0.2,0,0','0.2,0.8,1.6','0.4,0,0','0.4,0.8,3.2','0.6,0,0','0.6,0.8,6.4']);
const goal=(strain)=>({size_mm:10,height_mm:10,stroke_mm:10*strain});
function near(a,b){assert.ok(Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(b)),a+' != '+b);}

test('strict local import, byte hash, metadata, replay and fixture attribution',async()=>{
  const original='\uFEFF'+linear.replaceAll('\n','\r\n');
  const m=await parseMaterialCSV(original);
  assert.deepEqual(m.densities,[.2,.4,.6]);
  assert.equal(m.record_count,6);
  assert.equal(m.sha256,createHash('sha256').update(original).digest('hex'));
  assert.equal(m.provenance,'user_supplied');
  assert.equal(m.density_min,.2);
  assert.equal(m.density_max,.6);
  near(m.max_common_strain,.2);
  assert.equal(exportMaterialCSV(m),original);
  assert.equal('curves' in materialSummary(m),false);
  assert.throws(()=>{m.curves[0].stress_mpa[0]=3;});
  const fixture=await readFile(new URL('../web/examples/synthetic-compression-curves.csv',import.meta.url),'utf8');
  assert.equal((await parseMaterialCSV(fixture)).provenance,'synthetic_example');
  assert.equal((await parseMaterialCSV(fixture.split('\n').slice(1).join('\n'))).provenance,'synthetic_example');
});

test('density interpolation and layers in series follow analytical elastic compliance',async()=>{
  const m=await parseMaterialCSV(linear);
  const effective=3/(1/2+1/4+1/8), strain=.1;
  const [w,f,top]=materialResponse([.2,.4,.6],goal(strain),m);
  near(f,100*effective*strain);
  near(w,0.5*effective*strain**2);
  near(top,8);
  const between=materialResponse([.3,.3,.3],goal(strain),m);
  near(between[1],100*strain/(.5/2+.5/4));
  near(between[2],1/(.5/2+.5/4));
  const backwards=materialResponse([.6,.4,.2],goal(strain),m);
  near(backwards[0],w);
  near(backwards[2],2);
});

test('horizontal stress plateaus accumulate work exactly and support zero-pressure seating',async()=>{
  const rows=[];
  for(const r of [.2,.4]) for(const [e,p] of [[0,0],[.1,.2],[.4,.2],[.7,.8]]) rows.push([r,e,p].join(','));
  const m=await parseMaterialCSV(make(rows));
  const on=materialResponse([.2,.3,.4],goal(.25),m);
  near(on[1],20); near(on[0],.04);
  const above=materialResponse([.2,.3,.4],goal(.55),m);
  near(above[1],50); near(above[0],.1225);
  const zero=await parseMaterialCSV(make(['.2,0,0','.2,.1,0','.2,.7,1','.4,0,0','.4,.1,0','.4,.7,1']));
  assert.deepEqual(materialResponse([.2,.3,.4],goal(.05),zero),[0,0,0]);
});

test('rejects malformed or ambiguous measurements before interpolating',async()=>{
  for(const [data,pattern] of [
    [linear.replace(H,'rho,strain,stress'),/header/i],
    [make(['.2,0,0','.2,.3,.1']),/two distinct/],
    [make(['.2,0.1,0','.4,0,0']),/start at zero/],
    [make(['.2,0,0','.2,.1,.2','.2,.1,.3']),/repeats/],
    [make(['.2,0,0','.2,.1,.2','.2,.2,.1']),/softening/],
    [make(['.2,0,0','.2,.1,NaN']),/decimal/],
    [make(['20,0,0']),/outside/],
    [make(['.2,0,0,0']),/three decimal/],
    ['x'.repeat(262145),/256 KiB/]
  ]) await assert.rejects(parseMaterialCSV(data),pattern);
  const m=await parseMaterialCSV(linear);
  assert.throws(()=>materialResponse([.1,.3,.4],goal(.2),m),/outside/);
  assert.throws(()=>materialResponse([.2,.4,.6],goal(.7),m),/evidence/);
});

test('WebGPU lookup buffers preserve pressure knots, plateau energy and layer weights',async()=>{
  const m=await parseMaterialCSV(linear), states=gpuMaterialTable(m);
  const packed=packMaterialGpu([[.3,0]],goal(.1),m);
  assert.equal(packed[5],4);
  assert.equal(packed[0],2);
  near(packed[8],0);near(packed[9],.5);near(packed[10],1);near(packed[11],.5);
  assert.ok(Math.abs(states[4]-1.6)<1e-6);
  const state=4*(4+1);
  assert.ok(Math.abs(states[state]-.8)<1e-6);
  assert.ok(Math.abs(states[state+2]-.64)<1e-6);
});
