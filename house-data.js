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
  }
];
