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
    id: 'bed-vinay', type: 'bed', style: 'vinay', name: 'VINAY cord bed 180 x 200 (olive)',
    w: 196, d: 233, h: 90, color: '#6E7045', status: 'considering',
    link: 'https://www.beliani.ch/polsterbett-cord-olivgrun-180-x-200-cm-vinay.html',
    notes: 'Beliani VINAY, 180 x 200, CHF 579.99. Olive green corduroy, thick padded headboard (186 x 90), feet 2 cm, slatted base (14 slats). Outer size 196 x 233 x 90 (Beliani listing).'
  },
  {
    id: 'bed-time', rev: 2, type: 'bed', style: 'boxbed', name: 'Ti\u2019me storage bed 180 x 200 (beige cord)',
    w: 240, d: 247, h: 85, color: '#C9C1B2', status: 'considering',
    link: 'https://www.xxxlutz.ch/p/ti-me-polsterbett-180-200-cm-beige-002555000801',
    notes: 'XXXLutz Ti\u2019me upholstered bed, 180 x 200, beige corduroy. Wide flat upholstered rim standing on the floor, lift-up slatted base with storage box, headboard of two large square cushions. Outer size 240 x 247 x 85, frame height 32, max. load 250 kg (XXXLutz product details).'
  },
  {
    id: 'bed-livetastic', rev: 2, type: 'bed', style: 'cloe', name: 'Livetastic Cloe storage bed 180 x 200 (light brown cord)',
    w: 222, d: 243, h: 73, color: '#A99682', status: 'considering',
    link: 'https://www.xxxlutz.ch/p/livetastic-polsterbett-200-200-cm-hellbraun-001073004152',
    notes: 'XXXLutz Livetastic Cloe upholstered bed, 180 x 200, light brown wide-rib corduroy (other fabrics available). Wide flat upholstered rim standing on the floor, lift-up slatted base with storage box, low headboard of two flat panels. Outer size 222 x 243 x 73, frame height 39, max. load 250 kg (XXXLutz product details). The link is the 200 x 200 listing; choose 180 x 200 when ordering.'
  },
  {
    id: 'bed-zen', type: 'bed', style: 'zen', name: 'ZEN bed 180 x 200 with side tables (ash)',
    w: 328, d: 229, h: 86, color: '#8A6444', status: 'considering',
    link: 'https://www.beliani.ch/bett-mit-lattenrost-zen-180-x-200-cm-braune-esche-36178.html',
    notes: 'Beliani ZEN, 180 x 200, CHF 1,029.99. Brown ash veneer, Japanese-style low frame on 8 cm legs, headboard 220 x 86 with bouclé panels, two flat side tables built in. Outer size 328 x 229 x 86 including the side tables (Beliani listing).'
  },
  {
    id: 'grey-sofabed', type: 'sofa', style: 'sofabed', name: 'Grey sofa bed',
    w: 190, d: 86, h: 82, color: '#8C8883', status: 'own',
    notes: 'Mid-century style click-clack sofa bed in light grey tweed: rolled arms, two buttoned back cushions, two seat cushions with piping, splayed light wood legs, two small arm pillows. Folds flat into a bed (about 140 cm by your estimate). Bought from a Swiss web shop; the order was not found in Gmail. Sizes estimated from the photo: measure to confirm.'
  },
  {
    id: 'rowing-oar', rev: 2, type: 'art', style: 'oar', frame: 'none', mat: false, name: 'Presentation oar (wall)',
    w: 150, d: 9, h: 18, color: '#D9A866', status: 'own',
    notes: 'Green Templeton College Men\u2019s 1st Torpid presentation oar on two leather wall hooks. Dark green blade with the crew painted on in gold and the college crest, pale varnished shaft. Size estimated from the photo (about 150 cm long, blade about 18 cm high): measure to confirm.'
  },
  {
    id: 'painting-limed-oak', type: 'art', frame: 'limewash', mat: 'cream', image: 'url:photos/art/painting-limed-oak.jpg', name: 'Painting in limed oak frame',
    w: 78, d: 4, h: 71, color: '#CDBFA6', status: 'own',
    notes: 'Colourful painting behind glass, wide cream mat, whitewashed (limed) oak frame. Size estimated from the photo: measure to confirm.'
  },
  {
    id: 'pastel-pine', type: 'art', frame: 'pine', mat: 'cream', image: 'url:photos/art/pastel-pine.jpg', name: 'Pastel drawing in pine frame',
    w: 80, d: 4, h: 60, color: '#A56E3D', status: 'own',
    notes: 'Pastel drawing behind glass, cream mat, honey pine frame. Size estimated from the photo: measure to confirm.'
  },
  {
    id: 'antique-cabinet', type: 'cabinet', style: 'antique', name: 'Antique walnut cabinet',
    w: 90, d: 45, h: 140, color: '#553019', status: 'own',
    notes: 'Antique walnut cabinet: crown moulding, top drawer with two brass bail pulls, two burl-veneer panel doors with a keyhole, fluted corner pilasters, bun feet. Size estimated from the photo (about 90 x 45 x 140): measure to confirm.'
  },
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
    id: 'rivery-nightstand', type: 'cabinet', style: 'rivery', name: 'Rivery bedside chest',
    w: 46, d: 35, h: 52, color: '#F4F2EC', status: 'own',
    link: 'https://www.home24.de/produkt/nachtkommode-rivery-kiefer-massiv',
    notes: 'home24 (Maison Belfort), Sep 2024, 2 bought (€109.98). Solid pine, white, honey pine top, 2 drawers, brass-coloured handles. 46 x 35 x 52.'
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

