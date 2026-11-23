# Courbure v0.3.0 maintainer handoff

Start with the [README](README.md) for the local workflow and [validation](docs/VALIDATION.md) for the evidence behind each output. The source distribution is independent of a particular hosting account. It contains the browser application, relay and loopback gateway sources, PrusaSlicer and FreeCAD adapters, tests, lockfile, documentation and original synthetic examples. The archive contains source only. An extracted copy rebuilds `dist/` using the locked dependencies.

## Reproduce and release

1. Use Node.js 22+ and Python 3. Run `npm ci`, `npm test`, `npm run build`, then `npm run dev`. The local app runs at `http://localhost:5173`. The build regenerates the static assets, source download and self-contained Worker in `dist/server/index.js`.
2. Exercise the built-in stepped STL and the synthetic curves. Reopen one exported project and rerun its analysis. The numerical benchmark in [MECHANICS.md](docs/MECHANICS.md) gives reproducible inputs and expected reaction. Check the reported render and compute backends independently.
3. Deploy the Worker entry point on a compatible host for the complete web app, including same-origin BYOK. A static HTTP server also supports local generation, local analysis and the optional loopback gateway. A custom domain needs verified ownership, DNS, binding and TLS before use in a release link.
4. Keep the integrated source on `main`. Distribute the reviewed source archive or source allowlist, excluding hosting identities, unrelated Git history, secrets and private inputs. The GitHub Actions workflow builds and deploys the static demo from the public repository when GitHub Pages is configured to use Actions.
5. Check the public repository, release and demo before sharing the links. The [Codex for OSS application brief](docs/CODEX_FOR_OSS.md) and [X draft](docs/ANNOUNCEMENT.md) are prepared for separate approval and submission.

## Where changes belong

| Area | Source | Check |
| --- | --- | --- |
| Geometry and imported envelopes | `web/core.mjs`, `web/envelope-import.mjs`, `web/engine.mjs`, `web/worker.mjs` | Three-slab volume balance, finite STL, units, clipping, holes, plate budget and topology. |
| Compression curves and inverse design | `web/material.mjs`, `web/inverse.mjs`, `web/app.mjs` | Monotonic input, common-pressure interpolation, bounded search, mesh recheck and out-of-domain handling. |
| Frame mechanics and CAD | `web/mechanics.mjs`, `web/mechanics-worker.mjs`, `scripts/freecad_import.py` | Element solutions, equilibrium, energy balance, graph agreement and FreeCAD round-trip when changing the adapter. |
| Guided drop | `web/drop.mjs`, `web/drop-worker.mjs` | Check the analytic spring reference, time-step refinement, energy residual, stroke and curve boundaries. [Assumptions and acceptance criteria](docs/DROP_TEST.md) |
| Slicer handoff | `web/printing.mjs`, `web/print-worker.mjs`, `scripts/slice.py` | Inspect 3MF units, indexed facets and build-item transform, then use a real printer profile for toolpaths. [Printing](docs/PRINTING.md) |
| Browser language model | `web/browser-ai.mjs`, `web/browser-ai-worker.mjs` | Check explicit load, fetch restrictions, cancellation, grammar and review. Updating weights or compiler requires matching revision and SHA-256 pins. [Browser AI](docs/BROWSER_AI.md) |
| Reproducibility | `web/project.mjs` | Revalidate original envelope and curves. Discard cached results on import and regenerate geometry. |
| Optional model calls | `web/ai-gate.mjs`, `web/ai-ui.mjs`, `server/ai-worker.mjs`, `scripts/ai-gateway.mjs` | Keep actions and upstream destinations bounded. The browser asks for review before applying any draft. Run transport tests with stand-ins. |
| Distribution | `scripts/`, `server/index.mjs`, `package.json`, `package-lock.json`, `NOTICE` | Rebuild, launch from exported source, open the source download and retain dependency licenses. |

## Remaining evidence

The documented synthetic search passed the runtime CPU comparison on an Apple M4. Cross-device parity, latency and browser-model inference remain open. The browser model has grammar and tokenizer checks. The OpenAI transport has mock coverage. An explicitly authorized, billed live call is needed to demonstrate provider behavior for a real account. The included data are synthetic. Compression and drop performance on printed specimens require held-out material/process measurements and instrumented comparison with the chosen baseline. [Roadmap](docs/ROADMAP.md)
