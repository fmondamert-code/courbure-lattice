// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import {handleAIRequest} from './ai-worker.mjs';
import {assets,importMapHash} from '../.build/assets.mjs';
const POLICY=["default-src 'self'",`script-src 'self' 'wasm-unsafe-eval' 'sha256-${importMapHash}'`,"style-src 'self' 'unsafe-inline'","img-src 'self' data: blob:","font-src 'self'","connect-src 'self' http://127.0.0.1:* http://localhost:* https://127.0.0.1:* https://localhost:*","worker-src 'self' blob:","object-src 'none'","base-uri 'none'","form-action 'self'","frame-ancestors 'self' https://chatgpt.com"].join('; ');
// The model worker alone can fetch pinned public model assets. Document requests
// and all other workers retain the stricter same-origin / loopback policy.
const MODEL_POLICY=POLICY.replace(/connect-src [^;]+/,"connect-src 'self' https://huggingface.co https://raw.githubusercontent.com https://*.cdn.hf.co https://*.xethub.hf.co");
function secured(response,path){
 const headers=new Headers(response.headers);headers.set('Content-Security-Policy',path==='/browser-ai-worker.mjs'?MODEL_POLICY:POLICY);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname.startsWith('/api/ai/'))return secured(await handleAIRequest(request,env));
  if(!['GET','HEAD'].includes(request.method))return secured(new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}}));
  let path;try{path=decodeURIComponent(url.pathname);}catch{return secured(new Response('Bad path',{status:400}));}
  if(path==='/')path='/index.html';
  if(!Object.hasOwn(assets,path))return secured(new Response('Not found',{status:404}));
  const asset=assets[path],headers={'Content-Type':asset.type,'Cache-Control':path.startsWith('/vendor/')?'public, max-age=3600':'no-cache'};
  if(path.startsWith('/downloads/'))headers['Content-Disposition']='attachment; filename="courbure-starter.zip"';
  if(request.method==='HEAD')return secured(new Response(null,{headers}),path);
  const packed=Uint8Array.from(atob(asset.gzip),c=>c.charCodeAt(0));
  const body=new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'));
  return secured(new Response(body,{headers}),path);
 }
};
