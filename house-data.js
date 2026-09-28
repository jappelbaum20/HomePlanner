// Starting data for the planner (format version 2). All sizes in centimeters.
// Only used on first load or after clearing browser storage; after that the app keeps its own copy.
// Plan orientation: width runs left to right (x), length runs top to bottom (y).
// Walls: n = top, e = right, s = bottom, w = left.
// Opening offset = distance from the wall's top or left interior corner to the opening's edge.
// Item x/y = center point; rot = degrees clockwise; elev = height of the item's underside above the floor.
window.HOUSE_SEED = {
  version: 2,
  name: "New house",
  activeRoomId: "r1",
  catalog: [],
  rooms: [
    {
      id: "r1",
      name: "Example living room",
      level: "Ground floor",
      width: 520, length: 430, height: 260,
      floor: "#D6BA8E",
      walls: { n: "#F4F3EF", e: "#B4BFA6", s: "#F4F3EF", w: "#F4F3EF" },
      notes: "Example room. Delete it once the real rooms are in.",
      photos: [],
      openings: [
        { id: "o1", type: "window", wall: "n", offset: 170, width: 200, height: 140, sill: 80 },
        { id: "o2", type: "door", wall: "s", offset: 40, width: 90, height: 205, sill: 0 }
      ],
      items: [
        { id: "i1", type: "rug", name: "Rug", x: 190, y: 225, w: 240, d: 170, h: 1, rot: 0, color: "#C9BBA8" },
        { id: "i2", type: "sofa", name: "Sofa, 3-seat", x: 50, y: 225, w: 220, d: 95, h: 85, rot: 90, color: "#6F7C8A" },
        { id: "i3", type: "table", name: "Coffee table", x: 185, y: 225, w: 110, d: 60, h: 40, rot: 90, color: "#8B6A4E" },
        { id: "i4", type: "cabinet", name: "TV unit", x: 500, y: 225, w: 180, d: 40, h: 50, rot: 270, color: "#5B5048" },
        { id: "i5", type: "armchair", name: "Armchair", x: 165, y: 75, w: 85, d: 85, h: 80, rot: 150, color: "#A0826D" },
        { id: "i6", type: "plant", name: "Plant", x: 475, y: 45, w: 40, d: 40, h: 120, rot: 0, color: "#5E7A55" },
        { id: "i7", type: "floorlamp", name: "Floor lamp", x: 45, y: 60, w: 30, d: 30, h: 160, rot: 0, color: "#2F3337", kelvin: 2700, power: "medium" },
        { id: "i8", type: "pendant", name: "Pendant", x: 260, y: 225, w: 45, d: 45, h: 30, elev: 200, rot: 0, color: "#2F3337", kelvin: 2700, power: "bright" }
      ]
    }
  ]
};

