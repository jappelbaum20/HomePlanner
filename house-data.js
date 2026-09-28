// Starting data for the planner (format version 2). All sizes in centimeters.
// Only used on first load or after clearing browser storage; after that the app keeps its own copy.
// Plan orientation: width runs left to right (x), length runs top to bottom (y).
// Walls: n = top, e = right, s = bottom, w = left.
// Opening offset = distance from the wall's top or left interior corner to the opening's edge.
// Item x/y = center point; rot = degrees clockwise; elev = height of the item's underside above the floor.
window.HOUSE_SEED = {
  version: 2,
  name: "New house",
  catalog: [],
  rooms: [] // the default rooms come from HOUSE_ROOMS below
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
    id: 'tub-chair', type: 'chair', style: 'tub', name: 'JYSK ADSLEV dining chair',
    w: 59, d: 59, h: 82, color: '#EAE0C8', status: 'own',
    link: 'https://jysk.de/esszimmer/esszimmerstuehle/esszimmerstuhl-adslev-stoff-beige-eiche-natur',
    notes: 'JYSK ADSLEV with armrests, cream/beige fabric with vertical channel stitching, natural oak-colour legs with black caps. 59 x 59 x 82 (JYSK listing). 4 owned (listed for sale in Dec 2024, kept).'
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

// Default rooms (ensure: true = always present unless you delete them). Placeholder sizes until measured.
// A room of yours with a matching name is used instead of creating a new one.
const WHITE = '#F7F7F4';
window.HOUSE_ROOMS = [
  {
    // Layout from the listing photos: two windows on the long wall, the third on the short wall next to that corner,
    // an oak 3D feature panel (about 150 x 200) on the opposite long wall beside the open doorway to the hall.
    id: 'living', rev: 2, ensure: true, name: 'Living room', match: ['living', 'wohnzimmer', 'stube', 'lounge'], level: 'Ground floor',
    width: 620, length: 480, height: 245, floor: '#D9B98A', floorFinish: 'parquet',
    notes: 'Placeholder size until measured. Two windows on the north wall, one on the east wall by the corner, oak feature panel on the south wall next to the open doorway to the hall.',
    openings: [{ type: 'window', wall: 'n', offset: 180, width: 140, height: 130, sill: 85 }, { type: 'window', wall: 'n', offset: 400, width: 110, height: 130, sill: 85 },
      { type: 'window', wall: 'e', offset: 45, width: 110, height: 130, sill: 85 }, { type: 'door', wall: 's', offset: 40, width: 90, height: 205, leaf: false }]
  },
  {
    id: 'bedroom', ensure: true, name: 'Bedroom', match: ['schlafzimmer', 'main bedroom', 'master bedroom'], level: 'Ground floor',
    width: 420, length: 380, height: 240, floor: '#D9B98A', floorFinish: 'parquet', wallFinish: { n: 'panelling', e: 'panelling', w: 'panelling' },
    notes: 'Placeholder size until measured. White wood panelling as in the listing photo.',
    openings: [{ type: 'window', wall: 'e', offset: 70, width: 80, height: 110, sill: 90 }, { type: 'door', wall: 's', offset: 320, width: 85, height: 205 }]
  },
  {
    id: 'kitchen', ensure: true, name: 'Kitchen', match: ['küche', 'kueche', 'kochen'], level: 'Ground floor',
    width: 380, length: 300, height: 240, floor: '#ECE9E3', floorFinish: 'marble', wallFinish: { n: 'marble' },
    notes: 'Placeholder size until measured. White marble floor and splashback, white gloss fronts, dark granite top.',
    openings: [{ type: 'window', wall: 'e', offset: 90, width: 100, height: 110, sill: 95 }, { type: 'door', wall: 's', offset: 30, width: 85, height: 205 }]
  },
  {
    id: 'office', ensure: true, name: 'Office', match: ['büro', 'buero', 'arbeitszimmer', 'home office', 'study'], level: 'Ground floor',
    width: 380, length: 320, height: 240, floor: '#D9B98A', floorFinish: 'parquet',
    notes: 'Placeholder size until measured.',
    openings: [{ type: 'window', wall: 'n', offset: 120, width: 120, height: 130, sill: 85 }, { type: 'door', wall: 's', offset: 270, width: 85, height: 205 }]
  },
  {
    id: 'bedroom2', ensure: true, name: 'Second bedroom', match: ['bedroom 2', 'schlafzimmer 2', 'guest room', 'gästezimmer', 'gaestezimmer', 'kinderzimmer'], level: 'Ground floor',
    width: 360, length: 320, height: 240, floor: '#D9B98A', floorFinish: 'parquet',
    notes: 'Placeholder size until measured.',
    openings: [{ type: 'window', wall: 'n', offset: 120, width: 110, height: 120, sill: 90 }, { type: 'door', wall: 's', offset: 250, width: 85, height: 205 }]
  }
];

// Pieces to place once in a room (matched by name, else created from HOUSE_ROOMS). x, y = centre in cm; rot 270 = back against the left wall.
window.HOUSE_PLACEMENTS = [
  { id: 'office-desk', room: 'office', catalogId: 'q8-desk', x: 190, y: 38, rot: 0 },
  { id: 'office-billy', room: 'office', catalogId: 'billy-hoegadal', x: 16, y: 190, rot: 270 },
  { id: 'office-hektar', room: 'office', catalogId: 'hektar-floor', x: 330, y: 45, rot: 200 },
  { id: 'living-billy-1', room: 'living', catalogId: 'billy', x: 15, y: 260, rot: 270 },
  { id: 'living-billy-2', room: 'living', catalogId: 'billy', x: 15, y: 341, rot: 270 },
  { id: 'living-sofa', rev: 2, from: { x: 240, y: 389, rot: 180 }, room: 'living', catalogId: 'dellia-sofa', x: 240, y: 300, rot: 0 },
  { id: 'living-table', rev: 2, from: { x: 450, y: 150 }, room: 'living', catalogId: 'amburwood-table', x: 480, y: 150, rot: 0 },
  { id: 'living-chair-1', rev: 2, from: { x: 417, y: 88 }, room: 'living', catalogId: 'tub-chair', x: 447, y: 88, rot: 0 },
  { id: 'living-chair-2', rev: 2, from: { x: 483, y: 88 }, room: 'living', catalogId: 'tub-chair', x: 513, y: 88, rot: 0 },
  { id: 'living-chair-3', rev: 2, from: { x: 417, y: 212 }, room: 'living', catalogId: 'tub-chair', x: 447, y: 212, rot: 180 },
  { id: 'living-chair-4', rev: 2, from: { x: 483, y: 212 }, room: 'living', catalogId: 'tub-chair', x: 513, y: 212, rot: 180 },
  { id: 'living-art', rev: 2, from: { x: 240, y: 478.5 }, room: 'living', x: 620, y: 340, item: { type: 'art', name: 'Artwork', w: 100, d: 3, h: 70, frame: 'oak', mat: true, elev: 115 } },
  { id: 'living-oakpanel', room: 'living', x: 305, y: 480, item: { type: 'art', name: 'Oak 3D wall panel', w: 150, d: 2, h: 200, frame: 'oakpanel', mat: false, elev: 8 } },
  { id: 'bedroom-bed', room: 'bedroom', catalogId: 'mattis-bed', x: 210, y: 108, rot: 0 },
  { id: 'kitchen-counter', room: 'kitchen', x: 170, y: 30, item: { type: 'counter', name: 'Kitchen counter', w: 280, d: 60, h: 90, color: '#F4F4F2' } },
  { id: 'kitchen-tall', room: 'kitchen', x: 20, y: 170, rot: 270, item: { type: 'appliance', name: 'Tall units with oven', w: 60, d: 40, h: 225, color: '#3A3634' } }
];
