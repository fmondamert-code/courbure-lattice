// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import {createServer} from 'node:http';
import {on} from 'node:events';
import {pathToFileURL} from 'node:url';
import {buildSystemPrompt,modelReplySchema,parseModelReply,parseUniqueJSON} from '../web/ai-gate.mjs';
import {validatePromptRequest,requestOfficialProposal,ProposalRequestError} from '../server/ai-worker.mjs';

const REQUEST_LIMIT=32*1024, UPSTREAM_LIMIT=128*1024;
const LOCAL_HOSTS=new Set(['localhost','127.0.0.1','[::1]']);
const DEFAULT_ORIGINS='http://localhost:5173,http://127.0.0.1:5173';

class GatewayError extends Error {
  constructor(status,message) {super(message);this.status=status;}
}
function integerSetting(value,fallback,min,max) {
  const number=value===undefined?fallback:Number(value);
  if(!Number.isInteger(number)||number<min||number>max) throw Error('Invalid integer gateway setting.');
  return number;
}

export function configFromEnv(env=process.env) {
  const provider=env.COURBURE_AI_PROVIDER||'ollama';
  if(!['ollama','openai-compatible','openai'].includes(provider)) throw Error('Unsupported AI provider.');
  const model=env.COURBURE_AI_MODEL||(provider==='ollama'?'qwen3:4b':'');
  if(typeof model!=='string'||!model.trim()||model.length>160||/[\x00-\x1f\x7f]/.test(model)) throw Error('Configure a valid COURBURE_AI_MODEL.');
  if(provider==='ollama'&&/[:-]cloud(?:$|[-:])/i.test(model)) throw Error('Cloud-tagged Ollama models are disabled in loopback mode.');
  const apiKey=env.COURBURE_AI_API_KEY||'';
  if(provider==='openai'&&model!=='gpt-6-luna') throw Error('Official OpenAI mode currently supports gpt-6-luna.');
  if(provider==='openai'&&!apiKey.trim()) throw Error('Official OpenAI mode requires COURBURE_AI_API_KEY.');
  if(/[\r\n]/.test(apiKey)) throw Error('Invalid upstream credential.');
  let base;
  if(provider==='openai') {
    if(env.COURBURE_AI_BASE_URL) throw Error('Official OpenAI mode uses a fixed endpoint. Unset COURBURE_AI_BASE_URL.');
    base=new URL('https://api.openai.com/v1/');
  } else {
    base=new URL(env.COURBURE_AI_BASE_URL||(provider==='ollama'?'http://127.0.0.1:11434':'http://127.0.0.1:4000/v1'));
    if(!['http:','https:'].includes(base.protocol)||!LOCAL_HOSTS.has(base.hostname)||base.username||base.password||base.search||base.hash) {
      throw Error('The model endpoint must use a loopback HTTP(S) address without credentials or query parameters.');
    }
    if(base.hostname==='localhost') base.hostname='127.0.0.1';
  }
  base.pathname=base.pathname.replace(/\/+$/,'')+(provider==='ollama'?'/api/chat':provider==='openai'?'/responses':'/chat/completions');
  const origins=new Set();
  for(const item of (env.COURBURE_ALLOWED_ORIGINS??DEFAULT_ORIGINS).split(',')) {
    const origin=item.trim(),parsed=new URL(origin);
    if(parsed.origin!==origin||!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password) throw Error('Enter exact HTTP(S) origins without paths in COURBURE_ALLOWED_ORIGINS.');
    origins.add(origin);
  }
  return {provider,model,apiKey,endpoint:base.href,origins,
    port:integerSetting(env.COURBURE_GATEWAY_PORT,4317,1,65535),
    timeoutMs:integerSetting(env.COURBURE_AI_TIMEOUT_MS,45000,50,120000)};
}

