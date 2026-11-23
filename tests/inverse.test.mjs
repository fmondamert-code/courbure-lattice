import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseMaterialCSV,MATERIAL_CSV_HEADER} from '../web/material.mjs';
import {estimateLoadingStop, evaluateCandidate, evaluateMeasuredCandidate, evaluateMeasuredLayers, optimizeDesign, validateObjective} from '../web/inverse.mjs';

const objective = Object.freeze({mass_kg:0.5, drop_m:0.5, stroke_mm:15, max_force_n:450, size_mm:36, height_mm:30, soft_contact:true});
const near = (actual, expected, tolerance=1e-6) => assert.ok(Math.abs(actual-expected)<=tolerance, actual+' differs from '+expected);

test('ideal work gate rejects impossible targets before training', async()=>{
  const result=await optimizeDesign({...objective,max_force_n:150});
  near(result.required_work_j,2.525212375);
  assert.equal(result.selected,null);
  assert.equal(result.training_count,0);
  assert.equal(result.feasible,false);
  assert.match(result.reason,/force ceiling/i);
});

test('uniform small-strain fixture agrees with an analytic linear spring',()=>{
  const rho=0.30, stroke=1, goal={...objective,stroke_mm:stroke};
  const result=evaluateCandidate(rho,0,goal);
  const k=24*rho*rho*goal.size_mm**2/goal.height_mm;
  near(result.peak_force_n,k*stroke,0.00005);
  near(result.work_j,k*stroke*stroke/2000);
});

test('series layers preserve orientation symmetry for loading work and distinguish top softness',()=>{
  const positive=evaluateCandidate(0.3,0.4,objective), negative=evaluateCandidate(0.3,-0.4,objective);
  near(positive.work_j,negative.work_j);
  near(positive.peak_force_n,negative.peak_force_n);
  assert.ok(negative.top_layer_modulus_mpa<positive.top_layer_modulus_mpa);
  assert.ok(negative.score<positive.score);
  assert.ok(negative.work_j<=negative.peak_force_n*0.015);
  const shorter=evaluateCandidate(0.3,-0.4,{...objective,stroke_mm:10});
  assert.ok(negative.work_j>shorter.work_j);
  assert.ok(negative.peak_force_n>=shorter.peak_force_n);
});

test('48 unique evaluations, reproducible adaptive selection, exact final check and uniform baseline',async()=>{
  const progress=[];
  const result=await optimizeDesign(objective,{onProgress:p=>progress.push(p.training_count)});
  assert.equal(result.evidence,'synthetic_model');
  assert.equal(result.backend,'CPU');
  assert.equal(result.training_count,48);
  assert.equal(result.trace.length,48);
  assert.equal(new Set(result.trace.map(row=>[row.rho,row.gradient].join(','))).size,48);
  assert.equal(progress.at(-1),48);
  assert.ok(result.feasible);
  assert.deepEqual(result.selected,evaluateCandidate(result.selected.rho,result.selected.gradient,objective));
  assert.deepEqual(result.baseline,evaluateCandidate(result.selected.rho,0,objective));
  assert.ok(result.selected.work_j>=result.selected.required_work_j);
  assert.ok(result.selected.peak_force_n<=objective.max_force_n);
  assert.ok(result.selected.top_layer_modulus_mpa<result.baseline.top_layer_modulus_mpa);
  assert.ok(result.selected.score<result.baseline.score);
  const replay=await optimizeDesign(objective,{seed:result.seed});
  assert.deepEqual(result.trace,replay.trace);
  const heavy=await optimizeDesign({...objective,mass_kg:1,max_force_n:500});
  assert.ok(heavy.selected.rho>result.selected.rho);
  assert.notDeepEqual(result.trace.slice(15).map(c=>[c.rho,c.gradient]),heavy.trace.slice(15).map(c=>[c.rho,c.gradient]));
});

test('sampled infeasibility reports a closest point and never promotes it to winner',async()=>{
  const result=await optimizeDesign({...objective,max_force_n:170});
  assert.equal(result.training_count,48);
  assert.equal(result.feasible,false);
  assert.equal(result.selected,null);
  assert.ok(result.closest.violation>0);
});

test('measured equal-height slices use their actual fractions and retain face order',()=>{
  const uniform=evaluateCandidate(0.3,0,objective);
  const same=evaluateMeasuredLayers([0.3,0.3,0.3],objective);
  near(same.work_j,uniform.work_j);
  near(same.peak_force_n,uniform.peak_force_n);
  const linear=evaluateCandidate(0.3,-0.3,objective);
  const recovered=evaluateMeasuredLayers([0.36,0.3,0.24],objective);
  near(recovered.work_j,linear.work_j);
  near(recovered.peak_force_n,linear.peak_force_n);
  const nonlinear=evaluateMeasuredLayers([0.42,0.19,0.29],objective);
  near(nonlinear.mean_fraction,0.3);
  assert.equal(nonlinear.gradient,null);
  assert.ok(Math.abs(nonlinear.work_j-uniform.work_j)>0.1);
  const reversed=evaluateMeasuredLayers([0.29,0.19,0.42],objective);
  near(reversed.work_j,nonlinear.work_j);
  assert.ok(reversed.top_layer_modulus_mpa>nonlinear.top_layer_modulus_mpa);
  for(const values of [null,[0.2,0.2],[0.2,0,0.3],[0.2,1,0.3],[0.2,NaN,0.3]]) assert.throws(()=>evaluateMeasuredLayers(values,objective));
});

