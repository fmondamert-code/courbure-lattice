# AI proposals and gateway setup

Use **AI design → Connect AI** to select a destination. The browser provider loads its model after explicit confirmation. Gateway providers check their health endpoint when connecting. Pressing **Ask AI for a proposal** makes the model request. Review the changed parameters and select **Apply and generate** or **Apply and optimize** to run the result locally. **Try a sample proposal** demonstrates the same review without a model or a network call.

| Connection | Where the request goes | Credential and cost |
| --- | --- | --- |
| Browser WebGPU | Dedicated browser worker using the local GPU. The explicit first load downloads about 291 MB of pinned public assets. | No key or per-request API charge. [Device requirements and model privacy](BROWSER_AI.md) |
| OpenAI, bring your own key | Browser → same-origin Courbure relay → official OpenAI Responses API | The tab retains the key in memory and sends it to the relay with each proposal. The key owner pays the provider's applicable charges. |
| Local gateway with Ollama | Browser → loopback Courbure gateway → configured loopback Ollama service | Defaults to an installed local model. Configure Ollama itself for local-only operation when that is required. |
| Local gateway with OpenAI-compatible server | Browser → loopback Courbure gateway → configured loopback chat-completions service | The service controls any upstream forwarding and charges. Its name or loopback address alone cannot establish where the final model runs. |

For a remote or loopback request, the browser sends the brief and the fields for the selected task to its chosen gateway. The browser WebGPU option supplies them to a local worker. Geometry uses its validated design recipe. Optimize uses its validated coupon objective. Raw mesh coordinates, project files, imported material rows, filenames and numerical results are excluded from the structured context. Text typed into the prompt is sent verbatim after trimming. See the destinations and persistence behavior before connecting a private workload. [Privacy](PRIVACY.md)

### Accepted responses

For each action, the model returns either a complete recipe or objective, or a version-1 reply with the selected payload set to `null` to request clarification. Only a complete, validated proposal reaches review. The parser rejects duplicate property names, including equivalent escaped spellings, wrong actions, unknown fields, out-of-range values, excessive nesting and wire text larger than 8 KiB. Review and apply precede geometry generation or optimization. [Shared wire schema and parser](../web/ai-gate.mjs)

## Same-origin OpenAI

1. Start the built application with `npm run dev`, or use a deployment serving the included Worker. A static-files-only HTTP server can run the geometry and analysis features but lacks the `/api/ai/` routes for hosted BYOK.
2. Choose **OpenAI · bring your own key**, enter your project key, and select **Use this connection**. The health check sends no key and makes no inference request. Disconnecting or reloading clears the tab's stored connection.
3. Select one of the two design tasks, enter the brief and request a proposal. The relay makes one request to `https://api.openai.com/v1/responses`. The only allowlisted hosted model in v0.3 is `gpt-6-luna`. The relay requests a strict output schema, sets `store: false`, caps output at 1,200 tokens, and performs no automatic retry. Usage appears when the provider returns token counts.

The gateway prompt limit is 8 KiB. The hosted relay limits the overall request to 45 seconds and eight concurrent proposals per Worker instance. The controls bound an individual request. Provider charges can accumulate across requests and instances. A provider error or invalid proposal leaves the current specimen in place. A canceled or failed response can still incur usage if the provider already began processing it. Live provider access, model availability for a particular account and actual billing require an authorized request. Release tests inject local stand-ins. [Relay source](../server/ai-worker.mjs) · [Transport tests](../tests/ai-worker.test.mjs)

## Loopback model setup

Keep the app running on `http://localhost:5173`. In a second terminal, start the gateway from the same source directory. For Ollama, start an installed local Ollama service with a compatible model that is already present. The gateway does not install models.

```sh
COURBURE_AI_PROVIDER=ollama COURBURE_AI_MODEL=qwen3:4b npm run gateway
```

