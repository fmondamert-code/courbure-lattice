# Courbure development milestones

Version 0.3.0 generates graded lattices inside validated STL envelopes, checks inverse candidates against their measured mesh, solves initial BCC frame stiffness and runs a guided transient coupon drop model. It adds a small WebGPU proposal model, indexed 3MF export and a local PrusaSlicer bridge. Three prerequisites for a physical comparison are a reproducible print profile, compression data collected at the intended conditions and an independent held-out test. The time windows below are planning targets contingent on access to the equipment and material. [Release evidence](VALIDATION.md)

| Target | Deliverable | Proposed exit criteria |
| --- | --- | --- |
| 30 days | Independent software and manufacturing references | Extend the Apple M4 comparison to another GPU and a broader set of compression curves. Record device, browser, parity and timings. Compare the finite BCC elastic calculation with a resolved-solid reference using the same supports. Inspect toolpaths using a target printer profile, resolve adhesion and support warnings, then measure a printed specimen. |
| 60 days | One measured material and process profile | Test three geometries spanning the density range, with three specimens per geometry, and three matched foam controls. Record loading and unloading, dimensions, mass, rate, raw force and displacement, material batch and build orientation. Keep one geometry and an independent batch out of calibration. Compare its curve, work and error with the model. |
| 90 days | Instrumented drop pilot and cost per accepted part | Freeze candidate selection before comparing the insert with its baseline. Match payloads, installed geometry, attitudes and release heights. Specify limits for measured acceleration and travel. Report rebound, bottoming out, variation and specimen reuse. Apply actual material, labor, time and reject data to the same acceptance criterion. |

The optional AI interface stages validated draft parameters. Exercise the browser model on a named physical GPU with public synthetic briefs in English and French. Measure cold-load time, peak memory, inference latency, action agreement and preservation of unchanged dimensions. The same benchmark can compare provider compliance and design time. Record the model, versions, rejection causes and actual authorized usage. Keep this evaluation independent of the mechanical results.

## Choosing the next dependency

For fixed-domain sheet density, the band can be inverted numerically from the sampled field distribution. For a mechanical target, search over the topology and the geometric parameters supported by the forward model. Confirm the top-ranked candidates with the direct evaluator, together with one baseline under the same budget. Finite-element studies require calibrated materials, explicit contact and boundary conditions, and mesh convergence. An additional neural model becomes useful when the direct evaluator is expensive or independent mechanical labels are available. [SfePy hyperelastic example](https://sfepy.org/doc/examples/large_deformation-hyperelastic.html)

| Research option | Useful input and output | Integration decision |
|---|---|---|
| GraphMetaMat | Conditional graph generation for truss cells with target stress–strain or vibration transmission curves. The authors provide a forward surrogate, inverse policy and tree search. | The code is MIT. The publication links separate datasets and weights. Confirm their distribution terms and applicability to the selected material before packaging any assets. Use it as a candidate generator for its compatible cell families. [Code and licence](https://github.com/marcomau06/GraphMetaMat) · [Data archive](https://doi.org/10.6084/m9.figshare.28773806) |
| DiffuMeta | Generates an algebraic description of a shell cell conditioned on mechanical properties. Its training labels include stress–strain responses and effective stiffness. | The code is MIT. The ETH archive lists CC BY 4.0 for the deposited data and checkpoints. An evaluation on printed curved inserts would be a new study. [Code](https://github.com/li-zhengz/DiffusionMetamaterials) · [Dataset and checkpoints](https://doi.org/10.3929/ethz-b-000746797) · [Paper](https://doi.org/10.1038/s42256-026-01218-8) |
| Local browser surrogate | An offline model trained on appropriately labelled geometry receives bounded features and predicts a forward response. | Export a compact model after validation, compare outputs against the offline reference, and verify operator support and fallback on the target device. [ONNX Runtime WebGPU](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html) |

## Cost per accepted part

Start with direct, locally entered rates and record the source and date for each input. An estimate should show a missing rate as unknown. Keep the rate sheet on the user's machine and outside the AI context.

| Component | Basis |
|---|---|
| Material | Total grams consumed, including support, brim, purge and rejected runs, multiplied by the purchase price per gram. Distinguish slicer-estimated usage from measured usage. |
| Machine and energy | Occupied machine hours × local hourly machine rate, plus measured kWh × tariff if energy is excluded from that rate. |
| Labour and consumables | Hands-on setup, removal, inspection and finishing time × labour rate, plus separately identified consumables. Allocate batch setup once. |
| Accepted quantity | Divide actual total batch cost, including all failed attempts, by accepted part count. With no accepted parts, report the incurred total and leave unit cost undefined. |

For foam, use the same accepted quantity and function. Include stock or quoted blank price, cutting loss, processing, inspection and assembly where applicable. Record quantity and quotation date before claiming a saving. Geometry alone yields nominal material mass. Cycle time, touch labour, yield and matched performance determine the economic comparison. [Manufacturer's costing example](https://blog.prusa3d.com/how-to-calculate-printing-costs_38650/)

**Open dependencies.** Machine access, test-rig availability, material lots, procurement rates and first-pass yield determine whether the proposed schedule and cost comparison can be demonstrated. [Validation protocol](VALIDATION.md)
