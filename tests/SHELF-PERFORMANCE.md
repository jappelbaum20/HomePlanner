# Shelf performance measurement

The measurement uses the local browser harness and its Playwright dependency. It runs one browser at a time, with a 1280 × 900 viewport, device scale factor 1 and the harness's SwiftShader settings. The browser must support WebGL.

In PowerShell, select absolute directories for the generated build and measurement output, then run:

```powershell
$env:HOMEPLANNER_BUILD_DIR = '<absolute-build-directory>'
$env:SHELF_BENCH_OUT = '<absolute-evidence-directory>'
npm run build:vps
node tests/measure-shelf.cjs before
```

Run the same script and browser against a separate build of the revised sources with a different label, such as `after`. `BROWSER_CHANNEL` can select another browser supported by `tests/run-browser.cjs`.

Each run records a SÆTTER 3 and the default 240 × 200 cm, five-row custom shelf. The JSON reports individual update timings and the mean of 100 consecutive unchanged-state updates; 50 placement/removal pointer-event durations after one warm-up cycle; synthetic drag dispatch plus any deferred 3D update; renderer call duration and frame-start intervals while orbiting; and renderer texture/geometry counts before and after the 50 cycles. The script saves a screenshot of each scene with an item in place.

Pointer and drag measurements cover main-thread work, not the time until pixels are presented. The render call can return before GPU work finishes, so its duration is not GPU frame time; frame-start intervals reflect the browser and machine load as well. Compare runs on the same machine under similar conditions, and compare screenshots separately.
