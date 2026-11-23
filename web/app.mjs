// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import * as THREE from 'three';
import {OrbitControls} from './vendor/three/OrbitControls.js';
import {DEFAULT,CURVED_DEMO,validateSpec,binarySTL} from './core.mjs';
import {optimizeDesign,evaluateCandidate,evaluateMeasuredLayers,validateObjective} from './inverse.mjs';
import {parseMaterialCSV,materialSummary,MATERIAL_CSV_MAX_BYTES} from './material.mjs';
import {parseSTLEnvelope,MAX_STL_BYTES} from './envelope-import.mjs';
import {createProject,readProject,specimenReport,saveLocalProject,loadLocalProject,MAX_PROJECT_BYTES,projectMechanicsInputs} from './project.mjs';
import {setupAI} from './ai-ui.mjs';
import {setupManufacturing} from './manufacturing-ui.mjs';
import {SoftwareView} from './software-view.mjs';
const $=id=>document.getElementById(id);
const fmt=(x,n=1)=>Number(x).toLocaleString('en-US',{maximumFractionDigits:n,minimumFractionDigits:n});
let design=null,worker=null,job=0,jobTimer=null,pendingGeneration=null,mesh=null,grid=null,device=null,renderer=null,orbit=null,camera=null,scene=null,software=null,viewBackend='Starting';
let aiUI=null,manufacturingUI=null;
let inverseResult=null,importedEnvelope=null,importedMaterial=null,mechanicsResult=null,mechanicsInputs=null,mechanicsWorker=null,mechanicsReject=null,searchController=null,busy=null,dirty=false;
const familyNames={gyroid:'GYROID',primitive:'SCHWARZ P',diamond:'DIAMOND',bcc:'BCC STRUTS'};
const envelopeNames={box:'RECTANGULAR COUPON',cylinder:'CYLINDRICAL COUPON',insert:'SPHERICAL KEEP-OUT',curved:'CURVED HALF-SHELL',mesh:'IMPORTED ENVELOPE'};
const presets={gyroid:{...DEFAULT},truss:{...DEFAULT,family:'bcc',target_fraction:.3,gradient:-.35,cell_mm:10,skin_mm:.8},curved:{...CURVED_DEMO},insert:{...DEFAULT,envelope:'insert',size_mm:48,height_mm:30,cell_mm:10,target_fraction:.26,gradient:-.25}};
function notice(text){$('notice').textContent=text;$('notice').hidden=!text;}
function activeMaterial(){return $('model-source').value==='curves'?importedMaterial:null;}
function objectiveFields(){return validateObjective({mass_kg:$('mass').valueAsNumber,drop_m:$('drop').valueAsNumber,stroke_mm:$('stroke').valueAsNumber,max_force_n:$('force').valueAsNumber,size_mm:36,height_mm:30,soft_contact:$('soft-contact').checked});}
function setObjective(o){if(!o)return;for(const [id,key] of [['mass','mass_kg'],['drop','drop_m'],['stroke','stroke_mm'],['force','max_force_n']])$(id).value=o[key];$('soft-contact').checked=o.soft_contact;}
function fieldsToSpec(){return validateSpec({...DEFAULT,family:$('family').value,envelope:$('envelope').value,size_mm:$('size').valueAsNumber,height_mm:$('height').valueAsNumber,cell_mm:$('cell').valueAsNumber,target_fraction:$('density').valueAsNumber/100,gradient:$('gradient').valueAsNumber/100,skin_mm:$('skin').valueAsNumber,quality:$('quality').value});}
function setFields(spec){for(const [id,key] of [['family','family'],['envelope','envelope'],['size','size_mm'],['height','height_mm'],['cell','cell_mm'],['quality','quality'],['skin','skin_mm']])$(id).value=spec[key];$('density').value=spec.target_fraction*100;$('gradient').value=spec.gradient*100;updateLabels(spec);updateEnvelopeUI();}
function updateLabels(spec){const density=spec?spec.target_fraction*100:$('density').valueAsNumber,grad=spec?spec.gradient*100:$('gradient').valueAsNumber;$('density-value').textContent=fmt(density,1)+'%';$('cell-value').textContent=fmt(spec?.cell_mm??$('cell').valueAsNumber,1)+' mm';$('gradient-value').textContent=Math.abs(grad)<.1?'Uniform':(grad>0?'+':'')+fmt(grad,0)+'%';}
function updateEnvelopeUI(){const imported=$('envelope').value==='mesh';$('size').disabled=imported;$('height').disabled=imported;$('envelope-info').hidden=!imported;if(imported&&importedEnvelope)$('envelope-info').textContent=importedEnvelope.dimensions_mm.map(v=>fmt(v,2)).join(' × ')+' mm · '+fmt(importedEnvelope.triangle_count,0)+' input triangles';}
function exportsEnabled(value){for(const id of ['export-stl','export-json','export-report','save-draft'])$(id).disabled=!value;}
function canAnalyze(){return design&&!dirty&&design.spec.family==='bcc'&&design.spec.envelope==='box'&&design.metrics.components===1;}
function updateActions(){exportsEnabled(!!design&&!dirty&&!busy);$('analyze').disabled=!!busy||!canAnalyze();$('export-graph').disabled=!!busy||!mechanicsResult;manufacturingUI?.update();}
function setBusy(value){busy=value;$('design-controls').disabled=!!value;for(const id of ['import-trigger','open-import','import-material','load-example-material','clear-material','load-benchmark','restore-draft','choose-stl','load-example-envelope','stl-unit','stl-fit'])$(id).disabled=!!value;for(const el of document.querySelectorAll('[data-preset]'))el.disabled=!!value;$('young').disabled=!!value;$('poisson').disabled=!!value;$('cancel-job').hidden=!value;updateActions();}
function updateRuntime(compute){$('runtime').textContent=viewBackend+' · '+(compute==='WebGPU'?'WebGPU compute verified':compute==='CPU'?'CPU search':device?'GPU compute ready':'CPU compute available');}
function invalidateGeometry(){dirty=true;inverseResult=null;mechanicsResult=null;manufacturingUI?.reset();$('search-result').hidden=true;$('mechanics-results').hidden=true;$('mechanics-status').textContent='Geometry changed. Generate it again before analyzing.';updateActions();notice('Parameters changed. Generate the lattice to update the specimen and its exports.');}
function invalidateScenario(){inverseResult=null;manufacturingUI?.reset();$('search-result').hidden=true;$('search-progress').textContent='Run a new search to evaluate the current scenario.';}
async function startRenderer(){
  try {
    if(navigator.gpu){try{const adapter=await navigator.gpu.requestAdapter();if(adapter)device=await adapter.requestDevice({label:'Courbure local compute'});}catch{} }
    renderer=new THREE.WebGPURenderer({canvas:$('scene'),antialias:true,alpha:true,...(device?{device}:{forceWebGL:true})});
    await renderer.init();renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.setClearColor(0x101c2c,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(34,1,.1,2000);camera.up.set(0,0,1);camera.position.set(65,-78,63);
    orbit=new OrbitControls(camera,renderer.domElement);orbit.enableDamping=true;orbit.dampingFactor=.07;orbit.autoRotate=false;orbit.autoRotateSpeed=.5;orbit.minDistance=35;orbit.maxDistance=300;orbit.maxPolarAngle=Math.PI*.82;
    $('rotate').classList.toggle('selected',orbit.autoRotate);$('rotate').setAttribute('aria-pressed',String(orbit.autoRotate));
    scene.add(new THREE.AmbientLight(0xdde8ff,1.7));
    const key=new THREE.DirectionalLight(0xffffff,3.2);key.position.set(30,-50,70);scene.add(key);
    const rim=new THREE.DirectionalLight(0x97b7ff,2);rim.position.set(-50,25,35);scene.add(rim);
    const warm=new THREE.DirectionalLight(0xffe9d8,1.1);warm.position.set(50,30,5);scene.add(warm);
    const resize=()=>{const r=$('viewport').getBoundingClientRect();camera.aspect=r.width/r.height;camera.updateProjectionMatrix();renderer.setSize(r.width,r.height,false);};new ResizeObserver(resize).observe($('viewport'));resize();
    renderer.setAnimationLoop(()=>{orbit.update();renderer.render(scene,camera);});viewBackend=renderer.backend.isWebGPUBackend?'WebGPU view':'WebGL2 view';updateRuntime();
    if(device)device.lost.then(()=>{device=null;notice('The graphics device was lost. Reload this page to restore the 3D view.');});
  }catch(error){
    renderer=null;scene=null;camera=null;orbit=null;
    try{const old=$('scene'),canvas=old.cloneNode(false);old.replaceWith(canvas);software=new SoftwareView(canvas,$('viewport'));viewBackend='Software 3D preview';$('rotate').disabled=true;$('rotate').classList.remove('selected');$('rotate').setAttribute('aria-pressed','false');$('rotate').title='Auto rotation requires an accelerated renderer';updateRuntime();}
    catch(fallbackError){$('viewer-error').hidden=false;$('viewer-error').textContent='A 3D view is unavailable. The local geometry engine and exports remain available.';viewBackend='3D unavailable';updateRuntime();}
  }
}

function drawMesh(result){const spec=result.spec;
  if(software)software.setMesh(result);
  if(scene){
    if(mesh){scene.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(result.positions,3));geometry.setIndex(new THREE.BufferAttribute(result.indices,1));geometry.computeVertexNormals();
    const colors=new Float32Array(result.positions.length),bottom=new THREE.Color('#7e9ee4'),top=new THREE.Color('#d4ddfa'),tmp=new THREE.Color();
    for(let i=0;i<result.positions.length/3;i++){const t=Math.max(0,Math.min(1,result.positions[i*3+2]/spec.height_mm+.5));tmp.copy(bottom).lerp(top,t);colors[i*3]=tmp.r;colors[i*3+1]=tmp.g;colors[i*3+2]=tmp.b;}
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,metalness:.21,roughness:.39,side:THREE.DoubleSide,wireframe:$('wireframe').getAttribute('aria-pressed')==='true'}));scene.add(mesh);
    if(grid){scene.remove(grid);grid.geometry.dispose();grid.material.dispose();}
    grid=new THREE.GridHelper(spec.size_mm*3,24,0x405574,0x263e5b);grid.rotation.x=Math.PI/2;grid.position.z=-spec.height_mm/2-.25;grid.material.transparent=true;grid.material.opacity=.28;scene.add(grid);
    camera.position.set(spec.size_mm*1.7,-spec.size_mm*2.05,spec.height_mm*1.9);orbit.target.set(0,0,0);orbit.update();
  }
}
function setMesh(result){
  design=result;dirty=false;mechanicsResult=null;mechanicsInputs=null;
  manufacturingUI?.reset();
  const m=result.metrics,s=result.spec;
  $('actual-density').textContent=fmt(m.mesh_fraction*100,1)+'%';$('actual-target').textContent=fmt(s.target_fraction*100,1)+'%';$('volume').textContent=fmt(m.volume_mm3/1000,2)+' cm³';$('components').textContent=String(m.components);$('triangles').textContent=fmt(m.triangles,0);$('grid').textContent=fmt(m.grid_edge_mm,2)+' mm';
  $('mesh-status').classList.toggle('warn',m.components!==1||Math.abs(m.target_error_percentage_points)>1);
  $('mesh-status').textContent=m.components===1?'Closed manifold · One connected solid':`Closed meshes · ${m.components} disconnected solids`;
  if(Math.abs(m.target_error_percentage_points)>1)$('mesh-status').textContent+=' · Refine density sampling';
  $('view-label').textContent=familyNames[s.family]+' / '+envelopeNames[s.envelope];
  $('dimensions').textContent=(m.envelope_dimensions_mm??[s.size_mm,s.envelope==='curved'?s.size_mm/2:s.size_mm,s.height_mm]).map(x=>fmt(x,1)).join(' × ')+' mm';
  const profile=$('layer-profile');profile.replaceChildren();const caption=document.createElement('p');caption.textContent='SOLID FRACTION BY HEIGHT';profile.append(caption);
  const layers=m.layer_fractions_bottom_to_top??[];
  for(const i of [2,1,0]){const row=document.createElement('div');row.className='layer-row';const label=document.createElement('span');label.textContent=['Bottom','Middle','Top'][i];const bar=document.createElement('i'),fill=document.createElement('b');fill.style.width=Math.max(0,Math.min(100,(layers[i]??0)*100))+'%';bar.append(fill);const val=document.createElement('span');val.textContent=Number.isFinite(layers[i])?fmt(layers[i]*100,0)+'%':'—';row.append(label,bar,val);profile.append(row);}
  $('mechanics-results').hidden=true;$('mechanics-status').textContent=canAnalyze()?'Ready. The material modulus below is an assumption you can change.':'Elastic beam analysis is available for a connected rectangular BCC specimen.';
  drawMesh(result);updateActions();aiUI?.updateContext();
}
function cancelGeometry(){if(!pendingGeneration)return;worker?.terminate();worker=null;clearTimeout(jobTimer);const pending=pendingGeneration;pendingGeneration=null;$('loading').hidden=true;pending.reject(new DOMException('Calculation cancelled.','AbortError'));}
function generate(input,{render=true,envelopeMesh=importedEnvelope}={}){
  const spec=validateSpec(input);cancelGeometry();const id=++job;
  $('loading').hidden=false;$('loading-text').textContent='Calibrating geometry…';
  worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});
  return new Promise((resolve,reject)=>{
    pendingGeneration={id,reject};
    const finish=(error,result)=>{if(pendingGeneration?.id!==id)return;clearTimeout(jobTimer);worker?.terminate();worker=null;pendingGeneration=null;$('loading').hidden=true;if(error)reject(error);else{if(render)setMesh(result);resolve(result);}};
    jobTimer=setTimeout(()=>finish(Error('Geometry exceeded the 45-second local budget. Try Preview detail, a larger cell pitch or a smaller envelope.')),45000);
    worker.onerror=event=>finish(Error(event.message||'The geometry worker could not start. Reload to try again.'));
    worker.onmessage=({data})=>{if(data.id!==id)return;if(data.type==='progress')$('loading-text').textContent=data.message;else if(data.type==='error')finish(Error(data.message));else if(data.type==='result')finish(null,data.result);};
    worker.postMessage({id,spec,envelopeMesh:spec.envelope==='mesh'?envelopeMesh:null});
  });
}
async function runGeometry(spec){
  if(busy)return;invalidateScenario();notice('');setBusy('geometry');
  try{const s=validateSpec(spec??fieldsToSpec());setFields(s);return await generate(s);}catch(error){notice(error.name==='AbortError'?'Calculation cancelled. The previous specimen is still displayed.':error.message);if(design)setFields(design.spec);dirty=false;return null;}
  finally{setBusy(null);}
}
function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function exportProject(){let objective=null;try{objective=objectiveFields();}catch{}return createProject({design,envelopeMesh:importedEnvelope,material:importedMaterial,useMaterial:!!activeMaterial(),objective,inverse:inverseResult,mechanics:mechanicsResult,mechanicsInputs});}
async function openProject(text){
  if(busy)return;setBusy('geometry');notice('');
  const before={envelope:importedEnvelope,material:importedMaterial,source:$('model-source').value};
  try{const p=await readProject(text);const newDesign=await generate(p.spec,{render:false,envelopeMesh:p.envelopeMesh});importedEnvelope=p.envelopeMesh;setImportedOption();importedMaterial=p.material;updateMaterialUI();$('model-source').value=p.useMaterial?'curves':'synthetic';updateModelContext();setObjective(p.objective);invalidateScenario();setFields(p.spec);setMesh(newDesign);if(p.mechanicsInputs){$('young').value=p.mechanicsInputs.young_mpa;$('poisson').value=p.mechanicsInputs.poisson;}
    notice('Project opened. Geometry has been regenerated; run the search or beam solver to recompute results.');
  }catch(error){importedEnvelope=before.envelope;importedMaterial=before.material;$('model-source').value=before.source;notice('Project not opened: '+error.message);}
  finally{setBusy(null);}
}
function setImportedOption(){const option=$('envelope').querySelector('option[value="mesh"]');option.disabled=!importedEnvelope;}
async function importEnvelope(buffer){
  if(busy)return;const errorBox=$('stl-error');errorBox.hidden=true;setBusy('geometry');
  try{const fit=Number($('stl-fit').value);const envelope=parseSTLEnvelope(buffer,{unit:$('stl-unit').value,...(fit?{fit_mm:fit}:{})});const base=fieldsToSpec();const spec=validateSpec({...base,envelope:'mesh',size_mm:envelope.size_mm,height_mm:envelope.height_mm,skin_mm:0});
    const generated=await generate(spec,{render:false,envelopeMesh:envelope});importedEnvelope=envelope;setImportedOption();setFields(spec);invalidateScenario();setMesh(generated);$('import-dialog').close();notice('STL envelope imported and filled locally. Input geometry is included when you export the project.');
  }catch(error){errorBox.textContent=error.message;errorBox.hidden=false;}
  finally{setBusy(null);}
}
function setMode(mode){const active=mode===true?'objective':mode===false?'geometry':mode;for(const name of ['ai','geometry','objective']){const selected=name===active;$(name+'-panel').hidden=!selected;const tab=$('mode-'+name);tab.classList.toggle('active',selected);tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}}
function selectPreset(key){for(const b of document.querySelectorAll('[data-preset]'))b.classList.toggle('active',b.dataset.preset===key);setMode(false);runGeometry(presets[key]);}
function node(tag,attrs={},text){const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));if(text!==undefined)el.textContent=text;return el;}
function showCurve(layers,baselineLayers,objective,material){
  const host=$('curve-chart');host.replaceChildren();const svg=node('svg',{viewBox:'0 0 820 245',role:'img','aria-label':'Model loading force in newtons against compression in millimetres.'});const add=(tag,attrs,text)=>{const el=node(tag,attrs,text);svg.append(el);return el;};
  const title=document.createElement('p');title.className='chart-caption';title.textContent=(material?material.name:'Illustrative compression model')+' · force–displacement';host.append(title);
  const curves=[layers,baselineLayers].map(d=>d?[[0,0],...Array.from({length:32},(_,i)=>{const stroke=Math.max(.5,objective.stroke_mm*(i+1)/32);return [stroke,evaluateMeasuredLayers(d,{...objective,stroke_mm:stroke},material).peak_force_n];})]:null);
  const max=Math.max(objective.max_force_n,...curves.filter(Boolean).flat().map(p=>p[1]))*1.08;const x=v=>65+v/objective.stroke_mm*715,y=v=>188-v/max*148;
  for(let i=0;i<=3;i++){const v=max*i/3;add('line',{x1:65,y1:y(v),x2:780,y2:y(v),stroke:'#dfe6ef'});add('text',{x:54,y:y(v)+4,'text-anchor':'end',fill:'#718198','font-size':12},fmt(v,0));}
  add('line',{x1:65,y1:y(objective.max_force_n),x2:780,y2:y(objective.max_force_n),stroke:'#bb8d48','stroke-dasharray':'6 5'});add('text',{x:780,y:y(objective.max_force_n)-6,'text-anchor':'end',fill:'#a17b43','font-size':11},'Force ceiling');
  for(let c=1;c>=0;c--)if(curves[c])add('path',{d:curves[c].map((p,i)=>(i?'L':'M')+x(p[0]).toFixed(2)+' '+y(p[1]).toFixed(2)).join(' '),fill:'none',stroke:c?'#a2acbd':'#4266ad','stroke-width':c?4:2.5,...(c?{'stroke-dasharray':'5 5'}:{})});
  add('text',{x:65,y:22,fill:'#607590','font-size':12},'Contact force (N)');add('text',{x:780,y:231,'text-anchor':'end',fill:'#607590','font-size':12},'Displacement (mm)');for(let i=0;i<=3;i++)add('text',{x:x(objective.stroke_mm*i/3),y:209,'text-anchor':'middle',fill:'#718198','font-size':12},fmt(objective.stroke_mm*i/3,1));
  host.append(svg);const legend=document.createElement('p');legend.className='chart-legend';legend.textContent='Blue: selected mesh · Dashed grey: uniform mesh at the same requested fraction. Loading work only; no simulated impact or hysteresis.';if(!baselineLayers)legend.textContent='Blue: selected mesh. Uniform comparison unavailable within this material domain. Loading work only.';host.append(legend);
}
async function runSearch(){
  if(busy)return;notice('');inverseResult=null;$('search-result').hidden=true;$('search-progress').textContent='Preparing the bounded search…';setBusy('search');searchController=new AbortController();const signal=searchController.signal;
  try{
    const objective=objectiveFields(),material=activeMaterial();const result=await optimizeDesign(objective,{device,material,signal,onProgress:p=>{$('search-progress').textContent=`Learning from ${p.training_count} evaluations${p.total?' / '+p.total:''}…`;}});updateRuntime(result.backend);result.nominal_selected=result.selected;result.mesh_trials=[];let best=null;
    if(result.selected){
      const shortlist=result.trace.filter(c=>c.feasible).sort((a,b)=>a.score-b.score).slice(0,6);
      for(let i=0;i<shortlist.length;i++){
        signal.throwIfAborted();const c=shortlist[i];$('search-progress').textContent=`Checking actual geometry ${i+1} / ${shortlist.length}…`;const spec={...DEFAULT,family:'bcc',target_fraction:c.rho,gradient:c.gradient,cell_mm:12,skin_mm:0};const generated=await generate(spec,{render:false});
        let checked=null,reason=null;try{checked=evaluateMeasuredLayers(generated.metrics.layer_fractions_bottom_to_top,objective,material);}catch(error){reason=error.message;}
        const qualifies=!!checked?.feasible&&generated.metrics.components===1;result.mesh_trials.push({spec,metrics:generated.metrics,model_recheck:checked,reason,qualifies});if(qualifies&&(!best||checked.score<best.checked.score))best={candidate:c,generated,checked};
      }
      result.selected=best?.candidate??null;result.feasible=!!best;if(!best)result.reason='No shortlisted mesh met every constraint inside the response model’s valid domain. Revise the scenario or supply a wider set of compression curves.';
    }
    let baselineLayers=null,baselineWork=null;
    if(best){
      const c=best.candidate;let trial=result.mesh_trials.find(t=>t.spec.gradient===0&&t.spec.target_fraction===c.rho);
      if(!trial){signal.throwIfAborted();$('search-progress').textContent='Measuring the uniform comparison specimen…';const spec={...best.generated.spec,gradient:0};const baseline=await generate(spec,{render:false});let checked=null,reason=null;try{checked=evaluateMeasuredLayers(baseline.metrics.layer_fractions_bottom_to_top,objective,material);}catch(error){reason=error.message;}trial={spec,metrics:baseline.metrics,model_recheck:checked,reason,comparator:true,qualifies:!!checked?.feasible&&baseline.metrics.components===1};result.mesh_trials.push(trial);}
      if(trial.model_recheck){result.baseline_mesh_recheck=trial.model_recheck;baselineLayers=trial.metrics.layer_fractions_bottom_to_top;baselineWork=trial.model_recheck.work_j;}
      result.mesh_recheck={...best.checked,measured_fraction:best.generated.metrics.mesh_fraction};result.selected_spec=best.generated.spec;
    }
    signal.throwIfAborted();inverseResult=result;$('search-result').hidden=false;$('search-heading').textContent=best?'A candidate checked against its mesh.':'No feasible candidate found.';
    const evidence=material?(material.provenance==='synthetic_example'?'Synthetic example curves; no physical measurements.':'User-supplied loading curves; not independently validated.'):'Illustrative three-layer model; no calibrated material evidence.';
    $('search-evidence').textContent=`${result.training_count} learned evaluations · ${result.mesh_trials.length} mesh checks · ${result.backend}. ${evidence}`;
    $('search-values').replaceChildren();
    if(best){
      const {candidate:c,checked:q}=best;const nominal=result.nominal_selected;$('search-summary').textContent=`${fmt(best.generated.metrics.mesh_fraction*100,2)}% measured material, ${c.gradient===0?'uniform struts':fmt(c.gradient*100,0)+'% axial radius grading'}. ${nominal.rho!==c.rho||nominal.gradient!==c.gradient?'The initial surrogate proposal was corrected after measuring the final layer volumes.':'The proposed geometry satisfies the model after its actual layer volumes are measured.'}`;
      for(const [v,label] of [[fmt(q.work_j,3)+' J','Loading work · mesh layers'],[fmt(q.required_work_j,3)+' J','Required work through stroke'],[fmt(q.peak_force_n,1)+' N','Model terminal force'],[baselineWork===null?'—':fmt(baselineWork,3)+' J','Uniform mesh · same target fraction']]){const box=document.createElement('div'),value=document.createElement('strong'),name=document.createElement('span');value.textContent=v;name.textContent=label;box.append(value,name);$('search-values').append(box);}
      showCurve(best.generated.metrics.layer_fractions_bottom_to_top,baselineLayers,objective,material);setFields(best.generated.spec);setMesh(best.generated);
    }else{$('search-summary').textContent=result.reason||'No sampled candidate meets every declared constraint.';$('curve-chart').replaceChildren();notice('No new specimen selected. The previous geometry remains available; it is not a successful result of this search.');}
    $('search-progress').textContent=`Completed · ${result.training_count} samples + ${result.mesh_trials.length} mesh checks. ${best?'Specimen ready for investigation.':'No feasible design found.'}`;return best?.generated??null;
  }catch(error){notice(error.name==='AbortError'?'Search cancelled. The previous specimen is still displayed.':error.message);$('search-progress').textContent=error.name==='AbortError'?'Search cancelled.':'Search stopped. Check the scenario and material domain.';}
  finally{searchController=null;setBusy(null);}
}
function updateModelContext(){const m=activeMaterial();$('model-context').textContent=m?`${m.name}. Density range ${fmt(m.density_min*100,0)}–${fmt(m.density_max*100,0)}%; interpolation only.`:'Synthetic loading response. Add your curves in the material lab.';}
function materialChart(material){
  const host=$('material-chart');host.replaceChildren();host.hidden=!material;if(!material)return;const svg=node('svg',{viewBox:'0 0 580 210',role:'img','aria-label':'Imported loading curves: engineering compressive stress in MPa against strain.'});const xmax=Math.max(...material.curves.flatMap(c=>c.strain)),ymax=Math.max(...material.curves.flatMap(c=>c.stress_mpa));const x=v=>55+v/xmax*495,y=v=>172-v/ymax*130;
  for(let i=0;i<=3;i++){svg.append(node('line',{x1:55,y1:y(ymax*i/3),x2:550,y2:y(ymax*i/3),stroke:'#e0e7f0'}));svg.append(node('text',{x:44,y:y(ymax*i/3)+4,'text-anchor':'end',fill:'#7c8da6','font-size':11},fmt(ymax*i/3,2)));svg.append(node('text',{x:x(xmax*i/3),y:190,'text-anchor':'middle',fill:'#7c8da6','font-size':11},fmt(xmax*i/3*100,0)+'%'));}
  const palette=['#acbddd','#7f9bc3','#526fb0','#263e73','#8b95ab','#aa7c81'];material.curves.forEach((c,i)=>svg.append(node('path',{d:c.strain.map((v,j)=>(j?'L':'M')+x(v).toFixed(2)+' '+y(c.stress_mpa[j]).toFixed(2)).join(' '),fill:'none',stroke:palette[i%palette.length],'stroke-width':1.8})));
  svg.append(node('text',{x:55,y:21,fill:'#607998','font-size':12},'Compression stress (MPa)'));svg.append(node('text',{x:550,y:208,'text-anchor':'end',fill:'#607998','font-size':11},'Engineering strain'));host.append(svg);
}
function updateMaterialUI(){
  const m=importedMaterial;$('model-source').querySelector('option[value="curves"]').disabled=!m;$('clear-material').hidden=!m;
  $('material-badge').textContent=m?(m.provenance==='synthetic_example'?'Synthetic example':'User supplied'):'Illustrative model';
  $('material-status').textContent=m?`${m.densities.length} loading curves, ${m.record_count} samples. ${m.provenance==='synthetic_example'?'This example is synthetic. It demonstrates the workflow without claiming material validation.':'The imported measurements now define the interpolation domain. Check material, lattice family, pitch, manufacturing process and test conditions before interpreting predictions.'}`:'No curves imported. Bring your own data, or explore the workflow with a clearly labelled synthetic dataset.';
  $('material-meta').textContent=m?`Densities: ${m.densities.map(x=>fmt(x*100,0)+'%').join(' · ')}. SHA-256: ${m.sha256.slice(0,16)}…` :'';materialChart(m);updateModelContext();
}
async function loadMaterial(text){if(busy)return;try{const material=await parseMaterialCSV(text);importedMaterial=material;updateMaterialUI();$('model-source').value='curves';updateModelContext();invalidateScenario();notice('Compression curves loaded locally. Inverse design will use this response evidence.');setMode(true);}catch(error){$('material-status').textContent='Import rejected: '+error.message;notice('Compression CSV rejected: '+error.message);}}
async function runMechanics(){
  if(busy||!canAnalyze())return;setBusy('mechanics');notice('');$('mechanics-status').textContent='Assembling the beam graph and solving elastic equilibrium…';
  try{const params=projectMechanicsInputs({young_mpa:$('young').valueAsNumber,poisson:$('poisson').valueAsNumber,strain:.001});const result=await new Promise((resolve,reject)=>{mechanicsWorker=new Worker(new URL('./mechanics-worker.mjs',import.meta.url),{type:'module'});const timer=setTimeout(()=>{finish(Error('Elastic solve exceeded the 30-second local budget.'));},30000);const finish=(e,r)=>{clearTimeout(timer);mechanicsWorker?.terminate();mechanicsWorker=null;mechanicsReject=null;e?reject(e):resolve(r);};mechanicsReject=error=>finish(error);mechanicsWorker.onerror=e=>finish(Error(e.message));mechanicsWorker.onmessage=({data})=>{if(data.type==='error')finish(Error(data.message));else if(data.type==='result')finish(null,data.result);};mechanicsWorker.postMessage({id:job,spec:design.spec,material:params,band:design.metrics.band});});
    mechanicsResult=result;mechanicsInputs=params;const host=$('mechanics-results');host.replaceChildren();host.hidden=false;
    for(const [v,label] of [[fmt(result.stiffness_n_per_mm,2),'Stiffness · N/mm'],[fmt(result.effective_modulus_mpa,3),'Apparent modulus · MPa'],[fmt(result.reaction_n,3),'Plate reaction · N'],[fmt(result.max_normal_stress_mpa,3),'Max normal stress · MPa'],[fmt(result.graph.members.length,0),'Beam elements'],[result.residual_relative.toExponential(1),'Relative solver residual']]){const box=document.createElement('div'),value=document.createElement('strong'),name=document.createElement('span');value.textContent=v;name.textContent=label;box.append(value,name);host.append(box);}
    $('mechanics-status').textContent=`${result.model}. ${result.graph.nodes.length} nodes; ${result.iterations} iterations. These elastic estimates use your assumed base material.`;
  }catch(error){$('mechanics-status').textContent=error.name==='AbortError'?'Elastic calculation cancelled.':error.message;}
  finally{mechanicsWorker?.terminate();mechanicsWorker=null;mechanicsReject=null;setBusy(null);}
}
$('mode-ai').addEventListener('click',()=>setMode('ai'));
$('mode-geometry').addEventListener('click',()=>setMode(false));$('mode-objective').addEventListener('click',()=>setMode(true));
for(const id of ['mode-ai','mode-geometry','mode-objective'])$(id).addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const names=['ai','geometry','objective'],index=names.indexOf(id.slice(5));const next=e.key==='Home'?0:e.key==='End'?2:(index+(e.key==='ArrowRight'?1:2))%3;setMode(names[next]);$('mode-'+names[next]).focus();}});
for(const b of document.querySelectorAll('[data-preset]'))b.addEventListener('click',()=>selectPreset(b.dataset.preset));
for(const id of ['density','cell','gradient'])$(id).addEventListener('input',()=>{updateLabels();invalidateGeometry();});
for(const id of ['family','envelope','size','height','skin','quality'])$(id).addEventListener('change',()=>{if(id==='envelope'&&$('envelope').value==='mesh'&&importedEnvelope){$('size').value=importedEnvelope.size_mm;$('height').value=importedEnvelope.height_mm;}updateEnvelopeUI();invalidateGeometry();});
for(const id of ['mass','drop','stroke','force'])$(id).addEventListener('input',()=>{updateModelContext();invalidateScenario();});
for(const id of ['soft-contact','model-source'])$(id).addEventListener('change',()=>{updateModelContext();invalidateScenario();});
$('generate').addEventListener('click',()=>runGeometry());$('optimize').addEventListener('click',runSearch);
$('cancel-job').addEventListener('click',()=>{aiUI?.cancel();manufacturingUI?.cancel();searchController?.abort();cancelGeometry();if(mechanicsReject){mechanicsWorker?.terminate();mechanicsReject(new DOMException('Calculation cancelled.','AbortError'));}});
$('focus-mode').addEventListener('click',()=>{const active=document.body.classList.toggle('focus');$('focus-mode').setAttribute('aria-pressed',String(active));$('focus-mode').textContent=active?'Exit focus':'Focus view';if(active)window.scrollTo({top:0});});
$('reset-view').addEventListener('click',()=>{if(software){software.reset();return;}if(!orbit)return;const s=design?.spec||DEFAULT;camera.position.set(s.size_mm*1.7,-s.size_mm*2.05,s.height_mm*1.9);orbit.target.set(0,0,0);orbit.update();});
$('rotate').addEventListener('click',()=>{if(!orbit)return;orbit.autoRotate=!orbit.autoRotate;$('rotate').classList.toggle('selected',orbit.autoRotate);$('rotate').setAttribute('aria-pressed',String(orbit.autoRotate));});
$('wireframe').addEventListener('click',()=>{const active=$('wireframe').getAttribute('aria-pressed')!=='true';$('wireframe').setAttribute('aria-pressed',String(active));$('wireframe').classList.toggle('selected',active);if(mesh)mesh.material.wireframe=active;if(software){software.wireframe=active;software.schedule();}});
$('viewport').addEventListener('keydown',e=>{if(e.target.id!=='scene'||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','='].includes(e.key))return;e.preventDefault();const d=e.key==='ArrowLeft'?-1:1;if(software){if(e.key.startsWith('Arrow')){if(['ArrowLeft','ArrowRight'].includes(e.key))software.yaw+=d*.12;else software.pitch=Math.max(-1.15,Math.min(1.15,software.pitch+(e.key==='ArrowUp'?.1:-.1)));}else software.zoom=Math.max(.5,Math.min(2.5,software.zoom*(e.key==='-'?.9:1.1)));software.schedule();}else if(camera&&orbit){const v=camera.position.clone().sub(orbit.target);if(['ArrowLeft','ArrowRight'].includes(e.key))v.applyAxisAngle(new THREE.Vector3(0,0,1),d*.1);else if(e.key==='ArrowUp'||e.key==='ArrowDown')v.z+=e.key==='ArrowUp'?5:-5;else v.multiplyScalar(e.key==='-'?1.1:.9);camera.position.copy(orbit.target).add(v);orbit.update();}});
$('export-stl').addEventListener('click',()=>{if(design&&!dirty)download(`courbure-${design.spec.family}-${design.spec.envelope}-mm.stl`,binarySTL(design.positions,design.indices),'model/stl');});
$('export-json').addEventListener('click',()=>{try{download('courbure-project.json',JSON.stringify(exportProject(),null,2),'application/json');}catch(e){notice(e.message);}});
$('export-report').addEventListener('click',()=>{try{download('courbure-specimen-report.md',specimenReport(exportProject()),'text/markdown');}catch(e){notice(e.message);}});
$('save-draft').addEventListener('click',async()=>{try{await saveLocalProject(exportProject());$('draft-status').textContent='Saved on this browser · '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});$('restore-draft').hidden=false;}catch(e){$('draft-status').textContent=e.message;}});
$('restore-draft').addEventListener('click',async()=>{try{const text=await loadLocalProject();if(text)await openProject(text);}catch(e){notice(e.message);}});
$('import-trigger').addEventListener('click',()=>$('import-file').click());$('import-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>MAX_PROJECT_BYTES)throw Error('Project must be at most 16 MiB.');await openProject(await file.text());}catch(error){notice(error.message);}finally{e.target.value='';}});
$('open-import').addEventListener('click',()=>{$('stl-error').hidden=true;$('import-dialog').showModal();});$('choose-stl').addEventListener('click',()=>$('stl-file').click());
$('stl-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>MAX_STL_BYTES)throw Error('STL files must be at most 8 MiB.');await importEnvelope(await file.arrayBuffer());}catch(error){$('stl-error').textContent=error.message;$('stl-error').hidden=false;}finally{e.target.value='';}});
$('load-example-envelope').addEventListener('click',async()=>{try{const r=await fetch('examples/stepped-envelope.stl');if(!r.ok)throw Error('The example envelope could not be loaded.');$('stl-fit').value='0';$('stl-unit').value='mm';$('family').value='bcc';$('density').value='28';$('gradient').value='0';$('cell').value='12';await importEnvelope(await r.arrayBuffer());}catch(e){$('stl-error').textContent=e.message;$('stl-error').hidden=false;}});
$('import-material').addEventListener('click',()=>$('material-file').click());$('material-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>MATERIAL_CSV_MAX_BYTES)throw Error('Compression CSV must be at most 256 KiB.');await loadMaterial(await file.text());}catch(error){$('material-status').textContent=error.message;}finally{e.target.value='';}});
$('load-example-material').addEventListener('click',async()=>{try{const r=await fetch('examples/synthetic-compression-curves.csv');if(!r.ok)throw Error('The example CSV could not be loaded.');await loadMaterial(await r.text());}catch(e){$('material-status').textContent=e.message;}});
$('clear-material').addEventListener('click',()=>{$('model-source').value='synthetic';updateModelContext();invalidateScenario();$('material-status').textContent='The illustrative model is active. The imported curves remain available in this local session.';});
$('load-benchmark').addEventListener('click',()=>{setMode(false);runGeometry({...DEFAULT,family:'bcc'});$('studio').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});$('analyze').addEventListener('click',runMechanics);
for(const id of ['young','poisson'])$(id).addEventListener('input',()=>{mechanicsResult=null;mechanicsInputs=null;$('mechanics-results').hidden=true;$('mechanics-status').textContent='Material assumptions changed. Run the solver again.';updateActions();});
$('export-graph').addEventListener('click',()=>{if(mechanicsResult)download('courbure-beam-graph.json',JSON.stringify({format:'courbure-beam-graph',version:1,units:'mm',spec:design.spec,graph:mechanicsResult.graph,material:mechanicsResult.material,model:mechanicsResult.model,assumptions:mechanicsResult.assumptions},null,2),'application/json');});
setFields(CURVED_DEMO);setMode('ai');updateMaterialUI();
aiUI=setupAI({getDesignSpec:fieldsToSpec,getObjective:objectiveFields,getEnvelope:()=>importedEnvelope,onGeometry:runGeometry,onObjective:async objective=>{setObjective(objective);setMode(true);return runSearch();},setBusy,isBusy:()=>!!busy,onNotice:notice});
manufacturingUI=setupManufacturing({getDesign:()=>dirty?null:design,getProject:exportProject,getObjective:objectiveFields,getMaterial:activeMaterial,setBusy,isBusy:()=>busy,onNotice:notice,onConfigure:()=>{setMode(true);$('studio').scrollIntoView({behavior:'smooth'});},onLoadCoupon:async()=>{if(busy)return;setObjective({mass_kg:.5,drop_m:.5,stroke_mm:15,max_force_n:450,soft_contact:true});$('model-source').value='synthetic';updateModelContext();setMode(false);await runGeometry({...DEFAULT,family:'bcc'});$('drop-lab').scrollIntoView({behavior:'smooth'});}});
loadLocalProject().then(text=>{$('restore-draft').hidden=!text;}).catch(()=>{});
await startRenderer();await runGeometry(CURVED_DEMO);