// Default rooms (ensure: true = always present unless you delete them), measured from the Giraffe360 tour
// (floor plan units x 1.04 = cm, about ±4 %). North = top of the tour's floor plan.
// A room of yours with a matching name is used instead of creating a new one. `rev` + `resize` push corrected
// sizes, doors and windows to browsers that already have the room.
window.HOUSE_ROOMS = [
  {
    "id": "laundry",
    "rev": 6,
    "resize": true,
    "ensure": true,
    "name": "Laundry and cellar",
    "match": [
      "waschraum",
      "keller",
      "cellar",
      "laundry"
    ],
    "level": "Basement",
    "width": 468,
    "length": 405,
    "height": 210,
    "floor": "#A3A39E",
    "floorFinish": "concrete",
    "wallFinish": {},
    "notes": "Size from the architect plan (Haus 53), BF 18.94 m² (Haus 53 only). Washing machine and dryer, utility sink, stairs up.",
    "openings": [
      {
        "type": "window",
        "wall": "w",
        "offset": 135,
        "width": 72,
        "height": 60,
        "sill": 150,
        "niche": 35,
        "radiator": false
      },
      {
        "type": "door",
        "wall": "s",
        "offset": 249,
        "width": 80,
        "height": 200
      }
    ]
  },
  {
    "id": "boiler",
    "rev": 6,
    "resize": true,
    "ensure": true,
    "name": "Boiler room",
    "match": [
      "heizung",
      "boiler"
    ],
    "level": "Basement",
    "width": 462,
    "length": 143,
    "height": 210,
    "floor": "#A3A39E",
    "floorFinish": "concrete",
    "wallFinish": {},
    "notes": "Size from the architect plan (Haus 53), BF 6.60 m². Heating.",
    "openings": [
      {
        "type": "door",
        "wall": "s",
        "offset": 336,
        "width": 85,
        "height": 200
      }
    ]
  },
  {
    "id": "hall0",
    "rev": 6,
    "resize": true,
    "ensure": true,
    "name": "Entrance hall",
    "match": [
      "entrance hall",
      "hall",
      "diele",
      "eingang",
      "flur"
    ],
    "level": "Ground floor",
    "width": 175,
    "length": 416,
    "height": 225,
    "floor": "#D9B98A",
    "floorFinish": "parquet",
    "wallFinish": {},
    "notes": "Size from the architect plan (Haus 53), BF 7.29 m². Stairs up along the west wall, front door at the north end. Front door dark teal; stairs with dark wood treads, white risers and a glass balustrade.",
    "openings": [
      {
        "type": "door",
        "wall": "n",
        "offset": 86,
        "width": 89,
        "height": 210,
        "color": "#1E4B57",
        "swing": "out"
      },
      {
        "type": "door",
        "wall": "s",
        "offset": 102,
        "width": 69,
        "height": 200,
        "swing": "out"
      },
      {
        "type": "door",
        "wall": "w",
        "offset": 320,
        "width": 73,
        "height": 200,
        "swing": "out"
      }
    ],
    "tourPhotos": [
      {
        "src": "photos/tour/01_hall0_view1.jpg",
        "label": "Entrance hall (by the front door), looking south (tour photo)"
      },
      {
        "src": "photos/tour/01_hall0_view2.jpg",
        "label": "Entrance hall (by the front door), looking south-west (tour photo)"
      },
      {
        "src": "photos/tour/01_hall0_view3.jpg",
        "label": "Entrance hall (by the front door), looking north-west (tour photo)"
      },
      {
        "src": "photos/tour/01_hall0_view4.jpg",
        "label": "Entrance hall (by the front door), looking north (tour photo)"
      },
      {
        "src": "photos/tour/01_hall0_view5.jpg",
        "label": "Entrance hall (by the front door), looking north-east (tour photo)"
      },
      {
        "src": "photos/tour/01_hall0_view6.jpg",
        "label": "Entrance hall (by the front door), looking south-east (tour photo)"
      },
      {
        "src": "photos/tour/02_hall0_view1.jpg",
        "label": "Entrance hall (by the living-room door), looking south-east (tour photo)"
      },
      {
        "src": "photos/tour/02_hall0_view2.jpg",
        "label": "Entrance hall (by the living-room door), looking south-west (tour photo)"
      },
      {
        "src": "photos/tour/02_hall0_view3.jpg",
        "label": "Entrance hall (by the living-room door), looking west (tour photo)"
      },
      {
        "src": "photos/tour/02_hall0_view4.jpg",
        "label": "Entrance hall (by the living-room door), looking north-west (tour photo)"
      },
      {
        "src": "photos/tour/02_hall0_view5.jpg",
        "label": "Entrance hall (by the living-room door), looking north-east (tour photo)"
      },
      {
        "src": "photos/tour/02_hall0_view6.jpg",
        "label": "Entrance hall (by the living-room door), looking east (tour photo)"
      }
    ]
  },
  {
    "id": "living",
    "rev": 6,
    "resize": true,
    "ensure": true,
    "name": "Living room",
    "match": [
      "living",
      "wohnzimmer",
      "stube",
      "lounge"
    ],
    "level": "Ground floor",
    "width": 476,
    "length": 440,
    "height": 225,
    "floor": "#D9B98A",
    "floorFinish": "parquet",
    "wallFinish": {
      "e": "panelling",
      "s": "panelling",
      "w": "panelling"
    },
    "notes": "Size from the architect plan (Haus 53), BF 21.87 m². 23.0 m². White wood panelling, oak 3D feature panel on the north wall, beamed ceiling, glazed door to the hall. South windows sit in floor-to-top niches with the radiators; the west window has no radiator.",
    "openings": [
      {
        "type": "window",
        "wall": "s",
        "offset": 22,
        "width": 169,
        "height": 130,
        "sill": 85,
        "niche": 29
      },
      {
        "type": "window",
        "wall": "s",
        "offset": 273,
        "width": 164,
        "height": 130,
        "sill": 85,
        "niche": 29
      },
      {
        "type": "window",
        "wall": "w",
        "offset": 208,
        "width": 183,
        "height": 130,
        "sill": 85,
        "radiator": false
      },
      {
        "type": "door",
        "wall": "n",
        "offset": 400,
        "width": 69,
        "height": 200
      }
    ],
    "tourPhotos": [
      {
        "src": "photos/tour/03_living_view1.jpg",
        "label": "Living room, looking south (tour photo)"
      },
      {
        "src": "photos/tour/03_living_view2.jpg",
        "label": "Living room, looking south-west (tour photo)"
      },
      {
        "src": "photos/tour/03_living_view3.jpg",
        "label": "Living room, looking north-west (tour photo)"
      },
      {
        "src": "photos/tour/03_living_view4.jpg",
        "label": "Living room, looking north (tour photo)"
      },
      {
        "src": "photos/tour/03_living_view5.jpg",
        "label": "Living room, looking north-east (tour photo)"
      },
      {
        "src": "photos/tour/03_living_view6.jpg",
        "label": "Living room, looking south-east (tour photo)"
      }
    ]
  },
  {
    "id": "kitchen",
    "rev": 6,
    "resize": true,
    "ensure": true,
    "name": "Kitchen",
    "match": [
      "küche",
      "kueche",
      "kochen"
    ],
    "level": "Ground floor",
    "width": 289,
    "length": 326,
    "height": 225,
    "floor": "#ECE9E3",
    "floorFinish": "marble",
    "wallFinish": {},
    "notes": "Size from the architect plan (Haus 53), BF 9.43 m². 9.8 m². Marble floor and splashback, white gloss units with a dark granite top, dark oak tall units with ovens. Window in a deep niche with a desk shelf and the radiator below.",
    "openings": [
      {
        "type": "window",
        "wall": "w",
        "offset": 107,
        "width": 126,
        "height": 110,
        "sill": 100,
        "niche": 48,
        "nicheShelf": true
      },
      {
        "type": "door",
        "wall": "e",
        "offset": 241,
        "width": 73,
        "height": 200
      }
    ],
    "tourPhotos": [
      {
        "src": "photos/tour/04_kitchen_view1.jpg",
        "label": "Kitchen, looking south (tour photo)"
      },
      {
        "src": "photos/tour/04_kitchen_view2.jpg",
        "label": "Kitchen, looking south-west (tour photo)"
      },
      {
        "src": "photos/tour/04_kitchen_view3.jpg",
        "label": "Kitchen, looking north-west (tour photo)"
      },
      {
        "src": "photos/tour/04_kitchen_view4.jpg",
        "label": "Kitchen, looking north (tour photo)"
      },
      {
        "src": "photos/tour/04_kitchen_view5.jpg",
        "label": "Kitchen, looking north-east (tour photo)"
      },
      {
        "src": "photos/tour/04_kitchen_view6.jpg",
        "label": "Kitchen, looking south-east (tour photo)"
      }
    ]
  },
  {
    "id": "landing1",
    "rev": 6,
    "resize": true,
    "ensure": true,
    "name": "Landing",
    "match": [
      "landing",
      "diele oben",
      "flur oben"
    ],
    "level": "First floor",
    "width": 182,
    "length": 540,
    "height": 213,
    "floor": "#D9B98A",
    "floorFinish": "parquet",
    "wallFinish": {},
    "notes": "Size from the architect plan (Haus 53), BF 9.86 m². Stairs up to the attic, built-in cupboard on the east wall.",
    "openings": [
      {
        "type": "door",
        "wall": "w",
        "offset": 272,
        "width": 73,
        "height": 200,
        "swing": "out"
      },
      {
        "type": "door",
        "wall": "w",
        "offset": 469,
        "width": 62,
        "height": 200,
        "swing": "out"
      },
      {
        "type": "door",
        "wall": "s",
        "offset": 51,
        "width": 83,
        "height": 200,
        "swing": "out"
      }
    ],
    "tourPhotos": [
      {
        "src": "photos/tour/05_landing1_view1.jpg",
        "label": "Landing, looking south (tour photo)"
      },
      {
        "src": "photos/tour/05_landing1_view2.jpg",
        "label": "Landing, looking south-west (tour photo)"
      },
      {
        "src": "photos/tour/05_landing1_view3.jpg",
        "label": "Landing, looking west (tour photo)"
      },
      {
        "src": "photos/tour/05_landing1_view4.jpg",
        "label": "Landing, looking north (tour photo)"
      },
      {
        "src": "photos/tour/05_landing1_view5.jpg",
        "label": "Landing, looking north-east (tour photo)"
      },
      {
        "src": "photos/tour/05_landing1_view6.jpg",
        "label": "Landing, looking east (tour photo)"
      }
    ]
  },
  {
    "id": "office",
    "rev": 6,
    "resize": true,
    "ensure": true,
    "name": "Office",
    "match": [
      "büro",
      "buero",
      "arbeitszimmer",
      "home office",
      "study"
    ],
    "level": "First floor",
    "width": 485,
    "length": 345,
    "height": 213,
    "floor": "#D9B98A",
    "floorFinish": "parquet",
    "wallFinish": {},
    "notes": "Size from the architect plan (Haus 53), BF 16.74 m². 16.4 m². Painted walls, beamed ceiling, two windows with a lake view, glazed door.",
    "openings": [
      {
        "type": "window",
        "wall": "s",
        "offset": 35,
        "width": 159,
        "height": 125,
        "sill": 85
      },
      {
        "type": "window",
        "wall": "s",
        "offset": 283,
        "width": 159,
        "height": 125,
        "sill": 85
      },
      {
        "type": "door",
        "wall": "n",
        "offset": 359,
        "width": 83,
        "height": 200
      }
    ],
    "tourPhotos": [
      {
        "src": "photos/tour/08_office_view1.jpg",
        "label": "Office, looking south (tour photo)"
      },
      {
        "src": "photos/tour/08_office_view2.jpg",
        "label": "Office, looking south-west (tour photo)"
      },
      {
        "src": "photos/tour/08_office_view3.jpg",
        "label": "Office, looking north-west (tour photo)"
      },
      {
        "src": "photos/tour/08_office_view4.jpg",
        "label": "Office, looking north (tour photo)"
      },
      {
        "src": "photos/tour/08_office_view5.jpg",
        "label": "Office, looking north-east (tour photo)"
      },
      {
        "src": "photos/tour/08_office_view6.jpg",
        "label": "Office, looking south-east (tour photo)"
      }
    ]
  },
  {
    "id": "bedroom2",
    "rev": 6,
    "resize": true,
    "ensure": true,
    "name": "Second bedroom",
    "match": [
      "bedroom 2",
      "schlafzimmer 2",
      "guest room",
      "gästezimmer",
      "gaestezimmer",
      "kinderzimmer"
    ],
    "level": "First floor",
    "width": 303,
    "length": 357,
    "height": 213,
    "floor": "#D9B98A",
    "floorFinish": "parquet",
    "wallFinish": {
      "n": "panelling",
      "e": "panelling",
      "s": "panelling",
      "w": "panelling"
    },
    "notes": "Size from the architect plan (Haus 53), BF 10.83 m². 10.4 m². White wood panelling all round, beamed ceiling, small window with shutters.",
    "openings": [
      {
        "type": "window",
        "wall": "n",
        "offset": 97,
        "width": 77,
        "height": 110,
        "sill": 90
      },
      {
        "type": "door",
        "wall": "e",
        "offset": 284,
        "width": 73,
        "height": 200
      }
    ],
    "tourPhotos": [
      {
        "src": "photos/tour/06_bedroom2_view1.jpg",
        "label": "Second bedroom, looking north-east (tour photo)"
      },
      {
        "src": "photos/tour/06_bedroom2_view2.jpg",
        "label": "Second bedroom, looking south-east (tour photo)"
      },
      {
        "src": "photos/tour/06_bedroom2_view3.jpg",
        "label": "Second bedroom, looking south (tour photo)"
      },
      {
        "src": "photos/tour/06_bedroom2_view4.jpg",
        "label": "Second bedroom, looking south-west (tour photo)"
      },
      {
        "src": "photos/tour/06_bedroom2_view5.jpg",
        "label": "Second bedroom, looking north-west (tour photo)"
      },
      {
        "src": "photos/tour/06_bedroom2_view6.jpg",
        "label": "Second bedroom, looking north (tour photo)"
      }
    ]
  },
  {
    "id": "bathroom",
    "rev": 6,
    "resize": true,
    "ensure": true,
    "name": "Bathroom",
    "match": [
      "badezimmer",
      "bad",
      "bath"
    ],
    "level": "First floor",
    "width": 310,
    "length": 151,
    "height": 213,
    "floor": "#9A9C9E",
    "floorFinish": "stone",
    "wallFinish": {
      "n": "tiles",
      "e": "tiles",
      "s": "tiles",
      "w": "tiles"
    },
    "notes": "Size from the architect plan (Haus 53), BF 4.95 m². 4.9 m². Grey stone floor, white wall tiles, bath, wall-hung WC, basin on a wood vanity.",
    "openings": [
      {
        "type": "window",
        "wall": "w",
        "offset": 58,
        "width": 85,
        "height": 90,
        "sill": 110,
        "niche": 28
      },
      {
        "type": "door",
        "wall": "e",
        "offset": 80,
        "width": 62,
        "height": 200
      }
    ],
    "tourPhotos": [
      {
        "src": "photos/tour/07_bathroom_view1.jpg",
        "label": "Bathroom, looking north (tour photo)"
      },
      {
        "src": "photos/tour/07_bathroom_view2.jpg",
        "label": "Bathroom, looking east (tour photo)"
      },
      {
        "src": "photos/tour/07_bathroom_view3.jpg",
        "label": "Bathroom, looking south-east (tour photo)"
      },
      {
        "src": "photos/tour/07_bathroom_view4.jpg",
        "label": "Bathroom, looking south (tour photo)"
      },
      {
        "src": "photos/tour/07_bathroom_view5.jpg",
        "label": "Bathroom, looking west (tour photo)"
      },
      {
        "src": "photos/tour/07_bathroom_view6.jpg",
        "label": "Bathroom, looking north-west (tour photo)"
      }
    ]
  },
  {
    "id": "landing2",
    "rev": 6,
    "resize": true,
    "ensure": true,
    "name": "Attic landing",
    "match": [
      "attic landing",
      "dachgeschoss"
    ],
    "level": "Attic",
    "width": 187,
    "length": 451,
    "height": 225,
    "floor": "#E4D3B5",
    "floorFinish": "wood",
    "wallFinish": {
      "n": "panelling",
      "e": "panelling",
      "s": "panelling",
      "w": "panelling"
    },
    "notes": "Size from the architect plan (Haus 53), BF 7.68 m².  White wood panelling, mirrored built-in wardrobe, light laminate floor.",
    "openings": [
      {
        "type": "door",
        "wall": "w",
        "offset": 355,
        "width": 83,
        "height": 200,
        "swing": "out"
      },
      {
        "type": "door",
        "wall": "s",
        "offset": 114,
        "width": 73,
        "height": 200,
        "swing": "out"
      }
    ],
    "tourPhotos": [
      {
        "src": "photos/tour/09_landing2_view1.jpg",
        "label": "Attic landing, looking west (tour photo)"
      },
      {
        "src": "photos/tour/09_landing2_view2.jpg",
        "label": "Attic landing, looking north (tour photo)"
      },
      {
        "src": "photos/tour/09_landing2_view3.jpg",
        "label": "Attic landing, looking north-east (tour photo)"
      },
      {
        "src": "photos/tour/09_landing2_view4.jpg",
        "label": "Attic landing, looking east (tour photo)"
      },
      {
        "src": "photos/tour/09_landing2_view5.jpg",
        "label": "Attic landing, looking south (tour photo)"
      },
      {
        "src": "photos/tour/09_landing2_view6.jpg",
        "label": "Attic landing, looking south-west (tour photo)"
      }
    ]
  },
  {
    "id": "bedroom",
    "rev": 6,
    "resize": true,
    "ensure": true,
    "name": "Bedroom",
    "match": [
      "schlafzimmer",
      "main bedroom",
      "master bedroom"
    ],
    "level": "Attic",
    "width": 305,
    "length": 386,
    "height": 225,
    "floor": "#D9B98A",
    "floorFinish": "parquet",
    "wallFinish": {
      "e": "panelling",
      "s": "panelling"
    },
    "notes": "Size from the architect plan (Haus 53), BF 11.77 m². 11.9 m². Glass-walled en-suite with bath along the north side (drawn as a glass wall), white panelling.",
    "openings": [
      {
        "type": "window",
        "wall": "w",
        "offset": 114,
        "width": 157,
        "height": 120,
        "sill": 90
      },
      {
        "type": "door",
        "wall": "e",
        "offset": 93,
        "width": 83,
        "height": 200
      },
      {
        "type": "window",
        "wall": "n",
        "offset": 0,
        "width": 305,
        "height": 210,
        "sill": 0,
        "radiator": false
      }
    ],
    "tourPhotos": [
      {
        "src": "photos/tour/10_bedroom_view1.jpg",
        "label": "Bedroom, looking south-east (tour photo)"
      },
      {
        "src": "photos/tour/10_bedroom_view2.jpg",
        "label": "Bedroom, looking south (tour photo)"
      },
      {
        "src": "photos/tour/10_bedroom_view3.jpg",
        "label": "Bedroom, looking south-west (tour photo)"
      },
      {
        "src": "photos/tour/10_bedroom_view4.jpg",
        "label": "Bedroom, looking north-west (tour photo)"
      },
      {
        "src": "photos/tour/10_bedroom_view5.jpg",
        "label": "Bedroom, looking north (tour photo)"
      },
      {
        "src": "photos/tour/10_bedroom_view6.jpg",
        "label": "Bedroom, looking north-east (tour photo)"
      }
    ]
  },
  {
    "id": "ensuite",
    "rev": 6,
    "resize": true,
    "ensure": true,
    "name": "En-suite bathroom",
    "match": [
      "bad dg",
      "en-suite",
      "ensuite"
    ],
    "level": "Attic",
    "width": 325,
    "length": 224,
    "height": 225,
    "floor": "#D9B98A",
    "floorFinish": "parquet",
    "wallFinish": {
      "n": "marble",
      "e": "marble",
      "w": "marble"
    },
    "notes": "Size from the architect plan (Haus 53), BF 7.31 m². Opens to the bedroom through a glass wall; marble walls, bath and WC.",
    "openings": [
      {
        "type": "window",
        "wall": "s",
        "offset": 0,
        "width": 325,
        "height": 210,
        "sill": 0,
        "radiator": false
      }
    ]
  }
];

