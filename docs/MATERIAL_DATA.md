# Compression data for inverse design

Use **Compression evidence → Import curves CSV** to supply monotonic axial loading curves for coupons at several relative densities. Import selects the curves for the next **Optimize** search. **Try example data** runs the same workflow with an original synthetic fixture. For real data, use coupons that match the BCC family, pitch, loading direction, specimen scale, material lot, build process and loading rate being investigated. The importer cannot establish that match. [Example CSV](../web/examples/synthetic-compression-curves.csv)

## File contract

Use UTF-8 CSV with a comma delimiter, decimal points and the exact three column names below. This small synthetic table demonstrates the format.

```csv
# provenance=synthetic_example
relative_density,strain,stress_mpa
0.20,0,0
0.20,0.10,0.04
0.20,0.30,0.08
0.40,0,0
0.40,0.10,0.16
0.40,0.30,0.32
```

| Field | Definition | Accepted input |
| --- | --- | --- |
| `relative_density` | Coupon solid fraction. For a weighed coupon, divide its bulk density by the density of the solid base material. | Fraction greater than 0 and at most 1. Use `0.28` for 28%. |
| `strain` | Positive engineering compression, displacement divided by initial height. | Fraction from 0 inclusive to 1 exclusive, strictly increasing within each density. |
| `stress_mpa` | Compressive force in N divided by initial gross cross-sectional area in mm². | 0 through 10,000 MPa inclusive. Nondecreasing stress, including horizontal plateaus. |

Each density starts at zero strain and zero stress and needs at least one positive-stress sample. Supply 2–32 distinct densities, up to 2,048 samples per density, 8,192 total numeric rows and 256 KiB per file. The parser accepts blank lines, scientific notation and an optional UTF-8 byte-order mark. The only optional comment is the first-line synthetic provenance marker shown above. For user-supplied data, place the header first. Repeated cycles, stress drops, duplicate strains, quoted fields and columns for uncertainties or units fall outside this format. Keep original observations and the processing method separately. Never discard a measured softening branch and present the result as validation over that range.

## What the calculation does

1. At each sampled density, the solver connects stress–strain samples with straight lines. The area under the loading curve is input work per initial volume. On a stress plateau the solver retains the interval of possible strains and adds the constant-pressure work across that interval.
2. For a layer between two sampled densities, it interpolates strain at **common pressure** using the two density weights. The three equal-height layers are in series and carry the same pressure. Their strains and work densities average to the coupon quantities. Initial top-layer stiffness comes from interpolated compliance.
3. The solver finds the pressure needed for the requested stroke. Force equals pressure times initial square area. Work in joules equals the integrated work density in MPa times the initial volume in mm³, divided by 1,000. It rejects layer densities outside the table and strokes beyond the pressure range shared by the applicable curves.
4. The search uses assumed layer fractions, then repeats the evaluation using the actual bottom, middle and top fractions from each shortlisted mesh. A candidate can satisfy the nominal calculation and fall outside the measured density or stroke range after meshing. The uniform comparison is evaluated with the same material and nominal mean fraction when its mesh is in range.

The example shipped with Courbure has six densities and 36 numeric rows. The application recognizes the original numerical fixture even if its synthetic comment is removed or line endings change. Other accepted tables are labeled **user supplied**. The app records a SHA-256 fingerprint of the imported text encoded as UTF-8. Use the CSV text retained in the project to reproduce that fingerprint. A browser may remove an initial byte-order mark while decoding a file. Physical validity and permission to distribute the measurements require separate evidence. The hash of the interpolation implementation is also recorded. [Interpolation source](../web/material.mjs) · [Executable checks](../tests/material.test.mjs)

## Save and reproduce

The search record contains summary metadata and fingerprints. **Export project** and **Save locally** also include the imported CSV text so the calculation can be reproduced. Switching back to **Illustrative model** keeps that CSV available for the current session and includes it in subsequent project exports. An STL contains the generated triangles. The Markdown report summarizes the specimen and, for an active curves-based run, identifies its source and fingerprint. Reopening a project regenerates geometry. Run the search again to recompute analysis. [Privacy](PRIVACY.md)

Physical interpretation depends on specimen-to-specimen scatter, unloading behavior, strain rate and held-out validation. Retain raw force and displacement, initial dimensions, material batch, manufacturing settings, test rate and cycle separately from the three-column import. A loading-only file cannot establish absorbed impact energy or rebound.