The default model service is `http://127.0.0.1:11434`. To enforce local-only behavior in Ollama, set `OLLAMA_NO_CLOUD=1` on the **Ollama service** and restart it. In Courbure, choose **Local gateway · Ollama / compatible**, leave the gateway URL at `http://127.0.0.1:4317`, and use the connection. [Ollama configuration](https://docs.ollama.com/faq) · [Ollama structured output](https://docs.ollama.com/capabilities/structured-outputs)

For an installed OpenAI-compatible local server, replace the model name with its served model ID. The loopback endpoint must implement chat completions and JSON output.

```sh
COURBURE_AI_PROVIDER=openai-compatible \
COURBURE_AI_MODEL=your-local-model \
COURBURE_AI_BASE_URL=http://127.0.0.1:4000/v1 \
npm run gateway
```

The browser adapter and the model service use different ports. The Courbure gateway binds to `127.0.0.1` and allows the exact browser origins `http://localhost:5173` and `http://127.0.0.1:5173` by default. Set `COURBURE_ALLOWED_ORIGINS` to a comma-separated list of trusted exact origins if needed. A hosted HTTPS page may face browser restrictions reaching localhost. Running the app locally avoids that cross-origin hosting dependency. The optional gateway also supports official OpenAI via its own server-side `COURBURE_AI_API_KEY` when explicitly configured with `COURBURE_AI_PROVIDER=openai` and `COURBURE_AI_MODEL=gpt-6-luna`. This configuration sends the brief and context to OpenAI and can bill the gateway operator. [Gateway implementation](../scripts/ai-gateway.mjs) · [Local transport tests](../tests/gateway.test.mjs)

## Accepted drafts

| Action | Required payload | What applying it means |
|---|---|---|
| `propose_geometry` | Complete versioned design, including units, family, envelope, dimensions, cell pitch, solid fraction, gradient, skin thickness and quality | Generates the proposed specimen locally. A mesh reference requires an already selected local envelope whose dimensions match the draft. |
| `propose_inverse` | Payload mass, drop height, stroke, force ceiling, coupon width/height and soft-contact preference | Runs the local inverse search for the current 36 × 36 × 30 mm flat BCC coupon. Engineering targets can be mutually infeasible. The inverse solver reports that outcome. |

For example, this objective asks the solver to evaluate whether the candidate satisfies two numerical constraints. It contains no predicted or measured result.

```json
{
  "version": 1,
  "action": "propose_inverse",
  "objective": {
    "mass_kg": 0.5,
    "drop_m": 0.5,
    "stroke_mm": 15,
    "max_force_n": 450,
    "size_mm": 36,
    "height_mm": 30,
    "soft_contact": true
  }
}
```

Use `modelReplySchema(action)` for provider output. Pass the raw model text and selected action to `parseModelReply` before another parser can discard duplicate keys. An exact typed abstention returns `null`. A full recipe or objective passes through `parseAIProposal`. The gate rejects duplicate keys, unexpected fields, nested instructions, arbitrary code, oversized responses and non-finite numbers. It reuses the editor and solver's validators for cross-field rules, including cell pitch, material budget and stroke. A validated result is an immutable copy. `proposalDiff` computes field-by-field changes for review. `validateAIApply` checks the selected local mesh at apply time. The gate runs only the two parameter validators. A later reported value must come from the actual geometry engine, numerical model or physical measurement. [Geometry rules](../web/core.mjs) · [Mechanics](MECHANICS.md)

## Open-source choices

The workbench offers browser WebGPU, a loopback gateway and hosted OpenAI as routes to one shared proposal format. The geometry and numerical engines use the same application checks for all three. The existing JavaScript validators cover the two actions. A full routing product becomes worthwhile when operations require multiple authorised providers, centralised access policies or failover. Never configure fallback from a local service to a cloud provider without a separate user choice for that destination.

| Project | Best fit | Decision for this workbench |
|---|---|---|
| Ollama, MIT runtime | Installed local models and structured JSON output | Supported loopback adapter. Send the schema through the `format` parameter and validate the returned bytes. Check the selected model's licence separately. [Structured output API](https://docs.ollama.com/capabilities/structured-outputs) · [Licence](https://github.com/ollama/ollama) |
| llama.cpp, MIT | Local CPU/GPU inference with JSON grammar constraints | Alternative for an existing local inference installation. Its grammar conversion covers a subset of JSON Schema. The application still enforces numeric limits. [Grammar support and limitations](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md) · [Source](https://github.com/ggml-org/llama.cpp) |
| WebLLM, Apache-2.0 | On-device inference with a WebGPU worker | Integrated in v0.3 with Qwen2.5-0.5B, an explicit model download and constrained JSON decoding. [Browser AI](BROWSER_AI.md) · [WebLLM](https://github.com/mlc-ai/web-llm) |
| Ajv, MIT | Validating many JSON Schema contracts or sharing generated validators across services | The next validation dependency to consider if the number of schema versions grows. Its standalone compiler can generate JavaScript validators at build time. Engineering and session-specific checks still belong in Courbure. [Standalone compilation](https://ajv.js.org/standalone.html) · [Source](https://github.com/ajv-validator/ajv) |
| LiteLLM, MIT core with separately licensed enterprise code | Shared provider routing, access controls and spend tracking | Consider for a multi-team deployment where budgets and access controls justify an additional service. Verify terms for the selected features and explicitly configure allowed upstream destinations. [Source](https://github.com/BerriAI/litellm) · [Licence boundaries](https://github.com/BerriAI/litellm/blob/main/LICENSE) |
| Bifrost, Apache-2.0 | OpenAI-compatible multi-provider gateway with load balancing and failover | Candidate when a self-hosted gateway must serve several applications. Disable automatic cross-provider fallback in workflows that promise a specific destination. [Source](https://github.com/maximhq/bifrost) |
| Portkey Gateway, MIT | Provider routing, conditional retries and failover | Alternative for operators already running this gateway. Restrict routing and telemetry to the data-sharing agreement. [Source](https://github.com/Portkey-AI/gateway) · [Licence](https://github.com/Portkey-AI/gateway/blob/main/LICENSE) |
| Guardrails AI, Apache-2.0 | Python services that compose multiple input and output validators | Consider if a server later needs semantic policies beyond the two bounded parameter records. It adds a Python service and validator lifecycle. [Source](https://github.com/guardrails-ai/guardrails) |
| Instructor, MIT | Typed extraction and validation/retry loops for provider calls | Useful for a separately maintained extraction service. Retrying can add latency or provider charges, and the result must still pass the application gate. [Source](https://github.com/567-labs/instructor) |
