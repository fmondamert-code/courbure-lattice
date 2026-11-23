# Run a proposal on this device

In **AI design → Connect AI**, choose the browser WebGPU option and load the model. The first load requests about **291 MB** of model files and compiled code. No API key is required and the browser model has no per-request API charge. The workbench, geometry and numerical solvers also run with AI disconnected.

Enter a design instruction after the model is ready. For example, with **Geometry** selected, try “Keep the envelope and height. Use BCC struts at 12 mm pitch with a solid fraction of 32%.” The worker receives the brief and the current parameters for that task. Review the proposed values before applying them. An incomplete brief can produce a request for more detail. A small model can also return valid numbers that misinterpret the instruction.

## Device and limits

Use HTTPS or localhost and a browser that exposes a WebGPU adapter inside a dedicated worker. The selected variant uses four-bit weights and float32 computation. Upstream estimates **1,060 MB of GPU memory** at its default 4,096-token context. The application uses a 3,072-token context, a maximum 1,536 UTF-8 bytes per brief and 320 output tokens. Browser, graphics driver and other active GPU work affect actual memory use and speed. [Upstream model catalog](https://webllm.mlc.ai/models/)

WebLLM 0.2.89 requests a maximum buffer size of at least 256 MiB, a storage-buffer binding of at least 128 MiB, at least 32 KiB of compute workgroup storage and at least ten storage buffers per shader stage. A device can display the specimen and still fall below a compute limit. The worker checks the adapter before requesting external assets.

Cancelling a load or active proposal terminates the model worker. Disconnecting also releases it. Reconnect to load the model again. Successfully cached files remain in the site's IndexedDB until the browser evicts them or you clear site data. Clearing site data also removes a locally saved design draft. Export that draft first if you want to keep it.

## Sources and privacy

| Component | Version or revision | First load |
| --- | --- | ---: |
| WebLLM browser runtime | `@mlc-ai/web-llm` 0.2.89, Apache-2.0, served by the workbench | Separate same-origin JS module |
| Qwen2.5-0.5B-Instruct, MLC `q4f32_1` | Model revision `8e6ec5f417c7d0e1414703ef619b8a24686e3ab0` | 285,132,405 bytes for configuration, tokenizer, manifest and eight weight shards |
| Compiled MLC WebGPU model library | Binary repository revision `5b7251f3bdce957be2a7bf73a6f6c560d9874df4`, compiler directory `v0_2_87/base` | 5,713,183 bytes |

The public asset path downloads Qwen files from Hugging Face and its delivery network and the compiled model from GitHub's raw file service. Those hosts receive ordinary browser connection metadata, including an IP address and potentially the workbench origin. The worker requests fixed URLs with SHA‑256 integrity checks, omits credentials and suppresses the referrer. All twelve asset URLs and digests are in the worker source. After loading, its fetch policy blocks new network requests. [Worker and pinned hashes](../web/browser-ai-worker.mjs) · [Apache-2.0 base model and language coverage](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct) · [MLC weights](https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f32_1-MLC/tree/8e6ec5f417c7d0e1414703ef619b8a24686e3ab0) · [Compiled model](https://github.com/mlc-ai/binary-mlc-llm-libs/blob/5b7251f3bdce957be2a7bf73a6f6c560d9874df4/web-llm-models/v0_2_87/base/Qwen2-0.5B-Instruct-q4f32_1_cs1k-webgpu.wasm)

Inference runs within the worker. Prompts, parameters, mesh coordinates and compression-curve data never enter an external inference request in this mode. There is no automatic provider switch. Selecting a loopback gateway or BYOK OpenAI is a separate user action with a different data path. [Data handling](PRIVACY.md) · [Other providers](AI_GATEWAY.md)

### Same-origin mirror for an operator

The controller accepts `localAssets: true` in its `load` options. For a self-hosted build, select that option at the browser model's load call and serve the pinned artifacts as static files from this URL prefix on the workbench's own origin. The standard workbench uses the public download path.

```text
/models/qwen2.5-0.5b/resolve/8e6ec5f417c7d0e1414703ef619b8a24686e3ab0/
```

Place `mlc-chat-config.json`, `tokenizer.json`, `tensor-cache.json`, `params_shard_0.bin` through `params_shard_7.bin` and `Qwen2-0.5B-Instruct-q4f32_1_cs1k-webgpu.wasm` there. Serve the files alongside the application through a static route on the same origin. The self-contained application Worker and source archive are built independently of those large files. The same digests apply to both asset sources. [Controller](../web/browser-ai.mjs)

## Verification

The pinned XGrammar 0.1.27 WASM compiler was exercised with the real Qwen tokenizer. Both action grammars accepted a full example and a typed abstention. The worker constrains JSON fields, types and enumerations during decoding. The shared parser enforces numerical ranges, units and domain restrictions on the completed text and rejects duplicate keys. Controller and transport tests use stand-ins for inference. End-to-end generation, response quality, speed and memory consumption on a physical GPU remain unverified. [Controller and boundary tests](../tests/browser-ai.test.mjs) · [Shared parser](../web/ai-gate.mjs)
