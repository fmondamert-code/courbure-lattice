import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT,validateSpec} from '../web/core.mjs';
import {validateObjective} from '../web/inverse.mjs';
import {PROPOSAL_SCHEMA,PROPOSAL_MAX_BYTES,schemaForAction,modelReplySchema,parseModelReply,parseAIProposal,validateAIApply,buildAIContext,proposalDiff,buildSystemPrompt} from '../web/ai-gate.mjs';

const objective={mass_kg:0.5,drop_m:0.5,stroke_mm:15,max_force_n:450,size_mm:36,height_mm:30,soft_contact:true};
const geo=(change={})=>({version:1,action:'propose_geometry',design:{...DEFAULT,...change}});
const inv=(change={})=>({version:1,action:'propose_inverse',objective:{...objective,...change}});

test('both closed branches agree with the engine and yield independent immutable recipes',()=>{
  for(const [payload,field,validator] of [[geo(),'design',validateSpec],[inv(),'objective',validateObjective]]) {
    const result=parseAIProposal(JSON.stringify(payload));
    assert.deepEqual(result[field],validator(payload[field]));
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result[field]));
    assert.equal(schemaForAction(result.action).additionalProperties,false);
    assert.equal(schemaForAction(result.action).properties[field].additionalProperties,false);
    assert.deepEqual([...schemaForAction(result.action).properties[field].required].sort(),Object.keys(payload[field]).sort());
    assert.throws(()=>{result[field].size_mm=52;});
  }
  const source=geo(), parsed=parseAIProposal(source);
  source.design.cell_mm=16;
  assert.equal(parsed.design.cell_mm,DEFAULT.cell_mm);
  assert.equal(PROPOSAL_SCHEMA.oneOf.length,2);
  assert.ok(Object.isFrozen(PROPOSAL_SCHEMA.oneOf[0].properties.design.required));
});

test('each model may abstain only for its selected action and a null payload cannot be applied',()=>{
  for(const [draft,field] of [[geo(),'design'],[inv(),'objective']]) {
    const declined={...draft,[field]:null};
    const replySchema=modelReplySchema(draft.action);
    assert.deepEqual(replySchema.properties[field].anyOf,[schemaForAction(draft.action).properties[field],{type:'null'}]);
    assert.equal(parseModelReply(JSON.stringify(declined),draft.action),null);
    assert.deepEqual(parseModelReply(JSON.stringify(draft),draft.action),draft);
    assert.throws(()=>validateAIApply(declined));
    assert.throws(()=>parseModelReply(JSON.stringify({...declined,note:'text'}),draft.action));
    assert.throws(()=>parseModelReply(JSON.stringify(declined),field==='design'?'propose_inverse':'propose_geometry'));
    assert.throws(()=>parseModelReply(JSON.stringify(declined).replace('"version":1','"version":1,"version":1'),draft.action));
  }
});

test('rejects extraneous actions, provider results, claimed validation and executable outputs',()=>{
  for(const bad of [
    {version:1,action:'execute'}, {...geo(),tool_calls:[{name:'run'}]},
    {...inv(),validated:true}, {...inv(),provider:'trusted'}, {...geo(),objective},
    geo({family:'return currentRecipe()'}),geo({shell:'example'}),inv({predicted_peak_force_n:1}),
    {version:1,action:'propose_inverse',objective:null}, {version:2,action:'propose_geometry',design:DEFAULT},
    'Here is your requested recipe.', '[{"version":1}]', ' ```json\n{}\n``` ',{}
  ]) assert.throws(()=>parseAIProposal(bad));
  assert.throws(()=>schemaForAction('__proto__'));
});

test('input boundary rejects duplicate keys, escaped aliases, oversized input and custom getters',()=>{
  assert.throws(()=>parseAIProposal('{"version":1,"version":1}'),/uplicate/);
  const alias=String.raw`{"version":1,"vers\u0069on":1}`;
  assert.throws(()=>parseAIProposal(alias),/uplicate/);
  assert.throws(()=>parseAIProposal(JSON.stringify(geo()).replace('"units":"mm"','"units":"mm","units":"mm"')),/uplicate/);
  assert.throws(()=>parseAIProposal(' '.repeat(PROPOSAL_MAX_BYTES+1)),/KiB/);
  assert.throws(()=>parseAIProposal('☀'.repeat(3000)),/KiB/);
  let getterUsed=false;
  const withAccessor={...geo()};
  Object.defineProperty(withAccessor,'extra',{get(){getterUsed=true;return 'x';},enumerable:true});
  assert.throws(()=>parseAIProposal(withAccessor),/plain data/); assert.equal(getterUsed,false);
  assert.throws(()=>parseAIProposal({version:1,action:'propose_geometry',design:Object.create(DEFAULT)}),/plain JSON/);
  assert.throws(()=>parseAIProposal('{"__proto__":{},"version":1}'));
});

test('geometry, numerical budgets, active coupon size and units use domain checks',()=>{
  for(const d of [geo({units:'in'}),geo({cell_mm:Infinity}),geo({skin_mm:2,height_mm:16,target_fraction:0.16}),geo({gradient:.9}),inv({size_mm:48}),inv({height_mm:28}),inv({stroke_mm:25}),inv({soft_contact:1}),inv({max_force_n:'450'})])
    assert.throws(()=>parseAIProposal(d));
  const missing=inv(); delete missing.objective.drop_m;assert.throws(()=>parseAIProposal(missing));
  const improbable=inv({max_force_n:1});
  assert.deepEqual(parseAIProposal(improbable),improbable); // legitimate target can be numerically infeasible.
});

test('requests expose only validated compact inputs and a reviewable deterministic parameter diff',()=>{
  const current=buildAIContext(DEFAULT,objective);
  assert.deepEqual(Object.keys(current),['design','objective']);
  assert.equal(Object.hasOwn(current,'material_csv'),false);
  assert.deepEqual(buildAIContext(),{});
  assert.ok(Object.isFrozen(current.design));
  assert.throws(()=>buildAIContext({...DEFAULT,vertices:[0,0,0]},objective));
  assert.throws(()=>buildAIContext(DEFAULT,{...objective,credential:'private'}));
  assert.deepEqual(proposalDiff(geo({cell_mm:15}),current),[{field:'cell_mm',before:12,after:15}]);
  assert.deepEqual(proposalDiff(inv(),current),[]);
  assert.ok(proposalDiff(inv(),{}).every(row=>row.before===null));
  assert.match(buildSystemPrompt(),/physical qualification/);
});

test('applying an imported-mesh reference requires matching local dimensions',()=>{
  const proposal=geo({envelope:'mesh'});
  assert.throws(()=>validateAIApply(proposal),/Select an STL/);
  assert.throws(()=>validateAIApply(proposal,{size_mm:37,height_mm:30}),/dimensions/);
  assert.deepEqual(validateAIApply(proposal,{size_mm:36,height_mm:30}),proposal);
  assert.deepEqual(validateAIApply(inv()),inv());
});
