// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
// A bounded data contract shared by the browser worker and offline checks.
export const ENGINE = Object.freeze({ name: 'courbure', version: '0.3.0', manifold: '3.5.5' });
export const DEFAULT = Object.freeze({ schema_version: 1, units: 'mm', family: 'gyroid', envelope: 'box', size_mm: 36, height_mm: 30, cell_mm: 12, target_fraction: 0.28, gradient: 0, skin_mm: 0, quality: 'preview' });
export const CURVED_DEMO = Object.freeze({ ...DEFAULT, family: 'bcc', envelope: 'curved', size_mm: 48, height_mm: 36, cell_mm: 8, target_fraction: 0.24, gradient: 0.25, skin_mm: 0.8 });
const KEYS = Object.keys(DEFAULT);
export function validateSpec(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Design must be a JSON object.');
  const extra = Object.keys(input).filter(k => !KEYS.includes(k));
  if (extra.length) throw Error(`Unknown design fields: ${extra.join(', ')}`);
  for (const key of KEYS) if (!(key in input)) throw Error(`Missing design field: ${key}`);
  if (input.schema_version !== 1 || input.units !== 'mm') throw Error('Use schema version 1 and millimetres (mm).');
  for (const [key, allowed] of Object.entries({ family: ['gyroid', 'primitive', 'diamond', 'bcc'], envelope: ['box', 'cylinder', 'insert', 'curved', 'mesh'], quality: ['preview', 'fine'] })) {
    if (!allowed.includes(input[key])) throw Error(`Unsupported ${key}.`);
  }
  const imported=input.envelope==='mesh';
  for (const [key, low, high] of [['size_mm',imported?1:24,60],['height_mm',imported?1:16,48],['cell_mm',8,20],['target_fraction',0.16,0.55],['gradient',-0.6,0.6],['skin_mm',0,2]]) {
    if (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || input[key] < low || input[key] > high) throw Error(`${key} must be a finite number from ${low} to ${high}.`);
  }
  if (!imported && input.cell_mm > Math.min(input.size_mm, input.height_mm)) throw Error('Cell pitch must fit the envelope.');
  if (input.skin_mm*2>=input.height_mm || (!imported && input.target_fraction <= skinFraction(input))) throw Error('The end plates already use the requested material fraction. Reduce skin thickness or increase the target fraction.');
  const result = Object.fromEntries(KEYS.map(key=>[key,input[key]]));
  const edge = gridEdge(result);
  const cells = (Math.ceil((result.size_mm + 4*edge)/edge)+1)**2 * (Math.ceil((result.height_mm + 4*edge)/edge)+1)*2;
  if (cells > 3_000_000) throw Error('This design exceeds the local sampling budget. Choose Preview quality, a larger cell or a smaller envelope.');
  return result;
}
export function gridEdge(spec) { return Math.min(spec.quality === 'fine' ? 0.48 : 0.8, spec.cell_mm/(spec.quality === 'fine' ? 24 : 16)); }
const TAU = 2*Math.PI;
function foldedPhase(value) { return Math.abs(value - TAU*Math.round(value/TAU)); }
export function implicitField(family,x,y,z) {
  if (family === 'bcc') {
    // Reflection into one octant maps all eight centre-to-corner segments to
    // [0,0,0] -> [π,π,π]. The projection stays on that finite segment.
    const px=foldedPhase(x), py=foldedPhase(y), pz=foldedPhase(z);
    const projection=(px+py+pz)/3;
    return Math.hypot(px-projection,py-projection,pz-projection);
  }
  const sx=Math.sin(x),sy=Math.sin(y),sz=Math.sin(z),cx=Math.cos(x),cy=Math.cos(y),cz=Math.cos(z);
  if (family === 'primitive') return cx+cy+cz;
  if (family === 'diamond') return sx*sy*sz+sx*cy*cz+cx*sy*cz+cx*cy*sz;
  return sx*cy+sy*cz+sz*cx;
}
export function cavityRadius(spec) { return spec.size_mm * 0.28; }
export function curvedInnerRadius(spec) { return spec.size_mm*(0.5-0.22); }
export function insideEnvelope(spec,x,y,z) {
  if (Math.abs(x)>spec.size_mm/2 || Math.abs(y)>spec.size_mm/2 || Math.abs(z)>spec.height_mm/2) return false;
  if (spec.envelope === 'cylinder') return x*x+y*y <= (spec.size_mm/2)**2;
  if (spec.envelope === 'curved') {
    const outer=spec.size_mm/2, cy=y+outer/2, radius2=x*x+cy*cy;
    return cy>=0 && radius2<=outer*outer && radius2>=curvedInnerRadius(spec)**2;
  }
  if (spec.envelope === 'insert') return x*x+y*y+(z-spec.height_mm/2)**2 >= cavityRadius(spec)**2;
  return true;
}
// Plates fill the first and last skin_mm along Z, including in a clipped insert.
function skinFraction(spec) {
  const skin=spec.skin_mm, height=spec.height_mm;
  if (skin===0 || spec.envelope!=='insert') return 2*skin/height;
  const area=spec.size_mm**2, radius=cavityRadius(spec);
  const removedVolume=(depth)=>{
    const d=Math.min(depth,radius);
    return Math.PI*(radius*radius*d-d*d*d/3);
  };
  const envelopeVolume=area*height-removedVolume(height);
  const removedInPlates=removedVolume(skin)+removedVolume(height)-removedVolume(height-skin);
  return (2*skin*area-removedInPlates)/envelopeVolume;
}
export function localScale(spec,z) { return 1 + spec.gradient * Math.max(-1, Math.min(1, 2*z/spec.height_mm)); }
// Quantile inversion of the sampled field. This is a geometric target, never stiffness.
export function calibrateBand(spec, n=49, domain={}) {
  const plateFraction=domain.plateFraction??skinFraction(spec);
  if(plateFraction>=spec.target_fraction) throw Error('The end plates exceed the requested material fraction. Reduce skin thickness or increase density.');
  const coreTarget=(spec.target_fraction-plateFraction)/(1-plateFraction);
  const coreHeight=spec.height_mm-2*spec.skin_mm;
  const [dx,dy]=domain.dimensions??[spec.size_mm,spec.size_mm];
  const nx=Math.max(4,Math.round(n*dx/spec.size_mm)), ny=Math.max(4,Math.round(n*dy/spec.size_mm));
  const nz = Math.max(20,Math.min(96,Math.round(n*coreHeight/spec.size_mm)));
  const contains=domain.contains??((x,y,z)=>insideEnvelope(spec,x,y,z));
  const values=[]; const k=2*Math.PI/spec.cell_mm;
  for(let i=0;i<nx;i++) for(let j=0;j<ny;j++) for(let l=0;l<nz;l++) {
    const x=((i+.5)/nx-.5)*dx,y=((j+.5)/ny-.5)*dy,z=((l+.5)/nz-.5)*coreHeight;
    if(contains(x,y,z)) values.push(Math.abs(implicitField(spec.family,x*k,y*k,z*k))/localScale(spec,z));
  }
  values.sort((a,b)=>a-b);
  if (!values.length) throw Error('Empty calibration domain.');
  const index=Math.min(values.length-1,Math.floor(coreTarget*values.length));
  return {band:values[index],calibration_samples:values.length,sampled_fraction:plateFraction+(1-plateFraction)*index/values.length,plate_fraction:plateFraction,core_target:coreTarget};
}
export function meshData(mesh) {
  const count=mesh.vertProperties.length/mesh.numProp, positions=new Float32Array(count*3);
  for(let i=0;i<count;i++) for(let c=0;c<3;c++) positions[i*3+c]=mesh.vertProperties[i*mesh.numProp+c];
  return {positions,indices:new Uint32Array(mesh.triVerts)};
}
export function signedMeshVolume(positions,indices) {
  let v=0;
  for(let i=0;i<indices.length;i+=3) {
    const a=3*indices[i],b=3*indices[i+1],c=3*indices[i+2];
    v += positions[a]*(positions[b+1]*positions[c+2]-positions[b+2]*positions[c+1]) + positions[a+1]*(positions[b+2]*positions[c]-positions[b]*positions[c+2]) + positions[a+2]*(positions[b]*positions[c+1]-positions[b+1]*positions[c]);
  }
  return v/6;
}
export function binarySTL(positions,indices) {
  const triangles=indices.length/3, buffer=new ArrayBuffer(84+50*triangles), view=new DataView(buffer);
  const header=new TextEncoder().encode('Courbure 0.3 | coordinates mm | geometry preview, not mechanically validated');
  new Uint8Array(buffer,0,Math.min(80,header.length)).set(header.slice(0,80)); view.setUint32(80,triangles,true);
  for(let i=0;i<triangles;i++) {
    const a=3*indices[3*i],b=3*indices[3*i+1],c=3*indices[3*i+2];
    const ux=positions[b]-positions[a],uy=positions[b+1]-positions[a+1],uz=positions[b+2]-positions[a+2];
    const vx=positions[c]-positions[a],vy=positions[c+1]-positions[a+1],vz=positions[c+2]-positions[a+2];
    let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx; const norm=Math.hypot(nx,ny,nz)||1;
    const offset=84+i*50; [nx/norm,ny/norm,nz/norm].forEach((v,j)=>view.setFloat32(offset+4*j,v,true));
    for(let j=0;j<3;j++) for(let q=0;q<3;q++) view.setFloat32(offset+12+j*12+q*4,positions[indices[3*i+j]*3+q],true);
  }
  return buffer;
}
export function canonicalSpec(spec) { return JSON.stringify(validateSpec(spec)); }
