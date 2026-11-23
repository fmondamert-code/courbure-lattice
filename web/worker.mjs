import createManifold from './vendor/manifold/manifold.js';
import {generateDesign} from './engine.mjs';
const modulePromise=createManifold({locateFile:path=>new URL('./vendor/manifold/'+path,import.meta.url).href}).then(m=>{m.setup();return m;});
self.onmessage=async event=>{
  const {id,spec,envelopeMesh}=event.data;
  try {
    const module=await modulePromise;
    const result=generateDesign(module,spec,message=>self.postMessage({id,type:'progress',message}),{envelopeMesh});
    self.postMessage({id,type:'result',result},[result.positions.buffer,result.indices.buffer]);
  } catch(error) {self.postMessage({id,type:'error',message:String(error?.message||error)});}
};
