# ExcaliMath shape library

Source: https://github.com/tamerUAE/excalimath
Commit: `5b43096b82c8157b99ec6bea1973886eac3538f7` (checked 2026-10-28).
License: MIT; the complete upstream license is retained in `LICENSE`.

`library.js` is an unminified, tree-shaken ESM build of the upstream exports
`builtInPacks` and `shapeToExcalidrawElements` from
`packages/core/src/plugins/geometry/registry.ts`, including its six packs and
the required SVG file helpers from `core/elementFactory.ts`. Generated with
esbuild 0.28.2, bundle=true, platform=neutral, target=es2022, format=esm.
The upstream definitions are unchanged: 77 shapes, of which eight use SVG.
Notara's translations, normalized linear origins, unique identities and native
save/undo integration live separately in `../../drawing-library.js`. The adapter
also preserves explicitly disabled arrowheads and supplies missing stroke style.
Signed point bounds are handled by Notara's shared `drawingBounds`.

The npm `@excalimath/core@1.3.1` package points to a different fork
(`DynoW/excalimath`). It is not the provenance of this pinned extraction.
The upstream global sidebar, timers, scene replacement, Plotly and mathjs are
not included. This library supplies illustrative assets, not constrained
dynamic geometry or a 3D construction engine.
