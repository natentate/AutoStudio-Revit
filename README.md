# AutoStudio

AutoStudio is a building information modeling (BIM) desktop app for macOS. You model a building once with walls, doors, windows, floors, roofs and rooms. Plans, 3D views, elevations, schedules and IFC exports all come from that one model and update together.

It is an original app inspired by Revit-style workflows. It is not affiliated with Autodesk and cannot open `.rvt` files. To move models between the two, use **IFC**.

![Platforms](https://img.shields.io/badge/macOS-Apple%20Silicon%20%7C%20Intel-blue)

## Install (DMG)

1. Get a DMG:
   - **Tagged release:** download `AutoStudio-<version>-arm64.dmg` (Apple Silicon) or `-x64.dmg` (Intel) from the GitHub Release.
   - **Any branch build:** open *Actions → Build macOS DMG → latest run* and download the `AutoStudio-macOS-dmg` artifact.
2. Open the DMG and drag **AutoStudio** into **Applications**.
3. The first time, Control-click (or right-click) the app, choose **Open**, then **Open** again. Without a Developer ID certificate the CI builds are ad-hoc signed, so Gatekeeper asks once. If macOS says the app "is damaged", run:
   ```sh
   xattr -dr com.apple.quarantine /Applications/AutoStudio.app
   ```

To publish a release, push a tag such as `git tag v0.1.0 && git push origin v0.1.0`. CI attaches both DMGs to the GitHub Release.

## What it does

| Area | Features |
| --- | --- |
| **Modeling** | Walls (line, chain, rectangle, typed lengths, unconnected or level-to-level heights), doors and windows hosted in walls, floors, roofs (flat, gable, hip, shed), rooms, levels, grids |
| **Smart geometry** | Automatic wall joins (L corners mitered, T junctions trimmed). Openings cut walls in 3D. Rooms detect their boundary from the surrounding walls and recompute area when walls move. Floors and roofs can follow the building outline. |
| **Editing** | Select, box select (window or crossing), drag to move (joined walls stretch), grips, click-to-edit wall length, Move, Copy, Rotate, Mirror, Trim/Extend to Corner, Split, Delete, and unlimited undo/redo |
| **Views** | Floor plans per level (with the level below as underlay), perspective 3D with shadows and orbit, N/S/E/W elevations with level markers, view tabs, Visibility/Graphics per view |
| **Data** | Properties palette with type selector, Type Properties editor (duplicate, rename, delete), and live schedules for walls, doors, windows, rooms, floors and roofs with editable cells and totals |
| **Units** | Metric (mm, m²) or imperial (ft-in, SF). Fields accept `3000`, `3m`, `10'6"`, `10' 6 1/2"`, and so on. |
| **Files** | `.asbim` project files (JSON), with Finder double-click and Open Recent. Exports **IFC4**, PNG of any view, and schedule CSV. |
| **macOS** | Native menus and shortcuts, unsaved-changes prompt, document-edited dot, separate Apple Silicon and Intel DMGs |

### Keyboard shortcuts

These follow familiar BIM conventions: type two letters while the canvas has focus.

| Keys | Command | Keys | Command |
| --- | --- | --- | --- |
| `WA` | Wall | `MV` | Move |
| `DR` | Door | `CO` | Copy |
| `WN` | Window | `RO` | Rotate |
| `FL` | Floor | `MM` | Mirror |
| `RF` | Roof | `TR` | Trim/Extend to corner |
| `RM` | Room | `SL` | Split wall |
| `GR` | Grid | `DE` / ⌫ | Delete |
| `LL` | Level | `VV` | Visibility/Graphics |
| `DI` | Aligned dimension | `ZF` | Zoom to fit |
| `TX` | Text | `3D` | Default 3D view |

Other controls:

- **Esc** cancels the current step, then the tool.
- **Shift** forces horizontal or vertical while drawing.
- **Alt** while dragging moves without stretching joined walls.
- **Pan** with two-finger scroll, middle-drag or Space+drag.
- **Zoom** with pinch or ⌘+scroll.
- **Typed lengths:** while drawing a wall, type a length and press Enter.

## Development

Requires Node.js 22.

```sh
npm install
npm run dev          # renderer in the browser at http://localhost:5173 (file dialogs fall back to download/upload)
npm start            # build and run the Electron app
npm test             # unit tests (geometry, model, joins, rooms, editing, IFC, schedules)
npm run dist         # on a Mac: build DMGs into release/
```

### Project layout

```
electron/        main process (window, menus, dialogs) and the sandboxed preload bridge
src/core/        pure model code, with no DOM and fully unit-tested
  model.js       document, types, transactions, undo/redo
  wallgeom.js    wall joins and opening cut-outs
  topology.js    planar wall graph for room boundaries and building outlines
  roofgeom.js    pitched roof solids
  edit.js        move, copy, rotate, mirror, split, trim, length and grips
  ifc.js         IFC4 STEP writer
  schedules.js   schedules and CSV
src/views/       plan canvas, three.js 3D/elevations, schedules, interactive tools
src/ui/          app controller, ribbon, properties, project browser, dialogs
scripts/         electron-builder hooks (ad-hoc signing for unsigned builds)
```

### Signed and notarized builds

Add these repository secrets and CI produces a Developer ID-signed, notarized DMG:

- `MAC_CERTIFICATE_P12_BASE64`
- `MAC_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Without them, the build is ad-hoc signed.

## Scope and limitations

This is a focused BIM modeler, not a full replacement for a commercial BIM suite. Not included yet:

- Families/parametric component editor
- Curtain walls, stairs, railings, structure and MEP
- Sections and sheets
- Worksharing
- Phasing
- Rendering
- Native `.rvt` files: the format is proprietary. **IFC export** is the interchange path, and the output validates cleanly against the IFC4 schema in IfcOpenShell.

Pitched roofs use the bounding rectangle of their footprint.
