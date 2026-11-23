// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import {validateSpec} from './core.mjs';
import {responseForLayers,validateObjective} from './inverse.mjs';
import {curveSupportsStroke,materialResponse,parseMaterialCSV} from './material.mjs';

const G=9.80665, DURATION=2, MAX_STEPS=96000, DEFAULT_STEP=0.00005;

function checkInputs(input) {
  const fields=['spec','objective','layerFractions','materialCSV','step_s'];
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!fields.includes(key))) throw Error('Invalid drop-test inputs.');
  const spec=validateSpec(input.spec),goal=validateObjective(input.objective);
  if(spec.family!=='bcc' || spec.envelope!=='box' || spec.skin_mm!==0 || spec.size_mm!==36 || spec.height_mm!==30 ||
    goal.size_mm!==spec.size_mm || goal.height_mm!==spec.height_mm)
    throw Error('Generate a flat, skinless 36 × 36 × 30 mm BCC coupon for the guided drop test.');
  if(goal.drop_m<=0) throw Error('Enter a positive drop height for the transient test.');
  const fractions=input.layerFractions;
  if(!Array.isArray(fractions) || fractions.length!==3 || Array.from(fractions).some(r=>!Number.isFinite(r) || r<=0 || r>=1 || r*r===0))
    throw Error('Supply three measured mesh layer fractions strictly between zero and one.');
  const step=input.step_s===undefined?DEFAULT_STEP:input.step_s;
  if(!Number.isFinite(step) || step<0.000002 || step>0.0002) throw Error('The integration step must be between 2 and 200 microseconds.');
  return {goal,step,fractions:[...fractions]};
}

function contactLaw(fractions,goal,material) {
  const response=stroke=>material?materialResponse(fractions,{...goal,stroke_mm:stroke},material):responseForLayers(fractions,{...goal,stroke_mm:stroke});
  let limit=goal.stroke_mm,limitStatus='stroke_limit';
  if(material) {
    response(0); // Validates the density range separately from stroke coverage.
    if(!curveSupportsStroke(fractions,limit/goal.height_mm,material)) {
      let lo=0,hi=limit;
      for(let i=0;i<45;i++) {
        const mid=(lo+hi)/2;
        if(curveSupportsStroke(fractions,mid/goal.height_mm,material)) lo=mid;
        else hi=mid;
      }
      limit=lo;limitStatus='material_limit';
    }
  }
  function at(stroke) {
    if(stroke<=0) return {force:0,work:0};
    const [work,force]=response(Math.min(stroke,limit));
    if(!Number.isFinite(work) || !Number.isFinite(force) || work<0 || force<0) throw Error('The compression curve produced an invalid force or work.');
    return {force,work};
  }
  return {limit,limitStatus,at};
}

function point(t,y,v,force) {
  return {time_s:t,height_mm:1000*y,stroke_mm:1000*Math.max(0,-y),force_n:force,velocity_m_s:v};
}

function contactTrajectory(R,goal,law,dt,budget,deadline,record) {
  const mass=goal.mass_kg,impactSpeed=Math.sqrt(2*G*goal.drop_m),impactTime=impactSpeed/G;
  const incident=mass*G*goal.drop_m,world=new R.World({x:0,y:-G,z:0});
  try {
    world.timestep=dt;
    const body=world.createRigidBody(R.RigidBodyDesc.dynamic().enabledTranslations(false,true,false)
      .lockRotations().setCanSleep(false).setAdditionalMass(mass).setLinvel(0,-impactSpeed,0));
    body.recomputeMassPropertiesFromColliders();
    let time=impactTime,height=0,velocity=-impactSpeed,contact=law.at(0),peak=point(time,height,velocity,0);
    let status='time_limit',maxEnergyError=0,rebound=null,steps=0;
    const points=[],stride=Math.max(1,Math.round(0.00025/dt));
    function energy(y,v,work) {
      const residual=0.5*mass*v*v+mass*G*y+work-incident;
      maxEnergyError=Math.max(maxEnergyError,Math.abs(residual));
    }
    for(;steps<budget && time+dt<=DURATION;steps++) {
      if(steps%128===0 && performance.now()>=deadline) {status='numerical_limit';break;}
      // Split the spring impulse symmetrically about Rapier's gravity/drift step.
      body.applyImpulse({x:0,y:0.5*contact.force*dt,z:0},false);
      world.step();
      const nextHeight=body.translation().y;
      if(!Number.isFinite(nextHeight)) {status='numerical_limit';break;}
      const nextStroke=-nextHeight*1000;
      const next=law.at(Math.max(0,nextStroke));
      body.applyImpulse({x:0,y:0.5*next.force*dt,z:0},false);
      const nextVelocity=body.linvel().y;
      if(!Number.isFinite(nextVelocity)) {status='numerical_limit';break;}

      let portion=1;
      if(nextStroke>=law.limit) {
        portion=(height+law.limit/1000)/(height-nextHeight);
        status=law.limitStatus;
      } else if(nextHeight>=0 && nextVelocity>0 && height<0) {
        portion=-height/(nextHeight-height);
        status='rebounded';
      }
      const eventTime=time+dt*portion,eventVelocity=velocity+(nextVelocity-velocity)*portion;
      const eventHeight=status===law.limitStatus?-law.limit/1000:status==='rebounded'?0:nextHeight;
      // Locate the first compression maximum between samples when velocity changes sign.
      if(velocity<0 && eventVelocity>=0) {
        const turn=dt*(-velocity)/(nextVelocity-velocity);
        const atTurn=Math.min(law.limit,Math.max(0,-1000*(height+velocity*turn/2)));
        if(atTurn>=peak.stroke_mm) {
          const spring=law.at(atTurn);
          peak=point(time+turn,-atTurn/1000,0,spring.force);
          energy(-atTurn/1000,0,spring.work);
          if(atTurn>=law.limit) {
            status=law.limitStatus;time=peak.time_s;
            if(record) points.push(peak);
            steps++;break;
          }
        }
      }
      const spring=eventHeight===nextHeight?next:law.at(Math.max(0,-1000*eventHeight));
      const sample=point(eventTime,eventHeight,eventVelocity,spring.force);
      if(sample.stroke_mm>peak.stroke_mm) peak=sample;
      if(record && (steps%stride===0 || status!=='time_limit')) points.push(sample);
      energy(eventHeight,eventVelocity,spring.work);
      time=eventTime;height=eventHeight;velocity=eventVelocity;contact=spring;
      if(status!=='time_limit') {
        if(status==='rebounded') rebound=velocity;
        steps++;break;
      }
    }
    if(steps>=budget && status==='time_limit') status='numerical_limit';
    if(![maxEnergyError,peak.force_n,peak.stroke_mm].every(Number.isFinite)) status='numerical_limit';
    return {status,steps,points,peak,time,rebound,maxEnergyError,incident,impactTime,impactSpeed};
  } finally {world.free();}
}

