# Contributing to Courbure

Start with a reproducible design JSON, a short expected-versus-observed result and the browser/backend used. Keep all examples synthetic or openly licensed. Do not upload proprietary CAD, private customer data, credentials or third-party images without permission.

For geometry changes, preserve units, check connected components and bounds, and run the affected export and volume tests. Add a regression only for a real defect or a new numerical invariant. Do not approve a result because it looks convincing in the viewer.

For mechanics changes, name the material model, source, units, assumptions and validity domain. Distinguish numerical calibration, solver verification and experimental validation. Physical measurements need a specimen recipe, printing conditions and loading protocol. Preserve raw observations and state uncertainty.

Keep the browser core small. Add a dependency only if the existing implementation cannot reasonably provide its capability. Pin versions and retain notices. Never expose cloud credentials in browser code.

Run `npm test` and `npm run build`. New WebGPU work must retain and verify CPU numerical parity or explicitly change the declared compatibility. All external publishing is a maintainer action; no bot auto-merges or auto-submits program applications.
