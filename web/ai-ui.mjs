// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
// Credentials live only in this module's closure for the lifetime of this tab.
import {parseAIProposal,validateAIApply,buildAIContext,proposalDiff,parseUniqueJSON} from './ai-gate.mjs';
import {createBrowserAI,BROWSER_AI_MAX_PROMPT_BYTES} from './browser-ai.mjs';
const $=id=>document.getElementById(id);
const LABELS={family:'Lattice family',envelope:'Envelope',size_mm:'Width / diameter',height_mm:'Height',cell_mm:'Cell pitch',target_fraction:'Solid fraction',gradient:'Axial grading',skin_mm:'End plates',quality:'Mesh detail',mass_kg:'Payload',drop_m:'Drop height',stroke_mm:'Stroke',max_force_n:'Force ceiling',soft_contact:'Soft contact face',units:'Units',schema_version:'Schema'};
const UNITS={size_mm:'mm',height_mm:'mm',cell_mm:'mm',skin_mm:'mm',mass_kg:'kg',drop_m:'m',stroke_mm:'mm',max_force_n:'N'};
function value(field,v){if(v===null)return 'Not set';if(['target_fraction','gradient'].includes(field))return (v*100).toLocaleString('en-US',{maximumFractionDigits:2})+'%';if(typeof v==='boolean')return v?'Yes':'No';return String(v)+(UNITS[field]?' '+UNITS[field]:'');}
function localBase(text){let u;try{u=new URL(text);}catch{throw Error('Enter an absolute localhost gateway URL.');}if(!['http:','https:'].includes(u.protocol)||!['localhost','127.0.0.1'].includes(u.hostname)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Use a localhost or 127.0.0.1 origin without a path, credentials or query.');return u.origin;}
async function jsonResponse(response){
  const limit=128*1024;
  if(!response.body)throw Error('The gateway returned an empty response.');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0,text='';
  try{
    if(Number(response.headers.get('content-length'))>limit)throw Error('The gateway response exceeded its limit.');
    while(true){
      const chunk=await reader.read();
      if(chunk.done)break;
      bytes+=chunk.value.byteLength;
      if(bytes>limit)throw Error('The gateway response exceeded its limit.');
      text+=decoder.decode(chunk.value,{stream:true});
    }
    text+=decoder.decode();
  }catch(error){void reader.cancel().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
  let data;
  try{data=parseUniqueJSON(text);}catch{throw Error('The AI gateway returned invalid or ambiguous JSON. Use a compatible Courbure gateway.');}
  if(!response.ok)throw Error(typeof data?.error==='string'?data.error:'The AI request failed.');
  return data;
}
export function setupAI({getDesignSpec,getObjective,getEnvelope,onGeometry,onObjective,setBusy,isBusy,onNotice}){
  let connection=null,key='',proposal=null,proposalEnvelope=null,proposalContext=null,controller=null,connectionCheck=null,lastStarted=0;
  const browserAI=createBrowserAI();
  let disclosedGateway=null;
  function resetGatewayDisclosure(){disclosedGateway=null;$('ai-local-cloud-consent').checked=false;$('ai-local-cloud-ack').hidden=true;$('ai-local-provider').textContent='';}
  const context=action=>action==='propose_inverse'?buildAIContext(null,getObjective()):buildAIContext(getDesignSpec());
  function status(text){$('ai-progress').textContent=text;}
  function clearProposal(){proposal=null;proposalEnvelope=null;proposalContext=null;$('ai-proposal').hidden=true;}
  function showProposal(raw,label){
    const p=parseAIProposal(raw);validateAIApply(p,getEnvelope());const current=context(p.action);proposal=p;proposalEnvelope=getEnvelope();proposalContext=current;
    const host=$('ai-diff');host.replaceChildren();const diff=proposalDiff(p,current);
    if(!diff.length){const line=document.createElement('p');line.className='fine-print';line.textContent='The proposal keeps the current values. You can regenerate the specimen.';host.append(line);}
    for(const d of diff){const row=document.createElement('div');row.className='ai-diff-row';const name=document.createElement('span');name.textContent=LABELS[d.field]??d.field;const next=document.createElement('strong');next.textContent=value(d.field,d.after);next.title='Previous: '+value(d.field,d.before);row.append(name,next);host.append(row);}
    $('ai-proposal').hidden=false;$('ai-apply').textContent=p.action==='propose_geometry'?'Apply and generate':'Apply and optimize';status(label+' Review the parameters, then apply.');
  }
  function displayConnection(){
    const label=connection?.provider==='browser'?'On-device · Qwen 0.5B':connection?.provider==='openai'?'OpenAI · GPT-6 Luna':connection?`${connection.upstream} · ${connection.model}`:'No AI connected';
    $('ai-connection-status').textContent=label;$('ai-connect').textContent=connection?'Connection':'Connect AI';
    $('ai-privacy').textContent=connection?.provider==='browser'?'Prompts, parameters and files stay on this device. A small model proposes parameters; every proposal passes the same validation gate. No API billing.':connection?.provider==='local'?`Only your text and parameter summary go to your gateway (${connection.upstream} / ${connection.model}). ${connection.upstream==='openai'?'It forwards them to OpenAI and bills its configured key.':'The gateway operator controls further forwarding.'} STL and material CSV stay local.`:'AI requests send your instruction and parameter summary through this site to OpenAI. STL and compression curves stay local. Each request bills your own key.';
  }
  $('ai-connect').addEventListener('click',()=>{$('ai-connect-error').hidden=true;$('ai-key').value='';resetGatewayDisclosure();$('ai-dialog').showModal();});
  $('ai-provider').addEventListener('change',()=>{connectionCheck?.abort();resetGatewayDisclosure();$('ai-key').value='';const provider=$('ai-provider').value;for(const type of ['openai','local','browser'])$(type+'-connection').hidden=provider!==type;$('ai-save-connection').textContent=provider==='browser'?'Load on-device model':'Connect';$('ai-connect-error').hidden=true;});
  $('ai-local-url').addEventListener('input',()=>{connectionCheck?.abort();resetGatewayDisclosure();});
  $('ai-dialog').addEventListener('close',()=>{connectionCheck?.abort();$('ai-key').value='';});
  $('ai-save-connection').addEventListener('click',async()=>{
    const button=$('ai-save-connection');button.disabled=true;$('ai-connect-error').hidden=true;
    const provider=$('ai-provider').value;let candidateKey='';
    const check=new AbortController();connectionCheck=check;
    const signal=provider==='browser'?check.signal:AbortSignal.any([check.signal,AbortSignal.timeout(10000)]);
    try{
      if(provider==='openai'){
        candidateKey=$('ai-key').value.trim();$('ai-key').value='';if(!/^sk-[A-Za-z0-9_\-]{12,1020}$/.test(candidateKey))throw Error('Enter a valid project API key. It will not be saved.');
        const r=await fetch('/api/ai/health',{method:'POST',mode:'same-origin',credentials:'same-origin',referrerPolicy:'strict-origin',redirect:'error',signal});const info=await jsonResponse(r);signal.throwIfAborted();if(info.provider!=='openai')throw Error('This origin does not expose the expected OpenAI gateway.');browserAI.unload();key=candidateKey;connection={provider:'openai',model:'gpt-6-luna'};
      }else if(provider==='browser'){
        if(!$('ai-browser-consent').checked)throw Error('Review and accept the model download before continuing.');
        $('ai-browser-progress').textContent='Checking WebGPU and local memory limits…';
        await browserAI.load({signal,onProgress:text=>{$('ai-browser-progress').textContent=text;}});signal.throwIfAborted();key='';connection={provider:'browser',model:'Qwen2.5-0.5B-Instruct'};
      }else if(provider==='local'){
        const base=localBase($('ai-local-url').value);const info=await jsonResponse(await fetch(base+'/health',{credentials:'omit',redirect:'error',signal}));signal.throwIfAborted();
        if(info.ok!==true||info.schema_version!==1||!['openai','ollama','openai-compatible'].includes(info.provider)||typeof info.model!=='string'||!info.model.trim()||info.model.length>160||/[\x00-\x1f\x7f]/.test(info.model))throw Error('This server is not a compatible Courbure gateway.');
        const tuple=JSON.stringify([base,info.provider,info.model]);if(disclosedGateway!==tuple){$('ai-local-cloud-consent').checked=false;disclosedGateway=tuple;}
        $('ai-local-provider').textContent=`Configured provider: ${info.provider} · ${info.model}`;
        $('ai-local-cloud-ack').hidden=info.provider!=='openai';
        if(info.provider==='openai'&&!$('ai-local-cloud-consent').checked)throw Error('This gateway forwards prompts and parameters to OpenAI and bills its configured key. Confirm below to connect.');
        browserAI.unload();key='';connection={provider:'local',base,upstream:info.provider,model:info.model};
      }else{
        throw Error('Choose a supported AI provider.');
      }
      clearProposal();displayConnection();$('ai-dialog').close();status('Connection configured. No inference request has been made yet.');
    }catch(error){if(connection?.provider==='browser'&&!browserAI.ready){connection=null;displayConnection();}if(error.name!=='AbortError'){$('ai-connect-error').textContent=error.name==='TypeError'?'The connection failed. Check your browser support or gateway origin.':error.message;$('ai-connect-error').hidden=false;}}
    finally{candidateKey='';if(connectionCheck===check)connectionCheck=null;button.disabled=false;}
  });
  $('ai-disconnect').addEventListener('click',()=>{connectionCheck?.abort();controller?.abort();browserAI.unload();key='';connection=null;$('ai-key').value='';clearProposal();displayConnection();$('ai-dialog').close();status('Disconnected. Credentials cleared and the model worker released. Cached public model files remain in site storage.');});
  $('ai-propose').addEventListener('click',async()=>{
    if(isBusy())return;if(!connection){$('ai-connect').click();return;}
    const prompt=$('ai-prompt').value.trim();if(!prompt){status('Describe the lattice you want before asking the AI.');$('ai-prompt').focus();return;}
    const limit=connection.provider==='browser'?BROWSER_AI_MAX_PROMPT_BYTES:8192;
    if(new TextEncoder().encode(prompt).length>limit){status(`Keep the instruction within ${limit.toLocaleString('en-US')} UTF-8 bytes for this provider.`);return;}
    if(key&&prompt.includes(key)){status('Remove the API key from the design instruction.');return;}
    if(Date.now()-lastStarted<2000){status('Wait a moment before another request.');return;}lastStarted=Date.now();
    clearProposal();controller=new AbortController();const timer=setTimeout(()=>controller?.abort(),connection.provider==='browser'?120000:50000);setBusy('ai');status('Requesting a bounded parameter proposal…');
    try{const action=$('ai-action').value,input={prompt,action,context:context(action)},requestEnvelope=getEnvelope(),requestContext=JSON.stringify(input.context);let response,result;
      if(connection.provider==='openai')response=await fetch('/api/ai/propose',{method:'POST',mode:'same-origin',credentials:'same-origin',referrerPolicy:'strict-origin',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({...input,model:connection.model})});
      else if(connection.provider==='browser')result={proposal:await browserAI.propose(input,{signal:controller.signal})};
      else response=await fetch(connection.base+'/propose',{method:'POST',credentials:'omit',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,expected_provider:connection.upstream,expected_model:connection.model})});
      if(!result)result=await jsonResponse(response);controller.signal.throwIfAborted();
      if(requestEnvelope!==getEnvelope()||requestContext!==JSON.stringify(context(action)))throw Error('Inputs changed while the model was working. Request a fresh proposal.');
      if(result.proposal?.action!==input.action)throw Error('The model returned a different action. Proposal rejected.');
      showProposal(result.proposal,result.usage?`Proposal validated · ${result.usage.total_tokens} API tokens.`:'Proposal validated.');
    }catch(error){status(error.name==='AbortError'?'AI request cancelled. No proposal was applied.':'Proposal rejected: '+error.message);}
    finally{clearTimeout(timer);controller=null;if(connection?.provider==='browser'&&!browserAI.ready){connection=null;displayConnection();}setBusy(null);}
  });
  $('ai-example').addEventListener('click',()=>{if(isBusy())return;try{const s=getDesignSpec();showProposal({version:1,action:'propose_geometry',design:{...s,family:'gyroid',target_fraction:.24,gradient:.2,skin_mm:0,quality:'preview'}},'Sample proposal · not generated by an AI and no API call.');}catch(e){status(e.message);}});
  $('ai-dismiss').addEventListener('click',()=>{clearProposal();status('Proposal discarded.');});
  $('ai-apply').addEventListener('click',async()=>{
    if(isBusy()||!proposal)return;
    try{
      if(proposalEnvelope!==getEnvelope()||JSON.stringify(context(proposal.action))!==JSON.stringify(proposalContext))throw Error('Inputs changed after this proposal. Request or preview a fresh proposal.');
      const validated=validateAIApply(proposal,getEnvelope());clearProposal();const result=validated.action==='propose_geometry'?await onGeometry(validated.design):await onObjective(validated.objective);status(result?'Applied. The result was produced by the local numerical engine.':'The proposal could not produce a new specimen. See the studio status.');
    }catch(error){status(error.message);}
  });
  $('ai-import-stl').addEventListener('click',()=>$('open-import').click());displayConnection();
  return {cancel:()=>controller?.abort(),updateContext:()=>{const s=getDesignSpec();$('ai-envelope-name').textContent=(s.envelope==='mesh'?'Your imported STL':s.envelope.replaceAll('_',' '))+' · '+s.size_mm.toFixed(1)+' × '+s.height_mm.toFixed(1)+' mm';},clearProposal};
}
