// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import {calibrateBand, localScale, validateSpec} from './core.mjs';

export const FRAME_MODEL = 'Small-strain 3D Timoshenko frame with bonded platens';
export const DEFAULT_FRAME_MATERIAL = Object.freeze({young_mpa: 1500, poisson: 0.35, strain: 0.001});
const MAX_NODES = 1800, MAX_MEMBERS = 4500, DOFS = 6;
const TOLERANCE = 1e-9;
const norm = v => Math.hypot(...v);
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

function checkMaterial(young, poisson) {
  if (!Number.isFinite(young) || young <= 0 || young > 1e7) throw Error('Young’s modulus must be positive and at most 10,000,000 MPa.');
  if (!Number.isFinite(poisson) || poisson <= -1 || poisson >= 0.5) throw Error('Poisson’s ratio must be strictly between −1 and 0.5.');
}

// Intersect a finite centerline with an axis-aligned box using its parameter interval.
function clipMember(start, end, limits) {
  let lo = 0, hi = 1;
  const delta = end.map((value, i) => value-start[i]);
  for (let i=0; i<3; i++) {
    const t1 = (-limits[i]-start[i])/delta[i], t2 = (limits[i]-start[i])/delta[i];
    lo = Math.max(lo, Math.min(t1,t2));
    hi = Math.min(hi, Math.max(t1,t2));
  }
  if (hi-lo <= 1e-9) return null;
  return [lo, hi].map(t => start.map((value,i) => Math.max(-limits[i], Math.min(limits[i], value+t*delta[i]))));
}

function componentLabels(nodeCount, members) {
  const neighbors = Array.from({length:nodeCount}, () => []);
  for (const {a,b} of members) { neighbors[a].push(b); neighbors[b].push(a); }
  const label = new Int32Array(nodeCount).fill(-1);
  let count = 0;
  for (let start=0; start<nodeCount; start++) {
    if (label[start] !== -1) continue;
    const stack = [start];
    label[start] = count;
    while (stack.length) {
      const node = stack.pop();
      for (const next of neighbors[node]) if (label[next] === -1) { label[next] = count; stack.push(next); }
    }
    count++;
  }
  return {label, count};
}

// Integer-pitch points connect to their eight half-pitch corners. This is
// exactly the centerline set used by core.mjs's folded BCC distance field.
export function buildBCCGraph(input, suppliedBand) {
  const spec = validateSpec(input);
  if (spec.family !== 'bcc' || spec.envelope !== 'box') throw Error('The beam benchmark supports BCC struts in a box envelope.');
  const band = suppliedBand === undefined ? calibrateBand(spec).band : suppliedBand;
  if (!Number.isFinite(band) || band <= 0 || band >= Math.PI) throw Error('Invalid calibrated BCC radius band.');
  const pitch = spec.cell_mm, baseRadius = band*pitch/(2*Math.PI);
  const limits = [spec.size_mm/2, spec.size_mm/2, spec.height_mm/2-spec.skin_mm];
  const extents = limits.map(h => Math.ceil(h/pitch+0.5));
  const map = new Map(), nodes = [], members = [];
  function nodeAt(point) {
    const key = point.map(x => Math.round(x*1e8)).join(',');
    if (map.has(key)) return map.get(key);
    const id = nodes.length;
    if (id >= MAX_NODES) throw Error('Frame exceeds the local node budget. Increase the cell pitch.');
    map.set(key, id); nodes.push(point);
    return id;
  }
  for (let i=-extents[0]; i<=extents[0]; i++) for (let j=-extents[1]; j<=extents[1]; j++) for (let k=-extents[2]; k<=extents[2]; k++) {
    const center = [i*pitch,j*pitch,k*pitch];
    for (const dx of [-1,1]) for (const dy of [-1,1]) for (const dz of [-1,1]) {
      const end = [center[0]+dx*pitch/2,center[1]+dy*pitch/2,center[2]+dz*pitch/2];
      const cut = clipMember(center, end, limits);
      if (!cut) continue;
      const [p,q] = cut;
      const ra = baseRadius*localScale(spec,p[2]), rb = baseRadius*localScale(spec,q[2]);
      if (members.length >= MAX_MEMBERS) throw Error('Frame exceeds the local member budget. Increase the cell pitch.');
      members.push({a:nodeAt(p), b:nodeAt(q), radius_mm:(ra+rb)/2, radius_a_mm:ra, radius_b_mm:rb});
    }
  }
  // A short piece cut off on two lateral faces can float independently of the
  // connected lattice. Only components touching both platens carry axial load.
  const {label,count} = componentLabels(nodes.length,members);
  const ends = new Uint8Array(count);
  nodes.forEach((p,i) => {
    if (Math.abs(p[2]+limits[2])<1e-7) ends[label[i]] |= 1;
    if (Math.abs(p[2]-limits[2])<1e-7) ends[label[i]] |= 2;
  });
  const activeNodes = [], remap = new Int32Array(nodes.length).fill(-1);
  for (let i=0; i<nodes.length; i++) if (ends[label[i]] === 3) {
    remap[i] = activeNodes.length; activeNodes.push(nodes[i]);
  }
  const activeMembers = members.filter(m => remap[m.a]>=0).map(m => ({...m,a:remap[m.a],b:remap[m.b]}));
  if (!activeMembers.length) throw Error('No connected BCC centerline spans the two platen faces.');
  return {units:'mm', nodes:activeNodes, members:activeMembers, band, base_radius_mm:baseRadius,
    clear_height_mm:2*limits[2], excluded_nonspanning_members:members.length-activeMembers.length};
}

