# Architecture

The browser owns the specimen and its calculations. Browser WebGPU, loopback and hosted AI providers accept a brief and one bounded design action. A model's response passes through the recipe or objective validator before the user can apply it. Only the local geometry and numerical engines produce measurements.

## Geometry and measurement

A version 1 design recipe specifies units (mm), family, envelope, width or diameter, height, cell pitch, target solid fraction, signed axial gradient, end plate thickness and quality. The geometry contract supports these inputs.

| Parameter | Range |
| --- | --- |
| Native envelopes | Rectangular box, cylinder, curved half-shell, or box with spherical keep-out. Width 24–60 mm, height 16–48 mm. |
| Imported envelope | Closed STL centered on its bounding box. Each final extent at least 1 mm, X/Y at most 60 mm, Z at most 48 mm. |
| Lattice | Gyroid, Schwarz P, diamond sheets, or body-centered cubic struts. |
| Pitch, fraction, axial grading | 8–20 mm, 16–55% solid, −0.60 to +0.60 grading. |
| End plates, quality | 0–2 mm per Z end within the envelope. Preview and fine sampling, subject to the recipe budget. |

The worker reserves the end plates' actual material budget, samples the remaining domain and calibrates an implicit-field threshold against the requested solid fraction. Grading scales the threshold along Z. For BCC the threshold times cell pitch divided by 2π gives a nominal strut radius before grading. For sheets, physical thickness also varies with the local field slope. Manifold samples the field, intersects the mesh with the real finite envelope and merges plates when present. This preserves a hole in an imported solid. [Recipe and fields](../web/core.mjs) · [STL input](STL_IMPORT.md)

The worker measures volume, connected components, surface area, triangle count, sampling edge and signed volume of the export coordinates. It divides the envelope and solid into three equal heights, then divides each slab's material volume by its own available envelope volume. An empty envelope slab has no defined fraction. The whole-part fraction uses the complete envelope, including variation in cross section. These measurements describe the discretized solid. Sub-grid features and physical print quality need independent checks. [Solid operations](../web/engine.mjs)

## Inverse design

The studio searches one unskinned flat 36 × 36 × 30 mm BCC coupon at 12 mm pitch. Input targets are payload mass, drop height, allowable stroke, force ceiling and an optional preference for a soft top surface. The choices under study are density and through-height radius grading.

1. The model requires loading work of `m × g × (drop + stroke)`, with distances in metres. If the ceiling times the allowed stroke is below that work, the search terminates before fitting.
2. Three equal-thickness layers carry the same axial pressure. The default law is synthetic. Importing an accepted CSV enables common-pressure interpolation between supplied curves. Only candidates supported by the material domain and the requested stroke are eligible. [Material model](MATERIAL_DATA.md)
3. A seeded Gaussian process with a radial basis kernel ranks candidates by the numerical score and its uncertainty. The default search uses 15 seeds, 273 density–gradient combinations and at most 48 evaluations. Imported density levels can change the grid and available sample count. Every sampled candidate is ranked again with the CPU reference.
4. The studio meshes up to six nominally feasible finalists. It reevaluates each using its three measured slab fractions and requires one connected solid plus both mechanical constraints. The best qualifying mesh is displayed along with the uniform comparison at the same requested mean fraction when available. The comparison can require one more mesh. Trial metrics and rejection reasons are recorded. Meeting this objective is a result for the declared loading law.

The built-in numerical model assumes pressure depends on strain and relative density only. It omits dynamic contact, inertia, damage, unloading and rate effects. A geometry outside the fixed coupon still supports local generation and measurement. [Search implementation](../web/inverse.mjs) · [Numerical example](VALIDATION.md)

## Runtime and artifacts

| Operation | Implementation |
| --- | --- |
| Mesh generation | Dedicated module worker running Manifold WASM on the CPU. |
| Rendering | Three.js WebGPU or WebGL2. Canvas 2D projects the generated triangles when both are unavailable. |
| Response evaluations | Dedicated WGSL kernels for synthetic and CSV-based loading. Their first GPU batch must match the CPU reference. CPU fallback covers unavailable, unsupported or failing compute devices. The displayed render and compute backends are independent. |
| Elastic benchmark | Separate worker assembling a six-degree-of-freedom Timoshenko frame from the rectangular BCC recipe. The solver checks residual, force balance and strain energy. [Model, references and FreeCAD export](MECHANICS.md) |
| Guided drop | A dedicated Rapier WASM worker integrates a vertically guided rigid payload with the three-layer conservative force law. Results include peak force, travel, time-step comparison and energy residual. [Drop equations and limitations](DROP_TEST.md) |
| Printing | A dedicated worker serializes a millimetre 3MF and optional manufacturing ZIP using fflate. The local Python bridge invokes the operator’s PrusaSlicer with a selected profile. [Printing](PRINTING.md) |
| Optional design proposals | Shared gate validates the two supported actions and the UI shows a parameter diff. The browser option lazily loads pinned Qwen weights and runs WebLLM in a dedicated worker. A typed abstention asks for clearer input. Hosted BYOK uses a same-origin Worker. An optional Node gateway binds to loopback. [AI gateway](AI_GATEWAY.md) |
| Local persistence | IndexedDB stores one explicitly saved project per origin. Version 2 projects contain validated inputs, available results and local data needed for replay. The reader accepts earlier version 1 designs, regenerates geometry and discards imported result claims. [Project format](../web/project.mjs) |
| Build | Node builds same-origin application assets. Python packages the complete source and lockfile in a ZIP. Rebuild an extracted copy to obtain its compiled assets. esbuild bundles a standalone Worker at `dist/server/index.js`. Geometry and analysis also work from a static HTTP host. |

The built runtime includes Three.js 0.180.0, Manifold 3.5.5, Rapier 0.21.0, fflate 0.8.3 and WebLLM 0.2.89. Model artifacts are fetched only on explicit load. esbuild 0.28.2 is a development dependency. The application ships its original geometry fields, Gaussian process, compression routines, frame solver and synthetic examples. [Upstream inventory](UPSTREAM.md)
