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
- Furniture types: sofa, armchair, chair, table, roundtable, desk, bed, cabinet, shelf, wardrobe, counter, appliance, rug, plant, bath, shower, vanity, toilet, box.
- Light types: ceiling, pendant, spot, sconce, floorlamp, tablelamp. `kelvin`: 2200, 2700, 3000, 4000. `power`: soft, medium, bright.
- Piece `status`: own, considering, ordered.
- Room `floorFinish`: wood, tile, concrete, terrazzo, carpet, plain (default wood). Sets the floor texture in 3D.
- Photos are never part of the handoff; they stay in the browser and in backup files.

## Storage notes

Plan data lives in localStorage; photos and versions in IndexedDB, both per browser and per address (`file://` and `http://localhost:8000` are separate). Photos are downscaled to 1600 px JPEG on import. iPhone HEIC photos open in Safari; on other browsers, export them as JPEG first.

## Controls

Drag on the plan (5 cm snap). Tap a wall to target it for color swatches. `R` rotate 90°, `Shift+R` rotate -15°, arrows nudge 5 cm (`Shift` 25 cm), `Delete` remove, `Esc` deselect. Dashed red outline: overlaps another item or extends past a wall or the ceiling.
