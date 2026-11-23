// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import createManifold from 'manifold-3d';
import {CURVED_DEMO, DEFAULT, calibrateBand, implicitField, validateSpec, binarySTL} from '../web/core.mjs';
import {generateDesign} from '../web/engine.mjs';

test('BCC struts meet at the center and reflected corners of a periodic cell', () => {
  for (const x of [-1,1]) for (const y of [-1,1]) for (const z of [-1,1]) {
    assert.ok(implicitField('bcc',x*Math.PI/2,y*Math.PI/2,z*Math.PI/2)<1e-12);
  }
  assert.ok(implicitField('bcc',Math.PI,0,0)>2);
  assert.ok(implicitField('bcc',2*Math.PI,0,0)<1e-12);
});

test('end plates consume part of the material budget', () => {
  const plain=calibrateBand({...DEFAULT,family:'bcc'});
  const plated=calibrateBand({...DEFAULT,family:'bcc',skin_mm:1});
  assert.equal(plated.plate_fraction,2/DEFAULT.height_mm);
  assert.ok(plated.core_target<DEFAULT.target_fraction);
  assert.ok(plated.band<plain.band);
  assert.throws(()=>validateSpec({...DEFAULT,height_mm:16,skin_mm:2,target_fraction:0.16}),/end plates/);
});

test('the curved BCC example is one closed part with a semi-annular envelope', async () => {
  const wasmBinary=await readFile(new URL(import.meta.resolve('manifold-3d/manifold.wasm')));
  const kernel=await createManifold({wasmBinary});
  kernel.setup();
  const {metrics,positions,indices}=generateDesign(kernel,CURVED_DEMO);
  const outer=CURVED_DEMO.size_mm/2, inner=outer-0.22*CURVED_DEMO.size_mm;
  const envelopeVolume=0.5*Math.PI*(outer**2-inner**2)*CURVED_DEMO.height_mm;
  assert.equal(metrics.kernel_status,'NoError');
  assert.equal(metrics.components,1);
  assert.ok(Math.abs(metrics.envelope_volume_mm3/envelopeVolume-1)<0.001);
  assert.ok(Math.abs(metrics.target_error_percentage_points)<1);
  const fractions=metrics.layer_fractions_bottom_to_top;
  const volumes=metrics.layer_envelope_volumes_mm3;
  assert.ok(fractions[2]>fractions[0]);
  const measuredMaterial=volumes.reduce((sum,v,i)=>sum+v*fractions[i],0);
  assert.ok(Math.abs(measuredMaterial/metrics.volume_mm3-1)<1e-7);
  assert.ok(Math.abs(volumes.reduce((sum,v)=>sum+v,0)/metrics.envelope_volume_mm3-1)<1e-7);
  const bytes=binarySTL(positions,indices),view=new DataView(bytes),count=view.getUint32(80,true);
  assert.equal(count,metrics.triangles);
  assert.equal(bytes.byteLength,84+50*count);
  let exportedVolume=0;
  for(let i=0;i<count;i++){
    const xyz=Array.from({length:9},(_,j)=>view.getFloat32(84+50*i+12+4*j,true));
    assert.ok(xyz.every(Number.isFinite));
    const [ax,ay,az,bx,by,bz,cx,cy,cz]=xyz;
    exportedVolume+=ax*(by*cz-bz*cy)+ay*(bz*cx-bx*cz)+az*(bx*cy-by*cx);
  }
  assert.ok(Math.abs(exportedVolume/6/metrics.volume_mm3-1)<1e-6);
});

test('graded gyroid STL preserves distinct closed sheets after Float32 serialization',async()=>{
  const wasmBinary=await readFile(new URL(import.meta.resolve('manifold-3d/manifold.wasm')));
  const kernel=await createManifold({wasmBinary});kernel.setup();
  const {positions,indices,metrics}=generateDesign(kernel,{...DEFAULT,gradient:-.4,size_mm:24,height_mm:24});
  const file=new DataView(binarySTL(positions,indices)),n=file.getUint32(80,true);
  const vertices=new Map(),edges=new Map();
  for(let i=0;i<n;i++){
    const face=[],at=84+50*i;
    const normal=Array.from({length:3},(_,k)=>file.getFloat32(at+4*k,true));
    assert.ok(Math.abs(Math.hypot(...normal)-1)<1e-6,'binary facet must have a unit normal');
    for(let j=0;j<3;j++){
      const xyz=Array.from({length:3},(_,k)=>file.getFloat32(at+12+12*j+4*k,true)).join(',');
      if(!vertices.has(xyz))vertices.set(xyz,vertices.size);
      face.push(vertices.get(xyz));
    }
    for(let j=0;j<3;j++){
      const a=face[j],b=face[(j+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(',');
      const entry=edges.get(key)??[0,0];
      entry[0]++;entry[1]+=Math.sign(b-a);edges.set(key,entry);
    }
  }
  for(const [count,balance] of edges.values())assert.ok(count===2 && balance===0,'every STL edge must have two opposite faces');
  assert.equal(metrics.export_topology,'closed_oriented_float32');
  assert.equal(metrics.components,3);
  assert.ok(metrics.layer_fractions_bottom_to_top[0]>metrics.layer_fractions_bottom_to_top[2]);
});
