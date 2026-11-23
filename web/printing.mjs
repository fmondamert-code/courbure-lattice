// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import {strToU8, zipSync} from 'fflate';
import {binarySTL, canonicalSpec, signedMeshVolume} from './core.mjs';
import {assertClosedMesh} from './envelope-import.mjs';

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
const RELATIONSHIPS = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/></Relationships>';
const ZIP_OPTIONS={level:3,mtime:new Date(1980,0,1)};

export function encode3MF(design) {
  const {positions,indices}=design;
  if(!(positions instanceof Float32Array) || !(indices instanceof Uint32Array))throw Error('Expected an indexed Float32 specimen.');
  assertClosedMesh(positions,indices);
  if(!(signedMeshVolume(positions,indices)>0))throw Error('The print mesh must have positive oriented volume.');
  let minZ=positions[2];
  // Encode in chunks to avoid keeping an array of millions of XML strings.
  const chunks=[];
  let text='<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">Courbure</metadata><resources><object id="1" type="model" name="Courbure specimen"><mesh><vertices>';
  const flush=()=>{chunks.push(strToU8(text));text='';};
  for(let i=0;i<positions.length;i+=3){
    const x=positions[i],y=positions[i+1],z=positions[i+2];
    minZ=Math.min(minZ,z);
    text+='<vertex x="'+x+'" y="'+y+'" z="'+z+'"/>';
    if(text.length>=131072)flush();
  }
  text+='</vertices><triangles>';
  for(let i=0;i<indices.length;i+=3){
    text+='<triangle v1="'+indices[i]+'" v2="'+indices[i+1]+'" v3="'+indices[i+2]+'"/>';
    if(text.length>=131072)flush();
  }
  text+='</triangles></mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 '+(-minZ)+'"/></build></model>';
  flush();
  const model=new Uint8Array(chunks.reduce((sum,c)=>sum+c.length,0));
  let offset=0;
  for(const chunk of chunks){model.set(chunk,offset);offset+=chunk.length;}
  return zipSync({'[Content_Types].xml':strToU8(CONTENT_TYPES),'_rels/.rels':strToU8(RELATIONSHIPS),'3D/3dmodel.model':model},ZIP_OPTIONS);
}

const INSTRUCTIONS = `COURBURE · SLICER HANDOFF

Open specimen.3mf in your slicer. Units are millimetres. The build item starts at Z = 0 and preserves the design orientation and dimensions. For an STL workflow, import specimen.stl as millimetres and place it on the bed. Both files contain the same facets.

Select the actual printer, nozzle, material and print profile. Arrange the object within the bed bounds and slice it. Inspect the paths through the thinnest walls or struts, the first layer, unsupported spans, interfaces and separate islands. Check the slicer's warnings, toolpaths at multiple heights and support removal before sending a job to your machine.

The package contains no printer profile or machine instructions. Closed mesh topology establishes a file property. Minimum feature size, adhesion, toolpath continuity, physical performance and safety depend on the chosen process.

project.json contains the recipe and may include normalized envelope geometry and original compression curves. Review it before sharing.

With Courbure source and an installed PrusaSlicer CLI, run:
python3 scripts/slice.py --model specimen.3mf --profile YOUR-EXPORTED-CONFIG.ini --output specimen.gcode
`;

export function createPrintPackage(design,project){
  if(!project || project.format!=='courbure-design' || !project.design)throw Error('A Courbure project is required for a print package.');
  if(canonicalSpec(design.spec)!==canonicalSpec(project.design))throw Error('The print mesh and project recipes do not match.');
  const model=encode3MF(design);
  return zipSync({
    'specimen.3mf':[model,{level:0}],
    'specimen.stl':new Uint8Array(binarySTL(design.positions,design.indices)),
    'project.json':strToU8(JSON.stringify(project)),
    'PRINTING.txt':strToU8(INSTRUCTIONS)
  },ZIP_OPTIONS);
}