function ballisticSamples(points,start,duration,y0,v0) {
  if(duration<=0) return;
  for(let i=0;i<=32;i++) {
    const t=duration*i/32;
    points.push(point(start+t,Math.max(0,y0+v0*t-G*t*t/2),v0-G*t,0));
  }
}

export async function runDropTest(RAPIER,input) {
  const deadline=performance.now()+4000;
  const {goal,step,fractions}=checkInputs(input);
  const material=input.materialCSV===undefined || input.materialCSV===null?null:await parseMaterialCSV(input.materialCSV);
  const law=contactLaw(fractions,goal,material);
  const coarse=contactTrajectory(RAPIER,goal,law,step,MAX_STEPS/3,deadline,false);
  const fine=contactTrajectory(RAPIER,goal,law,step/2,MAX_STEPS*2/3,deadline,true);
  const scale=fine.incident+goal.mass_kg*G*fine.peak.stroke_mm/1000;
  const relative=(a,b)=>Math.abs(a-b)/Math.max(Math.abs(a),Math.abs(b),1e-12);
  const convergence=Math.max(relative(coarse.peak.force_n,fine.peak.force_n),relative(coarse.peak.stroke_mm,fine.peak.stroke_mm),
    relative(coarse.time-coarse.impactTime,fine.time-fine.impactTime),relative(coarse.rebound??0,fine.rebound??0));
  const energyError=fine.maxEnergyError/scale;
  let status=fine.status;
  const forceVerdictChanged=status==='rebounded' && (fine.peak.force_n<=goal.max_force_n)!==(coarse.peak.force_n<=goal.max_force_n);
  if(coarse.status!==fine.status || forceVerdictChanged || convergence>0.02 || energyError>0.02) status='numerical_limit';
  const points=[];
  ballisticSamples(points,0,fine.impactTime,goal.drop_m,0);
  // Keep the event and the maximum even on an unusually long contact.
  const every=Math.max(1,Math.ceil(fine.points.length/350));
  points.push(...fine.points.filter((p,i)=>i%every===0 || i===fine.points.length-1),fine.peak);
  if(fine.rebound!==null) ballisticSamples(points,fine.time,Math.min(fine.rebound/G,DURATION-fine.time),0,fine.rebound);
  const samples=points.sort((a,b)=>a.time_s-b.time_s).filter((p,i,a)=>!i || p.time_s>a[i-1].time_s);
  return {method:'Rapier guided rigid payload with a conservative three-layer compression law',engine_version:RAPIER.version(),
    material_source:material?.provenance??'illustrative_model',material_sha256:material?.sha256??null,
    status,within_force_limit:status==='rebounded'?fine.peak.force_n<=goal.max_force_n:null,
    impact_time_s:fine.impactTime,impact_speed_m_s:fine.impactSpeed,peak_force_n:fine.peak.force_n,peak_stroke_mm:fine.peak.stroke_mm,
    peak_time_s:fine.peak.time_s,contact_duration_s:fine.time-fine.impactTime,
    rebound_speed_m_s:status==='rebounded'?fine.rebound:null,incident_energy_j:fine.incident,
    max_energy_error_j:fine.maxEnergyError,energy_error_fraction:energyError,convergence_fraction:convergence,
    validated_stroke_limit_mm:law.limit,step_s:step/2,integration_steps:coarse.steps+fine.steps,samples};
}
