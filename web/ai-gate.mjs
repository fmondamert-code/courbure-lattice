// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
// Shared by the browser and AI gateways. This module validates data and never executes a proposal.
import { validateSpec } from './core.mjs';
import { validateObjective } from './inverse.mjs';

export const PROPOSAL_MAX_BYTES = 8192;
const ACTION_GEOMETRY = 'propose_geometry';
const ACTION_INVERSE = 'propose_inverse';
const units = { schema_version: [1], units: ['mm'], family: ['gyroid','primitive','diamond','bcc'],
  envelope: ['box','cylinder','insert','curved','mesh'], quality: ['preview','fine'] };

function freezeTree(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeTree);
    Object.freeze(value);
  }
  return value;
}
function enumeration(type, values) { return {type,enum:values}; }
function number(minimum, maximum) { return {type:'number', minimum, maximum}; }
function closed(properties) {
  return {type:'object',properties,required:Object.keys(properties),additionalProperties:false};
}
const designSchema=closed({
  schema_version:enumeration('integer',units.schema_version),units:enumeration('string',units.units),
  family:enumeration('string',units.family),envelope:enumeration('string',units.envelope),
  size_mm:number(1,60),height_mm:number(1,48),cell_mm:number(8,20),target_fraction:number(.16,.55),
  gradient:number(-.6,.6),skin_mm:number(0,2),quality:enumeration('string',units.quality),
});
const objectiveSchema=closed({
  mass_kg:number(.01,25),drop_m:number(0,5),stroke_mm:number(.5,24),max_force_n:number(1,250000),
  size_mm:enumeration('number',[36]),height_mm:enumeration('number',[30]),soft_contact:{type:'boolean'},
});
function branch(action,field,payload) {
  return closed({version:enumeration('integer',[1]),action:enumeration('string',[action]),[field]:payload});
}
const actionSchemas=freezeTree({
  [ACTION_GEOMETRY]:branch(ACTION_GEOMETRY,'design',designSchema),
  [ACTION_INVERSE]:branch(ACTION_INVERSE,'objective',objectiveSchema),
});
export const PROPOSAL_SCHEMA=freezeTree({oneOf:[actionSchemas[ACTION_GEOMETRY],actionSchemas[ACTION_INVERSE]]});
export function schemaForAction(action) {
  if(typeof action!=='string' || !Object.hasOwn(actionSchemas,action)) throw Error('Unsupported proposal action.');
  return actionSchemas[action];
}

// A model may ask for clearer input. Only complete proposals enter the project or engine.
export function modelReplySchema(action) {
  if(action===undefined) return {oneOf:[modelReplySchema(ACTION_GEOMETRY),modelReplySchema(ACTION_INVERSE)]};
  const schema=schemaForAction(action), field=action===ACTION_GEOMETRY?'design':'objective';
  return closed({...schema.properties,[field]:{anyOf:[schema.properties[field],{type:'null'}]}});
}

// Native JSON.parse accepts duplicate keys. Check the wire text before decoding so that a
// reviewer, provider and consumer see one value for each parameter, including escaped key names.
export function parseUniqueJSON(text,{maxDepth=32,allowArrays=true}={}) {
  const stack=[];
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='{' || c==='[') {
      if(c==='[' && !allowArrays) throw Error('Proposal arrays are unsupported.');
      if(stack.length>=maxDepth) throw Error('JSON nesting exceeds its limit.');
      stack.push(c==='{'?new Set():null);
    } else if(c==='}' || c===']') stack.pop();
    else if(c==='"') {
      const start=i;
      while(++i<text.length && text[i]!=='"') if(text[i]==='\\') i++;
      if(i>=text.length) throw Error('Invalid JSON string in proposal.');
      let after=i+1;
      while(after<text.length && /\s/.test(text[after])) after++;
      const keys=stack.at(-1);
      if(text[after]===':' && keys) {
        let key;
        try { key=JSON.parse(text.slice(start,i+1)); } catch { throw Error('Invalid proposal key.'); }
        if(keys.has(key)) throw Error('Duplicate JSON key.');
        keys.add(key);
      }
    }
  }
  try { return JSON.parse(text); } catch { throw Error('Expected one complete JSON proposal without prose or Markdown.'); }
}

function decodeText(text) {
  if(typeof text!=='string') throw Error('Expected JSON proposal text.');
  if(text.length>PROPOSAL_MAX_BYTES || new TextEncoder().encode(text).length>PROPOSAL_MAX_BYTES)
    throw Error('Proposal exceeds 8 KiB.');
  return parseUniqueJSON(text,{maxDepth:2,allowArrays:false});
}

export function parseModelReply(text,action) {
  const value=decodeText(text);
  if(action!==undefined && value?.action!==action) throw Error('Unexpected proposal action.');
  const schema=schemaForAction(value?.action);
  if(value.version===1 && value[value.action===ACTION_GEOMETRY?'design':'objective']===null) {
    exactKeys(value,schema.required);
    return null;
  }
  return parseAIProposal(value);
}

