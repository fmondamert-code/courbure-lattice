// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import {DEFAULT,validateSpec} from './core.mjs';
import {validateEnvelopeMesh} from './envelope-import.mjs';
import {parseMaterialCSV,exportMaterialCSV,materialSummary} from './material.mjs';
import {validateObjective} from './inverse.mjs';
export const MAX_PROJECT_BYTES=16*1024*1024;
function projectObjective(input){
  const objective=validateObjective(input);
  if(objective.size_mm!==DEFAULT.size_mm || objective.height_mm!==DEFAULT.height_mm)throw Error('This workbench supports inverse-design projects for the 36 × 36 × 30 mm coupon.');
  return objective;
}
export function projectMechanicsInputs(m){
  if(!Number.isFinite(m?.young_mpa)||m.young_mpa<.01||m.young_mpa>500000||!Number.isFinite(m.poisson)||m.poisson<0||m.poisson>.49)throw Error('Invalid elastic material inputs.');
  if(m.strain!==undefined && m.strain!==.001)throw Error('This workbench uses an imposed elastic strain of 0.001.');
  return {young_mpa:m.young_mpa,poisson:m.poisson,strain:.001};
}
export async function readProject(text){
  if(typeof text!=='string'||text.length>MAX_PROJECT_BYTES||new TextEncoder().encode(text).length>MAX_PROJECT_BYTES)throw Error('Project must be at most 16 MiB.');
  const raw=JSON.parse(text);
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Expected a Courbure project object.');
  if(raw.format!==undefined&&raw.format!=='courbure-design')throw Error('This is not a Courbure project.');
  if(raw.version!==undefined&&![1,2].includes(raw.version))throw Error('Unsupported project version.');
  const spec=validateSpec(raw.design??raw);
  const envelopeMesh=spec.envelope==='mesh'?validateEnvelopeMesh(raw.envelope_mesh,spec):null;
  if(raw.response_source!==undefined && !['curves','synthetic'].includes(raw.response_source))throw Error('Unsupported project response source.');
  const material=raw.material_csv===undefined?null:await parseMaterialCSV(raw.material_csv);
  if(!material && (raw.response_source==='curves' || raw.material_sha256!==undefined))throw Error('The project is missing its compression CSV.');
  if(material && (raw.version===2 || raw.material_sha256!==undefined) && material.sha256!==raw.material_sha256)throw Error('The material CSV does not match its recorded fingerprint.');
  const objective=raw.objective?projectObjective(raw.objective):null;
  const mechanicsInputs=raw.mechanics_inputs?projectMechanicsInputs(raw.mechanics_inputs):null;
  // Previously reported metrics and solver output are deliberately not trusted on reopen.
  return {spec,envelopeMesh,material,objective,mechanicsInputs,useMaterial:!!material&&raw.response_source==='curves'};
}
export function createProject({design,envelopeMesh,material,useMaterial,objective,inverse,mechanics,mechanicsInputs}){
  if(!design)throw Error('Generate a specimen first.');
  if(useMaterial&&!material)throw Error('The selected response source requires a compression CSV.');
  const spec=validateSpec(design.spec);
  const project={format:'courbure-design',version:2,created_at:new Date().toISOString(),units:'mm',design:spec,engine:design.engine,metrics:design.metrics,response_source:useMaterial?'curves':'synthetic'};
  if(spec.envelope==='mesh'){
    const m=validateEnvelopeMesh(envelopeMesh,spec);project.envelope_mesh={positions:Array.from(m.positions),indices:Array.from(m.indices)};
  }
  if(material){project.material_csv=exportMaterialCSV(material);project.material_sha256=material.sha256;project.material=materialSummary(material);}
  if(objective)project.objective=projectObjective(objective);
  if(inverse)project.inverse_design=inverse;
  if(mechanicsInputs)project.mechanics_inputs=projectMechanicsInputs(mechanicsInputs);
  if(mechanics)project.elastic_analysis=mechanics;
  return project;
}
export function specimenReport(project){
  const {design:s,metrics:m}=project;
  const lines=['# Courbure specimen report','',`Generated: ${project.created_at}`,`Engine: ${project.engine.name} ${project.engine.version}`,'','## Geometry','',`- Family: ${s.family}` ,`- Envelope: ${s.envelope}`,`- Dimensions (mm): ${(m.envelope_dimensions_mm??[s.size_mm,s.envelope==='curved'?s.size_mm/2:s.size_mm,s.height_mm]).join(' × ')}`,`- Cell pitch: ${s.cell_mm} mm`,`- Requested solid fraction: ${(s.target_fraction*100).toFixed(3)}%`,`- Measured solid fraction: ${(m.mesh_fraction*100).toFixed(3)}%`,`- Material volume: ${m.volume_mm3.toFixed(3)} mm³`,`- Connected solids: ${m.components}`,`- Triangles: ${m.triangles}`,`- Sampling edge: ${m.grid_edge_mm} mm`,`- Bottom / middle / top fractions: ${m.layer_fractions_bottom_to_top.map(x=>x===null?'not available':(x*100).toFixed(3)+'%').join(' / ')}`,'','## Response evidence','',project.response_source==='curves'?`${project.material.name}; provenance: ${project.material.provenance}; SHA-256: ${project.material_sha256}.`:'Illustrative three-layer compression model. Coefficients are synthetic, not a material certificate.'];
  const r=project.inverse_design;
  if(r){lines.push('',`Search method: ${r.method}`,`Numerical samples: ${r.training_count}; mesh checks: ${r.mesh_trials?.length??0}; runtime: ${r.backend}.`);if(r.mesh_recheck)lines.push(`Loading work: ${r.mesh_recheck.work_j.toFixed(6)} J; required: ${r.mesh_recheck.required_work_j.toFixed(6)} J; terminal force: ${r.mesh_recheck.peak_force_n.toFixed(6)} N.`);}
  const a=project.elastic_analysis;
  if(a)lines.push('','## Elastic frame calculation','',a.model,`- Young’s modulus: ${a.material.young_mpa} MPa; Poisson ratio: ${a.material.poisson}`,`- Imposed strain: ${a.material.strain}`,`- Stiffness: ${a.stiffness_n_per_mm.toFixed(6)} N/mm`,`- Apparent platen modulus: ${a.effective_modulus_mpa.toFixed(6)} MPa`,`- Reaction: ${a.reaction_n.toFixed(6)} N`,`- Maximum axial + bending normal stress: ${a.max_normal_stress_mpa.toFixed(6)} MPa`,`- Solver relative residual: ${a.residual_relative}`, ...a.assumptions.map(x=>'- '+x));
  lines.push('','## Before printing or making a performance claim','','STL coordinates use millimetres. Check connectivity, resolution convergence, minimum features and slicing. Compression loading work is not dissipated energy. The curve interpolation and elastic beam calculation do not simulate a dynamic drop, damage, rate dependence or rebound. Printed-property validation requires material/process identification, independent coupons and instrumented tests.','','The companion project JSON contains the actual recipe and any explicitly included local input data. Reopening it regenerates geometry and discards untrusted cached analysis output.');
  return lines.join('\n')+'\n';
}
function openStore(){return new Promise((resolve,reject)=>{if(!globalThis.indexedDB)return reject(Error('Local storage is not available in this browser.'));const req=indexedDB.open('courbure-workspace',1);req.onupgradeneeded=()=>req.result.createObjectStore('drafts');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(Error('The browser could not open local storage.'));});}
export async function saveLocalProject(project){const db=await openStore();try{await new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(JSON.stringify(project),'current');tx.oncomplete=resolve;tx.onerror=()=>reject(Error('Local save failed; export the project file instead.'));tx.onabort=tx.onerror;});}finally{db.close();}}
export async function loadLocalProject(){const db=await openStore();try{return await new Promise((resolve,reject)=>{const req=db.transaction('drafts').objectStore('drafts').get('current');req.onsuccess=()=>resolve(req.result??null);req.onerror=()=>reject(Error('The local project could not be read.'));});}finally{db.close();}}
