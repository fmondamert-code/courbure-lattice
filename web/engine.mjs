// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import {validateSpec,gridEdge,calibrateBand,implicitField,localScale,cavityRadius,curvedInnerRadius,meshData,signedMeshVolume,ENGINE} from './core.mjs';
import {assertClosedMesh,validateEnvelopeMesh} from './envelope-import.mjs';

// Calibration visits entire Z columns in order. A single accelerated kernel
// ray per column supplies the intervals through concavities and enclosed voids.
function importedDomain(shape,dimensions,plateFraction) {
  let lastX,lastY,events=[],next=0,inside=false;
  const reach=dimensions[2]/2+1;
  return {dimensions,plateFraction,contains(x,y,z) {
    if(x!==lastX || y!==lastY) {
      lastX=x;lastY=y;next=0;inside=false;events=[];
      // Sub-micron offsets avoid landing repeatedly on tessellation diagonals.
      const ox=x+1.234e-7,oy=y+2.675e-7;
      const hits=shape.rayCast([ox,oy,-reach],[ox,oy,reach]);
      for(const hit of hits) {
        const level=hit.position[2],dir=Math.sign(hit.normal[2]);
        if(!dir) continue;
        const previous=events.at(-1);
        if(previous && Math.abs(level-previous.level)<1e-7) {
          if(previous.dir!==dir) previous.dir=0;
        } else events.push({level,dir});
      }
      let occupied=false;
      for(const event of events) {
        if(!event.dir) continue;
        const entering=event.dir<0;
        if(entering===occupied) throw Error('Imported shell winding or overlapping solids produce an invalid interior.');
        occupied=entering;
      }
      if(occupied) throw Error('Imported envelope has an unclosed interior.');
    }
    while(next<events.length && events[next].level<=z) {
      const dir=events[next++].dir;
      if(dir) inside=dir<0;
    }
    return inside;
  }};
}

function layerVolumes(shape,height,keep) {
  // Both cuts operate on finished solids. A positive Z normal returns the
  // upper portion first, so order the final measurements from bottom to top.
  const [upperTwo,bottom]=shape.splitByPlane([0,0,1],-height/6);
  keep(upperTwo);
  keep(bottom);
  const [top,middle]=upperTwo.splitByPlane([0,0,1],height/6);
  keep(top);
  keep(middle);
  return [bottom,middle,top].map(layer=>{
    if(layer.status()!=='NoError') throw Error('Could not measure the three height bands.');
    const volume=layer.volume();
    if(!Number.isFinite(volume) || volume<0) throw Error('Invalid layer volume.');
    return volume;
  });
}

