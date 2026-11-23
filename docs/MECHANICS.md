# BCC compression benchmark

Courbure estimates the initial axial stiffness of a finite, box-shaped BCC coupon from the same recipe used to generate its mesh. The benchmark assembles a three-dimensional elastic frame locally in a Web Worker. It supports comparisons of cell pitch, material modulus, material fraction and through-height grading under specified platen conditions. Impact energy absorption requires separate nonlinear material data and experiments.

## Geometry and loading

Integer-pitch nodes connect to the eight adjacent half-pitch corner nodes along body diagonals. Each finite segment is clipped to the square section and the core faces at `z = ±(height_mm/2 − skin_mm)`. The graph retains components touching both platens and records the number of excluded non-spanning members. Side faces have free boundaries.

The geometry engine supplies the dimensionless calibrated band `b`. At height `z`, the nominal radius in millimetres is `b × cell_mm/(2π) × localScale(z)`, where `localScale(z) = 1 + gradient × clamp(2z/height_mm, −1, 1)`. The graph preserves both endpoint radii. Each finite element uses their arithmetic mean as its constant radius. Sampling the straight centerlines reproduces zeros of the BCC implicit field. A finite-radius mesh also includes merged junction volumes and material near clipped boundaries, including contributions from centerlines just outside the box. A line frame cannot reproduce those solid details.

Each joint has three translations and three rotations. Every bottom-face node has all six degrees of freedom fixed. Every top-face node translates vertically by `−strain × height_mm`, with both lateral translations and all rotations fixed. These conditions represent perfectly bonded rigid platens. Any end skin consumes geometric thickness and acts as a rigid cap. Frictionless platens or compliant skins would produce different results.

## Element and units

The two-node, circular Timoshenko element includes axial extension, torsion, bending in two planes and transverse shear. The material is homogeneous, isotropic and linear elastic. The implementation uses millimetres, newtons, radians and MPa (N/mm²).

| Quantity | Expression |
| --- | --- |
| Cross-sectional area | `A = πr²` |
| Area and polar moments | `I = πr⁴/4`, `J = 2I` |
| Shear modulus | `G = E/[2(1+ν)]` |
| Static circular-section shear factor | `κ = 6(1+ν)/(7+6ν)` |
| Shear contribution to bending stiffness | `φ = 12EI/(κGAL²)` |
| Axial and torsional member stiffness | `EA/L`, `GJ/L` |

Cowper derives the circular-section factor. The OpenSees element documentation lists the corresponding 3D beam properties, including two shear areas, and the CALFEM manual gives the prismatic bending matrix in the zero-shear-deformation limit. Courbure implements its own element and sparse solver in JavaScript. [Cowper, 1966](https://doi.org/10.1115/1.3625046) · [OpenSees elastic Timoshenko element](https://opensees.berkeley.edu/wiki/index.php/Elastic_Timoshenko_Beam_Column_Element) · [CALFEM element equations](https://calfem-python-manual.readthedocs.io/en/latest/element_functions.html)

## Reading the result

| Result | Interpretation |
| --- | --- |
| Reaction, N | Magnitude of the summed vertical top reaction. The bottom reaction provides an independent equilibrium check. |
| Stiffness and compliance | `K = reaction / applied displacement` in N/mm and `1/K` in mm/N. |
| Apparent compressive modulus, MPa | `K × full height / gross square area`. This property belongs to the modeled specimen and its platen conditions. |
| Peak member normal stress, MPa | Maximum of `abs(N)/A + r × hypot(My, Mz)/I` at member ends. This describes axial and extreme-fiber bending stress. No torsional shear, equivalent-stress or failure criterion is applied to this output. |
| Elastic strain energy, N·mm | Sum of member strain energies. For this displacement-driven linear model it equals half the top reaction times the displacement. 1,000 N·mm equals 1 J. |
| Minimum member length/diameter | Includes face-clipped members. Low values indicate stocky local geometry where idealized beam joints can give poor estimates. |

The sparse solver uses Jacobi-preconditioned conjugate gradients. It checks the true final residual, top/bottom force balance and elastic work. The reported relative residual uses the diagonal-scaled norm. Missing supports, non-finite solutions and non-convergence raise errors. Local budgets are 1,800 nodes, 4,500 members and 2,400 iterations. The supported nominal compression strain is 0.000001–0.01. Local yielding or instability can occur even at small nominal strain.

## Verified example

Use a BCC box measuring 36 × 36 × 30 mm, 12 mm pitch, 28% target material, zero gradient and zero skin. Choose E = 1,500 MPa, ν = 0.35 and nominal compression strain 0.001. These are illustrative inputs for a repeatable numerical benchmark.

| Output | Result |
| --- | ---: |
| Nodes / members | 131 / 216 |
| Top displacement magnitude | 0.030 mm |
| Top reaction magnitude | 38.4247 N |
| Axial stiffness | 1,280.825 N/mm |
| Apparent modulus | 29.6487 MPa |
| Peak member normal stress | 1.6320 MPa |
| Elastic strain energy | 0.57637 N·mm |
| Iterations / relative residual | 27 / 8.52 × 10⁻¹⁰ |
| Shortest member length/diameter | 1.66 |

Run `node --test tests/mechanics.test.mjs`. The six tests cover axial bar extension and stress, cantilever bending and shear deflection in both planes, torsion of a rotated shaft, finite centerline and radius agreement with the implicit recipe, full-frame equilibrium and scaling, and invalid or unrestrained models. The cantilever reference uses `FL³/(3EI) + FL/(κGA)`. The torsion reference uses `TL/(GJ)`. These tests check the implementation against analytical mechanics. Measured coupon performance remains an open question.

The drop-design screen and this model address different regimes. The frame calculation supplies a small-strain elastic stiffness. A credible drop comparison also needs measured force–displacement curves over the intended travel, print orientation and material lot, contact conditions and appropriate loading rate. Elastic energy from this screen cannot establish impact dissipation, peak drop force or fatigue life.

## Optional FreeCAD reconstruction

`scripts/freecad_import.py` imports a raw graph JSON or a report containing a top-level `graph`. It runs locally in a Python environment that can import FreeCAD and its Part module. It accepts either an FCStd document or a STEP file as its output. Use a new filename.

```sh
python scripts/freecad_import.py graph.json lattice.FCStd
python scripts/freecad_import.py graph.json lattice.step --fuse
```

On the tested Linux installation, the interpreter prefix was `PYTHONPATH=/usr/lib/freecad-python3/lib /usr/bin/python3`. The original script uses FreeCAD's installed B-rep primitives. Uniform members become cylinders, graded members become conical frustums and joint spheres use the largest incident endpoint radius. The default is a compound of overlapping solids for fast inspection. Its summed volume double-counts intersections. The optional `--fuse` runs an Open CASCADE Boolean union, which can be expensive. A top-level BCC box `spec` enables clipping to the core envelope. A raw graph omits that additional solid crop. The reconstruction contains the lattice core and omits rigid platen skins. [FreeCAD Part scripting](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Part_scripting.md)

A headless round-trip on FreeCAD 1.0.0 reopened a graded 216-member FCStd compound as 347 valid solids, reopened a smaller fused 32-member coupon as one valid solid, and read back a 216-member STEP compound. CAD reconstruction, beam idealization and the implicit STL have different joint and boundary treatments. Use the geometry engine's STL measurements for the as-exported mesh.
