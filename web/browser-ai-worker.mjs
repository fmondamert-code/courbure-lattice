// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import {buildSystemPrompt, modelReplySchema, parseModelReply} from './ai-gate.mjs';

const MODEL = 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC';
const REVISION = '8e6ec5f417c7d0e1414703ef619b8a24686e3ab0';
const BINARY_REVISION = '5b7251f3bdce957be2a7bf73a6f6c560d9874df4';
const WASM = 'Qwen2-0.5B-Instruct-q4f32_1_cs1k-webgpu.wasm';
// Hashes of the exact HTTPS artifacts, including the eight Git LFS object IDs.
const integrity = {
  [WASM]:'sha256-a6i4+Fvi6G98oWRU0Zm/yD5nLsAQ9PbiZSQMIlBfWCk=',
  'mlc-chat-config.json':'sha256-asELWAWyLILxhn2b5hUw0DdV6HQcK3M18SD/ocFa6PE=',
  'tokenizer.json':'sha256-wDghF+oynN8JcEETL21zWSS2l5JNb2/DlFcT6WzodTk=',
  'tensor-cache.json':'sha256-v7et8dPBuOpmBubxJqEmxXXOOTgaRxLKZdqZK+sXfpg=',
  'params_shard_0.bin':'sha256-yzKfqwyJKKpIO0PPQluNwZybZpQYwQLAQR9F+wpRW1U=',
  'params_shard_1.bin':'sha256-CNobk/1dQnqn2vta+OL/xopjBpgYbrQauxIp8JD92ZA=',
  'params_shard_2.bin':'sha256-EUEG43FHLJTznCiDT5WkSSTurIIC2VILu0bV90V2V8Q=',
  'params_shard_3.bin':'sha256-LelcFHLxgxXRvx4mw0p5svNkUUHiIdmn2oJSA+pu6Q4=',
  'params_shard_4.bin':'sha256-jm9UZEssu7nAQQg8HjqKNHXjpbN+XjYRQONc/19Q2eY=',
  'params_shard_5.bin':'sha256-54GG1u9t3DgbXRhG67fD3cYr9aG8lUSWb8oIT1MF+KM=',
  'params_shard_6.bin':'sha256-jWJXdUCPuP/JlDDkKTpyg803JoOWW5gmScc9qoVstB0=',
  'params_shard_7.bin':'sha256-XTM/JiILjAhMUBmw4l/yvr8czLx8HxpZck+bptSvtak=',
};

export function modelAssets(localAssets, origin) {
  const base = localAssets ? `${origin}/models/qwen2.5-0.5b` : `https://huggingface.co/mlc-ai/${MODEL}`;
  const model = `${base}/resolve/${REVISION}/`;
  const wasm = localAssets ? model + WASM :
    `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/${BINARY_REVISION}/web-llm-models/v0_2_87/base/${WASM}`;
  const files = new Map(Object.entries(integrity).map(([name, hash]) => [name === WASM ? wasm : model + name, hash]));
  return {model, wasm, files};
}

// IndexedDB is the model cache. In this WebLLM version its misses go through fetch().
// Rebuild each GET from a pinned URL to discard any ambient headers, body or credentials.
export function modelAssetFetch(assets, fetchFile, duringLoad) {
  return async (input, init) => {
    const request = new Request(input, init);
    const expected = assets.files.get(request.url);
    if (!duringLoad() || !expected || request.method !== 'GET') throw Error('Browser AI network request blocked.');
    const url = request.url;
    return fetchFile(url, {method:'GET', credentials:'omit', referrerPolicy:'no-referrer', mode:'cors',
      redirect:assets.model.startsWith('https://huggingface.co/') && url.startsWith(assets.model) ? 'follow' : 'error',
      integrity:expected, signal:request.signal});
  };
}

async function checkGPU() {
  if (!globalThis.isSecureContext || !navigator.gpu) throw Error('Browser AI needs WebGPU on HTTPS or localhost.');
  const adapter = await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
  if (!adapter) throw Error('No WebGPU adapter is available for browser AI.');
  const minimum = {maxBufferSize:2**28, maxStorageBufferBindingSize:2**27,
    maxComputeWorkgroupStorageSize:32768, maxStorageBuffersPerShaderStage:10};
  for (const [name, value] of Object.entries(minimum)) {
    if (adapter.limits[name] < value) throw Error(`The WebGPU adapter cannot run this model (${name} must reach ${value}).`);
  }
}

class InferenceError extends Error {}
// XGrammar 0.1.27 emits incorrect decimal-range grammar (the valid integer
// gradient 0 is rejected). Constrain JSON types and shape during sampling; the
// system prompt and final shared validator retain the exact interval contracts.
export function decoderSchema(schema) {
  return JSON.stringify(schema, (key,value) => key === 'minimum' || key === 'maximum' ? undefined : value);
}

export async function generateProposal(engine, {action, prompt, context}) {
  const schema = modelReplySchema(action);
  const request = {
    model:MODEL, temperature:0, max_tokens:320, stream:false,
    messages:[
      {role:'system', content:buildSystemPrompt() + '\nJSON schema: ' + JSON.stringify(schema)},
      {role:'user', content:JSON.stringify({action, current:context, instruction:prompt})},
    ],
    response_format:{type:'json_object', schema:decoderSchema(schema)},
  };
  let response;
  try {
    response = await engine.chat.completions.create(request);
    await engine.resetChat();
  } catch {
    throw new InferenceError('Browser inference stopped. Reload the model and check available GPU memory.');
  }
  const choice = response.choices?.[0];
  if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string') {
    throw Error('The browser model did not finish a complete proposal. Try a shorter, more specific instruction.');
  }
  const proposal = parseModelReply(choice.message.content, action);
  if (!proposal) throw Error('The model needs a clearer brief or additional targets for this task.');
  return proposal;
}

if (typeof DedicatedWorkerGlobalScope !== 'undefined' && globalThis instanceof DedicatedWorkerGlobalScope) {
  let engine = null, busy = false;
  globalThis.onmessage = async ({data}) => {
    const {id, operation} = data;
    if (busy) { postMessage({id, type:'error', message:'Browser AI is already busy.'}); return; }
    busy = true;
    try {
      let result;
      if (operation === 'load' && !engine) {
        await checkGPU();
        const assets = modelAssets(data.localAssets === true, location.origin);
        const {CreateMLCEngine} = await import('./vendor/webllm/web-llm.mjs');
        let loading = true;
        globalThis.fetch = modelAssetFetch(assets, globalThis.fetch.bind(globalThis), () => loading);
        try {
          engine = await CreateMLCEngine(MODEL, {
            logLevel:'SILENT',
            appConfig:{cacheBackend:'indexeddb', model_list:[{
              model_id:MODEL, model:assets.model, model_lib:assets.wasm,
              overrides:{context_window_size:3072, prefill_chunk_size:512},
              integrity:{model_lib:integrity[WASM], config:integrity['mlc-chat-config.json'],
                tokenizer:{'tokenizer.json':integrity['tokenizer.json']}},
            }]},
            initProgressCallback:({text}) => postMessage({id, type:'progress', text}),
          });
        } catch {
          throw Error('Could not load the pinned browser model. Check access to its files, site storage and GPU memory.');
        } finally { loading = false; }
      } else if (operation === 'propose' && engine) {
        result = await generateProposal(engine, data.input);
      } else throw Error('Browser AI is not ready for this operation.');
      postMessage({id, type:'done', result});
    } catch (error) {
      postMessage({id, type:'error', fatal:operation === 'load' || error instanceof InferenceError, message:error.message});
    } finally { busy = false; }
  };
}
