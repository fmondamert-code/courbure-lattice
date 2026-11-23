// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import {DEFAULT} from '../web/core.mjs';
import {estimateLoadingStop} from '../web/inverse.mjs';
import {runDropTest} from '../web/drop.mjs';

await RAPIER.init();
const G=9.80665,spec={...DEFAULT,family:'bcc'},layers=[.25,.28,.31];
const objective={mass_kg:.5,drop_m:.1,stroke_mm:20,max_force_n:160,size_mm:36,height_mm:30,soft_contact:false};
const input={spec,layerFractions:layers,objective};
const k=10000; // N/m
function linearCSV(maxStrain=.8){
  const modulus=k/1000*30/(36*36);
  return 'relative_density,strain,stress_mpa\n'+[.2,.4].flatMap(r=>[r+',0,0',r+','+maxStrain+','+modulus*maxStrain]).join('\n');
}
function close(observed,expected,tolerance){
  assert.ok(Number.isFinite(observed) && Math.abs(observed-expected)<=tolerance*Math.abs(expected),
    'expected '+expected+' ± '+(100*tolerance)+'%, got '+observed);
}

test('actual Rapier transient matches the gravity-loaded linear oscillator through first separation',async()=>{
  const result=await runDropTest(RAPIER,{...input,materialCSV:linearCSV()});
  const w=Math.sqrt(k/objective.mass_kg),v=Math.sqrt(2*G*objective.drop_m),xeq=G/w**2;
  const tPeak=(Math.PI/2+Math.atan(xeq*w/v))/w,xPeak=xeq+Math.hypot(xeq,v/w);
  assert.equal(result.status,'rebounded');assert.equal(result.within_force_limit,true);
  close(result.impact_time_s,v/G,1e-10);close(result.impact_speed_m_s,v,1e-10);
  close(result.peak_stroke_mm,xPeak*1000,.002);close(result.peak_force_n,xPeak*k,.002);
  close(result.peak_time_s-result.impact_time_s,tPeak,.002);close(result.contact_duration_s,2*tPeak,.002);
  close(result.rebound_speed_m_s,v,.002);
  assert.ok(result.energy_error_fraction<.002);assert.ok(result.convergence_fraction<.002);
  assert.ok(result.samples.some(p=>p.stroke_mm>0 && p.velocity_m_s>0));
  assert.ok(result.samples.at(-1).height_mm>99);
  assert.ok(result.samples.every((p,i,rows)=>Number.isFinite(p.velocity_m_s) && p.force_n>=0 && (!i||p.time_s>rows[i-1].time_s)));
  assert.ok(result.samples.length<=420 && result.integration_steps<=96000);
});

test('nonlinear layer law agrees with an independent loading-work turning point and detects force exceedance',async()=>{
  const goal={...objective,max_force_n:1},expected=estimateLoadingStop(layers,goal);
  assert.equal(expected.status,'model_stops_within_stroke');
  const result=await runDropTest(RAPIER,{...input,objective:goal});
  assert.equal(result.status,'rebounded');assert.equal(result.within_force_limit,false);
  close(result.peak_force_n,expected.contact_force_n,.004);close(result.peak_stroke_mm,expected.stop_mm,.004);
});

test('stroke exhaustion and a shorter imported curve terminate separately, before any unsupported rebound',async()=>{
  for(const [goal,materialCSV,limit,status] of [[{...objective,stroke_mm:4},linearCSV(),4,'stroke_limit'],[objective,linearCSV(.2),6,'material_limit']]){
    const result=await runDropTest(RAPIER,{...input,objective:goal,materialCSV});
    assert.equal(result.status,status);assert.equal(result.within_force_limit,null);assert.equal(result.rebound_speed_m_s,null);
    close(result.peak_stroke_mm,limit,1e-8);assert.ok(result.samples.every(p=>p.stroke_mm<=limit+1e-8));
  }
});

test('the guided model refuses out-of-domain inputs and withholds a result when the timestep fails its checks',async()=>{
  for(const patch of [{spec:{...spec,envelope:'curved'}},{spec:{...spec,skin_mm:1}},{spec:DEFAULT},{spec:{...spec,size_mm:37}},
    {layerFractions:[.2,NaN,.3]},{layerFractions:[.2,-1,.3]},{layerFractions:[.25,.28,1]},{layerFractions:[]},
    {objective:{...objective,mass_kg:Infinity}},{objective:{...objective,drop_m:0}},{step_s:0},{step_s:1},
    {materialCSV:'unvalidated'},{layerFractions:[.1,.2,.3],materialCSV:linearCSV()},{extra:true}])
    await assert.rejects(runDropTest(RAPIER,{...input,...patch}));
  const stiff='relative_density,strain,stress_mpa\n0.2,0,0\n0.2,0.8,1000\n0.4,0,0\n0.4,0.8,1000';
  const unresolved=await runDropTest(RAPIER,{...input,objective:{...objective,mass_kg:.01},step_s:.0002,materialCSV:stiff});
  assert.equal(unresolved.status,'numerical_limit');assert.equal(unresolved.within_force_limit,null);
});
