// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {strFromU8,strToU8,unzipSync,zipSync} from 'fflate';
import {DEFAULT} from '../web/core.mjs';
import {createPrintPackage,encode3MF} from '../web/printing.mjs';

const design={spec:DEFAULT,positions:new Float32Array([-2,-1,-3,6,-1,-3,-2,5,-3,-2,-1,4.25]),
  indices:new Uint32Array([0,2,1,0,1,3,0,3,2,1,2,3])};
const project={format:'courbure-design',version:2,design:DEFAULT};
const profileINI='printer_technology = FFF\nbed_shape = 0x0,250x0,250x210,0x210\nnozzle_diameter = 0.4\nfilament_type = PLA\nfilament_diameter = 1.75\ntemperature = 205\nbed_temperature = 60\nlayer_height = 0.2\n';

test('3MF mesh preserves indexed coordinates, winding and build-plate placement in millimetres',()=>{
  const bytes=encode3MF(design),parts=unzipSync(bytes);
  assert.deepEqual(Object.keys(parts).sort(),['3D/3dmodel.model','[Content_Types].xml','_rels/.rels']);
  assert.match(strFromU8(parts['_rels/.rels']),/Target="\/3D\/3dmodel\.model"/);
  const model=strFromU8(parts['3D/3dmodel.model']);
  assert.match(model,/<model unit="millimeter"/);
  const points=[...model.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].flatMap(m=>m.slice(1).map(Number));
  const faces=[...model.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)].flatMap(m=>m.slice(1).map(Number));
  assert.deepEqual(points,Array.from(design.positions));
  assert.deepEqual(faces,Array.from(design.indices));
  assert.match(model,/transform="1 0 0 0 1 0 0 0 1 0 0 3"/);
  assert.deepEqual(encode3MF(design),bytes);
  assert.throws(()=>encode3MF({...design,indices:design.indices.slice(3),metrics:{export_topology:'closed_oriented_float32'}}),/triangle data|open/);
});

test('manufacturing ZIP carries both meshes, the matching recipe and instructions',()=>{
  const contents=unzipSync(createPrintPackage(design,project));
  assert.deepEqual(Object.keys(contents).sort(),['PRINTING.txt','project.json','specimen.3mf','specimen.stl']);
  assert.deepEqual(JSON.parse(strFromU8(contents['project.json'])),project);
  assert.deepEqual(contents['specimen.3mf'],encode3MF(design));
  assert.equal(new DataView(contents['specimen.stl'].buffer,contents['specimen.stl'].byteOffset).getUint32(80,true),4);
  assert.match(strFromU8(contents['PRINTING.txt']),/printer, nozzle, material and print profile/);
  assert.throws(()=>createPrintPackage(design,{...project,design:{...DEFAULT,cell_mm:9}}),/recipes do not match/);
});

test('local slicer requires an explicit machine/material profile and preserves an existing output',async()=>{
  const folder=await mkdtemp(path.join(tmpdir(),'courbure-print-'));
  const model=path.join(folder,'specimen.3mf'),profile=path.join(folder,'config.ini'),out=path.join(folder,'print.gcode');
  const script=fileURLToPath(new URL('../scripts/slice.py',import.meta.url));
  const run=()=>spawnSync('python3',[script,'--model',model,'--profile',profile,'--output',out,'--slicer',process.execPath],{encoding:'utf8'});
  try{
    await writeFile(model,encode3MF(design));
    await writeFile(profile,'layer_height = 0.2\n');
    assert.match(run().stderr,/configuration must specify/);
    await writeFile(profile,profileINI+'  post_process = example-script\n');
    assert.match(run().stderr,/Post-processing commands must be empty/);
    await writeFile(profile,profileINI);
    const parts=unzipSync(encode3MF(design));
    parts['Metadata/Slic3r_PE.config']=strToU8('embedded settings');
    await writeFile(model,zipSync(parts));
    assert.match(run().stderr,/geometry-only 3MF/);
    await writeFile(out,'existing output');
    assert.match(run().stderr,/Output already exists/);
    assert.equal(await readFile(out,'utf8'),'existing output');
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('local slicer can position an origin-centered 3MF on a positive-coordinate bed',async()=>{
  const folder=await mkdtemp(path.join(tmpdir(),'courbure-print-'));
  const model=path.join(folder,'specimen.3mf'),profile=path.join(folder,'config.ini'),out=path.join(folder,'print.gcode');
  const slicer=path.join(folder,'slicer');
  const script=fileURLToPath(new URL('../scripts/slice.py',import.meta.url));
  const run=(...center)=>spawnSync('python3',[script,'--model',model,'--profile',profile,'--output',out,
    '--slicer',slicer,'--center',...center],{encoding:'utf8'});
  try{
    await writeFile(model,encode3MF(design));
    await writeFile(profile,profileINI);
    await writeFile(slicer,`#!/usr/bin/env python3
import sys
from pathlib import Path
args = sys.argv[1:]
if '--center' not in args or args[args.index('--center') + 1] != '125.0,105.0':
    sys.exit('All objects are outside of the print volume.')
Path(args[args.index('--output') + 1]).write_text('G1 X125 Y105 E1\\n')
`,{mode:0o700});
    const invalid=run('NaN','105');
    assert.equal(invalid.status,1);
    assert.match(invalid.stderr,/finite X and Y/);
    const result=run('125','105');
    assert.equal(result.status,0,result.stderr);
    assert.equal(await readFile(out,'utf8'),'G1 X125 Y105 E1\n');
  }finally{await rm(folder,{recursive:true,force:true});}
});