export function generateDesign(module,input,onProgress=()=>{},{envelopeMesh}={}) {
  const spec=validateSpec(input), {Manifold}=module, edge=gridEdge(spec), held=[];
  const keep=x=>{held.push(x);return x;};
  try {
    let envelope,imported;
    if(spec.envelope==='mesh') {
      onProgress('Validating the imported envelope');
      imported=validateEnvelopeMesh(envelopeMesh,spec);
      const mesh=new module.Mesh({numProp:3,vertProperties:imported.positions,triVerts:imported.indices});
      envelope=keep(Manifold.ofMesh(mesh));
      if(envelope.status()!=='NoError' || envelope.isEmpty() || !(envelope.volume()>0)) throw Error('Imported envelope is not an oriented, closed manifold with positive volume.');
    }
    else if(spec.envelope==='cylinder' || spec.envelope==='curved') envelope=keep(Manifold.cylinder(spec.height_mm,spec.size_mm/2,spec.size_mm/2,96,true));
    else envelope=keep(Manifold.cube([spec.size_mm,spec.size_mm,spec.height_mm],true));
    if(spec.envelope==='curved') {
      const inner=curvedInnerRadius(spec);
      const bore=keep(Manifold.cylinder(spec.height_mm+2*edge,inner,inner,96,true));
      const ring=keep(envelope.subtract(bore));
      const arch=keep(ring.trimByPlane([0,1,0],0));
      envelope=keep(arch.translate([0,-spec.size_mm/4,0]));
    }
    if(spec.envelope==='insert') {
      const sphere=keep(Manifold.sphere(cavityRadius(spec),64));
      const cutter=keep(sphere.translate([0,0,spec.height_mm/2]));
      envelope=keep(envelope.subtract(cutter));
    }
    const plates=[];
    if(spec.skin_mm>0) {
      const offset=spec.height_mm/2-spec.skin_mm;
      plates.push(keep(envelope.trimByPlane([0,0,1],offset)),keep(envelope.trimByPlane([0,0,-1],offset)));
    }
    const box=envelope.boundingBox(),dims=box.max.map((v,i)=>v-box.min[i]);
    const envelopeVolume=envelope.volume();
    const domain=imported?importedDomain(envelope,dims,plates.reduce((v,p)=>v+p.volume(),0)/envelopeVolume):undefined;
    onProgress('Calibrating the material fraction');
    const cal=calibrateBand(spec,49,domain),k=2*Math.PI/spec.cell_mm;
    const extent=imported?dims:[spec.size_mm,spec.size_mm,spec.height_mm];
    const bounds={min:extent.map(v=>-v/2-2*edge),max:extent.map(v=>v/2+2*edge)};
    onProgress('Meshing the implicit surface');
    // A sheet is the intersection of two smooth inequalities. Sampling their
    // absolute-value combination can pinch both sides onto one Float32 edge.
    const side=sign=>keep(Manifold.levelSet(([x,y,z])=>
      cal.band*localScale(spec,z)+sign*implicitField(spec.family,x*k,y*k,z*k),bounds,edge));
    const raw=side(-1);
    const opposite=spec.family==='bcc'?null:side(1);
    onProgress('Clipping and measuring the mesh');
    let solid=keep(raw.intersect(envelope));
    if(opposite) solid=keep(solid.intersect(opposite));
    if(plates.length) solid=keep(Manifold.union([solid,...plates]));
    const status=solid.status();
    if(status!=='NoError' || solid.isEmpty()) throw Error(`Geometry kernel rejected this design (${status}).`);
    const data=meshData(solid.getMesh()), volume=solid.volume();
    if(!Number.isFinite(volume)||volume<=0) throw Error('The result has no positive volume.');
    try { assertClosedMesh(data.positions,data.indices); }
    catch(error) { throw Error('The generated surface is not closed and manifold at STL precision. Change the resolution, cell pitch or grading. '+error.message); }
    const shells=solid.decompose();
    // A negative shell bounds an internal cavity within a material component.
    const count=shells.filter(shell=>shell.volume()>0).length;
    const cavities=shells.length-count;
    shells.forEach(shell=>shell.delete());
    const fraction=volume/envelopeVolume, difference=(fraction-spec.target_fraction)*100;
    const independentVolume=signedMeshVolume(data.positions,data.indices);
    if(Math.abs(independentVolume-volume)>Math.max(0.001,volume*0.0001)) throw Error('Export volume does not agree with the geometry kernel.');
    const materialVolumes=layerVolumes(solid,spec.height_mm,keep);
    const envelopeVolumes=layerVolumes(envelope,spec.height_mm,keep);
    const layerFractions=materialVolumes.map((value,i)=>envelopeVolumes[i]>0 ? value/envelopeVolumes[i] : null);
    return {spec,engine:ENGINE,...data,metrics:{kernel_status:status,export_topology:'closed_oriented_float32',components:count,enclosed_cavities:cavities,triangles:data.indices.length/3,vertices:data.positions.length/3,volume_mm3:volume,envelope_volume_mm3:envelopeVolume,envelope_dimensions_mm:dims,mesh_fraction:fraction,target_fraction:spec.target_fraction,target_error_percentage_points:difference,grid_edge_mm:edge,band:cal.band,calibration_samples:cal.calibration_samples,plate_fraction:cal.plate_fraction,core_target_fraction:cal.core_target,layer_fractions_bottom_to_top:layerFractions,layer_envelope_volumes_mm3:envelopeVolumes,area_mm2:solid.surfaceArea(),export_signed_volume_mm3:independentVolume,mechanical_validation:'not_performed',minimum_wall_validation:'not_performed',density_convergence:'not_performed'}};
  } finally { held.reverse().forEach(x=>x.delete()); }
}
