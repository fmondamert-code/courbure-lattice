// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
// Local-only monotone loading curves. Relative density and strain are fractions, stress is in MPa.
export const MATERIAL_CSV_HEADER = 'relative_density,strain,stress_mpa';
export const MATERIAL_CSV_MAX_BYTES = 262144;
export const CURVE_MODEL_ID = 'piecewise-linear common-pressure compliance interpolation / v1';
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const DEMO_MARK = '# provenance=synthetic_example';
const DEMO_TABLE_HASH = '62488499ce008cf8072cd786220ca5a7d6e2bb5d8c156498efc8a22f3f4bf27a';
const parsedTables = new WeakMap();

export class MaterialDomainError extends RangeError {}
function table(material) {
  const data = parsedTables.get(material);
  if (!data) throw Error('Select a compression CSV parsed locally in this session.');
  return data;
}

async function sha256Hex(bytes) {
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
}

export async function parseMaterialCSV(text) {
  if (typeof text !== 'string' || text.length > MATERIAL_CSV_MAX_BYTES) throw Error('Compression CSV must be text of at most 256 KiB.');
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MATERIAL_CSV_MAX_BYTES) throw Error('Compression CSV exceeds 256 KiB.');
  const lines = text.replace(/^\uFEFF/,'').split(/\r\n|\n|\r/);
  let first = 0, synthetic = false;
  if (lines[0].trim() === DEMO_MARK) { synthetic = true; first++; }
  if (lines[first]?.trim() !== MATERIAL_CSV_HEADER) throw Error('Expected CSV header ' + MATERIAL_CSV_HEADER + '. Use density and strain fractions, and stress in MPa.');
  const grouped = new Map();
  let count = 0;
  for (let i = first + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = line.split(',').map(cell => cell.trim());
    if (cells.length !== 3 || cells.some(cell => !DECIMAL.test(cell))) throw Error('Row ' + (i+1) + ' must contain three decimal numbers.');
    const [density, strain, stress] = cells.map(Number);
    if (!(density > 0 && density <= 1 && strain >= 0 && strain < 1 && stress >= 0 && stress <= 10000)) throw Error('Row ' + (i+1) + ' lies outside density (0,1], strain [0,1), or stress [0,10000] MPa.');
    if (!grouped.has(density)) grouped.set(density,{density,strains:[],stresses:[],works:[]});
    const curve = grouped.get(density), j = curve.strains.length;
    if (++count > 8192 || grouped.size > 32 || j >= 2048) throw Error('Curve table exceeds 32 densities, 2048 samples per curve or 8192 total rows.');
    if (j === 0 && (strain !== 0 || stress !== 0)) throw Error('Each density curve must start at zero strain and zero stress.');
    if (j && strain <= curve.strains[j-1]) throw Error('Row ' + (i+1) + ' repeats or reverses strain. Supply a single ordered loading curve per density.');
    if (j && stress < curve.stresses[j-1]) throw Error('Stress softening or unloading at row ' + (i+1) + '. This interpolation model requires nondecreasing loading stress.');
    if (j && !Number.isFinite((stress-curve.stresses[j-1])/(strain-curve.strains[j-1]))) throw Error('Row ' + (i+1) + ' has an unsupported stress slope.');
    curve.works.push(j ? curve.works[j-1]+0.5*(stress+curve.stresses[j-1])*(strain-curve.strains[j-1]) : 0);
    curve.strains.push(strain); curve.stresses.push(stress);
  }
  if (grouped.size < 2) throw Error('Supply at least two distinct relative-density curves.');
  const compiled = [...grouped.values()].sort((a,b)=>a.density-b.density);
  for (const curve of compiled) {
    if (curve.strains.length < 2 || curve.stresses.at(-1) <= 0) throw Error('Every curve needs an origin and at least one positive-stress loading sample.');
    curve.initialModulus = curve.stresses[1] / curve.strains[1];
  }
  if (!globalThis.crypto?.subtle) throw Error('A secure local context is required to fingerprint the CSV.');
  const definition=[CURVE_MODEL_ID,firstTrue,densityBracket,atPressure,combinedState,prepareLayers,
    materialResponse,gpuMaterialTable,packMaterialGpu,MATERIAL_WGSL].join('\n');
  const encode=value=>new TextEncoder().encode(value);
  const canonical=JSON.stringify(compiled.map(c=>[c.density,c.strains,c.stresses]));
  const [sha256,modelHash,canonicalHash]=await Promise.all([sha256Hex(bytes),sha256Hex(encode(definition)),sha256Hex(encode(canonical))]);
  synthetic ||= canonicalHash === DEMO_TABLE_HASH;
  const densities = Object.freeze(compiled.map(c=>c.density));
  const curves = Object.freeze(compiled.map(c=>Object.freeze({
    relative_density:c.density, strain:Object.freeze(c.strains), stress_mpa:Object.freeze(c.stresses),
  })));
  const commonPressure = Math.min(...compiled.map(c=>c.stresses.at(-1)));
  // Conservative strain supported for every density at the pressure shared by all curves.
  const maxCommonStrain = Math.min(...compiled.map(c=>atPressure(c,commonPressure)[1]));
  const material = Object.freeze({kind:'compression_curves',version:1,source:'local_csv',
    provenance:synthetic ? 'synthetic_example' : 'user_supplied', name:synthetic ? 'Synthetic example curves' : 'Imported loading curves',
    sha256, model_hash_sha256:modelHash, densities, curves, record_count:count, density_min:densities[0], density_max:densities.at(-1),
    max_common_strain:maxCommonStrain,common_pressure_mpa:commonPressure});
  const knots = [...new Set(compiled.flatMap(c=>c.stresses))].sort((a,b)=>a-b);
  parsedTables.set(material,{compiled,knots,text,modulusScale:Math.max(...compiled.map(c=>c.initialModulus))});
  return material;
}