// Pieces to place once in a room (matched by name, else created from HOUSE_ROOMS). x, y = centre in cm; rot 270 = back against the left wall.
// Starter rooms taken out of the house; removed from browsers that already have them
window.HOUSE_RETIRED_ROOMS = ['annexoffice', 'basementbath', 'commonroom', 'attic', 'loft'];

window.HOUSE_PLACEMENTS = [
  { id: 'bed-nightstand-l', room: 'bedroom', catalogId: 'rivery-nightstand', x: 26, y: 368, rot: 180 },
  { id: 'bed-nightstand-r', room: 'bedroom', catalogId: 'rivery-nightstand', x: 280, y: 368, rot: 180 },
  // Basement, attic en-suite and loft, from the architect plans
  { id: 'ug-stairs', builtin: true, room: 'laundry', x: 320, y: 60, item: { type: 'stairs', name: 'Stairs up', w: 75, d: 110, h: 210, color: '#9A6B3F' } },
  { id: 'ug-washer', room: 'laundry', x: 60, y: 196, rot: 270, item: { type: 'appliance', name: 'Washing machine', w: 60, d: 60, h: 85, color: '#F2F2F0' } },
  { id: 'ug-dryer', room: 'laundry', x: 60, y: 122, rot: 270, item: { type: 'appliance', name: 'Tumble dryer', w: 60, d: 60, h: 85, color: '#F2F2F0' } },
  { id: 'ug-sink', builtin: true, room: 'laundry', x: 24, y: 339, rot: 270, item: { type: 'vanity', name: 'Utility sink', w: 70, d: 45, h: 85, color: '#DCDCD6' } },
  { id: 'en-bath', builtin: true, room: 'ensuite', x: 237, y: 38, item: { type: 'bath', name: 'Bathtub', w: 175, d: 72, h: 58, color: '#FAFAF8' } },
  { id: 'en-wc', builtin: true, room: 'ensuite', x: 28, y: 180, rot: 270, item: { type: 'toilet', name: 'WC', w: 37, d: 54, h: 42, color: '#FAFAF8' } },
  { id: 'bed-basin', builtin: true, room: 'bedroom', x: 24, y: 57, rot: 270, item: { type: 'vanity', name: 'Basin', w: 60, d: 45, h: 85, color: '#1E1E1E' } },
  // rev 3: rooms measured from the tour; `from` is where the piece was put before, so only untouched pieces move
  { id: 'office-desk', rev: 4, from: [{ x: 116, y: 317 }, { x: 190, y: 38 }], room: 'office', catalogId: 'q8-desk', x: 126, y: 308, rot: 180 },
  { id: 'office-billy', rev: 3, from: { x: 16, y: 190 }, room: 'office', catalogId: 'billy-hoegadal', x: 16, y: 150, rot: 270 },
  { id: 'office-hektar', rev: 4, from: [{ x: 45, y: 300 }, { x: 330, y: 45 }], room: 'office', catalogId: 'hektar-floor', x: 28, y: 300, rot: 200 },
  { id: 'living-billy-1', rev: 3, from: { x: 15, y: 260 }, room: 'living', catalogId: 'billy', x: 235, y: 421, rot: 180 },
  { id: 'living-billy-2', rev: 3, from: { x: 15, y: 341 }, room: 'living', catalogId: 'billy', x: 343, y: 14, rot: 0 },
  { id: 'living-sofa', rev: 4, from: [{ x: 390, y: 230 }, { x: 240, y: 300 }], room: 'living', catalogId: 'dellia-sofa', x: 384, y: 230, rot: 90 },
  { id: 'living-table', rev: 3, from: { x: 480, y: 150 }, room: 'living', catalogId: 'amburwood-table', x: 150, y: 230, rot: 0 },
  { id: 'living-chair-1', rev: 3, from: { x: 447, y: 88 }, room: 'living', catalogId: 'tub-chair', x: 117, y: 158, rot: 0 },
  { id: 'living-chair-2', rev: 3, from: { x: 513, y: 88 }, room: 'living', catalogId: 'tub-chair', x: 183, y: 158, rot: 0 },
  { id: 'living-chair-3', rev: 3, from: { x: 447, y: 212 }, room: 'living', catalogId: 'tub-chair', x: 117, y: 302, rot: 180 },
  { id: 'living-chair-4', rev: 3, from: { x: 513, y: 212 }, room: 'living', catalogId: 'tub-chair', x: 183, y: 302, rot: 180 },
  { id: 'living-art', rev: 3, from: { x: 618.5, y: 340 }, room: 'living', x: 481, y: 230, item: { type: 'art', name: 'Artwork above the sofa', w: 100, d: 3, h: 70, frame: 'oak', mat: true, elev: 115 } },
  { id: 'living-oakpanel', builtin: true, rev: 3, from: { x: 305, y: 479 }, room: 'living', x: 178, y: 0, extra: { w: 208, h: 205, elev: 10 },
    item: { type: 'art', name: 'Oak 3D wall panel', w: 208, d: 2, h: 205, frame: 'oakpanel', mat: false, elev: 10 } },
  // rev 6: the Mattis bed moves to the second bedroom, headboard against the west wall, clear of the door's arc
  { id: 'bedroom-bed', rev: 6, fromRoom: 'bedroom', from: 'any', room: 'bedroom2', catalogId: 'mattis-bed', x: 108, y: 160, rot: 270 },
  // rev 4: the kitchen as in the tour (fitted run with sink, hob and wall units; dark oak tall units with two ovens)
  { id: 'kitchen-counter', builtin: true, rev: 6, from: [{ x: 105, y: 287 }, { x: 110, y: 287 }], room: 'kitchen', x: 105, y: 287, rot: 180, extra: { w: 210, style: 'fitted', name: 'Kitchen run', fixed: true },
    item: { type: 'counter', style: 'fitted', name: 'Kitchen run', fixed: true, w: 210, d: 60, h: 90, color: '#F4F4F2' } },
  { id: 'kitchen-tall', builtin: true, rev: 5, from: { x: 30, y: 52 }, room: 'kitchen', x: 50, y: 30, rot: 0, extra: { w: 100, d: 60, h: 225, color: '#6B5F55', style: 'tallovens', name: 'Tall units with ovens', fixed: true },
    item: { type: 'appliance', style: 'tallovens', name: 'Tall units with ovens', fixed: true, w: 100, d: 60, h: 225, color: '#6B5F55' } },
  { id: 'bath-toilet', builtin: true, rev: 2, from: { x: 30, y: 27 }, room: 'bathroom', x: 30, y: 27, extra: { fixed: true }, item: { type: 'toilet', fixed: true, name: 'Wall-hung WC', w: 37, d: 54, h: 42, color: '#FAFAF8' } },
  { id: 'bath-vanity', builtin: true, rev: 2, from: { x: 103, y: 20 }, room: 'bathroom', x: 103, y: 20, extra: { fixed: true }, item: { type: 'vanity', fixed: true, name: 'Basin on vanity', w: 59, d: 40, h: 85, color: '#C49A6C' } },
  { id: 'bath-tub', builtin: true, rev: 3, from: { x: 223, y: 40 }, room: 'bathroom', x: 223, y: 40, extra: { fixed: true, style: 'screen', name: 'Bath with shower screen' },
    item: { type: 'bath', fixed: true, style: 'screen', name: 'Bath with shower screen', w: 167, d: 80, h: 58, color: '#FAFAF8' } },
  { id: 'hall0-stairs', builtin: true, rev: 3, from: { x: 40, y: 211 }, room: 'hall0', x: 40, y: 211, extra: { fixed: true, color: '#5E3A20', style: 'glass' },
    item: { type: 'stairs', fixed: true, style: 'glass', name: 'Stairs up', w: 81, d: 271, h: 225, color: '#5E3A20' } },
  { id: 'landing1-stairs', builtin: true, rev: 2, from: { x: 51, y: 136 }, room: 'landing1', x: 51, y: 136, extra: { fixed: true }, item: { type: 'stairs', fixed: true, name: 'Stairs up', w: 87, d: 272, h: 213, color: '#9A6B3F' } },
  { id: 'landing1-cupboard', builtin: true, rev: 2, from: { x: 159, y: 472 }, room: 'landing1', x: 159, y: 466, extra: { fixed: true }, rot: 90, item: { type: 'wardrobe', fixed: true, name: 'Built-in cupboard', w: 145, d: 38, h: 200, color: '#F2F1EC' } },
  { id: 'landing2-stairs', builtin: true, rev: 2, from: { x: 48, y: 129 }, room: 'landing2', x: 48, y: 131, extra: { fixed: true }, item: { type: 'stairs', fixed: true, name: 'Stairs up', w: 91, d: 260, h: 225, color: '#C8A77E' } }
];