function putPair(k, a, b, value) {
  k[12*a+a] += value; k[12*b+b] += value;
  k[12*a+b] -= value; k[12*b+a] -= value;
}

function createElement(nodes, member, young, shear, shearFactor) {
  const {a,b,radius_mm:radius} = member, p=nodes[a], q=nodes[b];
  const line = q.map((v,i)=>v-p[i]), length = norm(line);
  if (!(length>1e-7)) throw Error('Beam length is zero or below the solver resolution.');
  const x = line.map(v => v/length);
  const yRaw = cross(Math.abs(x[2])<0.9 ? [0,0,1] : [0,1,0], x);
  const yNorm = norm(yRaw), y = yRaw.map(v=>v/yNorm), basis = [x,y,cross(x,y)];
  const area = Math.PI*radius**2, inertia = Math.PI*radius**4/4, polar = 2*inertia;
  const k = new Float64Array(144);
  putPair(k, 0,6, young*area/length);
  putPair(k, 3,9, shear*polar/length);
  // The two-node Timoshenko member includes the shear compliance in each
  // bending plane. Local y and z slopes use opposite right-handed rotations.
  const L2=length*length, phi=12*young*inertia/(shearFactor*shear*area*L2);
  const factor=young*inertia/(length**3*(1+phi));
  for (const [indices, sign] of [[[1,5,7,11],1], [[2,4,8,10],-1]]) {
    const s = sign*6*length;
    const block = [[12,s,-12,s],[s,(4+phi)*L2,-s,(2-phi)*L2],[-12,-s,12,-s],[s,(2-phi)*L2,-s,(4+phi)*L2]];
    for (let i=0; i<4; i++) for (let j=0; j<4; j++) k[12*indices[i]+indices[j]] = factor*block[i][j];
  }
  const dofs = Array.from({length:12},(_,i) => DOFS*(i<6 ? a : b)+i%6);
  return {k,basis,dofs,radius,area,inertia,length};
}

function rotatedEntry(e, row, col) {
  const i0=row-row%3, j0=col-col%3;
  let value=0;
  for (let i=0; i<3; i++) for (let j=0; j<3; j++) {
    value += e.basis[i][row%3]*e.k[12*(i0+i)+j0+j]*e.basis[j][col%3];
  }
  return value;
}