// Copy only inert JSON data. In-process callers cannot feed getters, custom prototypes,
// symbols, coercion hooks, nonfinite values, oversized primitives or cycles into the engine.
function copyRecord(input,depth=0) {
  if (!input || typeof input!=='object' || Array.isArray(input)) throw Error('Expected a plain JSON object.');
  const proto=Object.getPrototypeOf(input);
  if(proto!==Object.prototype && proto!==null) throw Error('Proposal must contain only plain JSON objects.');
  const keys=Reflect.ownKeys(input);
  if(keys.length>16) throw Error('Too many proposal or context fields.');
  const result=Object.create(null);
  for(const key of keys) {
    if(typeof key!=='string' || key.length>48 || ['__proto__','prototype','constructor'].includes(key))
      throw Error('Unsupported proposal field.');
    const descriptor=Object.getOwnPropertyDescriptor(input,key);
    if(!descriptor?.enumerable || !Object.hasOwn(descriptor,'value')) throw Error('Proposal must contain only plain data properties.');
    const value=descriptor.value;
    if(value && typeof value==='object') {
      if(depth>=1) throw Error('Proposal nesting exceeds the two-object contract.');
      result[key]=copyRecord(value,depth+1);
    } else if(typeof value==='boolean' || (typeof value==='number' && Number.isFinite(value)) ||
        (typeof value==='string' && value.length<=48)) result[key]=value;
    else throw Error('Proposal contains an unsupported value.');
  }
  return result;
}

function exactKeys(object,allowed) {
  const keys=Object.keys(object);
  if(keys.length!==allowed.length || allowed.some(key=>!Object.hasOwn(object,key)))
    throw Error('Proposal must contain exactly the required fields for the selected action.');
}
function normalizedDesign(input) {
  exactKeys(input,designSchema.required);
  return validateSpec(input);
}
function normalizedObjective(input) {
  exactKeys(input,objectiveSchema.required);
  const objective=validateObjective(input);
  if(objective.size_mm!==36 || objective.height_mm!==30)
    throw Error('This inverse-design workbench requires a 36 × 36 × 30 mm coupon.');
  return objective;
}

export function parseAIProposal(value) {
  const draft=copyRecord(typeof value==='string' ? decodeText(value) : value);
  if(draft.version!==1) throw Error('Expected proposal version 1. Supply a complete geometry or inverse objective.');
  const schema=schemaForAction(draft.action);
  exactKeys(draft,schema.required);
  if(draft.action===ACTION_GEOMETRY) return freezeTree({version:1,action:ACTION_GEOMETRY,design:normalizedDesign(draft.design)});
  return freezeTree({version:1,action:ACTION_INVERSE,objective:normalizedObjective(draft.objective)});
}
export const validateProposal=parseAIProposal;

// A symbolic mesh reference is meaningful only in a browser where the user has
// already opened that exact-sized envelope. A provider can never select a path or URL.
export function validateAIApply(value,localEnvelope=null) {
  const proposal=parseAIProposal(value);
  if(proposal.action===ACTION_GEOMETRY && proposal.design.envelope==='mesh') {
    if(!localEnvelope) throw Error('Select an STL envelope locally before applying this proposal.');
    for(const field of ['size_mm','height_mm']) {
      const actual=localEnvelope[field];
      if(!Number.isFinite(actual) || Math.abs(actual-proposal.design[field])>1e-6)
        throw Error('Proposed dimensions must match the selected local STL envelope.');
    }
  }
  return proposal;
}

// Accept only validated current input records. A full project, STL, material table or
// arbitrary metadata is rejected at this boundary. The caller selects which records to share.
export function buildAIContext(design,objective) {
  const context={};
  if(design!==undefined && design!==null) context.design=normalizedDesign(copyRecord(design));
  if(objective!==undefined && objective!==null) context.objective=normalizedObjective(copyRecord(objective));
  return freezeTree(context);
}

export function proposalDiff(proposal,current={}) {
  const next=parseAIProposal(proposal);
  const field=next.action===ACTION_GEOMETRY ? 'design':'objective';
  const context=buildAIContext(current.design,current.objective);
  const previous=context[field];
  return freezeTree(Object.entries(next[field])
    .filter(([key,value])=>!previous || previous[key]!==value)
    .map(([key,value])=>({field:key,before:previous ? previous[key] : null,after:value})));
}

export function buildSystemPrompt() {
  return [
    'Return exactly one version-1 JSON proposal matching the supplied schema.',
    'For propose_geometry return a complete design recipe. For propose_inverse return a complete objective.',
    'Preserve existing values from the supplied context unless the user asks to change them.',
    'Length parameters ending in _mm are millimetres; drop_m is metres, mass_kg kilograms and max_force_n newtons.',
    'Density target and gradient are fractions. Inverse design currently uses only a flat, skinless 36 by 36 by 30 mm BCC coupon.',
    'The mesh envelope refers to an already selected local mesh. The proposal cannot fetch or create an asset.',
    'If the brief is unrelated, ambiguous, or lacks necessary targets in both the brief and context, keep version and action and set the design or objective payload to null. Never invent missing mechanical targets.',
    'A force ceiling and a required drop height are user objectives. Never assert a measured result or a physical qualification.',
    'Return data only. Do not include code, commands, tool calls, provider metadata, links or explanations.',
  ].join(' ');
}
