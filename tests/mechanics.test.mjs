// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT, implicitField,localScale} from '../web/core.mjs';
import {analyzeBCC,buildBCCGraph,solveFrame} from '../web/mechanics.mjs';

const material={young_mpa:2100,poisson:0.33}, length=12, radius=1.4;
const area=Math.PI*radius**2, inertia=Math.PI*radius**4/4, shear=material.young_mpa/(2*(1+material.poisson));
const shearFactor=6*(1+material.poisson)/(7+6*material.poisson);
const constraints=Array.from({length:6},(_,dof)=>({node:0,dof,value:0}));
const spec={...DEFAULT,family:'bcc',gradient:-0.25};
const oneBeam={nodes:[[0,0,0],[length,0,0]],members:[{a:0,b:1,radius_mm:radius}]};
function near(actual,expected,tol=1e-8) {
  assert.ok(Math.abs(actual-expected)<=tol*Math.max(1,Math.abs(expected)),actual+' versus '+expected);
}

test('single bar gives FL/EA, stress F/A, equal and opposite reactions and elastic work',()=>{
  const force=13;
  const out=solveFrame(oneBeam,material,{constraints,loads:[{node:1,dof:0,value:force}]});
  const extension=force*length/(material.young_mpa*area);
  near(out.displacements[6],extension);
  near(out.reactions[0],-force);
  near(out.max_normal_stress_mpa,force/area);
  near(out.strain_energy_n_mm,force*extension/2);
  for (let i=7;i<12;i++) near(out.displacements[i],0);
});

test('both cantilever bending planes match bending plus transverse shear, rotation, stress and reaction moment',()=>{
  const force=6.3, bending=force*length**3/(3*material.young_mpa*inertia);
  const shearDeflection=force*length/(shearFactor*shear*area);
  for (const [dof,rotation,sign] of [[1,5,1],[2,4,-1]]) {
    const out=solveFrame(oneBeam,material,{constraints,loads:[{node:1,dof,value:force}]});
    near(out.displacements[6+dof],bending+shearDeflection);
    near(out.displacements[6+rotation],sign*force*length**2/(2*material.young_mpa*inertia));
    near(out.reactions[dof],-force); near(out.reactions[rotation],-sign*force*length);
    near(out.max_normal_stress_mpa,force*length*radius/inertia);
  }
});

test('arbitrarily oriented shafts reproduce the torsional twist TL/GJ',()=>{
  const unit=[2/3,-2/3,1/3], torque=4.5;
  const graph={...oneBeam,nodes:[[1,2,3],unit.map((u,i)=>oneBeam.nodes[0][i]+i+1+length*u)]};
  const loads=unit.map((v,i)=>({node:1,dof:3+i,value:torque*v}));
  const out=solveFrame(graph,material,{constraints,loads});
  const twist=torque*length/(shear*2*inertia);
  unit.forEach((v,i)=>{near(out.displacements[9+i],v*twist);near(out.displacements[6+i],0);near(out.reactions[i+3],-torque*v);});
});

test('finite graph matches the clipped implicit BCC centerlines and calibrated graded radii',()=>{
  const recipe={...spec,size_mm:35.7,height_mm:29.6,skin_mm:0.8}, band=0.7;
  const graph=buildBCCGraph(recipe,band), k=2*Math.PI/recipe.cell_mm;
  const links=new Set();
  for (const m of graph.members) {
    const p=graph.nodes[m.a],q=graph.nodes[m.b];
    const key=[m.a,m.b].sort((a,b)=>a-b).join(':');
    assert.ok(!links.has(key));links.add(key);
    for (const [z,r] of [[p[2],m.radius_a_mm],[q[2],m.radius_b_mm],[(p[2]+q[2])/2,m.radius_mm]]) near(r,band*localScale(recipe,z)/k);
    for (const t of [0,0.37,1]) {
      const pt=p.map((v,i)=>v*(1-t)+q[i]*t);
      assert.ok(Math.abs(pt[0])<=recipe.size_mm/2+1e-8 && Math.abs(pt[1])<=recipe.size_mm/2+1e-8);
      assert.ok(Math.abs(pt[2])<=recipe.height_mm/2-recipe.skin_mm+1e-8);
      near(implicitField('bcc',...pt.map(v=>v*k)),0);
    }
  }
  assert.ok(graph.members.length>50);
});

test('finite graded coupon balances top and bottom reactions and elastic work; doubling E doubles stiffness',()=>{
  const first=analyzeBCC(spec,{...material,strain:0.001},0.7);
  const second=analyzeBCC(spec,{...material,young_mpa:material.young_mpa*2,strain:0.002},0.7);
  near(first.reaction_n,first.bottom_reaction_n);
  near(first.strain_energy_n_mm,first.displacement_mm*first.reaction_n/2);
  near(first.stiffness_n_per_mm*first.compliance_mm_per_n,1);
  near(second.stiffness_n_per_mm,2*first.stiffness_n_per_mm);
  near(second.reaction_n,4*first.reaction_n);
  near(first.effective_modulus_mpa,first.reaction_n/(spec.size_mm**2*0.001));
  assert.equal(first.graph.members.length,first.member_max_normal_stress_mpa.length);
  assert.ok(first.residual_relative<1e-8 && first.iterations>0);
  assert.ok(first.graph.members.length>first.graph.nodes.length);
});

test('invalid, disconnected or unsupported inputs fail before reporting stiffness',()=>{
  assert.throws(()=>buildBCCGraph({...spec,envelope:'curved'}),/box/);
  assert.throws(()=>buildBCCGraph({...spec,family:'gyroid'}),/BCC/);
  assert.throws(()=>analyzeBCC(spec,{strain:0.1}),/strain/);
  assert.throws(()=>analyzeBCC(spec,{young_mpa:NaN}),/modulus/);
  assert.throws(()=>buildBCCGraph(spec,-1),/radius band/);
  assert.throws(()=>solveFrame(oneBeam,material,{constraints:[]}),/Unrestrained/);
  const disconnected={nodes:[...oneBeam.nodes,[0,2,0],[length,2,0]],members:[...oneBeam.members,{a:2,b:3,radius_mm:radius}]};
  assert.throws(()=>solveFrame(disconnected,material,{constraints}),/Unrestrained/);
  assert.throws(()=>solveFrame({...oneBeam,nodes:[[0,0,0],[0,0,0]]},material,{constraints}),/length/);
});
