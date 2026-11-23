# From Courbure to a slicer

**Export 3MF** produces a geometry-only 3MF Core model with explicit millimetre units. **Print package** includes that model, a binary STL, the matching project JSON and preparation instructions. The files are created locally. A shared project JSON can disclose its original compression curves and normalized input envelope.

| File | Coordinates and use |
| --- | --- |
| `specimen.3mf` | The indexed faces use the checked Float32 vertex coordinates and winding. A build transform places the lowest vertex at Z = 0. The object retains its horizontal position and orientation. The slicer can arrange it on the selected machine’s bed. |
| `specimen.stl` | Triangle coordinates use the design origin. Select millimetres when importing, then place the object on the bed. STL has no standard unit or placement metadata. |
| `project.json` | Recipe, original local inputs when included, and the measurements that accompanied this export. Reopen in Courbure to regenerate geometry. |
| `PRINTING.txt` | Preparation steps for the operator choosing the printer, nozzle, material, layer height and supports. |

Before export, the geometry engine checks the Float32 coordinates for degenerate facets, edge orientation, closure and connected face fans. The component count describes distinct material solids. Enclosed cavity shells have their own count. A specimen with several components can still be closed. Export and slicing do not establish that a printer can resolve its struts or that separated islands will join.

## Slice on your machine

Open the 3MF in PrusaSlicer. Select a printer, nozzle, filament and process profile appropriate to the actual machine. Place the object within the printable area and slice. Inspect the first layer, narrowest paths, unsupported spans, separate islands, supports and their removal across several heights. A warning about adhesion, missing paths or an unsupported feature needs a process or geometry decision before printing.

For command-line use, install PrusaSlicer and export the **active configuration** to a single flat INI file. The local adapter accepts an STL or the geometry-only 3MF produced by Courbure. Settings bundles and 3MF projects with embedded printer settings are excluded. It requires a supplied FFF profile with bed, nozzle, material, temperatures and layer height, and rejects post-processing commands in that profile.

```sh
python3 scripts/slice.py --model specimen.3mf --profile my-printer.ini --center 125 105 --output specimen.gcode
```

Choose `--center X Y` in millimetres from your printer profile. The example uses the centre of a 250 × 210 mm rectangular bed whose corner is at (0, 0). Courbure's meshes are centred around the design origin. On a bed extending into positive X and Y, choose an interior placement. Omit the option to retain the model's existing horizontal placement.

If the executable has a different name or location, pass `--slicer /path/to/prusa-slicer`. The adapter uses a temporary working directory, an isolated PrusaSlicer data directory and a five-minute time limit. It forwards slicer warnings, checks for generated extrusion moves and saves a new plain-text G-code file. Choose a new output path for each run. The adapter has no printer upload or print-start command. Review the resulting G-code in the slicer’s toolpath preview before use. [PrusaSlicer CLI](https://github.com/prusa3d/PrusaSlicer/wiki/Command-Line-Interface) · [3MF Core specification](https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md)

## Reproduced slicing observation

The test specimen was a 24 × 24 × 24 mm BCC box, 12 mm pitch, 28% target fraction, +50% axial grading, no end plates and preview resolution. The 3MF Consortium’s lib3mf 2.5.0 strict reader reopened it with zero warnings, 22,572 vertices and 45,260 triangles. It reported a manifold, oriented mesh and build bounds of −12 to +12 mm in X/Y and 0 to 24 mm in Z. Signed volume from the reopened facets was 3,823.810526 mm³.

PrusaSlicer 2.7.4 on Linux sliced the 3MF through the adapter using an illustrative FFF configuration with a 250 × 210 mm bed, 0.4 mm nozzle, 1.75 mm PLA, 210 °C nozzle, 60 °C bed, 0.20 mm layers, two perimeters and 15% infill. The output contained **120 layers** from Z = 0.20 to 24.00 mm and **86,003 linear XY moves with extrusion commands**. The slicer estimated 3.96 cm³ of filament and 58 min 2 s. These figures apply to that profile and software version.

Slicing the matching binary STL through the same adapter and profile also produced 120 layers and the same 1,646.46 mm estimate of filament length. Its output contained 86,055 linear XY moves with extrusion commands and a time estimate of 57 min 58 s.

PrusaSlicer reported **“Low bed adhesion”** for both exports and suggested supports or a brim. A further 3MF run changed only the outer brim width to 5 mm. It estimated 1,727.46 mm of filament and 59 min 40 s, and reported **“Thin fragile part”** with a suggestion to enable supports. The experiment ended at G-code inspection. Adhesion on a physical bed, dimensional accuracy, printed continuity and mechanical performance still require a print and measurements.

## GitHub release check

PrusaSlicer 2.9.7 on macOS sliced the browser-exported 36 × 36 × 30 mm BCC drop coupon. The illustrative 250 × 210 mm rectangular bed, 0.4 mm nozzle, 1.75 mm PLA, 210 °C nozzle, 60 °C bed and 0.20 mm layers used `--center 125 105`. The adapter saved G-code with 150 layer changes. PrusaSlicer reported **“Low bed adhesion”** and suggested supports or a brim. The G-code stayed local.
