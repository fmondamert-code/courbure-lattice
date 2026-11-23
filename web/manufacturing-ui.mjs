// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import {exportMaterialCSV} from './material.mjs';
const $=id=>document.getElementById(id);
const fmt=(v,n=2)=>Number(v).toLocaleString('en-US',{maximumFractionDigits:n,minimumFractionDigits:n});
function download(name,body,type){const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function node(tag,attrs={},text){const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));if(text!==undefined)el.textContent=text;return el;}
function plot(host,result,field,label,color,ceiling){
  host.replaceChildren();const svg=node('svg',{viewBox:'0 0 700 220',role:'img','aria-label':label+' against milliseconds after first contact.'});
  const duration=Math.max(result.contact_duration_s*1000,.1),points=result.samples.filter(p=>p.time_s>=result.impact_time_s&&p.time_s<=result.impact_time_s+result.contact_duration_s+1e-9);
  const max=Math.max(ceiling,...points.map(p=>p[field]),1)*1.15,x=v=>64+v/duration*610,y=v=>173-v/max*130;
  for(let i=0;i<=3;i++){const value=max*i/3;svg.append(node('line',{x1:64,x2:674,y1:y(value),y2:y(value),stroke:'#dde5f0'}),node('text',{x:53,y:y(value)+5,'text-anchor':'end',fill:'#65758b','font-size':14},fmt(value,field==='force_n'?0:1)),node('text',{x:x(duration*i/3),y:195,'text-anchor':'middle',fill:'#65758b','font-size':14},fmt(duration*i/3,1)));}
  svg.append(node('line',{x1:64,x2:674,y1:y(ceiling),y2:y(ceiling),stroke:'#ae732e','stroke-dasharray':'5 5'}));
  svg.append(node('text',{x:674,y:y(ceiling)-7,'text-anchor':'end',fill:'#916326','font-size':13},'Scenario limit'));
  svg.append(node('path',{d:points.map((p,i)=>(i?'L':'M')+x((p.time_s-result.impact_time_s)*1000).toFixed(2)+' '+y(p[field]).toFixed(2)).join(' '),fill:'none',stroke:color,'stroke-width':2.5}));
  svg.append(node('text',{x:64,y:23,fill:'#263e60','font-size':15},label),node('text',{x:674,y:218,'text-anchor':'end',fill:'#65758b','font-size':13},'Time after contact (ms)'));host.append(svg);
}