export function materialSummary(material) {
  table(material);
  const {kind,version,source,provenance,sha256,densities,record_count} = material;
  return {kind,version,source,provenance,sha256,densities:[...densities],record_count,name:material.name,
    density_min:material.density_min,density_max:material.density_max,max_common_strain:material.max_common_strain,
    common_pressure_mpa:material.common_pressure_mpa,model_hash_sha256:material.model_hash_sha256,
    curve_count:densities.length,units:{relative_density:'fraction',strain:'fraction',stress:'MPa'},
    interpolation:CURVE_MODEL_ID};
}

// Explicit local replay helper. The optimizer's public result includes only metadata, never the raw CSV.
export function exportMaterialCSV(material) { return table(material).text; }

function firstTrue(count, predicate) {
  let left=0, right=count;
  while (left<right) {
    const middle=(left+right)>>>1;
    if(predicate(middle)) right=middle;
    else left=middle+1;
  }
  return left;
}

function densityBracket(compiled, density) {
  // Accommodate one arithmetic rounding step at an observed density.
  const eps = 8 * Number.EPSILON;
  if (!Number.isFinite(density) || density <= 0 || density < compiled[0].density-eps || density > compiled.at(-1).density+eps)
    throw new MaterialDomainError('A layer density lies outside the imported curve densities.');
  const j = Math.min(firstTrue(compiled.length,i=>compiled[i].density>=density-eps),compiled.length-1);
  const hi = compiled[j];
  if (Math.abs(hi.density-density)<=eps || j===0) return [[hi,1]];
  const lo=compiled[j-1], weight=(density-lo.density)/(hi.density-lo.density);
  return [[lo,1-weight],[hi,weight]];
}

// Invert a monotone curve at pressure p. A horizontal plateau contributes an interval of strains.
function atPressure(c,p) {
  const first=firstTrue(c.stresses.length,i=>c.stresses[i]>=p);
  if (first===c.stresses.length) throw new MaterialDomainError('The imported stress range is exhausted.');
  if (c.stresses[first]===p) {
    const last=firstTrue(c.stresses.length,i=>c.stresses[i]>p)-1;
    return [c.strains[first],c.strains[last],c.works[first]];
  }
  const j=first-1;
  const de=(p-c.stresses[j])/(c.stresses[first]-c.stresses[j])*(c.strains[first]-c.strains[j]);
  const e=c.strains[j]+de;
  return [e,e,c.works[j]+0.5*(p+c.stresses[j])*de];
}

function combinedState(blend,p) {
  const out=[0,0,0];
  for(const [c,w] of blend) {
    const state=atPressure(c,p);
    for(let j=0;j<3;j++) out[j]+=w*state[j];
  }
  return out;
}

function prepareLayers(fractions, material) {
  const {compiled}=table(material), blend=new Map();
  let topCompliance=0;
  for(let i=0;i<fractions.length;i++) {
    const brackets=densityBracket(compiled,fractions[i]);
    for(const [curve,weight] of brackets) {
      blend.set(curve,(blend.get(curve)||0)+weight/3);
      if(i===2) topCompliance+=weight/curve.initialModulus;
    }
  }
  const maxPressure=Math.min(...[...blend.keys()].map(c=>c.stresses.at(-1)));
  return {blend,maxPressure,topModulus:1/topCompliance};
}

export function curveSupportsStroke(fractions, strain, material) {
  try {
    const {blend,maxPressure}=prepareLayers(fractions,material);
    return strain<=combinedState(blend,maxPressure)[1]+1e-12;
  } catch(e) { if (e instanceof MaterialDomainError) return false; throw e; }
}

