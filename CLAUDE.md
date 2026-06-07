# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

HUD5 Overlay — a Forza-Horizon-style racing HUD (speedometer, minimap, position, progress) synced to a video and telemetry stream, exported as a transparent video for video editors.

The project uses two toolchains for different jobs:

- **HUD generation → Web (React + Vite)** in `src/`. The overlay renderer, real-time preview, and transparent video exporter (Puppeteer + FFmpeg). This is the primary output pipeline.
- **Route editing → Native macOS (Swift 6 / SwiftUI)** in `swift/`. A standalone route editor (HUDRouteLab) with MapKit, OSM road snapping, video import, and GeoJSON export. Its output feeds back into the web HUD as track data.

The Swift side is split into four SPM packages:

- **HUD5Core** — shared library: telemetry/GPX/GeoJSON parsing, projection, heading, snap-to-roads, timecode, units.
- **HUD5Export** (`HUD5Render` + `hud5-export`) — Core Graphics HUD renderer and ProRes 4444 alpha exporter CLI.
- **HUD5App** — SwiftUI HUD overlay app (depends on HUD5Core + HUD5Render).
- **HUDRouteLab** — standalone SwiftUI route editor; the main tool for route preparation.

## Commands

### Web

```bash
npm run dev         # Vite dev server on :5173 (includes /api/enrich-gpx middleware)
npm run build       # tsc -b && vite build
npm run preview     # Serve build on :4173 (required before running export)
npm run export      # scripts/export-frames.mjs — Puppeteer + FFmpeg transparent export
```

Tests use Node's built-in runner (no test script in package.json). Run individually:

```bash
node --test scripts/enrich-gpx-with-osm.test.mjs
node --test --experimental-strip-types scripts/gpx-enrichment.test.ts
node --test --experimental-strip-types scripts/heading-smoothing.test.ts
```

### Swift

```bash
swift build --package-path swift/HUD5Core
swift test  --package-path swift/HUD5Core
swift build --package-path swift/HUDRouteLab
swift test  --package-path swift/HUDRouteLab
swift build --package-path swift/HUD5Export
swift test  --package-path swift/HUD5Export
swift build --package-path swift/HUD5App
```

## Architecture

### Fixed 1920×1080 HUD stage
All HUD components render onto a fixed `1920 x 1080` stage that is scaled to fit the container (`stageScale` in the playback store). Draggable layout offsets are in stage pixels, not screen pixels. The layout is persisted in `localStorage` under key `hud5.layout.v1`; advanced HUD settings are persisted under `hud5.settings.v1`. Bump the relevant version key when stored data shape changes.

### Time source switching
Playback has two mutually exclusive time sources, toggled in [src/App.tsx](src/App.tsx):
- **With video**: the `<video>` element is authoritative; `currentTime` is driven from `timeupdate` / `rAF` polling of the element.
- **Without video**: a `requestAnimationFrame` loop in [src/playback/store.ts](src/playback/store.ts) advances `currentTime` against `rate`.

Telemetry samples are indexed by `t` (seconds) and looked up by interpolation at `currentTime`. Track coordinates are projected to a local planar frame in [src/util/projection.ts](src/util/projection.ts) once at load time; the minimap uses those projected points plus a smoothed heading from [src/util/heading.ts](src/util/heading.ts).

### Data ingestion ([src/data/](src/data/))
- `telemetry.ts` — accepts CSV (Papa Parse) or JSON (array, or `{ samples: [...] }`), tolerant of camelCase and snake_case. Required fields: `t` and `speed_kmh`/`speed`. See README for the full field list.
- `track.ts` — accepts GPX (via `@tmcw/togeojson`) or GeoJSON. GeoJSON layers are categorized by `properties.kind` / `properties.type` into `driven` | `planned` | `reference`. GPX `route` → `planned`, GPX `track` → `driven`.
- `gpxEnrichment.ts` / `scripts/enrich-gpx-with-osm.mjs` — shared enrichment logic. The mjs module is imported both by the CLI script and by the Vite dev middleware in [vite.config.ts](vite.config.ts) at `POST /api/enrich-gpx`, which writes results to `output/` and returns them to the browser for immediate minimap use.

### State ([src/playback/store.ts](src/playback/store.ts))
Single Zustand store owns telemetry, track, profile, `currentTime`, playback flags, unit (kmh/mph), exporter mode, edit mode, layout, stage scale, video metadata, and project export settings (`projectFps`, `projectDuration`, `previewAspect`). Components read slices from this store — avoid prop-drilling state.

### Export pipeline
[scripts/export-frames.mjs](scripts/export-frames.mjs) launches Puppeteer against `npm run preview`, loads the app with URL params (see README), and captures frames. FFmpeg then muxes:
- `.webm` → VP9 alpha
- `.mov` / `.mp4` → ProRes 4444 alpha
- other extensions → leave PNG sequence in `out/frames`

FFmpeg must be on `PATH`. The app's `exporter=1` URL param hides the toolbar/timeline so only the HUD renders.

### URL-param loading
The app reads `telemetry`, `track`, `player`, `unit`, `t`, `exporter` from `location.search` on mount. This is the interface the exporter uses, and it's useful for reproducing bugs — prefer a URL over manual drag-and-drop when reproducing.

### Swift — HUDRouteLab architecture

HUDRouteLab is a standalone macOS route-editing tool. Key components:

- **RouteLabModel** (`Stores/`) — `@Observable` main model owning route state, track imports, video, and OSM data.
- **RoadMapView** (`Views/`) — MapKit-based route editor with interactive waypoint editing and road snapping.
- **RouteEngine** (`Services/`) — Dijkstra pathfinding on OSM road graph for route snapping.
- **OSMRoadService** — fetches and caches OSM road network via Overpass API.
- **TrackImportService** / **VideoImportService** — import GPX/GeoJSON tracks and video files with embedded timecode extraction.
- **GeoJSONExporter** — exports routes and snapped geometry as GeoJSON for use in the web HUD.

## Conventions specific to this repo

- HUD stage is fixed at 1920×1080 — don't introduce responsive breakpoints inside `hud/`; scale happens at the stage container.
- The minimap's driven-progress bar is truncated at the interpolated current position to avoid the arrow leading the yellow bar. Preserve that behavior when touching [src/hud/Minimap.tsx](src/hud/Minimap.tsx).
- Dev-server side effects (writing to `output/`) live in the Vite `configureServer` hook, not in browser code — keep filesystem work out of `src/`.
- Swift packages target macOS 14+ with Swift 6 strict concurrency. All four packages are independent SPM packages under `swift/`; they reference each other via relative `path:` dependencies.
- HUDRouteLab's `RoadMapView` uses MapKit's `Map` view — avoid UIKit map wrapping.
