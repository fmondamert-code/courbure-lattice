# Courbure

Courbure generates graded lattices inside a built-in shape or a closed STL on your computer. Export the result in millimetres as a 3MF model, as a binary STL, or as a manufacturing ZIP with both meshes and the regenerable project. A small optional WebGPU model translates a plain-language brief into editable parameters on the device. Geometry generation and numerical analysis work without a model or API key.

[Open the static demo](https://courbure-lattice.pages.dev/) · [Download the release](https://github.com/fmondamert-code/courbure-lattice/releases/tag/v0.3.0)

## Run locally

Use Node.js 22 or later and Python 3 (for packaging the source archive). Run these commands from the source directory.

```sh
npm ci
npm run build
npm run dev
```

Open **http://localhost:5173** in a modern browser. The build uses the locked packages and produces the browser assets, source archive and self-contained Worker entry point. The source ZIP contains the source and lockfile. Running the commands above regenerates `dist/` from an extracted copy. Use HTTP on localhost or HTTPS on a hosted installation so browser workers, WebAssembly and the material file fingerprinting can run.

```sh
npm test
```

## Try a specimen

| Task | In the workbench | What to check |
| --- | --- | --- |
| Fill a known envelope | Open **Geometry → Import an STL envelope → Try the included stepped envelope**. For your own STL, choose its coordinate units and the desired fit first. | Rotate the mesh to inspect the step and through-hole. Compare target and measured fraction, connected solids and the three height bands. |
| Design with text | In **AI design**, try the sample proposal to preview the review flow. For a local request, choose **Connect AI**, select the browser WebGPU model and load it explicitly. Choose a design task, then **Ask AI for a proposal**. | Review the field changes and apply the draft to run the local engine. The sample works offline after the app has loaded. |
| Screen a compression target | Open **Optimize**, keep the illustrative settings and select **Find a candidate**. To try a data-backed calculation, first load a CSV under **Compression evidence**. | Compare required work, predicted loading work and terminal force. A finalist must qualify again after the generated mesh is measured. |
| Compute elastic stiffness | Under **Elastic compression**, load the BCC benchmark coupon. Enter the base material modulus and Poisson ratio, then analyze it. | This is a small-strain frame solve with bonded platens. Export its graph for optional local FreeCAD reconstruction. |
| Simulate a guided drop | Generate the flat, skinless BCC benchmark coupon, select the payload, release height and stroke, and run the guided drop simulation. | Read peak contact force, compression, refinement checks and stop reason. The conservative loading law retraces on unloading. |
| Prepare a print | Export the 3MF or manufacturing ZIP. Open the model in a slicer using the actual printer, nozzle and material profile. | Check the plate placement and toolpaths through the thinnest struts. PrusaSlicer 2.7.4 produced 120 layers for the documented BCC example and warned of low bed adhesion. |
| Take your results with you | Select **Export STL**, **Export project**, or **Download specimen report**. **Save locally** writes one restorable browser draft. | Import the STL in millimetres. A project can include the normalized input envelope and the full imported compression CSV. Review its contents before sharing. |

The geometry editor supports gyroid, Schwarz P and diamond sheets, plus body-centered cubic (BCC) struts. The four built-in envelopes are a square-section box, cylinder, curved half-shell and box with a spherical keep-out. Cell pitch, fraction, signed axial grading, end plates and resolution determine the final specimen. A dimensionless sheet band controls the material fraction. Physical wall thickness varies with pitch and position.

## What the numbers mean

- **Measured solid fraction** is the generated solid's volume divided by the available envelope volume. Each of three height bands also has its own material and envelope volumes. Both measurements include the end plates when fitted.
- **Inverse design** screens one flat, unskinned 36 × 36 × 30 mm BCC coupon. A Gaussian process chooses density and grading to evaluate with a three-layer compression model. It can use either illustrative coefficients or imported monotonic loading curves. The geometric recheck can reject a nominal winner.
- **Elastic stiffness** comes from a separate 3D Timoshenko frame for rectangular BCC specimens. It reports reactions, stiffness, apparent modulus, member normal stress and elastic energy at small imposed strain. Other envelopes and sheet lattices currently support geometry analysis only.
- **Impact performance** needs physical data for the printed specimen and its loading conditions. Rapier integrates the vertical motion of one guided payload against a reduced coupon law. Numerical convergence and energy checks qualify that calculation. Physical rebound and force require rate-dependent loading and unloading data and an instrumented test. [Transient model](docs/DROP_TEST.md)

## Runtime and data

Manifold 3.5.5 generates and clips meshes using WASM on the CPU in a browser worker. Three.js 0.180.0 displays them using WebGPU, WebGL2 or a labeled Canvas 2D fallback. The inverse evaluator uses a separate WGSL compute path after a runtime comparison with its CPU reference. The synthetic inverse-design example ran on an Apple M4 and passed that comparison. Throughput and cross-device results remain unmeasured. [Validation](docs/VALIDATION.md)

The optional browser AI worker uses WebLLM 0.2.89 and Qwen2.5-0.5B. Its first explicit load requests about 291 MB of pinned files from Hugging Face and GitHub. Briefs and parameters are processed on the device. Physical-GPU inference quality and latency remain unverified. [Browser model, device requirements and privacy](docs/BROWSER_AI.md)

The optional same-origin Worker relays a proposal to OpenAI using your own key. It runs with `npm run dev` or on a compatible Worker host. On the static demo, try the offline sample, browser model or loopback adapter. Each hosted proposal can incur a charge. Connecting checks the gateway. Pressing the proposal button transmits the brief and the validated recipe for a geometry request or the validated objective for an optimization request. Local envelope coordinates and raw compression rows stay out of this request. Provider integration tests use stand-ins. An authenticated live OpenAI completion has yet to be verified. [AI setup](docs/AI_GATEWAY.md) · [Data handling](docs/PRIVACY.md)

## Documentation

| Question | Reference |
| --- | --- |
| Which STL units, sizes and meshes are supported? | [STL import](docs/STL_IMPORT.md) |
| How do I prepare curves, and what does the solver interpolate? | [Material data](docs/MATERIAL_DATA.md) |
| How do I open a print package or slice it locally? | [3MF, STL and PrusaSlicer](docs/PRINTING.md) |
| Which forces and stop conditions does the guided drop model use? | [Transient drop simulation](docs/DROP_TEST.md) |
| What frame does the solver assemble, and how do I export STEP or FCStd? | [Elastic benchmark and FreeCAD adapter](docs/MECHANICS.md) |
| How do generation, search, mesh measurement and replay fit together? | [Architecture](docs/ARCHITECTURE.md) |
| What is verified in software, and what still needs a physical test? | [Validation](docs/VALIDATION.md) · [Roadmap](docs/ROADMAP.md) |
| Which software and research does Courbure use? | [Upstream inventory](docs/UPSTREAM.md) · [Notices](NOTICE) |
| How do I contribute or prepare a public release? | [Contributing](CONTRIBUTING.md) · [Maintainer handoff](CODEX_HANDOFF.md) |

Original Courbure code and synthetic examples use the Apache License 2.0. The release includes Manifold, Three.js, Rapier, WebLLM and fflate. Optional model artifacts, PrusaSlicer and FreeCAD are obtained separately. [Project license](LICENSE) · [Third-party notices](NOTICE)
