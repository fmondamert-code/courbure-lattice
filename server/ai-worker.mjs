// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import {buildAIContext,buildSystemPrompt,modelReplySchema,parseModelReply,parseUniqueJSON,schemaForAction} from '../web/ai-gate.mjs';

const OFFICIAL_ENDPOINT='https://api.openai.com/v1/responses';
const MODELS=['gpt-6-luna'];
const MAX_PROMPT=8192, MAX_REQUEST=32768, MAX_REPLY=131072;
const encoder=new TextEncoder();
let inFlight=0;

export class ProposalRequestError extends Error {
  constructor(status,message) {super(message);this.status=status;}
}
function fail(status,message) {throw new ProposalRequestError(status,message);}

export function validatePromptRequest(value,{requireAction=true,withModel=false}={}) {
  const allowed=withModel?['prompt','action','context','model']:['prompt','action','context'];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k))) fail(400,'Unexpected proposal request fields.');
  if(typeof value.prompt!=='string'||!value.prompt.trim()) fail(400,'A nonempty prompt is required.');
  if(encoder.encode(value.prompt).byteLength>MAX_PROMPT) fail(413,'Prompt exceeds 8 KiB.');
  if(withModel&&!MODELS.includes(value.model)) fail(400,'Choose a supported AI model.');
  if(requireAction||value.action!==undefined) {
    try {schemaForAction(value.action);} catch {fail(400,'Choose a supported proposal action.');}
  }
  let context;
  if(value.context!==undefined) {
    const item=value.context;
    const fields=value.action==='propose_geometry'?['design']:value.action==='propose_inverse'?['objective']:['design','objective'];
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!fields.includes(k)) ||
      Object.values(item).some(v=>!v||typeof v!=='object'||Array.isArray(v))) fail(400,'Only validated design and objective fields can be sent as context.');
    try {context=buildAIContext(item.design,item.objective);} catch {fail(400,'The proposed design or objective context is invalid.');}
  }
  return {prompt:value.prompt.trim(),action:value.action,...(context?{context}:{})};
}

async function limitedJSON(message,limit,status,signal) {
  if(Number(message.headers.get('content-length'))>limit) fail(status,'Message exceeds its size limit.');
  if(!message.body) fail(status,'Expected a JSON body.');
  const reader=message.body.getReader();
  const decoder=new TextDecoder('utf-8',{fatal:true});
  const cancel=()=>{void reader.cancel().catch(()=>{});};
  if(signal?.aborted) cancel();
  else signal?.addEventListener('abort',cancel,{once:true});
  let bytes=0,text='';
  try {
    while(true) {
      const chunk=await reader.read();
      if(signal?.aborted) fail(408,'Request cancelled.');
      if(chunk.done) break;
      bytes+=chunk.value.byteLength;
      if(bytes>limit) {
        void reader.cancel().catch(()=>{});
        fail(status,'Message exceeds its size limit.');
      }
      text+=decoder.decode(chunk.value,{stream:true});
    }
    text+=decoder.decode();
    return parseUniqueJSON(text);
  } catch(error) {
    if(error instanceof ProposalRequestError) throw error;
    fail(status===413?400:status,'Invalid UTF-8 JSON body.');
  } finally {
    signal?.removeEventListener('abort',cancel);
    reader.releaseLock();
  }
}

function usageOf(data) {
  const keys=['input_tokens','output_tokens','total_tokens'];
  if(!data||keys.some(k=>!Number.isSafeInteger(data[k])||data[k]<0)) return null;
  return Object.fromEntries(keys.map(k=>[k,data[k]]));
}

