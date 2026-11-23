// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import createManifold from 'manifold-3d';
import {DEFAULT,binarySTL,meshData} from '../web/core.mjs';
import {generateDesign} from '../web/engine.mjs';
import {parseSTLEnvelope,validateEnvelopeMesh,MAX_STL_BYTES} from '../web/envelope-import.mjs';

const vertices=[0,0,0,24,0,0,0,16,0,0,0,18];
const faces=[0,2,1,0,1,3,0,3,2,1,2,3];
const encode=text=>new TextEncoder().encode(text).buffer;
function asciiSTL(points=vertices,indices=faces) {
  const records=[];
  for(let i=0;i<indices.length;i+=3) {
    const lines=['facet normal 0 0 0','outer loop'];
    for(const index of indices.slice(i,i+3)) lines.push('vertex '+points.slice(3*index,3*index+3).join(' '));
    records.push(...lines,'endloop','endfacet');
  }
  return 'solid fixture\n'+records.join('\n')+'\nendsolid fixture\n';
}

test('ASCII and binary preserve dimensions, unit choice, centered coordinates and explicit uniform fit',()=>{
  const ascii=parseSTLEnvelope(encode(asciiSTL(vertices.map(v=>v/10))),{unit:'cm'});
  const binary=parseSTLEnvelope(binarySTL(vertices,faces),{unit:'mm'});
  assert.deepEqual(ascii.positions,binary.positions);
  assert.deepEqual(ascii.indices,binary.indices);
  assert.deepEqual(ascii.dimensions_mm,[24,16,18]);
  assert.equal(ascii.scale_to_mm,10);
  assert.deepEqual(validateEnvelopeMesh({positions:Array.from(ascii.positions),indices:Array.from(ascii.indices)}).positions,binary.positions);
  const fit=parseSTLEnvelope(binarySTL(vertices,faces),{unit:'inch',fit_mm:36});
  assert.deepEqual(fit.dimensions_mm,[36,24,27]);
  assert.equal(fit.triangle_count,4);
});

test('rejects invalid syntax, coordinates, dimensions, face indices and incoherent topology',()=>{
  assert.throws(()=>parseSTLEnvelope(encode(asciiSTL().replace('endloop','endfacet'))),/Malformed/);
  assert.throws(()=>parseSTLEnvelope(encode(asciiSTL().replace('vertex 0 0 0','vertex 1e999 0 0'))),/nonfinite/);
  assert.throws(()=>parseSTLEnvelope(new ArrayBuffer(MAX_STL_BYTES+1)),/8 MiB/);
  assert.throws(()=>parseSTLEnvelope(binarySTL(vertices,faces),{unit:'ft'}),/units/);
  assert.throws(()=>parseSTLEnvelope(binarySTL(vertices,faces),{unit:'inch'}),/span/);
  const {positions,indices}=parseSTLEnvelope(binarySTL(vertices,faces));
  const invalid=Array.from(indices);invalid[0]=9999;
  assert.throws(()=>validateEnvelopeMesh({positions,indices:invalid}),/vertex index/);
  const badWinding=Array.from(indices);[badWinding[0],badWinding[1]]=[badWinding[1],badWinding[0]];
  assert.throws(()=>validateEnvelopeMesh({positions,indices:badWinding}),/winding/);
  const insideOut=Array.from(indices).reverse();
  assert.throws(()=>validateEnvelopeMesh({positions,indices:insideOut}),/outward-facing/);
  const touching=vertices.concat(vertices.map(x=>-x));
  const touchingFaces=faces.concat(faces.map(i=>i+4).reverse());
  assert.throws(()=>parseSTLEnvelope(binarySTL(touching,touchingFaces)),/nonmanifold vertex/);
});