export function materialResponse(fractions, objective, material) {
  if (!Array.isArray(fractions) || fractions.length!==3) throw Error('Expected three equal-thickness layers.');
  const {knots}=table(material);
  const {blend,maxPressure,topModulus}=prepareLayers(fractions,material);
  const requested=objective.stroke_mm/objective.height_mm;
  const lastStrain=combinedState(blend,maxPressure)[1];
  if (requested>lastStrain+1e-12) throw new MaterialDomainError('The requested stroke exceeds the common strain/stress evidence of the imported layers.');
  const target=Math.min(requested,lastStrain);
  const n=firstTrue(knots.length,i=>knots[i]>maxPressure);
  const index=firstTrue(n,i=>combinedState(blend,knots[i])[1]>=target);
  const high=knots[index], [left,,workLeft]=combinedState(blend,high);
  let pressure, work;
  if(target>=left || index===0) {
    pressure=high; work=workLeft+pressure*(target-left);
  } else {
    const low=knots[index-1], [loLeft,loRight,loWork]=combinedState(blend,low);
    pressure=low+(high-low)*(target-loRight)/(left-loRight);
    work=loWork+low*(loRight-loLeft)+0.5*(low+pressure)*(target-loRight);
  }
  const area=objective.size_mm**2;
  return [work*area*objective.height_mm/1000,pressure*area,topModulus];
}

export function materialModulusScale(material) {
  return table(material).modulusScale;
}

// GPU lookup table holds strain at each side of a pressure plateau and work on entry.
// The first row (curve index -1) holds sorted pressure knots. Unused, unsupported cells stay zero.
export function gpuMaterialTable(material) {
  const data=table(material);
  if(data.gpuTable) return data.gpuTable;
  const {compiled,knots}=data, width=knots.length;
  for(let j=1;j<width;j++) if(Math.fround(knots[j])<=Math.fround(knots[j-1])) throw Error('Curve pressure samples need CPU double precision.');
  const values=new Float32Array((compiled.length+1)*width*4);
  for(let j=0;j<width;j++) values[4*j]=knots[j];
  for(let i=0;i<compiled.length;i++) {
    const c=compiled[i];
    for(let j=0;j<width && knots[j]<=c.stresses.at(-1);j++) values.set(atPressure(c,knots[j]),4*((i+1)*width+j));
  }
  data.gpuTable=values;
  return values;
}

export function packMaterialGpu(points, objective, material) {
  const {compiled,knots}=table(material), values=new Float32Array(points.length*20);
  points.forEach(([rho,g],i)=>{
    const levels=[rho*(1-2*g/3),rho,rho*(1+2*g/3)], offset=20*i;
    const {maxPressure,topModulus}=prepareLayers(levels,material);
    const count=firstTrue(knots.length,j=>knots[j]>maxPressure);
    values.set([count,topModulus,objective.stroke_mm/objective.height_mm,objective.size_mm**2,objective.height_mm,knots.length,0,0],offset);
    for(let j=0;j<3;j++){
      const pairs=densityBracket(compiled,levels[j]), [a,wa]=pairs[0], [b,wb]=pairs[1]??[a,0];
      values.set([compiled.indexOf(a),wa,compiled.indexOf(b),wb],offset+8+4*j);
    }
  });
  return values;
}

export const MATERIAL_WGSL=`
@group(0) @binding(0) var<storage, read> inputs: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> outputs: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> states: array<vec4<f32>>;
fn stateAt(i:u32, k:u32, width:u32) -> vec3<f32> {
  var sum=vec3<f32>(0.0);
  for(var j=0u;j<3u;j++){
    let pair=inputs[5u*i+2u+j];
    let a=states[(1u+u32(pair.x))*width+k].xyz;
    let b=states[(1u+u32(pair.z))*width+k].xyz;
    sum+=pair.y*a+pair.w*b;
  }
  return sum/3.0;
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id:vec3<u32>) {
  let i=id.x;
  if(i>=arrayLength(&outputs)){return;}
  let spec=inputs[5u*i];
  let dim=inputs[5u*i+1u];
  let width=u32(dim.y);
  let n=u32(spec.x);
  let goalStrain=min(spec.z,stateAt(i,n-1u,width).y);
  var lo=0u;
  var hi=n-1u;
  while(lo<hi){
    let mid=(lo+hi)/2u;
    if(stateAt(i,mid,width).y>=goalStrain){hi=mid;}else{lo=mid+1u;}
  }
  let knot=lo;
  let upper=stateAt(i,knot,width);
  let high=states[knot].x;
  var pressure=high;
  var work=upper.z+high*(goalStrain-upper.x);
  if(knot>0u && goalStrain<upper.x){
    let lower=stateAt(i,knot-1u,width);
    let low=states[knot-1u].x;
    let dx=goalStrain-lower.y;
    pressure=low+(high-low)*dx/(upper.x-lower.y);
    work=lower.z+low*(lower.y-lower.x)+0.5*(low+pressure)*dx;
  }
  outputs[i]=vec4<f32>(work*spec.w*dim.x/1000.0,pressure*spec.w,spec.y,0.0);
}
`;