export function setupManufacturing({getDesign,getProject,getObjective,getMaterial,setBusy,isBusy,onNotice,onLoadCoupon,onConfigure}){
  let activeWorker=null,rejectWorker=null,nextId=0,dropRecord=null,dropMessage='';
  function eligible(d){return !!d&&d.spec.family==='bcc'&&d.spec.envelope==='box'&&d.spec.skin_mm===0&&d.spec.size_mm===36&&d.spec.height_mm===30&&d.metrics.components===1;}
  function update(){
    const d=getDesign(),busy=isBusy();
    for(const id of ['export-3mf','export-print-package'])$(id).disabled=busy||!d;
    $('run-drop').disabled=busy||!eligible(d);$('drop-demo').disabled=busy;$('drop-configure').disabled=busy;$('export-drop').disabled=busy||!dropRecord;
    $('print-preflight').textContent=d?`Closed oriented Float32 mesh · ${d.metrics.components} connected solid${d.metrics.components===1?'':'s'} · ${fmt(d.metrics.triangles,0)} facets. ${d.metrics.components===1?'':'Separate solids need a deliberate assembly or support strategy. '}3MF declares millimetres and places the lowest point at Z = 0.`:'Generate a specimen to prepare a manufacturing export.';
    try{const o=getObjective();$('drop-scenario').textContent=`${fmt(o.mass_kg)} kg · ${fmt(o.drop_m)} m release · ${fmt(o.stroke_mm,1)} mm stroke · ${fmt(o.max_force_n,0)} N ceiling`;}catch{$('drop-scenario').textContent='Set a valid scenario in Optimize.';}
    if(!dropRecord&&isBusy()!=='drop')$('drop-status').textContent=dropMessage||(eligible(d)?'Ready to test this mesh with the current compression response.':'Load a skinless 36 × 36 × 30 mm BCC coupon to run a guided drop.');
  }
  function reset(){dropRecord=null;dropMessage='';$('drop-results').hidden=true;update();}
  function callWorker(kind,payload){
    const id=++nextId,instance=new Worker(new URL(kind==='drop'?'./drop-worker.mjs':'./print-worker.mjs',import.meta.url),{type:'module'});activeWorker=instance;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>finish(Error(kind==='drop'?'Drop simulation exceeded its 15-second local budget.':'Print export exceeded its 30-second local budget.')),kind==='drop'?15000:30000);
      function finish(error,result){if(activeWorker!==instance)return;clearTimeout(timer);instance.terminate();activeWorker=null;rejectWorker=null;error?reject(error):resolve(result);}
      rejectWorker=error=>finish(error);instance.onerror=()=>finish(Error('The local calculation worker could not complete.'));
      instance.onmessage=({data})=>{if(data.id!==id)return;if(data.error||data.type==='error')finish(Error(data.error||data.message));else finish(null,kind==='drop'?data.result:data.bytes);};
      try{instance.postMessage({id,...payload});}catch(error){finish(error);}
    });
  }
  async function exportPrint(format){
    if(isBusy()||!getDesign())return;setBusy('print');$('print-status').textContent='Checking export topology and preparing the file locally…';
    try{const d=getDesign(),bytes=await callWorker('print',{design:d,format,...(format==='package'?{project:getProject()}: {})});
      download(format==='3mf'?'courbure-specimen.3mf':'courbure-print-package.zip',bytes,format==='3mf'?'model/3mf':'application/zip');
      $('print-status').textContent=`${format==='3mf'?'3MF':'Print package'} prepared · ${fmt(bytes.byteLength/1048576)} MiB. Open it in your slicer, select the actual machine profile, and inspect the toolpaths.`;
    }catch(error){$('print-status').textContent=error.name==='AbortError'?'Print export cancelled.':error.message;}
    finally{setBusy(null);}
  }
  async function runDrop(){
    if(isBusy()||!eligible(getDesign()))return;dropRecord=null;dropMessage='';$('drop-results').hidden=true;setBusy('drop');$('drop-status').textContent='Simulating contact with Rapier and checking time-step convergence…';
    try{
      const d=getDesign(),objective=getObjective(),material=getMaterial(),input={spec:d.spec,objective,layerFractions:d.metrics.layer_fractions_bottom_to_top,...(material?{materialCSV:exportMaterialCSV(material)}:{})};
      const project=getProject(),objectiveSnapshot=JSON.stringify(objective),result=await callWorker('drop',input);
      if(getDesign()!==d||getMaterial()!==material||JSON.stringify(getObjective())!==objectiveSnapshot)throw Error('The specimen, material or scenario changed during calculation. Run a fresh drop test.');
      dropRecord={format:'courbure-drop-test',version:1,project,inputs:input,result};
      const reasons={rebounded:result.within_force_limit?'Model force and stroke limits satisfied.':'Force ceiling exceeded in this model.',stroke_limit:'Stopped at the available stroke. No passing result.',material_limit:'Stopped at the compression-data boundary. No passing result.',numerical_limit:'Numerical checks did not converge. No passing result.',time_limit:'The simulation time limit was reached. No passing result.'};
      $('drop-status').textContent=reasons[result.status]??'Simulation stopped.';$('drop-status').classList.toggle('warn',result.status!=='rebounded'||!result.within_force_limit);
      const values=$('drop-metrics');values.replaceChildren();
      for(const [v,label] of [[fmt(result.peak_force_n,2)+' N','Peak contact force'],[fmt(result.peak_stroke_mm,3)+' mm','Peak compression'],[fmt(result.impact_speed_m_s,3)+' m/s','Speed at first contact'],[fmt(result.energy_error_fraction*100,5)+'%','Maximum energy residual']]){const box=document.createElement('div'),value=document.createElement('strong'),caption=document.createElement('span');value.textContent=v;caption.textContent=label;box.append(value,caption);values.append(box);}
      $('drop-evidence').textContent=`Rapier ${result.engine_version} · ${fmt(result.integration_steps,0)} integration steps · ${fmt(result.step_s*1000000,1)} µs fine step · ${fmt(result.convergence_fraction*100,4)}% coarse/fine difference. ${material?(material.provenance==='synthetic_example'?'Synthetic example curves; no physical measurements.':'User-supplied loading curves; not independently validated.'):'Illustrative compression law; no calibrated material data.'}`;
      $('drop-rebound').textContent=result.rebound_speed_m_s===null?'No complete rebound was resolved.':`Conservative rebound: ${fmt(result.rebound_speed_m_s,3)} m/s. Loading work is returned on unloading; this model does not predict dissipated energy.`;
      plot($('drop-force-chart'),result,'force_n','Contact force (N)','#4568ad',objective.max_force_n);plot($('drop-stroke-chart'),result,'stroke_mm','Compression (mm)','#2a8580',objective.stroke_mm);
      $('drop-results').hidden=false;
    }catch(error){dropMessage=error.name==='AbortError'?'Drop simulation cancelled.':error.message;$('drop-status').textContent=dropMessage;}
    finally{setBusy(null);}
  }
  $('export-3mf').addEventListener('click',()=>exportPrint('3mf'));
  $('export-print-package').addEventListener('click',()=>exportPrint('package'));
  $('run-drop').addEventListener('click',runDrop);$('drop-demo').addEventListener('click',onLoadCoupon);$('drop-configure').addEventListener('click',onConfigure);
  $('export-drop').addEventListener('click',()=>{if(dropRecord)download('courbure-drop-test.json',JSON.stringify(dropRecord,null,2),'application/json');});
  update();return {update,reset,cancel:()=>rejectWorker?.(new DOMException('Calculation cancelled.','AbortError'))};
}