// Pieces Claude found and you confirmed. Each appears in My pieces once (matched by id);
// if you delete one in the app it stays deleted. Raising `rev` pushes a changed size or look
// to the copy already in the browser. Sizes are W x D x H in cm.
window.HOUSE_PIECES = [
  {
    id: 'dellia-sofa', type: 'cornersofa', side: 'right', name: 'DELLIA corner sofa',
    w: 289, d: 182, h: 86, color: '#D9C9B0', status: 'own',
    link: 'https://www.amazon.de/dp/B0CVQKDT11',
    notes: 'home24 (Best Mobilier), Aug 2024, €999. Beige corduroy. Chaise 100 cm wide, can go left or right. Seat height 40, seat depth 65. Sleep function (342 x 140) and storage box. Black 2.5 cm feet.'
  },
  {
    id: 'mattis-bed', type: 'bed', name: 'Mattis upholstered bed 180 x 200',
    w: 205, d: 216, h: 112, color: '#CDBFA8', status: 'own',
    link: 'https://www.home24.de/produkt/polsterbett-mattis-i-beige-180-x-200cm-2-bettkaesten',
    notes: 'home24, Oct 2022. Beige woven fabric, plain rounded padded headboard, tapered oak feet, 2 storage boxes. Outer size from the home24 listing (about 205 x 216 x 112): measure to confirm.'
  },
  {
    id: 'amburwood-table', rev: 2, type: 'roundtable', name: 'AmburWOOD dining table (extended)',
    w: 130, d: 100, h: 75, color: '#B8875A', status: 'own',
    link: 'https://www.home24.de/produkt/esstisch-amburwood-mit-ausziehfunktion-eiche-massiv-eiche',
    notes: 'home24 (Ars Natura), Sep 2024. Solid oiled oak, round 100 cm, extends to 130 x 100 with a built-in butterfly leaf. Seats 2 to 4 (6 extended). Shown extended (130 x 100). Set width to 100 to plan it closed.'
  },
  {
    id: 'q8-desk', type: 'desk', style: 'standing', name: 'FlexiSpot Q8 standing desk',
    w: 140, d: 70, h: 75, color: '#D2A56C', status: 'own',
    link: 'https://www.flexispot.de/bambus-schreibtisch-q8.html',
    notes: 'flexispot.de, Sep 2024. Bamboo top 140 x 70 (only size), black 3-stage dual-motor frame, height 60 to 124 cm, slim drawer, cable tray, wireless charger. Set height to plan it standing.'
  },
  {
    id: 'billy-hoegadal', type: 'shelf', doors: 'lower', books: true, name: 'BILLY with HÖGADAL doors',
    w: 80, d: 30, h: 202, color: '#F4F4F1', status: 'considering',
    link: 'https://www.ikea.com/ch/de/p/billy-buecherregal-weiss-00263850/',
    notes: 'IKEA BILLY 80 x 28 x 202 white, with 2 HÖGADAL doors 40 x 97 (white, woven bamboo) on the lower half: https://www.ikea.com/ch/de/p/hoegadal-tuer-weiss-geflochtener-bambus-00542494/ . Doors add about 2 cm depth.'
  },
  {
    id: 'billy', type: 'shelf', doors: 'none', books: true, name: 'BILLY bookcase',
    w: 80, d: 28, h: 202, color: '#F4F4F1', status: 'considering',
    link: 'https://www.ikea.com/ch/de/p/billy-buecherregal-weiss-00263850/',
    notes: 'IKEA BILLY, white, 80 x 28 x 202. 1 fixed + 4 adjustable shelves, 30 kg per shelf.'
  },
  {
    id: 'fjallbo-sideboard', type: 'cabinet', style: 'fjallbo', name: 'FJÄLLBO sideboard',
    w: 111, d: 47, h: 95, color: '#1E1E1E', status: 'own',
    link: 'https://www.ikea.com/ch/de/p/fjaellbo-sideboard-schwarz-00502799/',
    notes: 'IKEA FJÄLLBO, black powder-coated steel with a stained pine top and shelf, 111 x 47 x 95. Doors and drawers. Anchor to the wall.'
  },
  {
    id: 'hektar-floor', type: 'floorlamp', style: 'hektar', name: 'HEKTAR floor lamp',
    w: 32, d: 32, h: 181, color: '#3B3C3D', status: 'considering', kelvin: 2700, power: 'medium',
    link: 'https://www.ikea.com/ch/de/p/hektar-standleuchte-dunkelgrau-00215307/',
    notes: 'IKEA HEKTAR, dark grey steel, 181 cm, shade 31.5 cm, base 34 cm, tilting head, E27 bulb sold separately.'
  }
];

// Starter rooms with placeholder sizes, used only when no room with a matching name exists.
// Replace the sizes once the rooms are measured.
window.HOUSE_ROOMS = [
  {
    id: 'office', name: 'Office', match: ['büro', 'buero', 'arbeitszimmer', 'home office', 'study'], level: 'Ground floor',
    width: 380, length: 320, height: 240, floor: '#D9B98A', floorFinish: 'parquet',
    notes: 'Placeholder size until measured.',
    openings: [{ type: 'window', wall: 'n', offset: 120, width: 120, height: 130, sill: 85 }, { type: 'door', wall: 's', offset: 270, width: 85, height: 205 }]
  },
  {
    id: 'living', name: 'Living room', match: ['living', 'wohnzimmer', 'stube', 'lounge'], level: 'Ground floor',
    width: 620, length: 480, height: 245, floor: '#D9B98A', floorFinish: 'parquet', wallFinish: { e: 'oakpanels' },
    notes: 'Placeholder size until measured. East wall: oak 3D panels as in the listing photo.',
    openings: [{ type: 'window', wall: 'n', offset: 80, width: 140, height: 130, sill: 85 }, { type: 'window', wall: 'n', offset: 330, width: 110, height: 130, sill: 85 },
      { type: 'window', wall: 'w', offset: 60, width: 120, height: 130, sill: 85 }, { type: 'door', wall: 's', offset: 480, width: 90, height: 205, color: '#1F2A36' }]
  }
];

// Pieces to place once in a room (matched by name, else created from HOUSE_ROOMS). x, y = centre in cm; rot 270 = back against the left wall.
window.HOUSE_PLACEMENTS = [
  { id: 'office-desk', room: 'office', catalogId: 'q8-desk', x: 190, y: 38, rot: 0 },
  { id: 'office-billy', room: 'office', catalogId: 'billy-hoegadal', x: 16, y: 190, rot: 270 },
  { id: 'office-hektar', room: 'office', catalogId: 'hektar-floor', x: 330, y: 45, rot: 200 },
  { id: 'living-billy-1', room: 'living', catalogId: 'billy', x: 15, y: 260, rot: 270 },
  { id: 'living-billy-2', room: 'living', catalogId: 'billy', x: 15, y: 341, rot: 270 }
];
