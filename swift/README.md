# HUD5 — Swift / macOS native rewrite

Native macOS rewrite of the HUD5 overlay tool, migrating off the React + Vite +
Puppeteer/FFmpeg stack. The web app under `../src` is retained during migration
as the parity reference; ports are cross-checked against its `scripts/*.test.*`
suites.

## Packages

| Package | Kind | What it is |
|---|---|---|
| `HUD5Core` | library + tests | Pure logic ported 1:1 from `src/util` + `src/data`: projection, heading, units, timecode, coordinate systems, telemetry (CSV/JSON), GPS denoise, road snapping, track ingestion (GPX/GeoJSON), pose sampling. No UI, no platform deps. |
| `HUD5Export` | library + executable | `HUD5Render` (CoreGraphics HUD renderer) + `hud5-export` CLI (AVFoundation ProRes 4444 **alpha** writer). Replaces Puppeteer + FFmpeg. |
| `HUD5App` | executable | SwiftUI preview app. Reuses `HUD5Core` + `HUD5Render`; playback + file loading. **UI work continues in Xcode.** |
| `HUDRouteLab` | executable | Native SwiftUI/AppKit road network route and timeline editor. Imports GPX/GeoJSON and MOV/MP4 with embedded `tmcd` timecode, previews synchronized video and road snapping, completes OSM roads, and exports HUD-compatible GeoJSON. |

## Build & test (command line)

```bash
# Data layer — fully testable without Xcode
cd HUD5Core && swift test

# Export pipeline
cd HUD5Export && swift test
swift run hud5-export --track ../../local/some.gpx --out out.mov --fps 60 --duration 10

# Preview app (compiles + launches as a bare binary; use Xcode for real UI work)
cd HUD5App && swift build && swift run

# Native HUD Route Lab
cd HUDRouteLab && ./script/build_and_run.sh
```

### hud5-export options

```
--telemetry <path>   CSV or JSON
--track <path>       GPX or GeoJSON
--out <path>         output .mov (ProRes 4444, alpha)
--fps <n>            [60]
--duration <sec>     default = source duration
--start <sec>        playhead start [0]
--unit kmh|mph       [kmh]
--width/--height     [1920x1080]
--telemetry-offset / --track-offset <sec>
--snap <m>           snap driven onto reference layer (0 = off)
```

Verify alpha output:
```bash
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,profile,pix_fmt out.mov
# expect: prores / 4444 / yuva444p12le
```

## Open in Xcode

Xcode opens a `Package.swift` directly — no `.xcodeproj` needed:

```bash
xed HUD5App        # or: open HUD5App/Package.swift
```

Xcode gives you SwiftUI Previews, the View Debugger (inspect CALayer/HUD
geometry), and Instruments (per-frame timing, CVPixelBuffer leaks) — the tools
the export and UI stages depend on.

## Migration status

- [x] Data layer (`HUD5Core`) — ported + tested against the TS suites
- [x] Export pipeline (`HUD5Export`) — native ProRes 4444 alpha, verified end-to-end
- [x] Preview app skeleton (`HUD5App`) — compiles + launches; playback + loading
- [x] Design tokens + fonts — exact oklch→sRGB colors, bundled Archivo +
      JetBrains Mono (matches src/styles/tokens.css)
- [x] Speedometer fidelity — geometry + dark radial disc (Speedometer.tsx)
- [x] Top-left progress + top-right position panels — match their TSX sources
- [x] Minimap — disc, ring, heading-up 50m window, layers, car arrow,
      compass N, scale bar, route/player/altitude labels (Minimap.tsx)
- [x] Minimap 70° perspective tilt — 3D ground plane via the CSS
      perspective+rotateX port (car at 0.72 anchor, road recedes upward)
- [x] Minimap soft edge fade + teal center glow — CoreGraphics transparency
      mask + stacked radial gradients matching Minimap.tsx
- [x] AVPlayer video time source + sync in the app — native video layer behind
      HUD, shared timeline driven from `AVPlayer.currentTime()`
- [ ] Edit mode: draggable layout + advanced settings, persisted to UserDefaults
- [ ] `videoTimecode` equivalent via AVFoundation timecode tracks
- [ ] Retire the web stack once at parity

The video / edit-mode stages are best done in Xcode (View Debugger for layer
geometry, live Previews for tuning).