const kernel=createManifold({wasmBinary:await readFile(new URL(import.meta.resolve('manifold-3d/manifold.wasm')))}).then(m=>{m.setup();return m;});
test('closed imported tetrahedron clips the lattice, conserves layered volume and accounts for actual plate volume',async()=>{
  const module=await kernel,imported=parseSTLEnvelope(binarySTL(vertices,faces));
  const spec={...DEFAULT,envelope:'mesh',family:'bcc',size_mm:imported.size_mm,height_mm:imported.height_mm,cell_mm:8};
  const result=generateDesign(module,spec,undefined,{envelopeMesh:imported});
  assert.equal(result.metrics.kernel_status,'NoError');
  assert.ok(Math.abs(result.metrics.envelope_volume_mm3-1152)<1e-6);
  assert.deepEqual(result.metrics.envelope_dimensions_mm,[24,16,18]);
  assert.ok(Math.abs(result.metrics.mesh_fraction-spec.target_fraction)<0.03);
  assert.ok(result.metrics.layer_envelope_volumes_mm3[0]>result.metrics.layer_envelope_volumes_mm3[2]);
  for(let i=0;i<result.positions.length;i+=3){
    const [x,y,z]=result.positions.subarray(i,i+3);
    assert.ok((x+12)/24+(y+8)/16+(z+9)/18<=1.00001);
    assert.ok(x>=-12.00001 && y>=-8.00001 && z>=-9.00001);
  }
  assert.throws(()=>generateDesign(module,spec),/envelope mesh is required/);
  assert.throws(()=>generateDesign(module,{...spec,size_mm:30},undefined,{envelopeMesh:imported}),/dimensions/);
  assert.throws(()=>generateDesign(module,{...spec,skin_mm:2,target_fraction:0.16},undefined,{envelopeMesh:imported}),/end plates/);
});

test('a through-hole remains empty and an open surface is rejected',async()=>{
  const module=await kernel,keep=[];
  try{
    const cuboid=module.Manifold.cube([30,24,14],true);keep.push(cuboid);
    const bore=module.Manifold.cylinder(18,6,6,32,true);keep.push(bore);
    const hollow=cuboid.subtract(bore);keep.push(hollow);
    const {positions,indices}=meshData(hollow.getMesh());
    assert.throws(()=>parseSTLEnvelope(binarySTL(positions,indices.slice(3))),/open/);
    const imported=parseSTLEnvelope(binarySTL(positions,indices));
    const spec={...DEFAULT,envelope:'mesh',size_mm:30,height_mm:14,cell_mm:8,skin_mm:0.8};
    const result=generateDesign(module,spec,undefined,{envelopeMesh:imported});
    assert.ok(Math.abs(result.metrics.envelope_volume_mm3/hollow.volume()-1)<1e-6);
    for(let i=0;i<result.positions.length;i+=3) assert.ok(Math.hypot(result.positions[i],result.positions[i+1])>=5.96);
  } finally {keep.reverse().forEach(s=>s.delete());}
});

test('an enclosed void counts as a cavity, while an empty height band separates two solids',async()=>{
  const {Manifold}=await kernel,shapes=[];
  const hold=m=>{shapes.push(m);return m;};
  try{
    const cube=hold(Manifold.cube([24,24,24],true)),voidCube=hold(Manifold.cube([.5,.5,.5],true));
    const hollow=hold(cube.subtract(voidCube));
    const spec={...DEFAULT,family:'bcc',envelope:'mesh',size_mm:24,height_mm:24};
    const closed=generateDesign(await kernel,spec,undefined,{envelopeMesh:meshData(hollow.getMesh())}).metrics;
    assert.equal(closed.components,1);
    assert.equal(closed.enclosed_cavities,1);
    assert.ok(Math.abs(closed.envelope_volume_mm3-(24**3-.5**3))<1e-6);
    const plate=hold(Manifold.cube([16,14,4],true));
    const pair=hold(hold(plate.translate([0,0,-10])).add(hold(plate.translate([0,0,10]))));
    const split=generateDesign(await kernel,{...spec,size_mm:16,skin_mm:.15,cell_mm:8,gradient:.25},undefined,{envelopeMesh:meshData(pair.getMesh())}).metrics;
    assert.equal(split.components,2);
    assert.equal(split.enclosed_cavities,0);
    assert.equal(split.layer_envelope_volumes_mm3[1],0);
    assert.equal(split.layer_fractions_bottom_to_top[1],null);
    assert.ok(Math.abs(split.plate_fraction-.15/4)<1e-9);
  }finally{shapes.reverse().forEach(s=>s.delete());}
});
