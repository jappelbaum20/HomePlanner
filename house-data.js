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
