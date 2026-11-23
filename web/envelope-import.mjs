// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import {signedMeshVolume} from './core.mjs';

export const MAX_STL_BYTES=8*1024*1024;
export const MAX_ENVELOPE_TRIANGLES=50_000;
const UNIT_MM=Object.freeze({mm:1,cm:10,inch:25.4});

function boundsOf(positions) {
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<positions.length;i++) {
    const value=positions[i],axis=i%3;
    if(!Number.isFinite(value)) throw Error('Envelope coordinates must be finite.');
    min[axis]=Math.min(min[axis],value);
    max[axis]=Math.max(max[axis],value);
  }
  return {min,max,dimensions:max.map((v,i)=>v-min[i])};
}

// JSON imports go through the same bounds, edge pairing, winding and degeneracy
// checks as parsed STLs. The worker additionally validates the solid in Manifold.
export function validateEnvelopeMesh(mesh,spec) {
  if(!mesh || typeof mesh!=='object') throw Error('An imported envelope mesh is required.');
  const {positions:points,indices:faces}=mesh;
  if(!(Array.isArray(points)||points instanceof Float32Array) || !(Array.isArray(faces)||faces instanceof Uint32Array))
    throw Error('Envelope positions and indices must be arrays.');
  const triangleCount=faces.length/3, vertexCount=points.length/3;
  if(!Number.isInteger(triangleCount)||triangleCount<4||triangleCount>MAX_ENVELOPE_TRIANGLES ||
     !Number.isInteger(vertexCount)||vertexCount<4||vertexCount>faces.length)
    throw Error('Envelope mesh exceeds its limits or has invalid triangle data.');
  if(!points.every(Number.isFinite)) throw Error('Envelope coordinates must be finite numbers.');
  const positions=points instanceof Float32Array?points:new Float32Array(points);
  const {min,max,dimensions}=boundsOf(positions);
  if(dimensions.some((d,i)=>d<1-1e-5 || d>(i===2?48:60)+1e-5)) throw Error('Imported envelope must span at least 1 mm on each axis, at most 60 mm in X/Y and 48 mm in Z. Choose a different unit or fit size.');
  if(min.some((v,i)=>Math.abs(v+max[i])>1e-4)) throw Error('Recipe envelope coordinates must be centered on their bounds.');
  assertClosedMesh(positions,faces,1e-12);
  const indices=new Uint32Array(faces);
  if(!(signedMeshVolume(positions,indices)>0)) throw Error('Envelope must enclose positive volume with outward-facing triangles.');
  const size=Math.max(dimensions[0],dimensions[1]),height=dimensions[2];
  if(spec && (Math.abs(spec.size_mm-size)>1e-4 || Math.abs(spec.height_mm-height)>1e-4)) throw Error('Design dimensions do not match the imported envelope.');
  return {positions,indices,dimensions_mm:dimensions,size_mm:size,height_mm:height,triangle_count:triangleCount};
}

// STL has no vertex IDs. Check the actual Float32 coordinates and their face
// fans so that coincident points cannot hide an open seam or a point contact.
export function assertClosedMesh(positions,indices,minDoubleArea=0) {
  const vertexCount=positions.length/3;
  if(!Number.isInteger(vertexCount)||vertexCount<4||indices.length<12||indices.length%3!==0)throw Error('Mesh has incomplete triangle data.');
  const unique=new Set();
  for(let i=0;i<positions.length;i+=3) {
    const x=positions[i],y=positions[i+1],z=positions[i+2];
    if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z))throw Error('Mesh coordinates must be finite.');
    const key=x+','+y+','+z;
    if(unique.has(key)) throw Error('Mesh has duplicate or precision-collapsed vertices.');
    unique.add(key);
  }
  unique.clear();
  const edges=new Map();
  // Adjacent corners at a vertex must form one connected fan. Edge counting
  // alone would accept two otherwise closed solids touching at just one point.
  const parent=new Uint32Array(indices.length);
  for(let i=0;i<parent.length;i++) parent[i]=i;
  function fan(i) {
    while(parent[i]!==i) {parent[i]=parent[parent[i]];i=parent[i];}
    return i;
  }
  function nextCorner(i) {return i%3===2?i-2:i+1;}
  for(let i=0;i<indices.length;i+=3) {
    const a=indices[i],b=indices[i+1],c=indices[i+2];
    for(const index of [a,b,c]) {
      if(!Number.isInteger(index)||index<0||index>=vertexCount) throw Error('Mesh contains an invalid vertex index.');
    }
    const ax=3*a,bx=3*b,cx=3*c;
    const u=positions[bx]-positions[ax],v=positions[bx+1]-positions[ax+1],w=positions[bx+2]-positions[ax+2];
    const x=positions[cx]-positions[ax],y=positions[cx+1]-positions[ax+1],z=positions[cx+2]-positions[ax+2];
    if(!(Math.hypot(v*z-w*y,w*x-u*z,u*y-v*x)>minDoubleArea)) throw Error('Mesh contains a degenerate triangle.');
    for(let start=i;start<i+3;start++) {
      const end=nextCorner(start),s=indices[start],t=indices[end];
      const key=Math.min(s,t)*vertexCount+Math.max(s,t),previous=edges.get(key);
      if(previous===undefined) edges.set(key,start);
      else if(previous>=0 && indices[previous]===t) {
        parent[fan(start)]=fan(nextCorner(previous));
        parent[fan(end)]=fan(previous);
        edges.set(key,-1);
      } else throw Error('Mesh is nonmanifold or has inconsistent triangle winding.');
    }
  }
  for(const corner of edges.values()) if(corner>=0) throw Error('Mesh is open. Each edge needs two oppositely wound faces.');
  const vertexFans=new Int32Array(vertexCount).fill(-1);
  for(let i=0;i<indices.length;i++) {
    const v=indices[i],ring=fan(i);
    if(vertexFans[v]!==-1 && vertexFans[v]!==ring) throw Error('Mesh has a nonmanifold vertex shared by disconnected face fans.');
    vertexFans[v]=ring;
  }
  if(vertexFans.includes(-1)) throw Error('Mesh contains unreferenced vertices.');
}

