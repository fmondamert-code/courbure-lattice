import {mkdir,cp,copyFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
const root=resolve(import.meta.dirname,'..'),dist=join(root,'dist');
await rm(dist,{recursive:true,force:true});
await mkdir(dist,{recursive:true});
await cp(join(root,'web'),dist,{recursive:true});
await mkdir(join(dist,'vendor','three'),{recursive:true});
await mkdir(join(dist,'vendor','manifold'),{recursive:true});
await mkdir(join(dist,'vendor','webllm'),{recursive:true});
await mkdir(join(dist,'vendor','rapier'),{recursive:true});
await mkdir(join(dist,'vendor','fflate'),{recursive:true});
for(const file of ['three.module.js','three.webgpu.js','three.core.js']) await copyFile(join(root,'node_modules/three/build',file),join(dist,'vendor/three',file));
await copyFile(join(root,'node_modules/three/examples/jsm/controls/OrbitControls.js'),join(dist,'vendor/three/OrbitControls.js'));
for(const file of ['manifold.js','manifold.wasm']) await copyFile(join(root,'node_modules/manifold-3d',file),join(dist,'vendor/manifold',file));
await copyFile(join(root,'node_modules/three/LICENSE'),join(dist,'vendor/three/LICENSE'));
await copyFile(join(root,'node_modules/manifold-3d/LICENSE'),join(dist,'vendor/manifold/LICENSE'));
await copyFile(join(root,'node_modules/@mlc-ai/web-llm/lib/index.js'),join(dist,'vendor/webllm/web-llm.mjs'));
await copyFile(join(root,'node_modules/@mlc-ai/web-llm/LICENSE'),join(dist,'vendor/webllm/LICENSE'));
await copyFile(join(root,'node_modules/loglevel/LICENSE-MIT'),join(dist,'vendor/webllm/loglevel-LICENSE-MIT'));
await copyFile(join(root,'node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs'),join(dist,'vendor/rapier/rapier.mjs'));
await copyFile(join(root,'node_modules/@dimforge/rapier3d-compat/LICENSE'),join(dist,'vendor/rapier/LICENSE'));
await copyFile(join(root,'node_modules/fflate/LICENSE'),join(dist,'vendor/fflate/LICENSE'));
await build({entryPoints:[join(root,'web/print-worker.mjs')],outfile:join(dist,'print-worker.mjs'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'inline'});
await cp(join(root,'docs'),join(dist,'docs'),{recursive:true});
for(const file of ['README.md','LICENSE','NOTICE','CODEX_HANDOFF.md']) {
  try {await copyFile(join(root,file),join(dist,'docs',file));} catch(error) {if(error.code!=='ENOENT') throw error;}
}
console.log('Built local assets in dist. No network calls during the build.');
execFileSync('python3',[join(root,'scripts/package-source.py')],{cwd:root,stdio:'inherit'});
await import('./build-worker.mjs');
