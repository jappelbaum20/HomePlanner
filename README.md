# House planner

Browser app for planning the new house: rooms with photos and notes, wall and floor colors, doors and windows, and a catalog of your own furniture and lights that you place into rooms. 2D plan plus live 3D view with day and evening lighting.

## Run it locally

No build step. Open `index.html`, or serve the folder:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

three.js and the font load from a CDN, so the first load needs internet. The 3D models, materials and textures are generated in `models3d.js`; nothing else is downloaded.

Live site: https://jappelbaum20.github.io/HomePlanner/ (redeploys on every push to `main`).

## The workflow

1. **New room**: name, floor or level, sizes (optional), photos, notes.
2. **Model it with Claude**: send the photos and sizes in chat. Claude replies with a data block.
3. **Claude handoff, then Add to plan**: paste the block. Rooms and pieces with an existing id are updated, new ones are added. A version is saved automatically first.
4. **My pieces**: add furniture and lights you own or are considering (photos, size, color, status, link). Place a piece in any room; editing it updates every placement.
5. **Tweak** on the plan: drag, rotate, recolor walls, switch rooms from the top bar.
6. **Save**: autosaves in the browser. Save named versions (for example "Sage living room"), and export a backup file (includes photos) to keep a copy or move computers.

To send the current state back to Claude, use Claude handoff, then Copy this room or Copy whole plan, and paste it into the chat.

## Handoff format (version 2), all sizes in cm

```json
{
  "rooms": [{
    "id": "living", "name": "Living room", "level": "Ground floor",
    "width": 520, "length": 430, "height": 260,
    "floor": "#D6BA8E", "floorFinish": "wood",
    "walls": { "n": "#F4F3EF", "e": "#B4BFA6", "s": "#F4F3EF", "w": "#F4F3EF" },
    "notes": "",
    "openings": [
      { "type": "window", "wall": "n", "offset": 170, "width": 200, "height": 140, "sill": 80 },
      { "type": "door", "wall": "s", "offset": 40, "width": 90, "height": 205 }
    ],
    "items": [
      { "catalogId": "sofa-grey", "x": 50, "y": 225, "rot": 90 },
      { "type": "pendant", "name": "Pendant", "x": 260, "y": 225, "w": 45, "d": 45, "h": 30, "elev": 200, "kelvin": 2700, "power": "bright" }
    ]
  }],
  "catalog": [
    { "id": "sofa-grey", "type": "sofa", "name": "Grey linen sofa", "w": 220, "d": 95, "h": 85, "color": "#6F7C8A", "status": "own" }
  ]
}
```

- Plan orientation: `width` runs left to right, `length` top to bottom. Walls `n` top, `e` right, `s` bottom, `w` left.
- Opening `offset`: from the top corner on side walls, the left corner on top and bottom walls.
- Item `x`, `y`: center point from the top-left interior corner. `rot`: degrees clockwise. `elev`: underside height above the floor.
- Items with `catalogId` take size, color and name from the catalog piece.
- Furniture types: sofa, cornersofa, armchair, chair, art, table, roundtable, desk, bed, cabinet, shelf, wardrobe, counter, appliance, rug, plant, bath, shower, vanity, toilet, stairs, potrack, box.
- Light types: ceiling, pendant, spot, sconce, floorlamp, tablelamp. `kelvin`: 2200, 2700, 3000, 4000. `power`: soft, medium, bright.
- Piece `status`: own, considering, ordered.
- Room `floorFinish`: parquet, wood, marble, stone, tile, concrete, terrazzo, carpet, plain (default parquet). Sets the floor texture in 3D.
- Room `wallFinish`: per wall (`n`, `e`, `s`, `w`), one of paint, panelling, oakpanels, marble, tiles (default paint).
- Window `radiator`: true draws a panel radiator under it (default true when the sill is 50 cm or higher). Door `color`: door leaf color.
- `cornersofa` items and pieces take `side`: right or left (chaise side seen from the front). Beds: `h` up to 80 is the mattress top; above 80 it is the headboard height.
- Pieces listed in `window.HOUSE_PIECES` in `house-data.js` are added to My pieces once. Deleting one in the app keeps it out. A higher `rev` on a piece pushes a changed size or look to browsers that already have it.
- `window.HOUSE_PLACEMENTS` places a piece once in a room: the room with a matching name (for example Office, Büro), else a starter room from `window.HOUSE_ROOMS`. A deleted starter room is not recreated.
- Shelf items and pieces take `doors` (none, lower, full; woven bamboo HÖGADAL style) and `books` (true or false).
- Built-in fittings (placements with `builtin: true`) are enforced from `house-data.js` on every load and locked; the house's own doors and windows are locked too. Rooms cannot be added or deleted in the app.
- Artwork: `type: "art"`, `w` and `h` = picture size, `d` = depth, `elev` = bottom edge height, `frame` (black, white, oak, brass, none), `mat` (true or false). It hangs on the wall it is nearest to and faces into the room. Pictures are uploaded in the app and stay in the browser (and backups).
- Default rooms: Haus 53, sized from the architect plans (BF areas) and checked against the Giraffe360 tour: Laundry and cellar, Boiler room (basement); Entrance hall, Living room, Kitchen (ground floor); Landing, Office, Second bedroom, Bathroom (first floor); Attic landing, Bedroom, En-suite bathroom (attic). Defined in `HOUSE_ROOMS` with `ensure: true`; a deleted default room is not recreated. A higher `rev` with `resize: true` pushes corrected sizes, doors and windows to browsers that already have the room.
- `style` picks a specific model: desk `standing` (FlexiSpot style), cabinet `fjallbo`, floorlamp `hektar`.
- Counter `style`: fitted (kitchen run), hestia, pattburg, vadholma, vadholmarack (worktop at 90, `h` = rack top), metod3 or metod4 (a run of IKEA METOD/MAXIMERA drawer cabinets with an oak top and brass handles; over 120 cm high it becomes a high cabinet with doors over drawers).
- Copper pot racks: `type: "potrack"` with `style` rail, ladder or curved (hung from the ceiling) or wall (a rail on wall brackets, back against the wall). `h` runs from the lowest pan up to the ceiling (ceiling racks, rail 20 cm below it) or up to the rail (wall). Ceiling racks default to hanging from the ceiling; wall rails default to `elev` 110. Drawn with sample copper and cast-iron pans.
- Photos are never part of the handoff; they stay in the browser and in backup files.

## Storage notes

Plan data lives in localStorage; photos and versions in IndexedDB, both per browser and per address (`file://` and `http://localhost:8000` are separate). Photos are downscaled to 1600 px JPEG on import. iPhone HEIC photos open in Safari; on other browsers, export them as JPEG first.

## Controls

Drag on the plan (5 cm snap). Tap a wall to target it for color swatches. `R` rotate 90°, `Shift+R` rotate -15°, arrows nudge 5 cm (`Shift` 25 cm), `Delete` remove, `Esc` deselect. Dashed red outline: overlaps another item or extends past a wall or the ceiling.