function payload(config,input) {
  const schema=modelReplySchema(input.action);
  const messages=[
    {role:'system',content:buildSystemPrompt()+'\nReturn a single JSON object matching this schema.\n'+JSON.stringify(schema)},
    {role:'user',content:JSON.stringify(input)},
  ];
  if(config.provider==='ollama') return {model:config.model,messages,format:schema,stream:false,think:false,options:{temperature:0,num_predict:1024}};
  // Some compatible gateways accept JSON mode only. Validate the inner object
  // locally for all providers, including those honoring a strict response format.
  return {model:config.model,messages,response_format:{type:'json_object'},stream:false,max_tokens:1024};
}

async function parseRequestBody(req,signal) {
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||'')) throw new GatewayError(415,'Use Content-Type application/json.');
  if(req.headers['content-encoding'] && req.headers['content-encoding']!=='identity') throw new GatewayError(415,'Compressed request bodies are not supported.');
  if(Number(req.headers['content-length'])>REQUEST_LIMIT) throw new GatewayError(413,'Request exceeds 32 KiB.');
  let size=0;const chunks=[];
  for await(const _ of on(req,'readable',{signal,close:['end','close']})) {
    let chunk;
    while((chunk=req.read())!==null) {
      size+=chunk.length;
      if(size>REQUEST_LIMIT) throw new GatewayError(413,'Request exceeds 32 KiB.');
      chunks.push(chunk);
    }
  }
  signal.throwIfAborted();
  try {return parseUniqueJSON(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
  catch {throw new GatewayError(400,'Request body must be valid UTF-8 JSON.');}
}

async function upstreamProposal(config,input,signal,fetchFn) {
  const headers={'Content-Type':'application/json'};
  if(config.apiKey) headers.Authorization='Bearer '+config.apiKey;
  let response;
  try {response=await fetchFn(config.endpoint,{method:'POST',headers,body:JSON.stringify(payload(config,input)),redirect:'error',signal});}
  catch {throw new GatewayError(502,'Cannot reach the configured model endpoint.');}
  if(!response.ok) throw new GatewayError(502,'The model endpoint returned HTTP '+response.status+'.');
  if(Number(response.headers.get('content-length'))>UPSTREAM_LIMIT || !response.body) throw new GatewayError(502,'Invalid or oversized model response.');
  const chunks=[];let length=0;
  for await(const chunk of response.body) {
    length+=chunk.byteLength;
    if(length>UPSTREAM_LIMIT) throw new GatewayError(502,'Model response exceeds 128 KiB.');
    chunks.push(chunk);
  }
  let proposal;
  try {
    const outer=parseUniqueJSON(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    let message;
    if(config.provider==='ollama') {
      if(outer.done!==true || (outer.done_reason!==undefined && outer.done_reason!=='stop')) throw Error();
      message=outer.message;
    } else {
      if(!Array.isArray(outer.choices) || outer.choices.length!==1 || outer.choices[0]?.finish_reason!=='stop') throw Error();
      message=outer.choices[0].message;
    }
    if(message?.role!=='assistant' || typeof message.content!=='string' || message.refusal || message.function_call ||
      (message.tool_calls!=null && (!Array.isArray(message.tool_calls) || message.tool_calls.length))) throw Error();
    proposal=parseModelReply(message.content,input.action);
  } catch {throw new GatewayError(502,'The model returned an invalid or incomplete Courbure proposal.');}
  if(proposal===null) throw new GatewayError(422,'The model needs a clearer brief or additional targets for this task.');
  return proposal;
}

function send(res,status,object) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(object));
}

function confirmedInput(value,config) {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new GatewayError(400,'Expected a JSON object.');
  const {expected_provider,expected_model,...input}=value;
  if(expected_provider!==undefined || expected_model!==undefined) {
    if(!['ollama','openai-compatible','openai'].includes(expected_provider) || typeof expected_model!=='string' ||
      !expected_model.trim() || expected_model.length>160 || /[\x00-\x1f\x7f]/.test(expected_model))
      throw new GatewayError(400,'Supply both the provider and model from the gateway health check.');
    if(expected_provider!==config.provider || expected_model!==config.model)
      throw new GatewayError(409,'The gateway provider or model changed. Reconnect and review the destination.');
  }
  return validatePromptRequest(input,{requireAction:config.provider==='openai'});
}

