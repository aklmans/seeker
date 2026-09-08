# Isolated widget capture

`widget-capture.txt` is an IIFE built from `scripts/widget-capture-entry.js` with the versions pinned in `package-lock.json` (html2canvas 1.4.1 and esbuild 0.28.2). Rebuild with `npm ci` followed by `node scripts/build-widget-capture.mjs`.

The text asset is loaded locally by the platform and injected with a fresh nonce into a separate opaque snapshot iframe. It is never evaluated in the parent application or loaded from a CDN. It uses html2canvas's pinned DOM parser and CanvasRenderer directly, because the standard DocumentCloner requires same-origin iframe access. No widget receives same-origin permission. Upgrading this dependency requires Chromium, WebKit and native export verification.

Rendering reconstructs supported CSS onto canvas. Complex CSS, filters and third-party widgets may differ, so the export flow displays a reviewable preview. The live widget is not mutated. Size and timeout limits reject oversized exports rather than silently clipping them. Original and transitive MIT license notices accompany this bundle.
