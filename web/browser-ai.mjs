// Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
import {buildAIContext, parseAIProposal, schemaForAction} from './ai-gate.mjs';

export const BROWSER_AI_MAX_PROMPT_BYTES = 1536;
const startWorker = () => new Worker(new URL('./browser-ai-worker.mjs', import.meta.url), {type:'module'});
const cancelled = () => new DOMException('Browser AI stopped. Load the model again to reconnect.', 'AbortError');

function modelInput({action, prompt, context}) {
  schemaForAction(action);
  if (typeof prompt !== 'string' || !prompt.trim() || new TextEncoder().encode(prompt).length > BROWSER_AI_MAX_PROMPT_BYTES) {
    throw Error('Enter a browser AI instruction within 1,536 UTF-8 bytes.');
  }
  const field = action === 'propose_geometry' ? 'design' : 'objective';
  if (!context || Object.keys(context).length !== 1 || !Object.hasOwn(context,field) || !context[field]) {
    throw Error('Browser AI requires the current parameters for the selected task.');
  }
  const current = field === 'design' ? buildAIContext(context.design) : buildAIContext(null, context.objective);
  return {action, prompt:prompt.trim(), context:current};
}

// One worker owns one model. Termination cancels both downloads and device work,
// including requests waiting on upstream APIs that do not accept an AbortSignal.
export function createBrowserAI({workerFactory = startWorker} = {}) {
  let worker = null, pending = null, ready = false, mirrored = false, nextId = 0;

  function settle(error, value) {
    if (!pending) return;
    const call = pending;
    pending = null;
    call.signal?.removeEventListener('abort', call.abort);
    if (error) call.reject(error);
    else call.resolve(value);
  }
  function unload(error = cancelled()) {
    const previous = worker;
    worker = null;
    ready = false;
    previous?.terminate();
    settle(error);
  }
  function attach() {
    const instance = workerFactory();
    worker = instance;
    instance.onmessage = ({data}) => {
      if (worker !== instance || !pending || data?.id !== pending.id) return;
      if (data.type === 'progress') { pending.onProgress?.(data.text); return; }
      if (data.type === 'error') {
        const error = Error(data.message);
        if (data.fatal || pending.operation === 'load') unload(error);
        else settle(error);
        return;
      }
      if (data.type !== 'done') { unload(Error('Invalid browser AI worker response.')); return; }
      if (pending.operation === 'load') ready = true;
      settle(null, data.result);
    };
    instance.onerror = instance.onmessageerror = () => {
      if (worker === instance) unload(Error('The browser AI worker stopped. Reload the model and check GPU memory.'));
    };
  }
  function call(operation, payload, {signal, onProgress} = {}) {
    if (pending) throw Error('Browser AI is already busy.');
    signal?.throwIfAborted();
    const id = ++nextId;
    return new Promise((resolve,reject) => {
      const abort = () => unload(signal.reason ?? cancelled());
      pending = {id, operation, resolve, reject, signal, abort, onProgress};
      signal?.addEventListener('abort', abort, {once:true});
      try { worker.postMessage({id, operation, ...payload}); }
      catch (error) { unload(error); }
    });
  }
  return {
    get ready() { return ready; },
    async load({signal, onProgress, localAssets = false} = {}) {
      signal?.throwIfAborted();
      if (pending) throw Error('Browser AI is already busy.');
      if (ready && mirrored === localAssets) return;
      unload();
      attach();
      mirrored = localAssets;
      await call('load',{localAssets}, {signal,onProgress});
    },
    async propose(input, options) {
      if (!ready) throw Error('Load the browser AI model before requesting a proposal.');
      const payload = modelInput(input);
      const result = parseAIProposal(await call('propose',{input:payload},options));
      if (result.action !== payload.action) throw Error('The browser model returned a different action.');
      return result;
    },
    unload:() => unload(),
  };
}
