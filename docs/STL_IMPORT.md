# Local STL envelope import

Use a closed ASCII or binary STL as the outer boundary for any supported lattice. Choose the STL's source unit in the import dialog. The browser centers the model on its bounding box, preserves its orientation and proportions, and clips the lattice to the actual solid, including through-holes. The file and mesh stay on the device.

## Units and limits

| Setting | Accepted value |
| --- | --- |
| Source unit | `mm`, `cm`, or `inch`. STL stores no units. One inch is 25.4 mm. |
| Optional fit | `fit_mm` sets the longest of the three axes to 1–60 mm. All axes scale by the same factor. Omitting it preserves physical dimensions after unit conversion. |
| Final envelope | Each axis must span at least 1 mm. X and Y each support up to 60 mm, Z up to 48 mm. The model's file orientation determines Z. |
| Input | Up to 8 MiB and 4–50,000 triangles. Binary length must match the declared triangle count. ASCII accepts one complete `solid` record. |
| Output resolution | Sampling remains subject to the recipe's 3,000,000-point budget. An admissible file can still exceed the mesh budget at fine resolution. |

The importer welds vertices at identical input coordinates. It checks finite coordinates, index bounds, positive volume, nondegenerate triangles and consistent face orientation. Each edge must have two oppositely directed adjacent faces and the faces around each vertex must form one connected fan. The worker constructs a Manifold solid and checks its status and volume. Density calibration samples ray intersections through the envelope. These checks do not establish minimum printable feature size or guarantee detection of every geometric self-intersection. Repair source geometry in CAD when import reports a defect.

## Worker and recipe contract

```js
const env = parseSTLEnvelope(stlArrayBuffer, {unit: 'mm'});
const spec = {...DEFAULT, envelope: 'mesh', size_mm: env.size_mm, height_mm: env.height_mm};
worker.postMessage({id, spec, envelopeMesh: env});
```

The parser returns centered millimeter coordinates as `positions` (Float32), triangle indices as `indices` (Uint32), and `dimensions_mm` in X/Y/Z order. It also returns `triangle_count`, `source_unit`, `scale_to_mm`, `size_mm` (the larger horizontal span), and `height_mm`. The geometry engine accepts the same payload through `generateDesign(module, spec, progress, {envelopeMesh: env})`.

Use **Export project** to retain the normalized positions and indices together with the design parameters and engine version. A project containing an imported shape therefore discloses the normalized geometry if you share it. JSON arrays built with `Array.from(env.positions)` and `Array.from(env.indices)` can be restored through `validateEnvelopeMesh`. The worker derives dimensions from the vertices and rejects a recipe whose dimensions disagree. The derived lattice STL alone cannot reconstruct its original envelope. Exported lattice metrics include measured envelope dimensions, volume and material fraction.

## Included example and STEP

The [included stepped envelope](../web/examples/stepped-envelope.stl) is an original synthetic 36 × 30 × 30 mm block. A 12 mm step and an offset 6.4 mm through-hole make incorrect bounding-box clipping easy to spot. A preview BCC lattice with 12 mm pitch, 28% target fraction, zero grading and zero end plates generated one connected solid at 28.23% measured fraction in version 0.2.0.

STEP retains analytic CAD faces, units and assembly information. Supporting it requires a CAD reader and a controlled tessellation step before Manifold can consume triangles. For an incoming STEP shape, export a closed STL from the source CAD program, record its intended units and choose the same units on import. For outgoing STEP or FCStd reconstruction of a rectangular BCC core, use the local FreeCAD graph adapter. [CAD export](MECHANICS.md)
