# What Courbure can verify

Courbure measures the generated solid and checks its numerical models against explicit fixtures. Physical calibration, manufacturing fidelity and dynamic impact performance require separate evidence.

## GitHub release checks — v0.3.0

- **Browser and project replay.** Chromium on macOS 15.6.1 generated the synthetic stepped envelope with a 28.2% solid fraction and 68,088 triangles. Reopening the exported project reproduced both values. The offline sample proposal applied through the review gate. The gate rejected a draft after its cell pitch changed.
- **Physical WebGPU adapter.** Chromium reported a non-fallback Apple Metal 3 adapter on an Apple M4. The synthetic-curve search passed its first-batch CPU comparison and ran the WGSL forward evaluator. It used 48 evaluations and 7 mesh rechecks, returning 29.33% measured solid fraction and −20% axial radius grading. A deliberately infeasible objective was rejected by the work bound. The mesh generation itself used Manifold WASM.
- **Guided drop and slicing.** The illustrative BCC coupon reproduced 257.05 N peak force, 12.709 mm peak stroke and a 0.00434% energy residual. A 150 N ceiling was flagged as exceeded. The browser exported the 3MF and manufacturing ZIP. PrusaSlicer 2.9.7 reopened the 3MF and produced 150 layers after explicit XY placement, with a low-bed-adhesion warning. [Slicer setup](PRINTING.md) · [Release captures](https://github.com/fmondamert-code/courbure-lattice/releases/tag/v0.3.0)

The GitHub release suite has 66 tests. The new test covers positioning an origin-centred export on a positive-coordinate print bed.

## Earlier checks — v0.3 handoff

- **Serialized mesh integrity.** Independent VTK 9.3 reads of six STL fixtures confirmed closed, oriented, nondegenerate meshes. The graded gyroid regression has 74,434 triangles and three actual disconnected material regions. Its earlier zero-area faces were corrected by meshing the two smooth sheet boundaries separately. A kernel-side check now runs on the exact Float32 coordinates exported. Enclosed cavities no longer count as separate material solids. These checks do not prove absence of every self-intersection or a printable minimum wall.
- **Transient guided drop.** Four actual Rapier 0.21.0 WASM cases test a gravity-loaded analytical spring, a nonlinear loading-work turning point, stroke/data limits and numerical rejection. A generated 36 × 36 × 30 mm BCC coupon, 28% requested fraction, 12 mm pitch, no plates, with a 0.5 kg payload released from 0.5 m gives 257.05 N peak force, 12.709 mm stroke and 14.647 ms contact with the illustrative law. Maximum energy residual is 0.00434%. Conservative rebound returns the stored loading work; no damping or measured protection rating is inferred. [Drop model](DROP_TEST.md)
- **Print interoperability.** lib3mf 2.5.0 strict mode accepted the 24 mm graded BCC 3MF with zero warnings, 45,260 triangles, explicit millimetres and Z from 0 to 24 mm. Actual PrusaSlicer 2.7.4 generated 120 layers from both 3MF and binary STL with a specified 0.4 mm nozzle / PLA / 0.20 mm profile. The slicer warned about low bed adhesion; adding a 5 mm brim changed the warning to a thin fragile part. No physical print was made. [Printing details](PRINTING.md)
- **Browser AI.** Three tests cover explicit model loading, cancellation, immutable asset allowlists and the shared proposal gate. The real XGrammar WASM and Qwen tokenizer accepted constrained geometry, objective and abstention responses. No complete GPU inference has been observed in this environment. [Local model](BROWSER_AI.md)
- **Provider boundaries.** Duplicate JSON keys, incomplete model replies, foreign task context and unsupported actions are rejected. A loopback gateway changed after connection returns 409 before forwarding any prompt. CPU/WASM automated tests use synthetic data and mocked providers; no paid OpenAI call was made.

The handoff browser exercised the default guided drop, exported its JSON, then lowered the force ceiling to 150 N and displayed a force-limit failure. It downloaded the manufacturing ZIP through the production worker route. Browser AI refused a load without download consent and then reported the unavailable WebGPU adapter. The tab used the mesh software projection.

## Evidence available

| Capability | What the release checks | Evidence still needed |
| --- | --- | --- |
| Geometry and STL | Known BCC centerlines, plate material budgets, curved-shell dimensions, three-slab volume conservation and binary STL volume. Imported ASCII and binary fixtures check units, topology, a clipped tetrahedron and an open through-hole. [Geometry tests](../tests/geometry.test.mjs) · [Import tests](../tests/envelope-import.test.mjs) | Resolution convergence, slicer fidelity and connectivity on each intended specimen. |
| Material CSV and inverse design | Analytical elastic compliance in series, horizontal plateaus, no extrapolation, synthetic fixture provenance, deterministic search and infeasibility handling. [Material tests](../tests/material.test.mjs) · [Inverse tests](../tests/inverse.test.mjs) | Held-out error at the intended pitch, orientation, material, rate and process. |
| BCC elastic frame | Axial bar, cantilever in both bending planes and torsion, with force balance, energy and stiffness scaling on a finite coupon. A FreeCAD round-trip reopened both compound and fused BCC reconstructions. [Benchmark and CAD observations](MECHANICS.md) | Resolved-solid comparison and printed stiffness under comparable platen conditions. |
| Provider contract | Local stand-ins test request contents, response schema, malformed proposals, origin restrictions, timeouts and absence of automatic retry on the official route. The sample proposal needs no service. [Gateway checks](../tests/gateway.test.mjs) · [Worker checks](../tests/ai-worker.test.mjs) | Authorized live proposals, actual provider charges and representative brief quality. |
| Project replay | Imported geometry is regenerated and the original curve data are revalidated. Corrupted curve fingerprints, invalid objectives and absent required envelopes are rejected. [Project tests](../tests/project.test.mjs) | Compatibility with other software and retained user backups. |

The bundled 36 × 30 × 30 mm stepped-envelope STL was exercised in the browser with BCC, 12 mm pitch, 28% target and no plates. It produced one connected solid with 68,088 triangles and a measured fraction of 28.2% at the displayed precision. Loading the synthetic CSV and saving a local draft also succeeded. [Example envelope](../web/examples/stepped-envelope.stl)

The v0.3 handoff suite passed 65 tests on 2026-11-23. That browser also completed a curve-backed search using the synthetic example: 48 learned evaluations and 7 mesh checks selected a 29.33% measured-fraction BCC coupon with −20% radius grading, 2.569 J model loading work and 323.4 N terminal force against a 2.525 J requirement. The local beam solver completed on that coupon, and restoring the saved imported-envelope project regenerated its original geometry. These are software observations.

**Independent numerical reference.** For the gyroid use `G = sin(X) cos(Y) + sin(Y) cos(Z) + sin(Z) cos(X)`, with `X = 2πx/a` and likewise for `Y` and `Z`. Counting cell-centred samples satisfying `abs(G) ≤ band` over one complete period gives the following results for an unclipped, ungraded cell.

| Samples per axis | Band 0.2 | Band 0.4 | Band 0.6 |
|---|---:|---:|---:|
| 128 | 12.869% | 25.768% | 38.985% |
| 256 | 12.872% | 25.860% | 38.914% |

The band is dimensionless. A millimetre wall thickness requires an offset from the midsurface in physical distance or a defined local thickness measurement. At fixed band, doubling the period doubles every physical length in the complete cell while keeping its volume fraction constant. Clipping and grading can change the fraction of a finished part.

## Checking a new geometry or export

1. **Inputs and replay.** Validate allowed families, units, finite values, parameter ranges and resolution limits. Exercise boundary values and infeasible targets. Reopen the recipe in the same pinned build and compare parameters, mesh bounds and volume.
2. **Density.** Report requested fraction, generated fraction and their difference in percentage points. Use `Vsolid / Venvelope`, with both volumes evaluated on the same clipped domain. State whether the insert cavity counts in the denominator. When showing a periodic-cell estimate, label it separately. Proposed acceptance is an absolute target error of at most one percentage point and a change of at most one point when spatial resolution doubles. Check volume independently by occupancy sampling. Mark the result unresolved if the resolution limit prevents convergence.
3. **Gradient.** Split the sample into slabs along the selected gradient axis. Record each slab's solid fraction relative to its local envelope, alongside the whole-part result. For graded fixtures containing multiple cells per slab, verify that the high-density end exceeds the low-density end. Use paired zero-gradient fixtures to expose endpoint bias caused by clipping.
4. **Export.** Re-import the actual STL at millimetre scale. Check finite coordinates, positive enclosed volume, consistent winding, two incident faces per undirected edge, non-degenerate triangles and the expected number of connected components. Include a coarse-resolution failure case and inspect clipped faces. Manifold exposes mesh measurement and topology operations. Its level-set implementation can produce corrugated faces when the field extends past the sampling bounds, so test the envelope boundary explicitly. [Manifold WASM API](https://manifoldcad.org/docs/jsapi/classes/manifold.Manifold.html)

## Inverse design and drop-energy screening

The studio fixes the coupon at 36 × 36 × 30 mm and accepts payload mass, free-fall height, available stroke and force ceiling. With the illustrative model, the search evaluates 15 seed designs and then fits a Gaussian process with a radial-basis kernel to the numerical score. It alternates low predicted scores with exploration of poorly sampled regions of a 273-candidate grid. It returns the best feasible candidate among 48 distinct evaluations, plus a uniform baseline at the same mean solid fraction. For impossible bounds it stops before search. If no sampled candidate is feasible, it returns the closest tested design and leaves the winner empty. The returned trace includes scores, work, force, density and gradient. The recipe also records the seed and, when Web Crypto is available, the SHA-256 fingerprint of the forward-model definition.

During the fast search, the three layers have assumed relative densities `ρ(1 − 2g/3)`, `ρ` and `ρ(1 + 2g/3)`, with `g` the gradient. For local fraction `r`, the assumed initial modulus is `24r² MPa`. The layer changes to an 8%-of-initial tangent slope at 8% strain and densifies at strain `0.84 − 0.70r`. Its final slope is four times its initial modulus. Layer strain is capped at 92%. The evaluator finds common pressure at the prescribed overall stroke and integrates each layer's piecewise-linear law. Imported curves replace the illustrative layer law with interpolation inside the supplied density and stroke domain. The search uses work and force constraints, a preference for lower mean density and an optional preference for a softer upper layer. The model omits individual member deformation and accepts no rate or unloading input. [Numerical implementation](../web/inverse.mjs)

**Reproduced CPU fixture.** At seed 713, a 0.50 kg mass, 0.50 m drop, 15 mm stroke, 450 N ceiling and 36 × 36 × 30 mm coupon with soft contact selected produced the following direct-model results. At fixed material fraction, the graded design achieves the softer surface with less loading work and a higher terminal force.

| Numerical candidate | Mean fraction | Gradient | Loading work | Terminal force | Top-layer initial modulus |
|---|---:|---:|---:|---:|---:|
| First choice using assumed layer densities | 0.2575 | −0.20 | 2.561 J | 245.71 N | 1.195 MPa |
| Uniform baseline | 0.2575 | 0 | 2.713 J | 234.29 N | 1.591 MPa |

**Recheck on the generated solid.** In BCC geometry the gradient acts on strut radius. Its relationship to enclosed layer volume is nonlinear. Intersect the finished solid with three equal-height slabs and divide each solid volume by its corresponding envelope volume. Pass all three measured geometric fractions, in bottom-to-top order, back through the direct compression equations. This updates the inputs to the synthetic model. The law relating a layer's solid fraction to material response still requires experimental calibration.

| BCC preview mesh at 12 mm pitch | Solid fraction per slab, bottom to top | Model loading work | Terminal force | Compared with this numerical objective |
|---|---|---:|---:|---|
| Graded first choice | 0.30330, 0.27142, 0.18766 | 2.369 J | 265.01 N | Falls below the 2.52521 J target |
| Uniform baseline | 0.24337, 0.27051, 0.24337 | 2.567 J | 223.48 N | Meets both model limits |

The finite coupon spans partial cells, so even uniform radius produces different fractions in the middle and outer slabs. These values came from the mesh volume calculations and the CPU compression model. The browser checks up to six finalists, ranks the qualifying meshes and can generate one additional uniform mesh as a comparator. In the default scenario it correctly replaces the initial graded proposal with the qualifying uniform geometry with measured mean fraction 25.24165%, work 2.56658 J and terminal force 223.48 N. This end-to-end behavior and the immediate rejection of a 150 N force ceiling were observed in the managed preview on 2026-11-23. No physical drop result is available.

**Handoff runtime observation, 2026-11-23.** The handoff browser used the Canvas 2D software projection of the actual mesh and the CPU inverse-design path. The initial curved example is a 48 × 24 × 36 mm half-shell, with 8 mm pitch, 24% target fraction and 0.8 mm end plates. It produced one connected mesh and 23.434% measured fraction in the CPU geometry check.

**Backend check.** The WebGPU compute shader evaluates batches of the three-layer forward model. It must dispatch work, read finite results back and match the first batch to the double-precision CPU evaluator within `0.0002 × max(abs(reference), 0.01)` for work, force and modulus. The optimizer independently re-evaluates the finalist and baseline on the CPU. An unavailable adapter or failed parity check falls back to CPU and records the reason when available. A WebGPU performance claim requires a timed run on an identified device. [Executable checks](../tests/inverse.test.mjs)

For a guided vertical drop, let `h` be the free-fall distance before contact, `m` the payload mass and `s` the allowed compression travel. The incident energy is `m g h`. A mass that comes to rest exactly at stroke `s` requires upward contact work of `m g (h + s)`. The model compares its full-stroke work capacity with that value. An earlier stop at `x` requires `m g (h + x)`. With force in newtons and displacement in millimetres, divide `∫F dx` by 1,000 to obtain joules. The constant-force ideal has mean contact force `m g (h + s) / s` when both lengths are expressed in metres. This provides a necessary feasibility check. A 0.50 kg mass, 0.50 m drop and 15 mm stroke require 2.525 J and at least 168.35 N mean contact force at `g = 9.80665 m/s²`. A 150 N force ceiling is infeasible in that example.

A quasi-static compression calculation estimates loading work. Some energy can return on unloading. Dynamic peak acceleration also depends on contact location, loading rate, rebound, confinement and the as-built material. For a finished curved insert, measure contact area evolution and load path in the installed configuration. Instrumented drops with a known payload and prescribed attitudes must measure the acceleration time history, stroke, rebound and repeatability before publishing impact-protection performance.

**Model credibility.** Distinguish solver agreement, error against synthetic training labels and agreement with physical tests. For a learned surrogate, split calibration and holdout data by geometry and print batch. Record which topology, material grade, strain range, rate and orientation were covered. A distance from sampled designs or disagreement between model fits can flag extrapolation. Only measured held-out errors support a statistical accuracy statement for printed parts. For a screening model with assumed coefficients, report the coefficient assumptions and sensitivity, including whether the preferred design changes across plausible inputs.

## From a mesh to a printed result

**Slicing.** Save the slicer version, printer, material, nozzle, extrusion width, layer height, orientation and support settings. Inspect actual toolpaths at the thinnest features and through graded transitions. Record missing walls, disconnected islands, bridges and inaccessible supports. Record slicer estimates for material and print time separately from observations on the machine. A universal minimum wall thickness would ignore profile-dependent extrusion width and slicing behaviour. [Prusa design guidance](https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135)

**Mass.** With units of g/cm³ and mm³, nominal part mass in grams is `material density × solid volume / 1000`. Weigh a printed coupon and calculate its measured bulk density in g/cm³ as `1000 × mass_g / measured envelope volume_mm³`. Compare nominal and measured mass to identify process variation before using geometric mass estimates for costing.

**Compression and foam comparison.** Print three geometries spanning the density range, three specimens per geometry, and test three specimens of one identified foam. Match initial envelope, loading direction, temperature, strain rate, preconditioning and cycle count. Record TPU grade and batch, build orientation, printer profile and as-built dimensions. Plot engineering stress `F/A₀` against compressive strain `ΔH/H₀`. Report stress at 10%, 25% and 40% strain, loading work per initial volume (area under the loading curve), and energy dissipated per initial volume (loading area minus unloading area). State the cycle and show individual curves or their observed range. Three specimens per condition constitute a pilot. Holmes and colleagues tested six gyroid geometries in each of two TPUs against three foams, including rate and cyclic effects. Their results illustrate the importance of defining the comparator and test conditions. [Primary study](https://doi.org/10.1016/j.addma.2021.102555)

## AI, GPU and physical evidence

An AI connection proposes an editable geometric recipe or a coupon objective. A bounded schema and domain checks limit what it can change. Its response cannot supply any measured volume, force, simulation result or certification. The current release uses simulated provider responses in tests. Verify any authorized live call separately. [AI gateway](AI_GATEWAY.md)

Cross-device GPU parity, GPU timings, browser-model inference, a live provider completion and instrumented physical drop tests remain open. The geometry and beam results apply to the stated equations, inputs and numerical conditions.
