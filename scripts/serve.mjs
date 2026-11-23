// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
// Development adapter for the same self-contained Worker used in production.
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import app from '../dist/server/index.js';
const args=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
const port=Number(option('--port')??process.env.PORT??5173);
const host=option('--host')??process.env.HOST??(process.env.SITES_MANAGED_LINUX_CONTAINER==='1'?'0.0.0.0':'127.0.0.1');
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid development port.');
const server=createServer({maxHeaderSize:16384,requestTimeout:60000,headersTimeout:15000},async(req,res)=>{
 const controller=new AbortController();
 req.once('aborted',()=>controller.abort());
 res.once('close',()=>{if(!res.writableEnded)controller.abort();});
 try{
  const headers=new Headers();for(const [key,value]of Object.entries(req.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):value);
  const request=new Request(new URL(req.url||'/',`http://${req.headers.host||'127.0.0.1:'+port}`),{
   method:req.method,headers,signal:controller.signal,
   ...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})
  });
  const response=await app.fetch(request,{},{});
  res.writeHead(response.status,Object.fromEntries(response.headers));
  if(response.body){const stream=Readable.fromWeb(response.body);stream.on('error',()=>res.destroy());stream.pipe(res);}
  else res.end();
 }catch{
  if(!res.headersSent)res.writeHead(500,{'Content-Type':'text/plain','Cache-Control':'no-store'});
  if(!res.destroyed)res.end('The request could not be completed.');
 }
});
server.keepAliveTimeout=5000;
server.listen(port,host,()=>console.log(`Courbure is available on http://${host}:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));