function localEndForces(e, u) {
  const local = new Float64Array(12), forces = new Float64Array(12);
  for (let group=0; group<12; group+=3) {
    const global=[u[e.dofs[group]],u[e.dofs[group+1]],u[e.dofs[group+2]]];
    for (let i=0; i<3; i++) local[group+i] = dot(e.basis[i],global);
  }
  for (let i=0; i<12; i++) for (let j=0; j<12; j++) forces[i] += e.k[12*i+j]*local[j];
  return {local,forces};
}

function compressRows(rows) {
  const start=new Int32Array(rows.length+1);
  for (let i=0; i<rows.length; i++) start[i+1]=start[i]+rows[i].size;
  const column=new Int32Array(start.at(-1)), values=new Float64Array(column.length), diagonal=new Float64Array(rows.length);
  for (let i=0; i<rows.length; i++) {
    let offset=start[i];
    for (const [j,k] of rows[i]) {column[offset]=j;values[offset]=k;offset++;}
    diagonal[i]=rows[i].get(i);
    if (!Number.isFinite(diagonal[i]) || diagonal[i]<=0) throw Error('Singular frame stiffness at a free degree of freedom.');
  }
  function apply(v,out) {
    for (let i=0; i<rows.length; i++) {
      let t=0; for (let j=start[i]; j<start[i+1]; j++) t+=values[j]*v[column[j]];
      out[i]=t;
    }
  }
  return {apply,diagonal};
}

function inner(a,b) {
  let value=0; for (let i=0; i<a.length; i++) value+=a[i]*b[i];
  return value;
}

function solvePCG(rows, rhs) {
  const {apply,diagonal} = compressRows(rows);
  const n=rhs.length, x=new Float64Array(n), r=rhs.slice(), z=new Float64Array(n), ap=new Float64Array(n);
  for (let i=0; i<n; i++) z[i]=r[i]/diagonal[i];
  const p=z.slice();
  let rz=inner(r,z);
  if (rz===0) return {x,iterations:0,residual_relative:0};
  if (!Number.isFinite(rz) || rz<0) throw Error('Invalid frame residual.');
  const initial=rz;
  for (let iteration=1; iteration<=2400; iteration++) {
    apply(p,ap);
    const curvature=inner(p,ap);
    if (!Number.isFinite(curvature) || curvature<=0) throw Error('Singular or ill-conditioned frame. No stable elastic solution.');
    const alpha=rz/curvature;
    for (let i=0; i<n; i++) {x[i]+=alpha*p[i];r[i]-=alpha*ap[i];z[i]=r[i]/diagonal[i];}
    const next=inner(r,z);
    if (next<=TOLERANCE*TOLERANCE*initial) {
      apply(x,ap);
      let actual=0;
      for (let i=0; i<n; i++) actual+=(rhs[i]-ap[i])**2/diagonal[i];
      const relative=Math.sqrt(actual/initial);
      if (!Number.isFinite(relative) || relative>10*TOLERANCE) throw Error('Frame solution failed its equilibrium residual check.');
      return {x,iterations:iteration,residual_relative:relative};
    }
    if (!Number.isFinite(next)) throw Error('Non-finite frame residual.');
    const beta=next/rz;
    for (let i=0; i<n; i++) p[i]=z[i]+beta*p[i];
    rz=next;
  }
  throw Error('Frame iterations exceeded the local budget. Adjust the geometry or increase the cell pitch.');
}

