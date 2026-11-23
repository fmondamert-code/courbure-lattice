// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
// A dimensioned but uncalibrated flat-coupon model. All material constants are illustrative.
import {CURVE_MODEL_ID,MaterialDomainError,curveSupportsStroke,gpuMaterialTable,packMaterialGpu,MATERIAL_WGSL,materialModulusScale,materialResponse,materialSummary} from './material.mjs';
const GRAVITY = 9.80665;
const STRAIN_LIMIT = 0.92;
const FIXED_MODEL = 'Synthetic three-layer compression coupon, version 1';
const EVIDENCE = 'synthetic_model';
const BOUNDS = {
  mass_kg: [0.01, 25], drop_m: [0, 5], stroke_mm: [0.5, 100],
  max_force_n: [1, 250000], size_mm: [10, 200], height_mm: [5, 120],
};
export const INVERSE_MODEL = FIXED_MODEL;

export function validateObjective(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Expected a mechanical objective.');
  const allowed = [...Object.keys(BOUNDS), 'soft_contact'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw Error('Unknown objective field.');
  const result = {};
  for (const [key, [low, high]] of Object.entries(BOUNDS)) {
    const value = input[key];
    if (!Number.isFinite(value) || value < low || value > high) throw Error(key + ' must be between ' + low + ' and ' + high + '.');
    result[key] = value;
  }
  if (typeof input.soft_contact !== 'boolean') throw Error('soft_contact must be a boolean.');
  if (result.stroke_mm > result.height_mm * 0.8) throw Error('Stroke must be at most 80% of the model coupon height.');
  result.soft_contact = input.soft_contact;
  return result;
}

function validateCandidate(rho, gradient) {
  if (!Number.isFinite(rho) || rho < 0.16 || rho > 0.55) throw Error('Density fraction must be between 0.16 and 0.55.');
  validateLayers(rho, gradient);
}

function validateLayers(rho, gradient) {
  if (!Number.isFinite(gradient) || Math.abs(gradient) > 0.6) throw Error('Gradient must be between -0.6 and 0.6.');
  const layers = [rho * (1 - 2 * gradient / 3), rho, rho * (1 + 2 * gradient / 3)];
  if (layers.some(value => !Number.isFinite(value) || value <= 0 || value >= 1)) throw Error('Each layer must have a solid fraction strictly between zero and one.');
}

function layer(fraction) {
  const modulus = 24 * fraction * fraction; // MPa
  const yieldStrain = 0.08, denseStrain = 0.84 - 0.70 * fraction;
  const initialStress = modulus * yieldStrain, plateauSlope = 0.08 * modulus;
  const denseStress = initialStress + plateauSlope * (denseStrain - yieldStrain);
  return {modulus, yieldStrain, denseStrain, initialStress, plateauSlope, denseStress};
}

function layerStrain(p, l) {
  if (p < l.initialStress) return p / l.modulus;
  if (p < l.denseStress) return l.yieldStrain + (p - l.initialStress) / l.plateauSlope;
  return Math.min(STRAIN_LIMIT, l.denseStrain + (p - l.denseStress) / (4 * l.modulus));
}

function layerWork(p, l) {
  const strain = layerStrain(p, l);
  const e0 = Math.min(strain, l.yieldStrain);
  const e1 = Math.max(0, Math.min(strain, l.denseStrain) - l.yieldStrain);
  const e2 = Math.max(0, strain - l.denseStrain);
  return 0.5 * l.modulus * e0 * e0 + l.initialStress * e1 + 0.5 * l.plateauSlope * e1 * e1
       + l.denseStress * e2 + 2 * l.modulus * e2 * e2;
}

function nominalFractions(rho,gradient) {
  const top = rho * (1 + (2 / 3) * gradient), bottom = rho * (1 - (2 / 3) * gradient);
  return [bottom,rho,top];
}

function couponResponse(rho, gradient, objective, material) {
  const fractions=nominalFractions(rho,gradient);
  return material ? materialResponse(fractions,objective,material) : responseForLayers(fractions, objective);
}

export function responseForLayers(fractions, objective) {
  // Three layers have equal initial thickness and carry the same axial pressure.
  const layers = fractions.map(layer);
  if(objective.stroke_mm===0)return [0,0,layers[2].modulus];
  const target = objective.stroke_mm / objective.height_mm;
  let low = 0, high = 4 * Math.max(...layers.map(l => l.modulus));
  for (let i = 0; i < 34; i++) {
    const p = (low + high) / 2;
    const strain = layers.reduce((sum, l) => sum + layerStrain(p, l), 0) / 3;
    if (strain < target) low = p;
    else high = p;
  }
  const p = (low + high) / 2, area = objective.size_mm ** 2;
  const workDensity = layers.reduce((sum, l) => sum + layerWork(p, l), 0) / 3;
  return [workDensity * area * objective.height_mm / 1000, p * area, layers[2].modulus];
}

function candidateMetrics(rho, gradient, objective, [work, force, surfaceModulus], material) {
  const required = objective.mass_kg * GRAVITY * (objective.drop_m + objective.stroke_mm / 1000);
  const shortfall = Math.max(0, 1 - work / required), forceExcess = Math.max(0, force / objective.max_force_n - 1);
  const violation = shortfall + forceExcess;
  // Lower density wins among competitive candidates. Optional surface softness uses the top-layer initial modulus.
  const referenceModulus=material ? materialModulusScale(material) : 24 * 0.55 ** 2;
  const score = 12 * violation + (rho - 0.16) / 0.39 + (objective.soft_contact && referenceModulus>0 ? 0.65 * surfaceModulus / referenceModulus : 0);
  return {rho, gradient, work_j: work, required_work_j: required, peak_force_n: force,
    top_layer_modulus_mpa: surfaceModulus, score, violation,
    feasible: work >= required && force <= objective.max_force_n};
}

export function evaluateCandidate(rho, gradient, objective, material) {
  const validated = validateObjective(objective);
  validateCandidate(rho, gradient);
  return candidateMetrics(rho, gradient, validated, couponResponse(rho, gradient, validated, material),material);
}

// Recheck the mesh volume on either side of a search bound. This is still a coupon approximation.
export function evaluateMeasuredCandidate(rho, gradient, objective, material) {
  const validated = validateObjective(objective);
  if (!Number.isFinite(rho) || rho < 0.10 || rho > 0.70) throw Error('Mesh fraction is outside the model recheck range [0.10, 0.70].');
  validateLayers(rho, gradient);
  return {...candidateMetrics(rho, gradient, validated, couponResponse(rho, gradient, validated, material),material),
    density_source:'export_mesh_volume', in_search_domain:rho >= 0.16 && rho <= 0.55};
}

export function evaluateMeasuredLayers(fractions, objective, material) {
  const goal = validateObjective(objective);
  if (!Array.isArray(fractions) || fractions.length !== 3) throw Error('Provide bottom, middle and top layer fractions for three equal box slices.');
  const values = Array.from(fractions);
  if (values.some(r => !Number.isFinite(r) || r <= 0 || r >= 1 || r*r === 0)) throw Error('Each mesh layer must have a finite solid fraction strictly between zero and one.');
  const mean = values.reduce((sum, r) => sum + r, 0) / 3;
  const response=material ? materialResponse(values,goal,material) : responseForLayers(values,goal);
  return {...candidateMetrics(mean, null, goal, response,material),
    density_source:'export_mesh_layer_volumes', layer_fractions:values, mean_fraction:mean};
}

// First turning point of a guided 1D mass following this rate-independent loading curve.
// It treats the coupon's load curve as a contact law and predicts neither rebound nor a measured impact.
export function estimateLoadingStop(fractions,objective,material) {
  const goal=validateObjective(objective);
  const full=evaluateMeasuredLayers(fractions,goal,material);
  const base={method:'1D loading-work balance',stroke_limit_mm:goal.stroke_mm,
    incident_energy_j:goal.mass_kg*GRAVITY*goal.drop_m,stop_mm:null,contact_force_n:null};
  if(goal.drop_m===0) return {...base,status:'no_free_fall'};
  if(full.work_j<full.required_work_j) return {...base,status:'insufficient_work_within_stroke'};
  let low=0, high=goal.stroke_mm;
  const response=stroke=>{
    const atStroke={...goal,stroke_mm:stroke};
    return material ? materialResponse(fractions,atStroke,material) : responseForLayers(fractions,atStroke);
  };
  for(let i=0;i<42;i++) {
    const x=(low+high)/2;
    if(response(x)[0]>=goal.mass_kg*GRAVITY*(goal.drop_m+x/1000)) high=x;
    else low=x;
  }
  const stop=(low+high)/2, [work,force]=response(stop);
  return {...base,status:'model_stops_within_stroke',stop_mm:stop,contact_force_n:force,contact_work_j:work};
}

// Each invocation processes one candidate. The GPU and CPU operate in MPa, N, mm and J.
const WGSL = `
@group(0) @binding(0) var<storage, read> inputs: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> outputs: array<vec4<f32>>;
fn strain(p:f32, r:f32) -> f32 {
  let e = 24.0 * r * r;
  let d = 0.84 - 0.70 * r;
  let t0 = 0.08 * e;
  let t1 = t0 + 0.08 * e * (d - 0.08);
  if (p < t0) { return p / e; }
  if (p < t1) { return 0.08 + (p - t0) / (0.08 * e); }
  return min(0.92, d + (p - t1) / (4.0 * e));
}
fn work(p:f32, r:f32) -> f32 {
  let e = 24.0 * r * r;
  let d = 0.84 - 0.70 * r;
  let t0 = 0.08 * e;
  let t1 = t0 + 0.08 * e * (d - 0.08);
  let x = strain(p,r);
  let a = min(x,0.08);
  let b = max(0.0,min(x,d)-0.08);
  let c = max(0.0,x-d);
  return 0.5*e*a*a + t0*b + 0.04*e*b*b + t1*c + 2.0*e*c*c;
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= arrayLength(&outputs)) { return; }
  let a = inputs[2u*i];
  let h = inputs[2u*i+1u].x;
  let rho = a.x;
  let bottom = rho*(1.0-2.0*a.y/3.0);
  let top = rho*(1.0+2.0*a.y/3.0);
  var lo = 0.0;
  let maxRho = max(rho,max(bottom,top));
  var hi = 96.0*maxRho*maxRho;
  for (var j=0u; j<34u; j++) {
    let p = (lo+hi)*0.5;
    let x = (strain(p,bottom)+strain(p,rho)+strain(p,top))/3.0;
    if (x < a.z/h) { lo = p; } else { hi = p; }
  }
  let p = (lo+hi)*0.5;
  let w = (work(p,bottom)+work(p,rho)+work(p,top))/3.0;
  outputs[i] = vec4<f32>(w*a.w*a.w*h/1000.0,p*a.w*a.w,24.0*top*top,0.0);
}
`;

async function gpuRunner(device,material) {
  const shader = device.createShaderModule({code: material ? MATERIAL_WGSL : WGSL});
  const pipeline = await device.createComputePipelineAsync({layout:'auto',compute:{module:shader,entryPoint:'main'}});
  let tableBuffer;
  if(material) {
    const states=gpuMaterialTable(material);
    tableBuffer=device.createBuffer({size:states.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    try { device.queue.writeBuffer(tableBuffer,0,states); }
    catch(error) { tableBuffer.destroy(); throw error; }
  }
  async function run(points, objective) {
    const data = material ? packMaterialGpu(points,objective,material) : new Float32Array(points.length * 8);
    if(!material) points.forEach(([r, g], i) => data.set([r,g,objective.stroke_mm,objective.size_mm,objective.height_mm,0,0,0],i*8));
    const bytes = points.length * 16, saved = [];
    function buffer(size, usage) {
      const item = device.createBuffer({size, usage});
      saved.push(item);
      return item;
    }
    try {
      const source = buffer(data.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      const target = buffer(bytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
      const staging = buffer(bytes, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
      device.queue.writeBuffer(source, 0, data);
      const entries=[{binding:0,resource:{buffer:source}}, {binding:1,resource:{buffer:target}}];
      if(tableBuffer) entries.push({binding:2,resource:{buffer:tableBuffer}});
      const group = device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries});
      const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(points.length / 64));
      pass.end();
      encoder.copyBufferToBuffer(target,0,staging,0,bytes);
      device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const out = new Float32Array(staging.getMappedRange().slice(0));
      staging.unmap();
      return points.map((_,i) => [out[i*4],out[i*4+1],out[i*4+2]]);
    } finally {
      saved.forEach(item => item.destroy());
    }
  }
  run.dispose=()=>tableBuffer?.destroy();
  return run;
}

function shuffle(values, seed) {
  let state = seed >>> 0;
  for (let i=values.length-1;i>0;i--) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    const j = Math.floor((state / 4294967296) * (i+1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

function kernel(a, b) {
  const dr = (a[0] - b[0]) / 0.095, dg = (a[1] - b[1]) / 0.35;
  return Math.exp(-0.5 * (dr*dr + dg*dg));
}

// A Gaussian process with a fixed RBF kernel learns the numerical objective after each batch.
// log1p preserves score ordering and limits the influence of badly infeasible candidates.
function fitSurrogate(samples) {
  const points = samples.map(c => [c.rho,c.gradient]), y = samples.map(c => Math.log1p(c.score));
  const mean = y.reduce((a,b)=>a+b,0)/y.length;
  const scale = Math.max(0.025, Math.sqrt(y.reduce((a,b)=>a+(b-mean)**2,0)/y.length));
  const L = [];
  for (let i=0;i<points.length;i++) {
    const row = new Float64Array(i+1);
    for (let j=0;j<=i;j++) {
      let sum = kernel(points[i],points[j]) + (i===j ? 0.0001 : 0);
      for(let k=0;k<j;k++) sum -= row[k]*(i===j ? row[k] : L[j][k]);
      row[j] = i===j ? Math.sqrt(Math.max(sum,1e-12)) : sum/L[j][j];
    }
    L.push(row);
  }
  function solveLow(rhs) {
    const xs = new Float64Array(rhs.length);
    for(let i=0;i<xs.length;i++) {
      let v=rhs[i];
      for(let j=0;j<i;j++) v-=L[i][j]*xs[j];
      xs[i]=v/L[i][i];
    }
    return xs;
  }
  const alpha = solveLow(y.map(v=>(v-mean)/scale));
  for(let i=alpha.length-1;i>=0;i--) {
    for(let j=i+1;j<alpha.length;j++) alpha[i]-=L[j][i]*alpha[j];
    alpha[i]/=L[i][i];
  }
  return function predict(point) {
    const cov = points.map(p=>kernel(point,p)), projected = solveLow(cov);
    const value = mean + scale*cov.reduce((s,k,i)=>s+k*alpha[i],0);
    const sigma = scale*Math.sqrt(Math.max(0,1-projected.reduce((s,v)=>s+v*v,0)));
    return {value,sigma};
  };
}

function compare(a,b) {
  if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
  if (!a.feasible && a.violation !== b.violation) return a.violation - b.violation;
  return a.score - b.score;
}

let modelHashPromise;
function numericalModelHash() {
  if (!globalThis.crypto?.subtle) return Promise.resolve(null);
  if (!modelHashPromise) {
    const definition = [FIXED_MODEL, GRAVITY, STRAIN_LIMIT, layer, layerStrain, layerWork,
      nominalFractions, couponResponse, responseForLayers, candidateMetrics, WGSL].join('\n');
    modelHashPromise = crypto.subtle.digest('SHA-256', new TextEncoder().encode(definition))
      .then(hash => Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2,'0')).join(''));
  }
  return modelHashPromise;
}

export async function optimizeDesign(objective, {device, onProgress, seed = 713,material,signal} = {}) {
  const goal = validateObjective(objective);
  signal?.throwIfAborted();
  if (!Number.isInteger(seed)) throw Error('Seed must be an integer.');
  const required = goal.mass_kg * GRAVITY * (goal.drop_m + goal.stroke_mm/1000);
  const metadata=material ? materialSummary(material) : null;
  const evidence=material ? (metadata.provenance==='synthetic_example' ? 'synthetic_curve_fixture' : 'user_supplied_loading_curves') : EVIDENCE;
  const info = {objective:goal, model:material ? CURVE_MODEL_ID : FIXED_MODEL,
    model_hash_sha256:material ? material.model_hash_sha256 : await numericalModelHash(),
    material:metadata, method:'Gaussian-process-assisted bounded search', evidence, seed, required_work_j:required,
    selected:null,baseline:null,closest:null,trace:[],training_count:0,backend:'CPU',feasible:false,reason:null};
  if (goal.max_force_n * goal.stroke_mm/1000 < required) return {...info,reason:'The force ceiling times the available stroke is below the required contact work.'};
  const pool = [], initial = [], low=Math.max(0.16,metadata?.density_min??0.16), high=Math.min(0.55,metadata?.density_max??0.55);
  const levels=new Set();
  if(low<=high) {
    for(let i=0;i<=20;i++) levels.add(Math.max(low,Math.min(high,+(low+(high-low)*i/20).toFixed(9))));
    if(material) for(const r of metadata.densities) if(r>=low && r<=high) levels.add(r);
  }
  for(const rho of levels) for(let j=0;j<=12;j++) {
    const gradient=+(-0.6+0.1*j).toFixed(4);
    if(!material || curveSupportsStroke(nominalFractions(rho,gradient),goal.stroke_mm/goal.height_mm,material)) pool.push([rho,gradient]);
  }
  info.eligible_candidate_count=pool.length;
  if(!pool.length) return {...info,reason:'No bounded candidate has layer densities and a stroke covered by the imported curves.'};
  shuffle(pool,seed);
  if(material) {
    const sorted=[...pool].sort((a,b)=>a[0]-b[0] || a[1]-b[1]);
    const count=Math.min(15,sorted.length);
    for(let i=0;i<count;i++) initial.push(sorted[count===1 ? 0 : Math.round(i*(sorted.length-1)/(count-1))]);
  } else for (const r of [0.16,0.2575,0.355,0.4525,0.55]) for(const g of [-0.6,0,0.6]) initial.push([r,g]);
  const budget=Math.min(48,pool.length);
  const seen = new Set(), key = p=>p.join(','), trace = info.trace;
  let runGpu=null, backendNote=null, gpuVerified=false;
  if(device) {
    try { runGpu=await gpuRunner(device,material); }
    catch(e) { backendNote='WebGPU setup failed. ' + String(e?.message||e); }
  }
  async function measure(points) {
    signal?.throwIfAborted();
    let results;
    if(runGpu) {
      try {
        results=await runGpu(points,goal);
        if (results.some(row=>row.some(v=>!Number.isFinite(v)))) throw Error('Nonfinite GPU result.');
        if(!gpuVerified) {
          points.forEach(([r,g],i)=>{
            const reference=couponResponse(r,g,goal,material);
            if(reference.some((v,j)=>Math.abs(v-results[i][j])>0.0002*Math.max(Math.abs(v),0.01))) throw Error('Float32 parity check failed.');
          });
          gpuVerified=true;
        }
      } catch(e) {
        runGpu=null; gpuVerified=false; results=null;
        backendNote='WebGPU evaluation failed. ' + String(e?.message||e);
      }
    }
    const batch=points.map(([r,g],i)=>candidateMetrics(r,g,goal,results?.[i]||couponResponse(r,g,goal,material),material));
    points.forEach(p=>seen.add(key(p)));
    trace.push(...batch);
    onProgress?.({training_count:trace.length,total:budget,best_score:[...trace].sort(compare)[0].score});
    if(signal) { await new Promise(resolve=>setTimeout(resolve,0)); signal.throwIfAborted(); }
  }
  const disposeGpu=runGpu?.dispose;
  try {
    await measure(initial);
    while(trace.length<budget) {
      const predict=fitSurrogate(trace);
      const proposals=pool.filter(p=>!seen.has(key(p))).map(p=>({p,...predict(p)}));
      proposals.sort((a,b)=>(a.value-0.65*a.sigma)-(b.value-0.65*b.sigma));
      const next=[proposals[0].p];
      // Reserve one slot each round for an unexplored region of the numerical objective.
      if(trace.length+next.length<budget) {
        const explorer=proposals.slice(1).reduce((best,c)=>c.sigma>best.sigma?c:best);
        next.push(explorer.p);
      }
      await measure(next);
    }
  } finally { disposeGpu?.(); }
  // Re-evaluate with the double-precision direct model, including the winner and baseline.
  const checked=trace.map(c=>candidateMetrics(c.rho,c.gradient,goal,couponResponse(c.rho,c.gradient,goal,material),material)).sort(compare);
  const closest=checked[0], selected=closest.feasible ? closest : null;
  let baseline=null, baselineReason=null;
  try { baseline=evaluateCandidate(closest.rho,0,goal,material); }
  catch(e) { if(!(e instanceof MaterialDomainError)) throw e; baselineReason=e.message; }
  return {...info,selected,closest,baseline,baseline_reason:baselineReason,
    training_count:trace.length,backend:gpuVerified ? 'WebGPU':'CPU',backend_note:backendNote,
    feasible:!!selected,reason:selected ? null : 'No evaluated candidate satisfies both model constraints.'};
}
