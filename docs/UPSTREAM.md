# Upstream software and provenance

Research date **2026-11-23**. Courbure is an independent application. The application logic and synthetic envelope designs are original. The inventory distinguishes packages selected for the browser from tools assessed as engineering references.

## Browser dependencies

| Package | Pinned release | License | Role and integration constraint |
| --- | --- | --- | --- |
| `manifold-3d` | 3.5.5 | Apache-2.0 | JS/WASM geometry kernel. `levelSet` accepts a scalar field, sampling bounds and a target edge length. Smaller edges resolve thinner features and increase computation. [Repository and license](https://github.com/elalish/manifold/blob/master/LICENSE) · [Release](https://github.com/elalish/manifold/releases/tag/v3.5.5) · [JS API](https://manifoldcad.org/docs/jsuser/classes/Manifold.html) |
| `three` | 0.180.0 | MIT | `WebGPURenderer` displays the indexed mesh and exposes its active graphics backend. Courbure's original native WGSL kernel evaluates compression candidates separately. [License](https://github.com/mrdoob/three.js/blob/dev/LICENSE) · [WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html) · [BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html) · [STL format notes](https://threejs.org/docs/pages/STLExporter.html) |
| `@dimforge/rapier3d-compat` | 0.21.0 | Apache-2.0 | Advances the guided payload as a rigid body in local WASM. Courbure supplies the conservative three-layer force law and refinement checks. [Drop model](DROP_TEST.md) · [Rapier JS](https://github.com/dimforge/rapier.js) |
| `@mlc-ai/web-llm` | 0.2.89 | Apache-2.0 | Runs a compact text model in a dedicated WebGPU worker with grammar-constrained JSON output. The selected Qwen2.5-0.5B weights and compiler are separately pinned and downloaded on request. [Runtime](https://github.com/mlc-ai/web-llm) · [Model sources and pins](BROWSER_AI.md) |
| `fflate` | 0.8.3 | MIT | Packages the indexed millimetre 3MF and the manufacturing ZIP. Courbure writes the 3MF model, build transform and relationships. [Repository and license](https://github.com/101arrowz/fflate) · [Printing](PRINTING.md) |

The package manifest, lockfile and installed package metadata identify the pinned releases. Keep the license and copyright files from those packages with redistributed copies, including relevant third-party notices.

Builds use esbuild 0.28.2 under the MIT license to bundle the Worker. The tool is a development dependency. Python 3 provides the standard-library source archiver. [esbuild license](https://github.com/evanw/esbuild/blob/v0.28.2/LICENSE.md)

The in-browser Gaussian process learns from numerical evaluations of the selected response law. The law can use synthetic coefficients or user-supplied compression curves. Courbure implements this model in JavaScript and uses the browser's WebGPU API directly. The project ships its own geometry, solver and demonstration recipes. Neither a pretrained network nor an external inference service is required. [WebGPU specification](https://www.w3.org/TR/webgpu/)

## Desktop adapters, verification tools and candidates

| Project | License | Role in Courbure |
| --- | --- | --- |
| `3MFConsortium/lib3mf` | BSD-2-Clause for lib3mf. Bundled libraries have their own terms. | Independent readback with lib3mf 2.5.0 in strict mode verified the exported BCC mesh, explicit millimetres and build placement. The browser serializer uses fflate. [Repository](https://github.com/3MFConsortium/lib3mf) · [License](https://github.com/3MFConsortium/lib3mf/blob/master/LICENSE) · [Release notes](https://github.com/3MFConsortium/lib3mf/releases) · [3MF Core Specification](https://github.com/3MFConsortium/spec_core) |
| `prusa3d/PrusaSlicer` | AGPL-3.0 | Separately installed slicer invoked by the local `scripts/slice.py` adapter. A real 2.7.4 CLI run produced toolpaths and a low-bed-adhesion warning. [Printing evidence](PRINTING.md) · [Upstream repository and license](https://github.com/prusa3d/PrusaSlicer) |
| `mikedh/trimesh` | MIT | Reopen exported files in a separate Python process and compare dimensions, mesh closure, winding and volume. This gives an independent check on the browser serializer. [License](https://github.com/mikedh/trimesh/blob/main/LICENSE.md) · [Mesh API](https://trimesh.org/trimesh.base.html) |
| `Tcadart/pyLatticeDSO` | MIT for the project. Its scientific dependencies have separate licenses. | Offline benchmark for BCC, octet, Kelvin and hybrid lattices, graded radii, clipping and beam-versus-solid finite-element analysis with FEniCSx. Useful for checking a reduced model against resolved struts. [Repository](https://github.com/Tcadart/pyLatticeDSO) · [License](https://github.com/Tcadart/pyLatticeDSO/blob/master/LICENCE.txt) |
| `microsoft/onnxruntime` | MIT for ONNX Runtime. Model artifacts carry their own terms. | Optional local inference runtime for a future independently trained predictor. Check operator coverage, model outputs and held-out accuracy before selecting the WebGPU provider. [Web package license metadata](https://registry.npmjs.org/onnxruntime-web/1.23.2) · [WebGPU integration](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html) |
| `FreeCAD/FreeCAD` | LGPL-2.1-or-later is the project's standard code license. | The shipped local Python adapter reconstructs a BCC graph as an FCStd or STEP model using an installed FreeCAD. FreeCAD itself is separately installed. Its FEM workbench can also invoke external solvers. Courbure's browser pipeline runs independently. [Project license guidance](https://freecad.github.io/Website/dev/code/copyright/) · [FEM workflow](https://freecad.github.io/Website/news/getting-started-with-fem/) |
| `OpenCourant/OpenCourant` | AGPL-3.0 | Candidate for a later offline explicit finite-element impact adapter, including resolved deformation and contact. Not integrated or executed in this release. Its inherited material laws still need printer-specific calibration and mesh/time-step convergence. [Current source](https://github.com/OpenCourant/OpenCourant) · [RESF announcement, 19 October 2026](https://rockylinux.org/news/opencourant) |
| `zalo/Tetrament` | MIT | Exploratory reference for tetrahedral soft bodies, WebGPU compute, contact and strain visualization. Adopting a deformation preview would still require checks against reference solutions and measured coupons before reporting engineering loads. [Repository](https://github.com/zalo/Tetrament) · [License](https://github.com/zalo/Tetrament/blob/main/LICENSE) |

## Lattice research references

These projects informed the choice of features and evaluation methods. Their role in Courbure is limited to research and independent comparison.

| Project | License evidence | Transferable finding and practical limit |
| --- | --- | --- |
| `3MAH/microgen` | GPL-3.0-only in the project's citation metadata | The published example generates a sheet gyroid from a target density and exports STL. A useful independent benchmark. Pin the version when reproducing examples because the 2.0 beta changes APIs from 1.3.x. [Repository](https://github.com/3MAH/microgen) · [License metadata](https://github.com/3MAH/microgen/blob/main/CITATION.cff) · [TPMS example](https://microgen.readthedocs.io/en/latest/examples/tpms.html) · [Release history](https://pypi.org/project/microgen/#history) |
| `albertforesg/TPMSgen` | MIT | Reference for cell period, specimen dimensions and shell versus solid-network output. Desktop Python app with CLI and STL export. Some mesh operations require Blender. The release page lists v1.0.0. [Repository](https://github.com/albertforesg/TPMSgen) · [License](https://github.com/albertforesg/TPMSgen/blob/main/LICENSE) · [Releases](https://github.com/albertforesg/TPMSgen/releases) |
| `tpms-lattice/ASLI` | AGPL-3.0-or-later for ASLI. Bundled components carry separate licenses. | Reference for native infill generation with spatially varying topology, cell size or features. Its C++ toolchain includes CGAL and Mmg. The release page lists v0.1. [Repository](https://github.com/tpms-lattice/ASLI) · [License and component inventory](https://github.com/tpms-lattice/ASLI/blob/master/LICENSE) · [Releases](https://github.com/tpms-lattice/ASLI/releases) |
| MSLattice | An open-source license could not be verified for the published Windows distribution. | Feature reference for relative-density and cell-size grading. The authors distribute a compiled MATLAB Runtime application. The Windows repository lists the executable and README. [Author's description](https://www.oraibkhitan.com/mslattice/) · [Windows distribution](https://github.com/MSLattice/MSLattice_windows) |

## Learned inverse-design benchmarks

| Project | License evidence | Model domain and potential comparison |
| --- | --- | --- |
| GraphMetaMat | The `marcomau06/GraphMetaMat` implementation includes an MIT code license. The published workflow distributes pretrained models and configurations separately. Verify permission for the exact weights and dataset before use. | A forward graph model predicts response and an inverse policy generates truss connectivity conditioned on a target curve. This is a benchmark for a future topology-changing generator. [Implementation license](https://github.com/marcomau06/GraphMetaMat/blob/main/LICENSE) · [Model distribution instructions](https://github.com/DerekQXu/GraphMetaMat/blob/main/README.md) · [Authors' paper](https://www.nature.com/articles/s42256-025-01067-x) |
| DiffuMeta | MIT code license. Model and data provenance must follow the specific distribution. | The diffusion transformer generates equations for 3D shell metamaterials conditioned on mechanical properties. Its shell representation and training domain differ from Courbure's straight BCC members and three-layer coupon. [Code license](https://github.com/li-zhengz/DiffusionMetamaterials/blob/main/LICENSE) · [Model card](https://github.com/li-zhengz/DiffusionMetamaterials/blob/main/modelcard.md) · [Authors' paper](https://doi.org/10.1038/s42256-026-01218-8) |

Cambridge's variable-radius strut dataset supplies simulated elastic compliance tensors and is CC BY 4.0 except where noted. It could benchmark linear stiffness across relative densities. Compression to large strain and cyclic unloading require different labels. [Cambridge dataset and usage terms](https://www.repository.cam.ac.uk/items/c4a4ccb5-2d2e-448c-830a-113581051cfb)

## Manufacturing evidence

The research links support geometry and experimental design. A cushioning study measured the response of graded TPU gyroids and found a minimum printable wall of 0.48 mm for its own process. Courbure needs measurements from the intended printer, material, orientation and slicer settings to make a comparable claim about a new insert. [Functionally graded TPU gyroid structures for cushioning applications](https://doi.org/10.1080/15376494.2025.2530146)