export function createGatewayServer(config=configFromEnv(),fetchFn=fetch) {
  let busy=false;
  const server=createServer({maxHeaderSize:8192,requestTimeout:15000,headersTimeout:10000},async(req,res)=>{
    let acquired=false,timer,controller,deadline=false;
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Vary','Origin');
    try {
      if(!/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(req.headers.host||'')) throw new GatewayError(403,'Gateway Host header must address loopback.');
      const origin=req.headers.origin;
      if(!origin||!config.origins.has(origin)) throw new GatewayError(403,'Browser origin is not allowed.');
      res.setHeader('Access-Control-Allow-Origin',origin);
      const requiredMethod=req.url==='/health'?'GET':req.url==='/propose'?'POST':null;
      if(!requiredMethod) throw new GatewayError(404,'Unknown gateway route.');
      if(req.method==='OPTIONS') {
        const headers=(req.headers['access-control-request-headers']||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
        if(req.headers['access-control-request-method']!==requiredMethod||headers.some(h=>h!=='content-type')) throw new GatewayError(403,'Preflight method or headers are not allowed.');
        res.setHeader('Access-Control-Allow-Methods',requiredMethod);
        res.setHeader('Access-Control-Allow-Headers','Content-Type');
        if(req.headers['access-control-request-private-network']==='true') res.setHeader('Access-Control-Allow-Private-Network','true');
        res.writeHead(204);res.end();return;
      }
      if(req.method!==requiredMethod) {res.setHeader('Allow',requiredMethod+', OPTIONS');throw new GatewayError(405,'Method not allowed.');}
      if(req.url==='/health') {send(res,200,{ok:true,provider:config.provider,model:config.model,schema_version:1});return;}
      if(busy) throw new GatewayError(429,'Another proposal is being processed.');
      busy=true;acquired=true;
      controller=new AbortController();
      res.once('close',()=>controller.abort());
      timer=setTimeout(()=>{deadline=true;controller.abort();},config.timeoutMs);
      const input=confirmedInput(await parseRequestBody(req,controller.signal),config);
      if(config.provider==='openai') {
        send(res,200,await requestOfficialProposal({input,model:config.model,credential:config.apiKey,signal:controller.signal,fetchFn}));
      } else {
        const proposal=await upstreamProposal(config,input,controller.signal,fetchFn);
        send(res,200,{proposal,provider:config.provider,model:config.model});
      }
    } catch(error) {
      if(!res.destroyed&&!res.headersSent) {
        if(!req.complete) {res.setHeader('Connection','close');req.resume();}
        const expected=error instanceof GatewayError||error instanceof ProposalRequestError;
        const status=deadline?504:(expected?error.status:502);
        if(status===429) res.setHeader('Retry-After','1');
        send(res,status,{error:deadline?'The proposal request timed out.':(expected?error.message:'The model response could not be processed.')});
      }
    } finally {
      clearTimeout(timer);controller?.abort();if(acquired) busy=false;
    }
  });
  server.keepAliveTimeout=5000;
  return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const config=configFromEnv(),server=createGatewayServer(config);
    server.on('error',()=>{console.error('The local Courbure gateway could not listen. Check the configured port.');process.exitCode=1;});
    server.listen(config.port,'127.0.0.1',()=>console.log('Courbure gateway listening on http://127.0.0.1:'+config.port+' ('+config.provider+').'));
  } catch {console.error('Invalid Courbure gateway configuration. Check provider, model, permitted origins and local endpoint.');process.exitCode=1;}
}