// The public low-level solver accepts clamped frames. Each connected component
// must have at least one fully restrained node, eliminating its six rigid modes.
export function solveFrame(graph, material, boundary) {
  const {nodes,members} = graph ?? {}, {young_mpa:young,poisson}=material ?? {};
  checkMaterial(young,poisson);
  if (!Array.isArray(nodes) || !nodes.length || nodes.length>MAX_NODES || !Array.isArray(members) || !members.length || members.length>MAX_MEMBERS) throw Error('Invalid frame size or solver budget exceeded.');
  for (const p of nodes) if (!Array.isArray(p) || p.length!==3 || !p.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e6)) throw Error('Frame coordinates must be finite XYZ values in mm.');
  const validNode=n=>Number.isInteger(n)&&n>=0&&n<nodes.length;
  for (const m of members) if (!m || !validNode(m.a) || !validNode(m.b) || m.a===m.b || !Number.isFinite(m.radius_mm) || m.radius_mm<1e-7 || m.radius_mm>1e5) throw Error('Invalid frame member endpoints or radius.');
  const constraints=boundary?.constraints, loads=boundary?.loads ?? [];
  if (!Array.isArray(constraints) || !Array.isArray(loads) || constraints.length>nodes.length*6 || loads.length>nodes.length*6) throw Error('Invalid frame boundary conditions.');
  const size=nodes.length*DOFS, fixed=new Uint8Array(size), u=new Float64Array(size), external=new Float64Array(size);
  function index(v) {
    if (!v || !validNode(v.node) || !Number.isInteger(v.dof) || v.dof<0 || v.dof>=6 || !Number.isFinite(v.value)) throw Error('Invalid nodal boundary value.');
    return v.node*6+v.dof;
  }
  for (const bc of constraints) {
    const j=index(bc);
    if (fixed[j]) throw Error('A degree of freedom has duplicate constraints.');
    fixed[j]=1; u[j]=bc.value;
  }
  for (const load of loads) external[index(load)]+=load.value;
  const {label,count}=componentLabels(nodes.length,members), anchored=new Uint8Array(count);
  for (let i=0; i<nodes.length; i++) if (fixed.subarray(i*6,i*6+6).every(v=>v===1)) anchored[label[i]]=1;
  if (anchored.some(v=>!v)) throw Error('Unrestrained frame component. At least one full clamp is required on each component.');
  const free=new Int32Array(size).fill(-1);
  let n=0; for (let i=0; i<size; i++) if (!fixed[i]) free[i]=n++;
  const rows=Array.from({length:n},()=>new Map()), rhs=new Float64Array(n);
  for (let i=0; i<size; i++) if (free[i]>=0) rhs[free[i]]=external[i];
  const shear=young/(2*(1+poisson));
  // Cowper (1966), doi:10.1115/1.3625046, static circular cross-section.
  const shearFactor=6*(1+poisson)/(7+6*poisson);
  const elements=members.map(m=>createElement(nodes,m,young,shear,shearFactor));
  for (const e of elements) for (let i=0; i<12; i++) {
    const fi=free[e.dofs[i]];
    if (fi<0) continue;
    const row=rows[fi];
    for (let j=0; j<12; j++) {
      const value=rotatedEntry(e,i,j);
      if (value===0) continue;
      const gj=e.dofs[j], fj=free[gj];
      if (fj<0) rhs[fi]-=value*u[gj]; else row.set(fj,(row.get(fj)??0)+value);
    }
  }
  const solution=solvePCG(rows,rhs);
  for (let i=0; i<size; i++) if (free[i]>=0) u[i]=solution.x[free[i]];
  const reactions=Float64Array.from(external,v=>-v), stresses=new Float64Array(elements.length);
  let energy=0, maxStress=0;
  elements.forEach((e,idx)=>{
    const {local,forces}=localEndForces(e,u);
    energy+=0.5*inner(local,forces);
    for (let group=0; group<12; group+=3) for (let j=0; j<3; j++) {
      let global=0;
      for (let i=0; i<3; i++) global+=e.basis[i][j]*forces[group+i];
      reactions[e.dofs[group+j]]+=global;
    }
    const moment=Math.max(Math.hypot(forces[4],forces[5]),Math.hypot(forces[10],forces[11]));
    stresses[idx]=Math.abs(forces[0])/e.area+moment*e.radius/e.inertia;
    maxStress=Math.max(maxStress,stresses[idx]);
  });
  if (!Number.isFinite(energy) || !Number.isFinite(maxStress)) throw Error('Non-finite frame result.');
  return {displacements:u,reactions,member_max_normal_stress_mpa:stresses,max_normal_stress_mpa:maxStress,
    strain_energy_n_mm:energy,iterations:solution.iterations,residual_relative:solution.residual_relative};
}

