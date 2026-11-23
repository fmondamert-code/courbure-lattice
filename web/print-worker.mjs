// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import {encode3MF,createPrintPackage} from './printing.mjs';

self.onmessage=({data})=>{
  const {id,design,project,format=project?'package':'3mf'}=data;
  try {
    if(format!=='3mf' && format!=='package')throw Error('Unknown print export format.');
    const bytes=format==='3mf'?encode3MF(design):createPrintPackage(design,project);
    self.postMessage({id,type:'result',format,bytes},[bytes.buffer]);
  } catch(error) {self.postMessage({id,type:'error',message:String(error?.message||error)});}
};
