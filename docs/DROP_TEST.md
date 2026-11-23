# Guided-payload drop test

The transient drop test models one rigid payload falling vertically onto a fixed, flat, skinless 36 × 36 × 30 mm BCC coupon. It uses the three bottom-to-top solid fractions measured from the generated mesh. The payload contacts a full-width platen. The model assumes uniform axial pressure, perfect alignment and no guide friction. The inferred peak is the **contact force on the payload**, including the support force required against gravity. The payload's net upward acceleration is `F / mass − g`.

## Motion and material

1. Release the payload from rest. The ballistic approach uses constant gravity of 9.80665 m/s². At first contact the elapsed time is `sqrt(2h/g)` and the downward speed is `sqrt(2gh)`.
2. Rapier advances a dynamic rigid body under gravity. Translation is locked laterally and rotation is locked. A pair of half-step impulses couples the existing three-layer coupon force law to the body at the beginning and end of each step. Above the unloaded surface the contact force is zero. Indentation determines the common pressure across the three equal-thickness layers. Contact force equals pressure times platen area.
3. Use the built-in illustrative law or the selected local loading-curve CSV. Imported curves retain their original density and stroke limits. On unloading, the force retraces the same curve. This assumes zero damping, hysteresis and residual deformation. A nearly elastic bounce is therefore expected even for an imported loading curve. It cannot predict energy loss in the user's actual material.
4. Stop contact integration at first upward separation, the specified stroke ceiling, the end of the supported curve, or the numerical limits. Following separation the plotted trajectory shows ballistic motion toward the apex, capped at two seconds from initial release. The test covers the first impact.

Samples record time since release, velocity positive upward, contact force, compression and the height of the payload underside relative to the unloaded coupon top. Negative height denotes indentation. The trace preserves the turning point. A rigid platen and an illustrative coupon view do not resolve individual struts, local stresses, buckling, fracture, lateral motion, strain-rate dependence or self-contact.

## Numerical checks

The default contact step is 50 µs on the coarse run and 25 µs on the fine run. The fine trajectory is reported. Peak force, peak compression, contact duration and rebound speed must change by at most 2% on refinement. The maximum energy residual must be within 2% of incident energy plus the gravity work at peak compression. With height measured positive upward, the energy residual is `½mv² + mgy + stored loading work − mgh_release`. Both runs must also agree on whether the force ceiling was met. They share a 96,000-step budget and a four-second local computation budget checked every 128 steps. The full simulated time is capped at two seconds.

| Status | Interpretation |
| --- | --- |
| `rebounded` | The transient reached first separation and met the numerical checks. The result separately compares peak contact force with the user's ceiling. |
| `stroke_limit` | Compression reached the allowed stroke. Forces and displacement are reported only up to that boundary. Subsequent hard-stop impact is outside the model. |
| `material_limit` | The curve ended while the payload was still compressing. The simulation stopped at the last supported stroke. |
| `numerical_limit` | The integrator exhausted its step budget or failed convergence or energy checks. |
| `time_limit` | The allowed simulated duration ended before separation. |

A qualifying numerical result requires both `rebounded` and `within_force_limit === true`. The latter is null for every unfinished or unresolved drop. A passing synthetic case validates implementation of that case. Rate-dependent unloading data and instrumented drops on printed specimens are necessary to validate impact and rebound predictions for a physical part.

## Open-source implementation and verification

Rapier 3D supplies the rigid-body dynamics. The browser loads the JavaScript and WebAssembly package from the workbench's origin. Calculation and CSV parsing run in a dedicated local worker. The constituent material law is implemented by Courbure. [Rapier source, Apache-2.0](https://github.com/dimforge/rapier) · [Official JavaScript bindings and setup](https://rapier.rs/docs/user_guides/javascript/getting_started_js/) · [Rapier forces and impulses](https://rapier.rs/docs/user_guides/javascript/rigid_body_forces_and_impulses/)

Run `node --test tests/drop.test.mjs` after installing the locked dependencies. The tests run the published Rapier WASM engine against an analytically solvable spring under gravity and an independent loading-work turning point. Other cases cover stroke exhaustion, a shorter CSV domain, force-ceiling failure and an unresolved stiff contact. [Simulation](../web/drop.mjs) · [Regression tests](../tests/drop.test.mjs) · [Material curve model](MATERIAL_DATA.md)

## Resolved three-dimensional impact path

[OpenCourant](https://github.com/OpenCourant/OpenCourant) is an open-source explicit finite-element solver for crash, impact and nonlinear dynamics under AGPL-3.0. It is the community continuation of OpenRadioss; the [RESF announcement of 19 October 2026](https://rockylinux.org/news/opencourant) documents the transition, and [Siemens describes its separate Simcenter transition](https://www.siemens.com/en-us/products/simcenter/mechanical-simulation/radioss/rd/). Refer to the current OpenCourant repository rather than assuming the retired OpenRadioss service remains available.

This release does not execute OpenCourant or claim full-strut impact analysis. A future local adapter needs a resolved volumetric or shell mesh, contact and boundary definitions, calibrated rate-dependent loading/unloading/damage laws, solver pinning and independent energy and discretization checks. The resulting model should first reproduce a benchmark and instrumented printed-coupon drops before treating a user's arbitrary imported STL as an impact-qualified part.