const NUMBER='([+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?)';
const TRIPLE=[NUMBER,NUMBER,NUMBER].join('\\s+');
const FACET=new RegExp('\\s*facet\\s+normal\\s+'+TRIPLE+'\\s+outer\\s+loop'+('\\s+vertex\\s+'+TRIPLE).repeat(3)+'\\s+endloop\\s+endfacet\\b','iy');

function asciiFaces(buffer,add) {
  let text;
  try {text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);} catch {throw Error('Invalid ASCII STL or truncated binary STL.');}
  const header=/^\s*solid\b[^\r\n]*(?:\r\n|\r|\n)/i.exec(text);
  if(!header) throw Error('Unrecognized or truncated STL file.');
  let offset=header[0].length,count=0;
  while(true) {
    FACET.lastIndex=offset;
    const record=FACET.exec(text);
    if(!record) break;
    if(++count>MAX_ENVELOPE_TRIANGLES) throw Error('STL triangle count exceeds the import limit.');
    const values=record.slice(1).map(Number);
    if(!values.every(Number.isFinite)) throw Error('STL contains nonfinite numbers.');
    for(let j=3;j<12;j+=3) add(values[j],values[j+1],values[j+2]);
    offset=FACET.lastIndex;
  }
  if(!count || !/^\s*endsolid\b[^\r\n]*\s*$/i.test(text.slice(offset))) throw Error('Malformed ASCII STL facet or closing record.');
}

export function parseSTLEnvelope(buffer,options={}) {
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<16||buffer.byteLength>MAX_STL_BYTES) throw Error('STL file must be at most 8 MiB and contain a model.');
  const {unit='mm',fit_mm:fit}=options;
  if(!Object.hasOwn(UNIT_MM,unit)) throw Error('Choose STL units in mm, cm or inch.');
  if(fit!==undefined && (!Number.isFinite(fit)||fit<1||fit>60)) throw Error('Fit size must be between 1 and 60 mm.');
  const points=[],faces=[],weld=new Map(),view=new DataView(buffer);
  function add(x,y,z) {
    if(![x,y,z].every(Number.isFinite)) throw Error('STL contains nonfinite coordinates.');
    const key=x+','+y+','+z;
    let index=weld.get(key);
    if(index===undefined) {index=points.length/3;weld.set(key,index);points.push(x,y,z);}
    faces.push(index);
  }
  const count=buffer.byteLength>=84?view.getUint32(80,true):0;
  if(buffer.byteLength===84+50*count) {
    if(count<4 || count>MAX_ENVELOPE_TRIANGLES) throw Error('STL triangle count must be between 4 and 50000.');
    for(let i=0;i<count;i++) {
      const start=84+50*i;
      for(let j=0;j<3;j++) if(!Number.isFinite(view.getFloat32(start+4*j,true))) throw Error('STL contains a nonfinite normal.');
      for(let j=0;j<3;j++) {
        const at=start+12+j*12;
        add(view.getFloat32(at,true),view.getFloat32(at+4,true),view.getFloat32(at+8,true));
      }
    }
  } else asciiFaces(buffer,add);
  const {min,dimensions}=boundsOf(points),longest=Math.max(...dimensions);
  if(!Number.isFinite(longest)||longest<=0) throw Error('STL bounds are empty or exceed supported precision.');
  const scale=fit===undefined?UNIT_MM[unit]:fit/longest;
  if(!Number.isFinite(scale)||scale<=0) throw Error('Invalid unit conversion or fit size.');
  const positions=Float32Array.from(points,(v,i)=>((v-min[i%3])-dimensions[i%3]/2)*scale);
  return {...validateEnvelopeMesh({positions,indices:faces}),source_unit:unit,scale_to_mm:scale};
}