// The caller supplies the credential for this request. The fetch destination,
// model prompt, response schema, output budget and storage policy are controlled here.
export async function requestOfficialProposal({input,model,credential,signal,fetchFn=fetch}) {
  const schema=modelReplySchema(input.action);
  const body={
    model,store:false,max_output_tokens:1200,reasoning:{effort:'none'},
    instructions:buildSystemPrompt(),
    input:JSON.stringify(input),
    text:{format:{type:'json_schema',name:'courbure_proposal',strict:true,schema}},
  };
  const outbound=await fetchFn(OFFICIAL_ENDPOINT,{method:'POST',redirect:'error',signal,
    headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!outbound.ok) {
    void outbound.body?.cancel().catch(()=>{});
    if(outbound.status===401 || outbound.status===403) fail(401,'OpenAI did not accept this credential or its permissions.');
    if(outbound.status===429) fail(429,'OpenAI reported a quota or rate limit.');
    fail(502,'OpenAI could not complete the proposal request.');
  }
  const envelope=await limitedJSON(outbound,MAX_REPLY,502,signal);
  if(envelope?.status!=='completed'||!Array.isArray(envelope.output)) fail(502,'OpenAI did not return a completed proposal.');
  let proposal;
  for(const item of envelope.output) {
    if(item?.type==='reasoning') continue;
    if(proposal!==undefined||item?.type!=='message'||item.role!=='assistant'||item.status!=='completed'||!Array.isArray(item.content)||item.content.length!==1||
        item.content[0]?.type!=='output_text'||typeof item.content[0].text!=='string') fail(502,'OpenAI returned an invalid proposal format.');
    try {proposal=parseModelReply(item.content[0].text,input.action);} catch {fail(502,'The AI proposal failed Courbure validation.');}
  }
  if(proposal===null) fail(422,'The model needs a clearer brief or additional targets for this task.');
  if(!proposal) fail(502,'OpenAI returned no proposal.');
  return {proposal,provider:'openai',model,usage:usageOf(envelope.usage)};
}

function json(status,body) {
  return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'}});
}

export async function handleAIRequest(request,env,fetchFn=fetch) {
  const url=new URL(request.url),origin=request.headers.get('origin');
  let acquired=false,controller,timer,expired=false;
  const disconnect=()=>controller?.abort();
  try {
    if(!['/api/ai/health','/api/ai/propose'].includes(url.pathname)||url.search) fail(404,'Unknown AI route.');
    if(origin!==url.origin || origin==='null') fail(403,'Same-origin browser requests are required.');
    if(url.pathname==='/api/ai/health') {
      if(request.method!=='GET'&&request.method!=='POST') fail(405,'Unsupported method.');
      return json(200,{ok:true,provider:'openai',models:[...MODELS],schema_version:1,credential:'user-supplied'});
    }
    if(request.method!=='POST') fail(405,'Use POST.');
    if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')||'')) fail(415,'Use application/json.');
    if(![null,'identity'].includes(request.headers.get('content-encoding'))) fail(415,'Compressed requests are unsupported.');
    const authorization=request.headers.get('authorization')||'';
    const match=/^Bearer ([A-Za-z0-9._~+\/-]{8,1024}=*)$/.exec(authorization);
    if(!match||authorization.length>1040) fail(401,'Supply your OpenAI API key for this request.');
    if(request.signal.aborted) fail(408,'The request was cancelled.');
    if(inFlight>=8) fail(429,'The proposal service is busy.');
    inFlight++;acquired=true;
    controller=new AbortController();
    request.signal.addEventListener('abort',disconnect,{once:true});
    timer=setTimeout(()=>{expired=true;controller.abort();},45000);
    const value=await limitedJSON(request,MAX_REQUEST,413,controller.signal);
    const input=validatePromptRequest(value,{withModel:true});
    if(input.prompt.includes(match[1])) fail(400,'Remove your credential from the prompt.');
    const result=await requestOfficialProposal({input,model:value.model,credential:match[1],signal:controller.signal,fetchFn});
    return json(200,result);
  } catch(error) {
    if(expired) return json(504,{error:'The proposal request timed out.'});
    if(error instanceof ProposalRequestError) return json(error.status,{error:error.message});
    return json(502,{error:'The AI provider could not complete this request.'});
  } finally {
    if(timer!==undefined) clearTimeout(timer);
    request.signal.removeEventListener('abort',disconnect);
    controller?.abort();
    if(acquired) inFlight--;
  }
}
