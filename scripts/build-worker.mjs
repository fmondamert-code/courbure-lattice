// Build a self-contained Worker ESM. No runtime package/CDN/asset-binding dependency.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const root=resolve(import.meta.dirname,'..'),dist=join(root,'dist');
const MIME={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.wasm':'application/wasm','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8','.csv':'text/csv; charset=utf-8','.stl':'model/stl','.zip':'application/zip'};
const assets={};
async function scan(dir,prefix=''){
 for(const item of await readdir(dir,{withFileTypes:true})){
  if(['server','.openai'].includes(item.name))continue;
  const path=prefix+'/'+item.name;
  if(item.isDirectory())await scan(join(dir,item.name),path);
  else if(item.isFile()){const body=await readFile(join(dir,item.name));assets[path]={type:MIME[extname(item.name)]??'text/plain; charset=utf-8',gzip:gzipSync(body,{level:9}).toString('base64')};}
  else throw Error('Static assets must be regular files.');
 }
}
await scan(dist);
const html=await readFile(join(dist,'index.html'),'utf8'),map=html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];
if(!map)throw Error('Missing pinned import map for the content security policy.');
await mkdir(join(root,'.build'),{recursive:true});await mkdir(join(dist,'server'),{recursive:true});
await writeFile(join(root,'.build/assets.mjs'),'export const assets='+JSON.stringify(assets)+';\nexport const importMapHash='+JSON.stringify(createHash('sha256').update(map).digest('base64'))+';\n');
await build({entryPoints:[join(root,'server/index.mjs')],outfile:join(dist,'server/index.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'none',sourcemap:false});
console.log('Built Worker with '+Object.keys(assets).length+' local assets and the BYOK AI endpoint. No credentials embedded.');
