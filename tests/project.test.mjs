import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULT} from '../web/core.mjs';
import {parseSTLEnvelope} from '../web/envelope-import.mjs';
import {parseMaterialCSV} from '../web/material.mjs';
import {createProject,readProject,specimenReport} from '../web/project.mjs';
const objective={mass_kg:.5,drop_m:.5,stroke_mm:15,max_force_n:450,size_mm:36,height_mm:30,soft_contact:true};
test('local project replays exact envelope and material data without trusting supplied results',async()=>{
 const bytes=await readFile(new URL('../web/examples/stepped-envelope.stl',import.meta.url));
 const envelopeMesh=parseSTLEnvelope(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),{unit:'mm'});
 const material=await parseMaterialCSV(await readFile(new URL('../web/examples/synthetic-compression-curves.csv',import.meta.url),'utf8'));
 const spec={...DEFAULT,family:'bcc',envelope:'mesh',size_mm:envelopeMesh.size_mm,height_mm:envelopeMesh.height_mm};
 const design={spec,engine:{name:'courbure',version:'0.2.0'},metrics:{volume_mm3:10,mesh_fraction:.3,components:1,triangles:5,grid_edge_mm:.8,layer_fractions_bottom_to_top:[.2,.3,.4]}};
 const project=createProject({design,envelopeMesh,material,useMaterial:true,objective});
 project.metrics.volume_mm3=-999;project.elastic_analysis={model:'untrusted data'};
 const replay=await readProject(JSON.stringify(project));
 assert.deepEqual(replay.spec,spec);assert.deepEqual(replay.envelopeMesh.positions,envelopeMesh.positions);assert.equal(replay.material.sha256,material.sha256);assert.equal(replay.material.provenance,'synthetic_example');assert.equal(replay.metrics,undefined);assert.equal(replay.mechanics,undefined);assert.equal(replay.useMaterial,true);
 assert.match(specimenReport({...project,metrics:design.metrics,elastic_analysis:undefined}),/loading work is not dissipated energy/i);
});
test('projects reject corrupted evidence, missing envelopes and invalid objective boundaries',async()=>{
 const csv=await readFile(new URL('../web/examples/synthetic-compression-curves.csv',import.meta.url),'utf8');
 await assert.rejects(readProject(JSON.stringify({format:'courbure-design',version:2,design:DEFAULT,material_csv:csv,material_sha256:'bad'})),/fingerprint/);
 await assert.rejects(readProject(JSON.stringify({design:{...DEFAULT,envelope:'mesh'}})),/envelope|mesh/i);
 await assert.rejects(readProject(JSON.stringify({design:DEFAULT,objective:{...objective,stroke_mm:100}})),/Stroke/);
 await assert.rejects(readProject(JSON.stringify({format:'different',design:DEFAULT})),/not a Courbure/);
});

test('project replay rejects missing evidence and geometry or objective dimensions it cannot reproduce',async()=>{
 const open=fields=>readProject(JSON.stringify({format:'courbure-design',version:2,design:DEFAULT,...fields}));
 const csv=await readFile(new URL('../web/examples/synthetic-compression-curves.csv',import.meta.url),'utf8');
 await assert.rejects(open({response_source:'curves'}),/missing its compression CSV/);
 await assert.rejects(open({response_source:'curves',material_csv:csv}),/fingerprint/);
 await assert.rejects(open({response_source:'unexpected'}),/response source/);
 await assert.rejects(open({objective:{...objective,size_mm:50}}),/36 × 36 × 30/);
 await assert.rejects(open({mechanics_inputs:{young_mpa:1000,poisson:.3,strain:.009}}),/strain of 0.001/);
 const bytes=await readFile(new URL('../web/examples/stepped-envelope.stl',import.meta.url));
 const mesh=parseSTLEnvelope(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 await assert.rejects(open({design:{...DEFAULT,envelope:'mesh',size_mm:35},envelope_mesh:{positions:Array.from(mesh.positions),indices:Array.from(mesh.indices)}}),/dimensions/);
 assert.equal((await readProject(JSON.stringify(DEFAULT))).material,null);
});