test('invalid objectives, candidate inputs and seed are rejected by the boundary',async()=>{
  for(const delta of [{stroke_mm:24.1},{mass_kg:NaN},{size_mm:'36'},{height_mm:Infinity},{soft_contact:0},{extra:'ignore'}]) {
    assert.throws(()=>validateObjective({...objective,...delta}));
  }
  for(const [rho,gradient] of [[NaN,0],[0.15,0],[0.56,0],[0.3,0.7],[0.3,Infinity]]) {
    assert.throws(()=>evaluateCandidate(rho,gradient,objective));
  }
  assert.equal(evaluateMeasuredCandidate(.159,0,objective).in_search_domain,false);
  assert.throws(()=>evaluateMeasuredCandidate(.99,.6,objective));
  await assert.rejects(optimizeDesign(objective,{seed:NaN}));
});

test('missing compute support falls back to CPU with exact results',async()=>{
  const result=await optimizeDesign(objective,{device:{}});
  assert.equal(result.backend,'CPU');
  assert.match(result.backend_note,/WebGPU setup failed/);
  assert.deepEqual(result.selected,evaluateCandidate(result.selected.rho,result.selected.gradient,objective));
});

test('curve-backed search is replayable, uses imported labels, and exports provenance without raw rows',async()=>{
  const material=await parseMaterialCSV(await readFile(new URL('../web/examples/synthetic-compression-curves.csv',import.meta.url),'utf8'));
  const result=await optimizeDesign(objective,{material,device:{}});
  assert.equal(result.backend,'CPU');
  assert.match(result.backend_note,/WebGPU setup failed/);
  assert.equal(result.evidence,'synthetic_curve_fixture');
  assert.equal(result.training_count,48);
  assert.equal(result.material.sha256,material.sha256);
  assert.equal(result.model_hash_sha256,material.model_hash_sha256);
  assert.equal(result.material.curves,undefined);
  assert.deepEqual(result.selected,evaluateCandidate(result.selected.rho,result.selected.gradient,objective,material));
  assert.deepEqual(result.trace,(await optimizeDesign(objective,{material,seed:result.seed})).trace);
  const synthetic=evaluateCandidate(result.selected.rho,result.selected.gradient,objective);
  assert.notEqual(result.selected.work_j,synthetic.work_j);
  const rho=result.selected.rho, g=result.selected.gradient;
  const layers=evaluateMeasuredLayers([rho*(1-2*g/3),rho,rho*(1+2*g/3)],objective,material);
  near(layers.work_j,result.selected.work_j);
  assert.throws(()=>evaluateMeasuredLayers([.05,.22,.25],objective,material),/outside/);
});

test('unsupported empirical range, single-candidate support and cancellation have explicit outcomes',async()=>{
  const shallow=await parseMaterialCSV(MATERIAL_CSV_HEADER+'\n.2,0,0\n.2,.05,1\n.4,0,0\n.4,.05,2');
  const empty=await optimizeDesign(objective,{material:shallow});
  assert.equal(empty.selected,null);assert.equal(empty.training_count,0);assert.match(empty.reason,/imported curves/);
  const narrow=await parseMaterialCSV(MATERIAL_CSV_HEADER+'\n.55,0,0\n.55,.7,.5\n.7,0,0\n.7,.7,.6');
  const one=await optimizeDesign(objective,{material:narrow});
  assert.equal(one.eligible_candidate_count,1);assert.equal(one.training_count,1);
  const controller=new AbortController();
  await assert.rejects(optimizeDesign(objective,{signal:controller.signal,onProgress:()=>controller.abort()}),{name:'AbortError'});
});

test('one-dimensional loading-work stop reproduces a linear spring and reports insufficient stroke',async()=>{
  const m=await parseMaterialCSV(MATERIAL_CSV_HEADER+'\n.2,0,0\n.2,.8,1.6\n.4,0,0\n.4,.8,3.2');
  const goal={...objective,size_mm:10,height_mm:10,stroke_mm:6,mass_kg:.1,drop_m:.1};
  const k=20,mg=goal.mass_kg*9.80665;
  const x=(mg+Math.sqrt(mg**2+2*k*mg*goal.drop_m*1000))/k;
  const result=estimateLoadingStop([.2,.2,.2],goal,m);
  assert.equal(result.status,'model_stops_within_stroke');near(result.stop_mm,x);
  near(result.contact_force_n,k*x);near(result.contact_work_j,mg*(goal.drop_m+x/1000));
  assert.equal(estimateLoadingStop([.2,.2,.2],{...goal,stroke_mm:2},m).status,'insufficient_work_within_stroke');
  assert.equal(estimateLoadingStop([.2,.2,.2],{...goal,drop_m:0},m).status,'no_free_fall');
});