export function analyzeBCC(input, materialInput=DEFAULT_FRAME_MATERIAL, band) {
  const spec=validateSpec(input);
  if (!materialInput || typeof materialInput!=='object' || Array.isArray(materialInput) || Object.keys(materialInput).some(k=>!Object.hasOwn(DEFAULT_FRAME_MATERIAL,k))) throw Error('Invalid frame material or loading options.');
  const material={...DEFAULT_FRAME_MATERIAL,...materialInput};
  checkMaterial(material.young_mpa,material.poisson);
  if (!Number.isFinite(material.strain) || material.strain<1e-6 || material.strain>0.01) throw Error('Applied compression strain must be between 0.000001 and 0.01.');
  const graph=buildBCCGraph(spec,band);
  const half=graph.clear_height_mm/2, displacement=material.strain*spec.height_mm;
  const constraints=[], top=[], bottom=[];
  graph.nodes.forEach((p,node)=>{
    const atTop=Math.abs(p[2]-half)<1e-7, atBottom=Math.abs(p[2]+half)<1e-7;
    if (!atTop && !atBottom) return;
    (atTop ? top : bottom).push(node);
    for (let dof=0; dof<6; dof++) constraints.push({node,dof,value:atTop&&dof===2 ? -displacement : 0});
  });
  const solved=solveFrame(graph,material,{constraints});
  const reaction=-top.reduce((v,node)=>v+solved.reactions[6*node+2],0);
  const bottomReaction=bottom.reduce((v,node)=>v+solved.reactions[6*node+2],0);
  if (!(reaction>0) || Math.abs(bottomReaction-reaction)>reaction*1e-5 || Math.abs(solved.strain_energy_n_mm-0.5*reaction*displacement)>1e-5*reaction*displacement) throw Error('Compression reaction or strain energy failed the equilibrium check.');
  const stiffness=reaction/displacement;
  let shortestRatio=Infinity;
  for (const m of graph.members) {
    const length=norm(graph.nodes[m.a].map((x,i)=>x-graph.nodes[m.b][i]));
    shortestRatio=Math.min(shortestRatio,length/(2*m.radius_mm));
  }
  return {model:FRAME_MODEL,graph,material,stiffness_n_per_mm:stiffness,compliance_mm_per_n:1/stiffness,
    effective_modulus_mpa:stiffness*spec.height_mm/(spec.size_mm**2),reaction_n:reaction,
    bottom_reaction_n:bottomReaction,max_normal_stress_mpa:solved.max_normal_stress_mpa,
    member_max_normal_stress_mpa:Array.from(solved.member_max_normal_stress_mpa),
    nodal_displacements_mm:graph.nodes.map((p,i)=>Array.from(solved.displacements.slice(i*6,i*6+3))),
    displacement_mm:displacement,strain_energy_n_mm:solved.strain_energy_n_mm,
    iterations:solved.iterations,residual_relative:solved.residual_relative,
    min_member_length_to_diameter:shortestRatio,top_node_count:top.length,bottom_node_count:bottom.length,
    assumptions:['Circular Timoshenko beams include transverse shear with Cowper’s correction. Rigid point joints and midpoint radii approximate the graded, voxel-meshed solid. Short, stocky or overlapping members can depart substantially from this beam model.',
      'Both ends are bonded to rigid platens. The bottom is fixed and the top translates in Z. Any skin is perfectly rigid. Side cuts truncate centerlines.',
      'Stress is axial plus extreme-fiber bending stress. Printed material anisotropy, buckling, plastic collapse, contact and drop dynamics require separate evidence.']};
}
