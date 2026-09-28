(() => {
  'use strict';

  // ================= Constants =================
  const STORAGE_KEY = 'houseplanner.project.v1';
  const T = 12, SNAP = 5;
  const WALLS = [['n', 'North', 'top'], ['e', 'East', 'right'], ['s', 'South', 'bottom'], ['w', 'West', 'left']];
  const WALL_SWATCHES = [
    ['Pure white', '#F7F7F4'], ['Chalk', '#F4F3EF'], ['Linen', '#E9E2D6'], ['Warm grey', '#D6D1C8'], ['Greige', '#C4B9AA'],
    ['Blush', '#E3C6BC'], ['Terracotta', '#BF7458'], ['Ochre', '#C99D4A'], ['Sage', '#B4BFA6'],
    ['Eucalyptus', '#8C9F90'], ['Forest', '#3E5544'], ['Dusty blue', '#A7B6C2'], ['Navy', '#2D394D'], ['Charcoal', '#46494D']
  ];
  const FLOOR_FINISHES = { parquet: 'Oak strip parquet', wood: 'Wood planks', marble: 'Marble tiles', stone: 'Stone tiles', tile: 'Tiles', concrete: 'Concrete', terrazzo: 'Terrazzo', carpet: 'Carpet', plain: 'Plain' };
  const WALL_FINISHES = { paint: 'Paint', panelling: 'Wood panelling', oakpanels: 'Oak 3D panels', marble: 'Marble', tiles: 'Tiles' };
  const FURNITURE_TYPES = {
    sofa: 'Sofa', cornersofa: 'Corner sofa', armchair: 'Armchair', chair: 'Chair', table: 'Table, rectangular', roundtable: 'Table, round',
    desk: 'Desk', bed: 'Bed', cabinet: 'Cabinet or sideboard', shelf: 'Shelf', wardrobe: 'Wardrobe',
    counter: 'Counter or island', appliance: 'Appliance', rug: 'Rug', plant: 'Plant', art: 'Artwork (on a wall)', bath: 'Bathtub',
    shower: 'Shower', vanity: 'Vanity', toilet: 'Toilet', stairs: 'Stairs', box: 'Other'
  };
  const LIGHT_TYPES = {
    ceiling: 'Ceiling light', pendant: 'Pendant', spot: 'Spotlight', sconce: 'Wall light',
    floorlamp: 'Floor lamp', tablelamp: 'Table lamp'
  };
  const isLight = (type) => Object.prototype.hasOwnProperty.call(LIGHT_TYPES, type);
  const KELVIN = { 2200: '#FFB266', 2700: '#FFC58F', 3000: '#FFD2A6', 4000: '#FFE8CF' };
  const POWER = { soft: 0.55, medium: 1, bright: 1.6 };
  const ROUND = new Set(['roundtable', 'plant', 'floorlamp', 'tablelamp', 'pendant', 'ceiling', 'spot']);
  // Generic pieces to try out. No beds or sofas (only your own), nothing built into the house (kitchen, bathroom
  // fittings, stairs, the oak wall panel: placed and locked by house-data.js), and no ceiling lights (the ceilings are low).
  const LIBRARY = [
    ['Living', [
      ['armchair', 'Armchair', 85, 85, 80, '#A0826D'], ['table', 'Coffee table', 110, 60, 40, '#8B6A4E'], ['roundtable', 'Side table', 45, 45, 50, '#8B6A4E'],
      ['cabinet', 'TV unit', 180, 40, 50, '#5B5048'], ['cabinet', 'Sideboard', 180, 45, 80, '#5B5048'],
      ['shelf', 'Bookshelf', 80, 30, 200, '#8B6A4E'], ['rug', 'Rug', 200, 300, 1, '#C9BBA8'], ['rug', 'Runner', 80, 250, 1, '#B8A993'],
      ['plant', 'Plant', 40, 40, 120, '#5E7A55'], ['plant', 'Small plant', 25, 25, 50, '#5E7A55']
    ]],
    ['Wall art', [
      ['art', 'Artwork 50 x 70', 50, 3, 70, '#1D1D1D'], ['art', 'Artwork 70 x 100', 70, 3, 100, '#1D1D1D'],
      ['art', 'Canvas 100 x 70', 100, 4, 70, '#F4F3EF'], ['art', 'Small print 30 x 40', 30, 2, 40, '#C49A6C']
    ]],
    ['Floor lamps (IKEA)', [
      ['floorlamp', 'ÅRSTID floor lamp, brass/white', 38, 38, 155, '#B8914A'],
      ['floorlamp', 'LAUTERS floor lamp, ash/white', 42, 42, 150, '#C8A57A', { style: 'wood' }],
      ['floorlamp', 'TÅGARP uplighter (indirect)', 35, 35, 176, '#2F3337', { style: 'uplighter' }],
      ['floorlamp', 'ISJAKT uplighter with reading lamp', 45, 35, 180, '#B8B9BA', { style: 'uplightread' }],
      ['floorlamp', 'SKOTTORP/SKAFTET arc lamp', 170, 40, 200, '#C4C6C8', { style: 'arc' }],
      ['floorlamp', 'SIMRISHAMN floor lamp, opal globe', 30, 30, 150, '#C9CCCE', { style: 'globepole' }],
      ['floorlamp', 'VIDJA floor lamp, textile column', 33, 33, 138, '#F4EFE4', { style: 'paper' }],
      ['floorlamp', 'VARPTROSS floor lamp, bamboo', 40, 40, 118, '#C9A36B', { style: 'lantern' }]
    ]],
    ['Table lamps (IKEA)', [
      ['tablelamp', 'VARMBLIXT, orange glass donut', 30, 12, 34, '#E0863F', { style: 'donut' }],
      ['tablelamp', 'VARMBLIXT, white glass donut', 30, 12, 34, '#F1EEE8', { style: 'donut' }],
      ['tablelamp', 'FADO, opal globe', 25, 25, 25, '#F4F1EA', { style: 'globe' }],
      ['tablelamp', 'DEJSA, beige opal glass', 28, 28, 28, '#E9DFCF', { style: 'mushroom' }],
      ['tablelamp', 'TÄRNABY, dark yellow', 25, 25, 25, '#C99D4A', { style: 'mushroom' }],
      ['tablelamp', 'BLIDVÄDER, cream ceramic', 30, 30, 50, '#EFE9DC'],
      ['tablelamp', 'HALGATT, brown ceramic', 30, 30, 49, '#8A6A4E'],
      ['tablelamp', 'ÅRSTID table lamp, brass/white', 22, 22, 55, '#B8914A', { style: 'pole' }],
      ['tablelamp', 'STORSEGEL, ash/white', 22, 22, 44, '#C8A57A', { style: 'polewood' }],
      ['tablelamp', 'SOLKLINT, brass/grey glass', 22, 22, 28, '#B8914A', { style: 'glassdome' }],
      ['tablelamp', 'VARPTROSS table lamp, bamboo', 30, 30, 26, '#C9A36B', { style: 'lantern' }],
      ['tablelamp', 'VINDKAST table lamp, white', 30, 25, 26, '#F6F5F1', { style: 'cloud' }]
    ]],
    ['Dining', [
      ['table', 'Dining table', 180, 90, 75, '#8B6A4E'], ['roundtable', 'Round table', 110, 110, 75, '#8B6A4E'],
      ['chair', 'Dining chair', 45, 50, 90, '#4A4F55'], ['cabinet', 'Buffet cabinet', 120, 45, 85, '#EDEBE6']
    ]],
    ['Bedroom and storage', [
      ['cabinet', 'Nightstand', 50, 40, 55, '#8B6A4E'], ['wardrobe', 'Wardrobe', 200, 60, 220, '#EDEBE6'],
      ['cabinet', 'Dresser', 120, 50, 85, '#8B6A4E'], ['cabinet', 'Chest of drawers', 80, 48, 100, '#EDEBE6']
    ]],
    ['Office', [['desk', 'Desk', 140, 70, 75, '#8B6A4E'], ['chair', 'Office chair', 60, 60, 110, '#2F3337'], ['shelf', 'Shelf unit', 80, 40, 180, '#EDEBE6']]]
  ];
  // Sizes for a new piece of a type the library no longer shows (your own sofas and beds, built-in fittings)
  const TYPE_DEFAULTS = { sofa: { w: 220, d: 95, h: 85, color: '#6F7C8A' }, cornersofa: { w: 280, d: 180, h: 85, color: '#D9C9B0' },
    bed: { w: 180, d: 200, h: 50, color: '#D9D4CC' }, counter: { w: 120, d: 60, h: 90, color: '#DCDCD6' }, appliance: { w: 60, d: 65, h: 185, color: '#E8E8E4' },
    stairs: { w: 85, d: 270, h: 225, color: '#B98A5A' }, bath: { w: 170, d: 75, h: 58, color: '#F5F5F2' }, shower: { w: 90, d: 90, h: 200, color: '#E6ECEF' },
    vanity: { w: 80, d: 50, h: 85, color: '#EDEBE6' }, toilet: { w: 38, d: 65, h: 40, color: '#F5F5F2' } };
  LIBRARY.forEach(([, items]) => items.forEach(([t, , w, d, h, c]) => { if (!TYPE_DEFAULTS[t]) TYPE_DEFAULTS[t] = { w, d, h, color: c }; }));
  const SHARED = ['name', 'type', 'w', 'd', 'h', 'color', 'kelvin', 'power', 'doors', 'books', 'style', 'image', 'frame', 'mat'];
  const ART_FRAMES = { black: 'Black frame', white: 'White frame', oak: 'Oak frame', limewash: 'Limed oak frame', pine: 'Pine frame', walnut: 'Walnut frame', brass: 'Brass frame', none: 'No frame (canvas)', oakpanel: 'Oak 3D wall panel' };
  const ART_WALL_ROT = { n: 0, e: 90, s: 180, w: 270 };
  const SHELF_DOORS = { none: 'No doors', lower: 'Doors on the lower half', full: 'Full-height doors' };

  // ================= Helpers =================
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const uid = () => Math.random().toString(36).slice(2, 9);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const snap = (v) => Math.round(v / SNAP) * SNAP;
  const num = (v, min, max, fb) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fb; };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const hex = (v, fb) => /^#[0-9a-f]{6}$/i.test(v || '') ? v : fb;
  const wallName = (k) => (WALLS.find((w) => w[0] === k) || [k, k])[1];
  const typeName = (t) => FURNITURE_TYPES[t] || LIGHT_TYPES[t] || 'Item';
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const textOn = (h) => { const c = h.replace('#', ''); const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16); return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#1D2124' : '#FFFFFF'; };
  const today = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
  let toastTimer;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600); }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (_) { /* ignore */ }
      ta.remove(); return ok;
    }
  }

  // ================= Photo and version store (IndexedDB) =================
  const Store = (() => {
    let dbp;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('IndexedDB unavailable'));
      const q = indexedDB.open('houseplanner', 1);
      q.onupgradeneeded = () => { const d = q.result; d.createObjectStore('photos'); d.createObjectStore('versions', { keyPath: 'id' }); };
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    }));
    const run = async (store, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const r = fn(t.objectStore(store)); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); };
    return {
      putPhoto: (id, url) => run('photos', 'readwrite', (s) => s.put(url, id)),
      // rendered thumbnails share the photo store under a 'thumb:' key (small PNGs, safe to lose)
      getThumb: (key) => run('photos', 'readonly', (s) => s.get('thumb:' + key)),
      putThumb: (key, url) => run('photos', 'readwrite', (s) => s.put(url, 'thumb:' + key)),
      getPhoto: (id) => run('photos', 'readonly', (s) => s.get(id)),
      delPhoto: (id) => run('photos', 'readwrite', (s) => s.delete(id)).catch(() => {}),
      putVersion: (v) => run('versions', 'readwrite', (s) => s.put(v)),
      listVersions: () => run('versions', 'readonly', (s) => s.getAll()),
      delVersion: (id) => run('versions', 'readwrite', (s) => s.delete(id))
    };
  })();
  const photoCache = new Map();
  // Photos are either stored in this browser (IndexedDB) or, for tour photos shipped with the app, a file path ('url:...')
  async function getPhoto(id) {
    if (id.startsWith('url:')) return id.slice(4);
    if (photoCache.has(id)) return photoCache.get(id);
    try { const u = await Store.getPhoto(id); if (u) photoCache.set(id, u); return u; } catch (e) { return null; }
  }
  function resizeImage(file, max = 1600) {
    return new Promise((res, rej) => {
      const img = new Image(), u = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); res(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(u); rej(new Error(`${file.name} could not be read. Use JPG or PNG.`)); };
      img.src = u;
    });
  }
  async function storePhotos(files) {
    const ids = [];
    for (const f of files) {
      try {
        const url = await resizeImage(f), id = 'p' + uid();
        photoCache.set(id, url);
        try { await Store.putPhoto(id, url); } catch (e) { toast('Photos are kept for this session only: browser storage is unavailable.'); }
        ids.push(id);
      } catch (e) { toast(e.message); }
    }
    return ids;
  }
  async function hydratePhotos(root = document) {
    for (const img of $$('img[data-photo]', root)) {
      if (img.getAttribute('src')) continue;
      const u = await getPhoto(img.dataset.photo);
      if (u) img.src = u; else { const t = img.closest('.thumb'); if (t) t.classList.add('missing'); }
    }
  }

  // ================= Data normalization =================
  function defaultElev(type, roomH, h) {
    switch (type) {
      case 'ceiling': case 'spot': return roomH - h;
      case 'pendant': return Math.max(0, Math.min(roomH - h, 150));
      case 'sconce': return 170;
      case 'art': return Math.max(0, 150 - h / 2); // picture centre at 150 cm, gallery height
      case 'tablelamp': return 75;
      default: return 0;
    }
  }
  function normItem(it, r) {
    const type = it.type === 'lamp' ? 'floorlamp' : (FURNITURE_TYPES[it.type] || LIGHT_TYPES[it.type] ? it.type : 'box');
    const w = num(it.w, 1, 3000, 60), d = num(it.d, 1, 3000, 60), h = num(it.h, 1, 800, 75);
    const o = {
      id: it.id || 'i' + uid(), type, name: it.name || typeName(type), w, d, h,
      x: num(it.x, -1000, 5000, r.width / 2), y: num(it.y, -1000, 5000, r.length / 2),
      rot: ((num(it.rot, -3600, 3600, 0) % 360) + 360) % 360,
      elev: num(it.elev, 0, 800, defaultElev(type, r.height, h)),
      color: hex(it.color, '#9A9A94')
    };
    if (it.catalogId) o.catalogId = it.catalogId;
    if (type === 'cornersofa') o.side = it.side === 'left' ? 'left' : 'right';
    if (type === 'shelf') { o.doors = SHELF_DOORS[it.doors] ? it.doors : 'none'; o.books = it.books !== false; }
    if (it.style) o.style = String(it.style);
    if (it.fixed) o.fixed = true;
    if (it.seedPl) o.seedPl = String(it.seedPl); // which house-data placement made it // built into the house: cannot be moved, resized, rotated or removed
    if (type === 'art') { o.frame = ART_FRAMES[it.frame] ? it.frame : 'black'; o.mat = ['none', 'oakpanel'].includes(o.frame) || it.mat === false ? false : it.mat === 'cream' ? 'cream' : true; if (it.image) o.image = String(it.image); }
    if (isLight(type)) { o.kelvin = KELVIN[it.kelvin] ? Number(it.kelvin) : 2700; o.power = POWER[it.power] ? it.power : 'medium'; }
    return o;
  }
  function normRoom(r) {
    const o = {
      id: r.id || 'r' + uid(), name: r.name || 'Room', level: r.level || 'Ground floor',
      width: num(r.width, 50, 3000, 400), length: num(r.length, 50, 3000, 350), height: num(r.height, 150, 800, 250),
      floor: hex(r.floor, '#D9B98A'), floorFinish: FLOOR_FINISHES[r.floorFinish] ? r.floorFinish : 'parquet', walls: {}, wallFinish: {}, notes: r.notes || '', photos: Array.isArray(r.photos) ? r.photos.slice() : [],
      openings: [], items: []
    };
    if (r.seedId) o.seedId = r.seedId;
    if (r.seedRev) o.seedRev = r.seedRev;
    o.photoLabels = {}; Object.entries(r.photoLabels || {}).forEach(([k, v]) => { if (o.photos.includes(k)) o.photoLabels[k] = String(v); });
    const wc = r.walls || {};
    WALLS.forEach(([k]) => { o.walls[k] = hex(wc[k], typeof r.walls === 'string' ? hex(r.walls, '#F7F7F4') : '#F7F7F4'); });
    const wf = r.wallFinish || {};
    WALLS.forEach(([k]) => { const f = typeof wf === 'string' ? wf : wf[k]; o.wallFinish[k] = WALL_FINISHES[f] ? f : 'paint'; });
    o.openings = (r.openings || []).map((p) => {
      const type = p.type === 'window' ? 'window' : 'door';
      return { id: p.id || 'o' + uid(), type, wall: ['n', 'e', 's', 'w'].includes(p.wall) ? p.wall : 's',
        offset: num(p.offset, 0, 3000, 20), width: num(p.width, 20, 1000, type === 'door' ? 90 : 120),
        height: num(p.height, 20, 800, type === 'door' ? 205 : 130), sill: type === 'door' ? 0 : num(p.sill, 0, 800, 90),
        color: hex(p.color, '#F7F6F2'), radiator: type === 'window' && (p.radiator != null ? !!p.radiator : num(p.sill, 0, 800, 90) >= 50),
        leaf: type === 'door' ? p.leaf !== false : false,
        swing: p.swing === 'out' ? 'out' : 'in', // door opens into this room ('in') or into the room next door ('out')
        niche: type === 'window' ? num(p.niche, 0, 100, 0) : 0, nicheShelf: type === 'window' && !!p.nicheShelf };
    });
    o.items = (r.items || []).map((it) => normItem(it, o));
    return o;
  }
  function normPiece(p) {
    const type = FURNITURE_TYPES[p.type] || LIGHT_TYPES[p.type] ? p.type : 'box';
    const o = { id: p.id || 'c' + uid(), type, name: p.name || typeName(type),
      w: num(p.w, 1, 3000, 60), d: num(p.d, 1, 3000, 60), h: num(p.h, 1, 800, 75), color: hex(p.color, '#9A9A94'),
      status: ['own', 'considering', 'ordered'].includes(p.status) ? p.status : 'own',
      link: p.link || '', notes: p.notes || '', photos: Array.isArray(p.photos) ? p.photos.slice() : [] };
    if (type === 'cornersofa') o.side = p.side === 'left' ? 'left' : 'right';
    if (type === 'shelf') { o.doors = SHELF_DOORS[p.doors] ? p.doors : 'none'; o.books = p.books !== false; }
    if (p.style) o.style = String(p.style);
    if (type === 'art') { o.frame = ART_FRAMES[p.frame] ? p.frame : 'black'; o.mat = ['none', 'oakpanel'].includes(o.frame) || p.mat === false ? false : p.mat === 'cream' ? 'cream' : true; if (p.image) o.image = String(p.image); }
    if (isLight(type)) { o.kelvin = KELVIN[p.kelvin] ? Number(p.kelvin) : 2700; o.power = POWER[p.power] ? p.power : 'medium'; }
    if (p.seedRev) o.seedRev = p.seedRev;
    return o;
  }
  function normState(s) {
    const o = { version: 2, name: s.name || 'New house', catalog: (s.catalog || []).map(normPiece), rooms: (s.rooms || []).map(normRoom) };
    o.removedPieces = Array.isArray(s.removedPieces) ? s.removedPieces.slice() : [];
    o.placedSeeds = Array.isArray(s.placedSeeds) ? s.placedSeeds.slice() : [];
    o.removedRooms = Array.isArray(s.removedRooms) ? s.removedRooms.slice() : [];
    // your paint palette: [{ id, name, hex }]
    o.paints = (Array.isArray(s.paints) ? s.paints : []).map((p) => ({ id: p.id || 'c' + uid(), name: String(p.name || p.hex || ''), hex: hex(p.hex, '') })).filter((p) => p.hex);
    // Starter rooms from house-data.js. A room is matched by name (so your own "Büro" counts as the office);
    // a starter room you deleted is never recreated.
    const seedRooms = (window.HOUSE_ROOMS || []).filter(Boolean);
    const findRoom = (rid) => {
      const tpl = seedRooms.find((x) => x.id === rid), names = [rid].concat(tpl ? [tpl.name].concat(tpl.match || []) : []).map((n) => n.toLowerCase());
      let r = o.rooms.find((x) => x.seedId === rid) || o.rooms.find((x) => names.includes(x.name.trim().toLowerCase()));
      if (!r && tpl && !o.removedRooms.includes(rid)) { r = normRoom(Object.assign({}, tpl, { id: 'r' + uid() })); r.seedId = rid; r.seedRev = tpl.rev || 1; o.rooms.push(r); }
      if (r && !r.seedId) r.seedId = rid;
      return r;
    };
    // The old example room goes once the real rooms exist, unless it holds any of your pieces
    if (!s.exampleRetired) {
      o.rooms = o.rooms.filter((r) => !(r.name === 'Example living room' && /^Example room/.test(r.notes) && !r.items.some((i) => i.catalogId)));
      o.exampleRetired = true;
    } else o.exampleRetired = true;
    (window.HOUSE_RETIRED_ROOMS || []).forEach((rid) => {
      o.rooms = o.rooms.filter((r) => r.seedId !== rid);
      if (!o.removedRooms.includes(rid)) o.removedRooms.push(rid);
    });
    seedRooms.filter((t) => t.ensure).forEach((t) => findRoom(t.id));
    // A higher `rev` on a starter room updates its doors, windows, wall finishes and notes; with `resize` also its
    // measured size, level and floor. Furniture you placed stays; anything left outside the new walls is pulled back in.
    const resized = [];
    o.rooms.forEach((r) => {
      const tpl = r.seedId && seedRooms.find((x) => x.id === r.seedId);
      if (!tpl || (r.seedRev || 1) >= (tpl.rev || 1)) return;
      const n = normRoom(tpl.resize ? tpl : Object.assign({}, tpl, { width: r.width, length: r.length, height: r.height }));
      r.openings = n.openings; r.wallFinish = n.wallFinish; r.notes = n.notes; r.seedRev = tpl.rev;
      if (tpl.resize) { Object.assign(r, { name: n.name, width: n.width, length: n.length, height: n.height, level: n.level, floor: n.floor, floorFinish: n.floorFinish }); resized.push(r); }
    });
    // Tour photos listed on a starter room are added once, with their label; a photo you delete stays deleted
    o.removedPhotos = Array.isArray(s.removedPhotos) ? s.removedPhotos.slice() : [];
    o.rooms.forEach((r) => {
      const tpl = r.seedId && seedRooms.find((x) => x.id === r.seedId);
      (tpl && tpl.tourPhotos || []).forEach((ph) => {
        const id = 'url:' + ph.src;
        if (o.removedPhotos.includes(id) || r.photos.includes(id)) return;
        r.photos.push(id); r.photoLabels[id] = ph.label;
      });
    });
    if (!o.rooms.length) o.rooms.push(normRoom({ name: 'Room 1' }));
    o.activeRoomId = o.rooms.some((r) => r.id === s.activeRoomId) ? s.activeRoomId : o.rooms[0].id;
    // Pieces Claude adds to house-data.js appear in My pieces once; deleting one keeps it out.
    // A higher `rev` on a seeded piece updates its size, look, name and notes (status and photos stay yours).
    (window.HOUSE_PIECES || []).forEach((p) => {
      if (!p.id || o.removedPieces.includes(p.id)) return;
      const ex = o.catalog.find((c) => c.id === p.id), rev = p.rev || 1;
      if (!ex) { o.catalog.push(normPiece(Object.assign({}, p, { seedRev: rev }))); return; }
      if ((ex.seedRev || 1) < rev) {
        const n = normPiece(p);
        ['type', 'name', 'w', 'd', 'h', 'color', 'link', 'notes', 'side'].forEach((k) => { if (n[k] !== undefined) ex[k] = n[k]; });
        ex.seedRev = rev;
        o.rooms.forEach((r) => r.items.forEach((it) => { if (it.catalogId === ex.id) SHARED.forEach((k) => { if (ex[k] !== undefined) it[k] = ex[k]; }); }));
      }
    });
    // Placements Claude adds to house-data.js are made once. A placement with a `rev` and `from` moves the piece
    // it made earlier, but only if it is still where it was put (anything you moved stays put).
    // Built-in fittings (builtin: true) always match house-data.js: same model, size, position and lock,
    // whatever the saved copy says. Matched by the placement that made them, else by type in that room.
    (window.HOUSE_PLACEMENTS || []).filter((pl) => pl.builtin).forEach((pl) => {
      const r = findRoom(pl.room); if (!r) return;
      const spec = Object.assign({}, pl.item || {}, pl.extra || {}, { x: pl.x, y: pl.y, rot: pl.rot || 0, fixed: true, seedPl: pl.id });
      let it = r.items.find((i) => i.seedPl === pl.id);
      if (!it) it = r.items.find((i) => !i.seedPl && i.type === spec.type && (!spec.style || !i.style || i.style === spec.style) && (!spec.frame || i.frame === spec.frame) && !i.catalogId);
      const n = normItem(Object.assign({}, spec, { id: it ? it.id : undefined }), r);
      if (n.type === 'art') snapArt(n, r);
      if (it) r.items[r.items.indexOf(it)] = n; else r.items.push(n);
      if (!o.placedSeeds.includes(pl.id)) o.placedSeeds.push(pl.id);
    });
    (window.HOUSE_PLACEMENTS || []).forEach((pl) => {
      if (!pl.id || pl.builtin) return;
      const mark = pl.rev ? pl.id + '@' + pl.rev : null;
      if (o.placedSeeds.includes(pl.id)) {
        if (!mark || o.placedSeeds.includes(mark)) return;
        // `fromRoom` moves the piece over from another room; `from: 'any'` takes it wherever it stands there
        const r = findRoom(pl.room), src = pl.fromRoom ? findRoom(pl.fromRoom) : r, froms = [].concat(pl.from || {});
        const it = r && src && src.items.find((i) => (pl.catalogId ? i.catalogId === pl.catalogId : (i.type === pl.item.type && !i.catalogId)) &&
          (pl.from === 'any' || froms.some((f) => Math.abs(i.x - f.x) < 2 && Math.abs(i.y - f.y) < 2 && (f.rot == null || i.rot === f.rot))));
        if (it && src !== r) { src.items.splice(src.items.indexOf(it), 1); r.items.push(it); }
        if (it) { Object.assign(it, pl.extra || {}); it.x = Math.min(pl.x, r.width); it.y = Math.min(pl.y, r.length); it.rot = pl.rot || 0; if (it.type === 'art') snapArt(it, r); }
        o.placedSeeds.push(mark); return;
      }
      const pc = pl.catalogId ? o.catalog.find((c) => c.id === pl.catalogId) : null, r = (pc || pl.item) && findRoom(pl.room);
      if (!r) return;
      const base = pc ? Object.assign({}, pc, { id: undefined, catalogId: pc.id, photos: undefined, status: undefined, link: undefined, notes: undefined }) : pl.item;
      const it = normItem(Object.assign({}, base, { x: Math.min(pl.x, r.width), y: Math.min(pl.y, r.length), rot: pl.rot || 0 }, pl.extra || {}), r);
      if (it.type === 'art') snapArt(it, r);
      r.items.push(it); o.placedSeeds.push(pl.id); if (mark) o.placedSeeds.push(mark);
    });
    resized.forEach((r) => r.items.forEach((it) => {
      if (it.type === 'art') return snapArt(it, r);
      it.x = Math.min(Math.max(it.x, 0), r.width); it.y = Math.min(Math.max(it.y, 0), r.length);
    }));
    return o;
  }

  // ================= State =================
  let state = normState(load() || clone(window.HOUSE_SEED));
  let selected = null;          // { kind: 'item' | 'opening', id }
  let wallTarget = 'all';
  let view = window.innerWidth < 900 ? 'plan' : 'both';
  let roomTab = 'layout';
  let catTab = 'mine';
  let evening = false;
  let saveNote = 'All changes saved in this browser';
  let draft = null;             // piece or room being edited in a dialog

  function load() { try { const s = localStorage.getItem(STORAGE_KEY); const p = s ? JSON.parse(s) : null; return p && Array.isArray(p.rooms) && p.rooms.length ? p : null; } catch (e) { return null; } }
  let saveTimer = null;
  function flushSave() {
    clearTimeout(saveTimer); saveTimer = null;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); saveNote = 'All changes saved in this browser'; }
    catch (e) { saveNote = 'Browser storage is unavailable, so changes are not kept. Export a backup.'; }
    renderStatus();
  }
  function save() {
    saveNote = 'Saving…'; renderStatus();
    clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 300);
  }
  // Don't lose the last edit when the tab is closed or hidden within the save delay
  window.addEventListener('pagehide', () => { if (saveTimer) flushSave(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) flushSave(); });
  const room = () => state.rooms.find((r) => r.id === state.activeRoomId) || state.rooms[0];
  const piece = (id) => state.catalog.find((p) => p.id === id);
  const selItem = () => selected && selected.kind === 'item' ? room().items.find((i) => i.id === selected.id) : null;
  const selOpening = () => selected && selected.kind === 'opening' ? room().openings.find((o) => o.id === selected.id) : null;
  const placements = (pid) => state.rooms.reduce((n, r) => n + r.items.filter((i) => i.catalogId === pid).length, 0);
  function commit() { save(); renderAll(); }
  function refreshDrawing() { save(); renderPlan(); schedule3D(); renderStatus(); }

  function syncFromPiece(p) { state.rooms.forEach((r) => r.items.forEach((it) => { if (it.catalogId === p.id) SHARED.forEach((k) => { if (p[k] !== undefined) it[k] = p[k]; }); })); }
  function syncToPiece(it) { const p = it.catalogId && piece(it.catalogId); if (!p) return; SHARED.forEach((k) => { if (it[k] !== undefined) p[k] = it[k]; }); syncFromPiece(p); }

  // ================= Geometry =================
  function aabb(it) {
    const a = it.rot * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    const hw = (it.w * c + it.d * s) / 2, hd = (it.w * s + it.d * c) / 2;
    return { x0: it.x - hw, x1: it.x + hw, y0: it.y - hd, y1: it.y + hd, z0: it.elev || 0, z1: (it.elev || 0) + it.h };
  }
  // The quarter circle a door leaf sweeps as it opens into the room: hinge at the start of the opening
  // (offset along the wall), radius = door width. Kept in the wall's own frame (x along the wall, y into the room).
  function doorZones(r) {
    return r.openings.filter((o) => o.type === 'door' && o.leaf !== false && o.swing !== 'out').map((o) => ({ wall: o.wall, a: o.offset, w: o.width }));
  }
  // An item's footprint in a wall's frame (all four walls are axis-aligned, so a box stays a box)
  function toWallFrame(r, k, b) {
    if (k === 'n') return { x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 };
    if (k === 's') return { x0: b.x0, x1: b.x1, y0: r.length - b.y1, y1: r.length - b.y0 };
    if (k === 'w') return { x0: b.y0, x1: b.y1, y0: b.x0, y1: b.x1 };
    return { x0: b.y0, x1: b.y1, y0: r.width - b.x1, y1: r.width - b.x0 };
  }
  // Rugs, wall art and anything mounted above door height can sit in a door's swing; everything else must not.
  // 6 cm of tolerance: a leaf clears things it only grazes.
  const inSwing = (it, zones, r) => {
    if (it.type === 'rug' || it.type === 'art' || (it.elev || 0) >= 200) return false;
    const b = aabb(it);
    return zones.some((z) => {
      const f = toWallFrame(r, z.wall, b), x0 = Math.max(f.x0, z.a), x1 = Math.min(f.x1, z.a + z.w), y0 = Math.max(f.y0, 0), y1 = Math.min(f.y1, z.w);
      if (x1 - x0 <= 6 || y1 - y0 <= 6) return false;
      const nx = Math.max(x0, Math.min(z.a, x1)) - z.a, ny = Math.max(y0, Math.min(0, y1));
      return Math.hypot(nx, ny) < z.w - 6;
    });
  };
  function swingClashes(r) { const z = doorZones(r); return new Set(r.items.filter((it) => inSwing(it, z, r)).map((it) => it.id)); }
  function clashes(r) {
    const out = new Set(), solids = r.items.filter((i) => i.type !== 'rug').map((i) => ({ i, b: aabb(i) }));
    for (const { i, b } of solids) if (b.x0 < -0.5 || b.y0 < -0.5 || b.x1 > r.width + 0.5 || b.y1 > r.length + 0.5 || b.z1 > r.height + 0.5) out.add(i.id);
    for (let a = 0; a < solids.length; a++) for (let z = a + 1; z < solids.length; z++) {
      const A = solids[a].b, B = solids[z].b;
      const ov = (p, q, P, Q) => Math.min(q, Q) - Math.max(p, P) > 1;
      // chairs tuck under tables and desks, so that pair is not a clash
      const tA = solids[a].i.type, tB = solids[z].i.type, tuck = (x, y) => x === 'chair' && ['table', 'roundtable', 'desk'].includes(y);
      if (tuck(tA, tB) || tuck(tB, tA)) continue;
      if (ov(A.x0, A.x1, B.x0, B.x1) && ov(A.y0, A.y1, B.y0, B.y1) && ov(A.z0, A.z1, B.z0, B.z1)) { out.add(solids[a].i.id); out.add(solids[z].i.id); }
    }
    swingClashes(r).forEach((id) => out.add(id));
    return out;
  }
  function wallLength(r, k) { return (k === 'n' || k === 's') ? r.width : r.length; }
  // Artwork hangs flat on a wall: pick the given (or nearest) wall, face into the room, stay within the wall
  function artWall(it) { return ({ 0: 'n', 90: 'e', 180: 's', 270: 'w' })[it.rot] || 'n'; }
  function snapArt(it, r, wall) {
    const k = wall || [['n', it.y], ['s', r.length - it.y], ['w', it.x], ['e', r.width - it.x]].sort((a, b) => a[1] - b[1])[0][0];
    const len = wallLength(r, k), half = Math.min(it.w / 2, len / 2), off = it.d / 2;
    const along = Math.min(len - half, Math.max(half, (k === 'n' || k === 's') ? it.x : it.y));
    it.rot = ART_WALL_ROT[k];
    if (k === 'n') { it.x = along; it.y = off; } else if (k === 's') { it.x = along; it.y = r.length - off; }
    else if (k === 'w') { it.x = off; it.y = along; } else { it.x = r.width - off; it.y = along; }
  }

  // ================= Shared UI pieces =================
  const photoLabel = (owner, id) => { const [k, rid] = owner.split(':'); const r = k === 'room' && state.rooms.find((x) => x.id === rid); return (r && r.photoLabels && r.photoLabels[id]) || ''; };
  const photoStrip = (ids, owner) => `<div class="photos" data-owner="${owner}">${(ids || []).map((id) => { const lab = photoLabel(owner, id);
    return `<button type="button" class="thumb${lab ? ' labelled' : ''}" data-photo-open="${id}" data-owner="${owner}" aria-label="${esc(lab || 'Open photo')}" title="${esc(lab)}"><img data-photo="${id}" alt="${esc(lab)}" loading="lazy">${lab ? `<span class="cap">${esc(lab)}</span>` : ''}</button>`; }).join('')}
    <button type="button" class="thumb add" data-photo-add="${owner}">Add photos</button></div>`;
  function ownerPhotos(owner) {
    if (owner === 'draft') return draft && draft.obj.photos;
    const [k, id] = owner.split(':');
    if (k === 'room') { const r = state.rooms.find((x) => x.id === id); return r && r.photos; }
    return null;
  }
  function refreshStrips(owner) { $$(`.photos[data-owner="${owner}"]`).forEach((el) => { el.outerHTML = photoStrip(ownerPhotos(owner), owner); }); hydratePhotos(); }
  const levels = () => [...new Set(state.rooms.map((r) => r.level))];
  // Floors listed bottom to top; any other level name follows in the order it first appears
  const LEVEL_ORDER = ['Basement', 'Ground floor', 'First floor', 'Attic', 'Loft'];
  const byLevel = () => {
    const m = new Map(), rank = (lv) => { const i = LEVEL_ORDER.indexOf(lv); return i < 0 ? 99 : i; };
    [...state.rooms].sort((a, b) => rank(a.level) - rank(b.level)).forEach((r) => { if (!m.has(r.level)) m.set(r.level, []); m.get(r.level).push(r); });
    return m;
  };

  // ================= Render: top bar + rooms =================
  function renderRooms() {
    $('#projectName').value = state.name || '';
    const cur = room().id, groups = byLevel();
    $('#roomSwitch').innerHTML = [...groups].map(([lv, rs]) => `<optgroup label="${esc(lv)}">${rs.map((r) => `<option value="${r.id}" ${r.id === cur ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</optgroup>`).join('');
    $('#roomList').innerHTML = [...groups].map(([lv, rs]) => `
      <p class="level">${esc(lv)}</p>
      <ul class="rooms">${rs.map((r) => `<li><button data-room-id="${r.id}" aria-current="${r.id === cur}">
        <span>${esc(r.name)}<span class="meta">${plural(r.photos.length, 'photo')}, ${plural(r.items.length, 'item')}</span></span>
        <small>${(r.width * r.length / 10000).toFixed(1)} m²</small></button></li>`).join('')}</ul>`).join('');
  }
  function switchRoom(id) { state.activeRoomId = id; selected = null; wallTarget = 'all'; roomTab = 'layout'; commit(); }

  // ================= Render: room panel =================
  function renderRoomPanel() {
    const r = room();
    const tabs = `<div class="tabs" role="tablist">
      <button role="tab" data-room-tab="layout" aria-selected="${roomTab === 'layout'}">Layout and colors</button>
      <button role="tab" data-room-tab="photos" aria-selected="${roomTab === 'photos'}">Photos and notes (${r.photos.length})</button></div>`;
    if (roomTab === 'photos') {
      $('#roomPanel').innerHTML = `<h2>${esc(r.name)}</h2>${tabs}
        ${photoStrip(r.photos, 'room:' + r.id)}
        <label class="field" style="margin-top:12px"><span>Notes</span><textarea data-room="notes" rows="5" placeholder="Radiator under the window, sockets on the east wall, sloped ceiling…">${esc(r.notes)}</textarea></label>
        <p class="note">Photos are for reference. To have Claude model the room, send the photos and sizes in chat, then paste back the block Claude gives you under Claude handoff.</p>`;
      hydratePhotos($('#roomPanel'));
      return;
    }
    $('#roomPanel').innerHTML = `<h2>${esc(r.name)}</h2>${tabs}
      <div class="row2">
        <label class="field"><span>Name</span><input data-room="name" value="${esc(r.name)}"></label>
        <label class="field"><span>Floor or level</span><input data-room="level" list="levelList" value="${esc(r.level)}"></label>
      </div>
      <datalist id="levelList">${levels().map((l) => `<option value="${esc(l)}">`).join('')}</datalist>
      <p class="note">${r.width} x ${r.length} cm, ceiling ${r.height} cm (${(r.width * r.length / 10000).toFixed(1)} m²). Sizes come from the architect plans and are fixed.</p>
      <h3>Wall colors</h3>
      ${WALLS.map(([k, name, side]) => `
        <div class="wallrow ${wallTarget === k ? 'on' : ''}" data-target="${k}">
          <input type="color" data-wall="${k}" value="${r.walls[k]}" aria-label="${name} wall color">
          <span>${name} <small>${side}</small><code>${r.walls[k].toUpperCase()}</code></span>
          <select data-wallfinish="${k}" aria-label="${name} wall finish">${Object.entries(WALL_FINISHES).map(([f, n]) => `<option value="${f}" ${r.wallFinish[k] === f ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </div>`).join('')}
      <div class="target"><span>Swatch applies to</span>
        <select id="wallTarget"><option value="all" ${wallTarget === 'all' ? 'selected' : ''}>All walls</option>
          ${WALLS.map(([k, n]) => `<option value="${k}" ${wallTarget === k ? 'selected' : ''}>${n} wall</option>`).join('')}</select>
      </div>
      <div class="swatches" data-kind="wall">${WALL_SWATCHES.map(([n, h]) => `<button class="sw" data-hex="${h}" style="--c:${h}"><i></i>${n}</button>`).join('')}</div>
      <h3>Your paint colors</h3>
      <div class="swatches" data-kind="wall">${state.paints.map((p) => `<span class="paintchip"><button class="sw" data-hex="${p.hex}" style="--c:${p.hex}" title="${esc(p.name)} ${p.hex}"><i></i>${esc(p.name)}</button><button class="paintx" data-del-paint="${p.id}" aria-label="Remove ${esc(p.name)}">×</button></span>`).join('') || '<p class="note" style="margin:0">None saved yet. Add the paints you are considering below.</p>'}</div>
      <div class="paintadd">
        <input type="color" id="paintPick" value="${state.paints.length ? state.paints[state.paints.length - 1].hex : '#E8E0D5'}" aria-label="Pick a color">
        <input id="paintCode" placeholder="#E8E0D5, rgb(232 224 213), hsl(…), cmyk(…) or a name" aria-label="Color code">
        <input id="paintName" placeholder="Name, e.g. Farrow &amp; Ball Skimming Stone" aria-label="Paint name">
        <button class="btn small" id="paintAdd">Add and paint</button>
      </div>
      <p class="note">Adds the color to your palette (saved with the plan, in versions and backups) and paints ${wallTarget === 'all' ? 'all walls' : 'the ' + wallName(wallTarget).toLowerCase() + ' wall'}. <button class="linkbtn" id="paintSaveWalls">Save this room's wall colors to the palette</button></p>
      <h3>Doors and windows</h3>
      ${r.seedId ? '<p class="note" style="margin-top:0">Built into the house, so they are locked. Tap one to see its details.</p>' : '<div class="btnrow"><button class="btn light" data-add-opening="door">Add door</button><button class="btn light" data-add-opening="window">Add window</button></div>'}
      <ul class="openings">${r.openings.map((o) => `<li><button data-select-opening="${o.id}" class="${selected && selected.id === o.id ? 'on' : ''}">
        ${o.type === 'door' ? 'Door' : 'Window'}, ${wallName(o.wall)} wall, ${o.width} cm wide</button></li>`).join('') || '<li class="empty">No doors or windows yet.</li>'}</ul>`;
  }

  // ================= Render: inspector =================
  function renderInspector() {
    const el = $('#inspector'), it = selItem(), op = selOpening();
    if (it && it.type === 'art') return renderArtInspector(el, it);
    if (it && it.fixed) {
      el.innerHTML = `<h2>${esc(it.name)}</h2><div class="ins-thumb">${thumbImg(it, 'thumb3d big')}</div>
        <p class="note">Built into the house, so it is locked in place. ${Math.round(it.w)} x ${Math.round(it.d)} x ${Math.round(it.h)} cm.</p>`;
      return;
    }
    if (it) {
      const p = it.catalogId && piece(it.catalogId), light = isLight(it.type);
      el.innerHTML = `<h2>${esc(it.name)}</h2>
        <div class="ins-thumb">${thumbImg(it, 'thumb3d big')}</div>
        ${p ? `<div class="linked">${p.photos[0] ? `<img data-photo="${p.photos[0]}" alt="">` : ''}<span>From My pieces. Size, color and label changes apply to every placement of this piece (${placements(p.id)}).</span></div>` : ''}
        <label class="field"><span>Label</span><input data-item="name" value="${esc(it.name)}"></label>
        <div class="row3">
          <label class="field"><span>Width, cm</span><input type="number" data-item="w" value="${it.w}"></label>
          <label class="field"><span>Depth, cm</span><input type="number" data-item="d" value="${it.d}"></label>
          <label class="field"><span>Height, cm</span><input type="number" data-item="h" value="${it.h}"></label>
        </div>
        <div class="row3">
          <label class="field"><span>From left, cm</span><input type="number" data-item="x" value="${Math.round(it.x)}"></label>
          <label class="field"><span>From top, cm</span><input type="number" data-item="y" value="${Math.round(it.y)}"></label>
          <label class="field"><span>Rotation, °</span><input type="number" step="15" data-item="rot" value="${it.rot}"></label>
        </div>
        ${it.type === 'shelf' ? `<div class="row2"><label class="field"><span>Doors</span><select data-item="doors">${Object.entries(SHELF_DOORS).map(([k, n]) => `<option value="${k}" ${it.doors === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="check" style="margin-top:22px"><input type="checkbox" data-item="books" ${it.books !== false ? 'checked' : ''}> Books on shelves</label></div>` : ''}
        ${it.type === 'cornersofa' ? `<label class="field"><span>Chaise side (seen from the front)</span><select data-item="side"><option value="right" ${it.side !== 'left' ? 'selected' : ''}>Right</option><option value="left" ${it.side === 'left' ? 'selected' : ''}>Left</option></select></label>` : ''}
        <div class="row2">
          <label class="field"><span>Above floor, cm</span><input type="number" data-item="elev" value="${it.elev}"></label>
          <div class="field"><span>Color</span><div class="wallrow" style="padding:0"><input type="color" data-item="color" value="${it.color}" aria-label="Color"><code>${it.color.toUpperCase()}</code><span></span></div></div>
        </div>
        ${light ? `<div class="row2">
          <label class="field"><span>Light color</span><select data-item="kelvin">${Object.keys(KELVIN).map((k) => `<option value="${k}" ${Number(k) === it.kelvin ? 'selected' : ''}>${k} K${k === '2700' ? ', warm' : k === '4000' ? ', neutral' : ''}</option>`).join('')}</select></label>
          <label class="field"><span>Brightness</span><select data-item="power">${Object.keys(POWER).map((k) => `<option value="${k}" ${k === it.power ? 'selected' : ''}>${k[0].toUpperCase() + k.slice(1)}</option>`).join('')}</select></label>
        </div>` : ''}
        <p class="note">Position is the center point from the top-left interior corner.${light ? ' Switch the 3D view to Evening light to see lights on.' : ''}</p>
        <div class="btnrow" style="margin-top:12px">
          <button class="btn light" data-act="rotate">Rotate 90°</button>
          <button class="btn light" data-act="duplicate">Duplicate</button>
          ${p ? '<button class="btn light" data-act="editPiece">Edit piece</button>' : '<button class="btn light" data-act="savePiece">Save to My pieces</button>'}
          <button class="btn danger" data-act="delete">Remove</button>
        </div>`;
      hydratePhotos(el);
    } else if (op && room().seedId) {
      const isWin = op.type === 'window', facts = [`${wallName(op.wall)} wall, ${op.offset} cm from the corner`, `${op.width} x ${op.height} cm`];
      if (isWin) facts.push(`Sill ${op.sill} cm`, op.niche ? `Niche ${op.niche} cm deep${op.nicheShelf ? ' with a shelf' : ''}` : 'No niche', op.radiator ? 'Radiator below' : 'No radiator');
      else facts.push(op.leaf === false ? 'Open passage' : op.swing === 'out' ? 'Opens into the next room' : 'Opens into this room');
      el.innerHTML = `<h2>${isWin ? 'Window' : 'Door'}</h2><ul class="facts">${facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        <p class="note">Part of the house, so it is locked.</p>`;
    } else if (op) {
      const isWin = op.type === 'window';
      el.innerHTML = `<h2>${isWin ? 'Window' : 'Door'}</h2>
        <div class="row2">
          <label class="field"><span>Type</span><select data-op="type"><option value="door" ${!isWin ? 'selected' : ''}>Door</option><option value="window" ${isWin ? 'selected' : ''}>Window</option></select></label>
          <label class="field"><span>Wall</span><select data-op="wall">${WALLS.map(([k, n]) => `<option value="${k}" ${op.wall === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        </div>
        <div class="row2">
          <label class="field"><span>Offset from corner, cm</span><input type="number" data-op="offset" value="${op.offset}"></label>
          <label class="field"><span>Width, cm</span><input type="number" data-op="width" value="${op.width}"></label>
        </div>
        <div class="row2">
          <label class="field"><span>Height, cm</span><input type="number" data-op="height" value="${op.height}"></label>
          ${isWin ? `<label class="field"><span>Sill height, cm</span><input type="number" data-op="sill" value="${op.sill}"></label>` : '<span></span>'}
        </div>
        ${isWin ? `<div class="row2"><label class="field"><span>Niche depth, cm</span><input type="number" data-op="niche" value="${op.niche || 0}" title="A recess in the wall under and around the window (0 = none)"></label>
            <label class="check" style="margin-top:22px"><input type="checkbox" data-op="nicheShelf" ${op.nicheShelf ? 'checked' : ''} ${op.niche > 0 ? '' : 'disabled'}> Shelf in niche</label></div>
          <label class="check"><input type="checkbox" data-op="radiator" ${op.radiator ? 'checked' : ''}> Radiator below</label>`
          : `<label class="check"><input type="checkbox" data-op="leaf" ${op.leaf !== false ? 'checked' : ''}> Door leaf (untick for an open passage)</label>
             ${op.leaf !== false ? `<label class="check"><input type="checkbox" data-op="swingIn" ${op.swing !== 'out' ? 'checked' : ''}> Opens into this room (keeps the swing area clear)</label>` : ''}
             ${op.leaf !== false ? `<div class="wallrow"><input type="color" data-op="color" value="${op.color}" aria-label="Door color"><span>Door color</span><code>${op.color.toUpperCase()}</code></div>` : ''}`}
        <p class="note">Offset is from the top corner on side walls, or the left corner on top and bottom walls.</p>
        <div class="btnrow" style="margin-top:12px"><button class="btn danger" data-act="delete">Remove</button></div>`;
    } else {
      el.innerHTML = `<h2>Selection</h2><p class="empty">Tap furniture, a light, a door or a window on the plan to edit it. Tap a wall to choose its color.</p>`;
    }
  }

  function renderArtInspector(el, it) {
    const r = room(), k = artWall(it), along = Math.round((k === 'n' || k === 's') ? it.x : it.y), centre = Math.round(it.elev + it.h / 2), p = it.catalogId && piece(it.catalogId);
    el.innerHTML = `<h2>${esc(it.name)}</h2>
      ${p ? `<div class="linked"><span>From My pieces. Changes apply to every placement of this piece (${placements(p.id)}).</span></div>` : ''}
      ${it.frame === 'oakpanel' || it.style === 'oar' ? '' : `<div class="art-pick">${it.image ? `<img data-photo="${it.image}" alt="">` : '<span class="art-empty">No picture yet: a placeholder is shown</span>'}
        <div class="btnrow"><button class="btn small" data-act="artPicture">${it.image ? 'Change picture' : 'Add picture'}</button>${it.image ? '<button class="btn light small" data-act="artClear">Remove picture</button>' : ''}</div></div>`}
      <label class="field"><span>Label</span><input data-item="name" value="${esc(it.name)}"></label>
      <div class="row2">
        <label class="field"><span>Width, cm</span><input type="number" data-item="w" value="${it.w}"></label>
        <label class="field"><span>Height, cm</span><input type="number" data-item="h" value="${it.h}"></label>
      </div>
      <div class="row3">
        <label class="field"><span>Wall</span><select data-art="wall">${WALLS.map(([w, n]) => `<option value="${w}" ${k === w ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="field"><span>Along wall, cm</span><input type="number" data-art="along" value="${along}"></label>
        <label class="field"><span>Centre height, cm</span><input type="number" data-art="centre" value="${centre}"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Frame</span><select data-item="frame">${Object.entries(ART_FRAMES).map(([f, n]) => `<option value="${f}" ${it.frame === f ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="field"><span>Mat</span><select data-item="mat" ${['none', 'oakpanel'].includes(it.frame) ? 'disabled' : ''}>${[['', 'No mat'], ['white', 'White mat'], ['cream', 'Cream mat']].map(([v, n]) => `<option value="${v}" ${(it.mat === true ? 'white' : it.mat || '') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <p class="note">Along wall is the picture's centre, from the ${k === 'n' || k === 's' ? 'left' : 'top'} corner. Drag it on the plan to slide it along a wall or move it to another wall. 150 cm is a usual centre height.</p>
      <div class="btnrow" style="margin-top:12px">
        <button class="btn light" data-act="rotate">Next wall</button>
        <button class="btn light" data-act="duplicate">Duplicate</button>
        ${p ? '<button class="btn light" data-act="editPiece">Edit piece</button>' : '<button class="btn light" data-act="savePiece">Save to My pieces</button>'}
        <button class="btn danger" data-act="delete">Remove</button>
      </div>`;
    hydratePhotos(el);
  }

  // ================= Render: catalog =================
  const dims = (o) => `${o.w} x ${o.d} x ${o.h} cm`;
  // 3D thumbnails of pieces, rendered one at a time in the background and cached for the session
  const thumbs = new Map(), thumbQueue = [];
  let thumbBusy = false, thumbFail = false;
  const libFrame = (color) => color === '#F4F3EF' ? 'none' : color === '#C49A6C' ? 'oak' : color === '#C9A06A' ? 'oakpanel' : 'black';
  const THUMB_VERSION = 7; // bump when models change so saved thumbnails are redrawn
  const thumbKey = (o) => JSON.stringify([THUMB_VERSION].concat(['type', 'w', 'd', 'h', 'color', 'style', 'doors', 'books', 'side', 'frame', 'mat', 'image', 'kelvin'].map((k) => o[k])));
  const showThumb = (key, url) => $$('img[data-thumb]').forEach((img) => { if (img.dataset.thumb === key) img.src = url; });
  function thumbImg(o, cls) {
    const key = thumbKey(o), url = thumbs.get(key);
    if (!url && !thumbFail && window.THREE && window.HouseModels) { if (!thumbQueue.some((q) => q.key === key)) thumbQueue.push({ key, o: clone(o) }); pumpThumbs(); }
    return `<img class="${cls || 'thumb3d'}" data-thumb="${esc(key)}" ${url ? `src="${url}"` : ''} alt="">`;
  }
  // Thumbnails only render while you are not dragging, typing or orbiting, so they never get in the way
  let lastInput = 0;
  ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchmove'].forEach((ev) => window.addEventListener(ev, (e) => { if (ev !== 'pointermove' || e.buttons) lastInput = performance.now(); }, { capture: true, passive: true }));
  function pumpThumbs() {
    if (thumbBusy || !thumbQueue.length) return;
    const quiet = performance.now() - lastInput;
    if (quiet < 800) { setTimeout(pumpThumbs, 800 - quiet + 20); return; }
    thumbBusy = true;
    const job = thumbQueue.shift(), done = () => { thumbBusy = false; setTimeout(pumpThumbs, 30); };
    // saved from an earlier visit? then no rendering at all
    Store.getThumb(job.key).catch(() => null).then((saved) => {
      if (saved) { thumbs.set(job.key, saved); showThumb(job.key, saved); return done(); }
      const pic = job.o.image ? getPhoto(job.o.image).then((u) => u && HouseModels.preloadImage(u)).catch(() => {}) : Promise.resolve();
      pic.then(() => (window.requestIdleCallback || ((f) => setTimeout(f, 50)))(() => {
        try {
          HouseModels.init(THREE);
          const url = HouseModels.thumbnail(job.o, { photo: photoFor3D });
          thumbs.set(job.key, url); showThumb(job.key, url); Store.putThumb(job.key, url).catch(() => {});
        } catch (e) { thumbFail = true; thumbQueue.length = 0; }
        done();
      }, { timeout: 2000 }));
    });
  }
  function pieceCard(p) {
    const st = p.status === 'own' ? '' : `<span class="badge want">${p.status === 'ordered' ? 'Ordered' : 'Considering'}</span>`;
    return `<li class="piece"><div class="pic" style="--c:${p.color}">${p.photos[0] ? `<img data-photo="${p.photos[0]}" alt="">` : thumbImg(p)}</div>
      <div class="txt"><b>${esc(p.name)}</b><small>${dims(p)}${st}${placements(p.id) ? `<span class="badge">${placements(p.id)} placed</span>` : ''}</small></div>
      <div class="acts"><button class="btn small" data-place="${p.id}">Place</button><button class="btn light small" data-edit-piece="${p.id}">Edit</button></div></li>`;
  }
  function renderCatalog() {
    const el = $('#catalogPanel'), lights = state.catalog.filter((p) => isLight(p.type)), furn = state.catalog.filter((p) => !isLight(p.type));
    let body;
    if (catTab === 'mine') {
      body = state.catalog.length ? `
        ${furn.length ? `<h3>Furniture</h3><ul class="pieces">${furn.map(pieceCard).join('')}</ul>` : ''}
        ${lights.length ? `<h3>Lights</h3><ul class="pieces">${lights.map(pieceCard).join('')}</ul>` : ''}`
        : `<p class="empty">Add the furniture and lights you own or are considering, with photos and sizes. Each piece can then be placed in any room, and editing it updates every placement.</p>`;
    } else {
      body = LIBRARY.map(([cat, items], ci) => `<h3>${cat}</h3><div class="lib-grid">${items.map(([type, name, w, d, h], ii) =>
        `<button data-lib="${ci}:${ii}">${thumbImg(Object.assign({ type, w, d, h, color: LIBRARY[ci][1][ii][5] }, LIBRARY[ci][1][ii][6] || {}, type === 'art' ? { frame: libFrame(LIBRARY[ci][1][ii][5]), mat: !['#F4F3EF', '#C9A06A'].includes(LIBRARY[ci][1][ii][5]) } : {}))}<span>${name}</span><small>${w} x ${d} x ${h} cm</small></button>`).join('')}</div>`).join('');
    }
    el.innerHTML = `<div class="sec-head"><h2>Furniture and lights</h2><button class="btn small" data-new-piece>New piece</button></div>
      <div class="tabs" role="tablist">
        <button role="tab" data-cat-tab="mine" aria-selected="${catTab === 'mine'}">My pieces (${state.catalog.length})</button>
        <button role="tab" data-cat-tab="generic" aria-selected="${catTab === 'generic'}">Generic</button></div>${body}`;
    hydratePhotos(el);
  }

  // ================= Render: save panel =================
  async function renderSavePanel() {
    const el = $('#savePanel');
    el.innerHTML = `<div class="sec-head"><h2>Save</h2><button class="btn light small" data-close-save>Close</button></div>
      <p class="note" style="margin:0 0 10px">Everything autosaves in this browser. Save a version to keep a snapshot you can return to, for example before trying a new color scheme.</p>
      <div class="version-add"><input id="versionName" placeholder="Version name, e.g. Sage living room" aria-label="Version name"><button class="btn small" id="saveVersion">Save version</button></div>
      <ul class="versions" id="versionList"><li><span class="note">Loading versions…</span></li></ul>
      <div class="btnrow"><button class="btn light small" id="exportBtn">Export backup</button><button class="btn light small" id="importBtn">Import backup</button></div>
      <p class="note">A backup file includes photos. Use it to move the plan to another computer or keep a copy.</p>`;
    let list = [];
    try { list = (await Store.listVersions()).sort((a, b) => b.date.localeCompare(a.date)); } catch (e) { $('#versionList').innerHTML = '<li><span class="note">Versions need browser storage, which is unavailable here.</span></li>'; return; }
    $('#versionList').innerHTML = list.map((v) => `<li><span>${esc(v.name)}<small>${new Date(v.date).toLocaleString()}</small></span>
      <button class="btn light small" data-restore="${v.id}">Restore</button><button class="btn danger small" data-del-version="${v.id}" aria-label="Delete version">Delete</button></li>`).join('') || '<li><span class="note">No saved versions yet.</span></li>';
  }
  async function saveVersion(name) {
    const v = { id: 'v' + uid(), name: name || `Version ${new Date().toLocaleString()}`, date: new Date().toISOString(), data: clone(state) };
    try { await Store.putVersion(v); toast(`Saved version "${v.name}"`); renderSavePanel(); return true; }
    catch (e) { toast('Could not save the version: browser storage is unavailable.'); return false; }
  }

  // ================= Render: plan =================
  function itemShape(it, fs) {
    const w = it.w, d = it.d, x0 = -w / 2, y0 = -d / 2, c = it.color;
    if (isLight(it.type) && w > 2.5 * d) { // track rails, arc lamps: a bar with a glow line
      return `<rect class="light-body" x="${x0}" y="${-Math.max(d, 4) / 2}" width="${w}" height="${Math.max(d, 4)}" rx="2" fill="${c}"/><line class="light-x" x1="${x0 + 3}" x2="${x0 + w - 3}" y1="0" y2="0"/>`;
    }
    if (isLight(it.type)) {
      const rr = Math.max(Math.max(w, d) / 2, fs * 0.45), k = rr * 0.7;
      return `<circle class="light-body" r="${rr}" fill="${c}"/><path class="light-x" d="M${-k} ${-k}L${k} ${k}M${k} ${-k}L${-k} ${k}"/>`;
    }
    const base = `<rect class="body" x="${x0}" y="${y0}" width="${w}" height="${d}" rx="2" fill="${c}"/>`;
    switch (it.type) {
      case 'rug': return `<rect class="body" x="${x0}" y="${y0}" width="${w}" height="${d}" fill="${c}" fill-opacity=".75" stroke-dasharray="6 4"/>`;
      case 'art': { // seen from above: a thin frame on the wall with the picture edge inside
        const t = Math.max(d, 5), fc = { black: '#1D1D1D', white: '#E8E6E0', oak: '#C49A6C', limewash: '#CDBFA6', pine: '#A56E3D', walnut: '#5C3A22', brass: '#B89559', none: '#8A8A8A' }[it.frame] || c;
        return `<rect class="body" x="${x0}" y="${-t / 2}" width="${w}" height="${t}" fill="${fc}"/><line class="detail" x1="${x0 + 3}" x2="${x0 + w - 3}" y1="${t / 2 + 3}" y2="${t / 2 + 3}"/>`;
      }
      case 'plant': return `<ellipse class="body" rx="${w / 2}" ry="${d / 2}" fill="${c}"/>`;
      case 'roundtable': { const r = Math.min(w, d) / 2; return `<rect class="body" x="${x0}" y="${y0}" width="${w}" height="${d}" rx="${r}" ry="${r}" fill="${c}"/>`; }
      case 'bed': {
        const n = w >= 140 ? 2 : 1, gap = 10, pw = (w - gap * (n + 1)) / n; let p = '';
        for (let k = 0; k < n; k++) p += `<rect class="detail" x="${x0 + gap + k * (pw + gap)}" y="${y0 + 8}" width="${pw}" height="${Math.min(40, d * 0.2)}" rx="6"/>`;
        return base + p + `<line class="detail" x1="${x0}" x2="${x0 + w}" y1="${y0 + d * 0.32}" y2="${y0 + d * 0.32}"/>`;
      }
      case 'sofa': case 'armchair': {
        const back = Math.min(22, d * 0.25), arm = Math.min(18, w * 0.15);
        return base + `<rect class="detail" x="${x0}" y="${y0}" width="${w}" height="${back}"/><rect class="detail" x="${x0}" y="${y0}" width="${arm}" height="${d}"/><rect class="detail" x="${x0 + w - arm}" y="${y0}" width="${arm}" height="${d}"/>`;
      }
      case 'cornersofa': {
        // main seat along the back (-y), chaise running forward on one side (+x = right when seen from the front, which is +y)
        const back = Math.min(22, d * 0.14), md = Math.min(d, Math.max(back + 60, d * 0.55)), cw = Math.min(w * 0.4, 105), right = it.side !== 'left';
        const cx = right ? x0 + w - cw : x0;
        const outline = right ? `M${x0} ${y0}H${x0 + w}V${y0 + d}H${x0 + w - cw}V${y0 + md}H${x0}Z` : `M${x0} ${y0}H${x0 + w}V${y0 + md}H${x0 + cw}V${y0 + d}H${x0}Z`;
        return `<path class="body" fill="${c}" d="${outline}"/>` +
          `<rect class="detail" x="${x0}" y="${y0}" width="${w}" height="${back}"/><line class="detail" x1="${cx}" x2="${cx + cw}" y1="${y0 + md}" y2="${y0 + md}"/>`;
      }
      case 'chair': {
        if (it.style === 'tub') { // rounded shell with arms, open at the front
          const r = w / 2; return `<path class="body" fill="${c}" d="M${x0} ${y0 + r * 0.9}A${r} ${r * 0.9} 0 0 1 ${x0 + w} ${y0 + r * 0.9}V${y0 + d * 0.8}Q${x0 + w} ${y0 + d} ${x0 + w * 0.8} ${y0 + d}H${x0 + w * 0.2}Q${x0} ${y0 + d} ${x0} ${y0 + d * 0.8}Z"/>` +
            `<path class="detail" d="M${x0 + 6} ${y0 + d * 0.72}V${y0 + r * 0.9}A${r - 6} ${r * 0.9 - 6} 0 0 1 ${x0 + w - 6} ${y0 + r * 0.9}V${y0 + d * 0.72}"/>`;
        }
        const bk = Math.min(8, d * 0.18); return base + `<rect class="detail" x="${x0 + 2}" y="${y0}" width="${w - 4}" height="${bk}" rx="2"/>`;
      }
      case 'table': case 'desk': { // top with the legs shown as corner dots
        const k = Math.min(6, Math.min(w, d) * 0.08), t = Math.max(2, k * 0.6);
        return base + [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy]) => `<circle class="detail" cx="${sx * (w / 2 - k)}" cy="${sy * (d / 2 - k)}" r="${t}"/>`).join('');
      }
      case 'shelf': { // shelf front with uprights; doors drawn as a line across
        let p = ''; const n = Math.max(1, Math.round(w / 40)); for (let k = 1; k < n; k++) p += `<line class="detail" x1="${x0 + (w * k) / n}" x2="${x0 + (w * k) / n}" y1="${y0}" y2="${y0 + d}"/>`;
        return base + p + `<line class="detail" x1="${x0}" x2="${x0 + w}" y1="${y0 + d - 2}" y2="${y0 + d - 2}"/>`;
      }
      case 'cabinet': case 'wardrobe': case 'counter': case 'vanity': { // doors along the front
        const n = Math.max(1, Math.round(w / (it.type === 'wardrobe' ? 50 : 55))); let p = '';
        for (let k = 1; k < n; k++) p += `<line class="detail" x1="${x0 + (w * k) / n}" x2="${x0 + (w * k) / n}" y1="${y0 + d * 0.65}" y2="${y0 + d}"/>`;
        if (it.type === 'wardrobe') p += `<line class="detail" stroke-dasharray="4 3" x1="${x0 + 4}" x2="${x0 + w - 4}" y1="0" y2="0"/>`;
        if (it.type === 'vanity') p += `<ellipse class="detail" cx="0" cy="${d * 0.05}" rx="${w * 0.28}" ry="${d * 0.25}"/>`;
        if (it.type === 'counter' && w >= 120) p += `<rect class="detail" x="${w * 0.1}" y="${y0 + d * 0.2}" width="${Math.min(50, w * 0.3)}" height="${d * 0.55}" rx="4"/>`;
        return base + p + `<line class="detail" x1="${x0}" x2="${x0 + w}" y1="${y0 + d * 0.65}" y2="${y0 + d * 0.65}"/>`;
      }
      case 'stairs': { // one line per step and an arrow pointing up the flight
        const n = Math.max(3, Math.round(it.h / 18)); let p = '';
        for (let k = 1; k < n; k++) p += `<line class="detail" x1="${x0}" x2="${x0 + w}" y1="${y0 + (d * k) / n}" y2="${y0 + (d * k) / n}"/>`;
        return base + p + `<path class="detail" d="M0 ${y0 + d - 8}V${y0 + 10}M-6 ${y0 + 18}L0 ${y0 + 8}L6 ${y0 + 18}"/>`;
      }
      case 'appliance': return base + `<rect class="detail" x="${x0 + 3}" y="${y0 + d - 5}" width="${w - 6}" height="3"/>`;
      case 'bath': return base + `<rect class="detail" x="${x0 + 8}" y="${y0 + 8}" width="${w - 16}" height="${d - 16}" rx="${Math.min(w, d) / 3}"/>`;
      case 'toilet': return `<rect class="body" x="${x0}" y="${y0}" width="${w}" height="${d * 0.28}" rx="3" fill="${c}"/><ellipse class="body" cx="0" cy="${y0 + d * 0.62}" rx="${w / 2}" ry="${d * 0.36}" fill="${c}"/>`;
      case 'shower': return base + `<path class="detail" d="M${x0} ${y0}L${x0 + w} ${y0 + d}M${x0 + w} ${y0}L${x0} ${y0 + d}"/>`;
      default: return base;
    }
  }
  function renderPlan() {
    const r = room(), W = r.width, L = r.length, svg = $('#plan'), fs = Math.max(W, L) / 36, pad = T + fs * 3.2;
    svg.setAttribute('viewBox', `${-pad} ${-pad} ${W + 2 * pad} ${L + 2 * pad}`);
    const bad = clashes(r);
    let h = `<defs><pattern id="swingHatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="rgba(210,60,40,.06)"/><line x1="0" y1="0" x2="0" y2="8" stroke="rgba(190,60,40,.35)" stroke-width="1.5" vector-effect="non-scaling-stroke"/></pattern><pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="rgba(0,0,0,.09)" stroke-width="1" vector-effect="non-scaling-stroke"/></pattern></defs>`;
    h += `<rect x="0" y="0" width="${W}" height="${L}" fill="${r.floor}"/><rect x="0" y="0" width="${W}" height="${L}" fill="url(#grid)"/>`;
    const polys = { n: `${-T},${-T} ${W + T},${-T} ${W},0 0,0`, e: `${W + T},${-T} ${W + T},${L + T} ${W},${L} ${W},0`, s: `0,${L} ${W},${L} ${W + T},${L + T} ${-T},${L + T}`, w: `${-T},${-T} 0,0 0,${L} ${-T},${L + T}` };
    for (const [k] of WALLS) h += `<polygon class="wall ${wallTarget === k ? 'target' : ''}" data-wall="${k}" points="${polys[k]}" fill="${r.walls[k]}"/>`;
    const M = { n: 'matrix(1 0 0 1 0 0)', e: `matrix(0 1 -1 0 ${W} 0)`, s: `matrix(1 0 0 -1 0 ${L})`, w: 'matrix(0 1 1 0 0 0)' };
    for (const o of r.openings) {
      let g = `<rect x="${o.offset}" y="${-T - 1}" width="${o.width}" height="${T + 2}" fill="${r.floor}"/>`;
      if (o.niche > 0) g += `<rect class="niche" x="${o.offset}" y="${-o.niche}" width="${o.width}" height="${o.niche}" fill="${r.floor}"/>`;
      if (o.type === 'door' && o.leaf !== false && o.swing !== 'out') g += `<path class="swing" d="M${o.offset} 0H${o.offset + o.width}A${o.width} ${o.width} 0 0 1 ${o.offset} ${o.width}Z" fill="url(#swingHatch)"/>`;
      if (o.type === 'door' && o.leaf !== false && o.swing === 'out') g += `<line class="line" x1="${o.offset}" x2="${o.offset + o.width}" y1="${-T / 2}" y2="${-T / 2}" stroke-dasharray="4 3"/>`;
      else if (o.type === 'door' && o.leaf !== false) g += `<rect x="${o.offset}" y="0" width="${o.width}" height="${o.width}" fill="transparent"/><path class="line" d="M${o.offset} 0L${o.offset} ${o.width}M${o.offset + o.width} 0A${o.width} ${o.width} 0 0 1 ${o.offset} ${o.width}"/>`;
      else g += `<rect class="glass" x="${o.offset}" y="${-T}" width="${o.width}" height="${T}"/><line class="line" x1="${o.offset}" x2="${o.offset + o.width}" y1="${-T / 2}" y2="${-T / 2}"/>`;
      if (selected && selected.id === o.id) g += `<rect class="sel-outline" x="${o.offset - 3}" y="${-T - 3}" width="${o.width + 6}" height="${(o.type === 'door' ? o.width + T : T) + 6}"/>`;
      h += `<g class="opening" data-opening="${o.id}" transform="${M[o.wall]}">${g}</g>`;
    }
    const layer = (i) => i.type === 'rug' ? 0 : isLight(i.type) ? 2 : 1;
    for (const it of [...r.items].sort((a, b) => layer(a) - layer(b))) {
      const on = selected && selected.id === it.id, light = isLight(it.type);
      const lf = Math.max(fs * 0.45, Math.min(fs * 0.8, it.w / Math.max(5, it.name.length) * 1.5));
      const show = !light && it.w > 35 && it.d > 25, flip = it.rot > 90 && it.rot <= 270;
      const sw = light ? Math.max(Math.max(it.w, it.d) / 2, fs * 0.45) * 2 : 0;
      h += `<g class="item ${bad.has(it.id) ? 'clash' : ''}" data-item="${it.id}" transform="translate(${it.x} ${it.y}) rotate(${it.rot})"><title>${esc(it.name)}</title>
        ${itemShape(it, fs)}
        ${on ? (light ? `<circle class="sel-outline" r="${sw / 2 + 4}"/>` : `<rect class="sel-outline" x="${-it.w / 2 - 4}" y="${-it.d / 2 - 4}" width="${it.w + 8}" height="${it.d + 8}" rx="4"/>`) : ''}
        ${show ? `<text ${flip ? 'transform="rotate(180)"' : ''} text-anchor="middle" dominant-baseline="middle" font-size="${lf}" fill="${it.type === 'rug' ? '#1D2124' : textOn(it.color)}" y="${it.type === 'bed' ? (flip ? -1 : 1) * it.d * 0.15 : 0}">${esc(it.name)}</text>` : ''}</g>`;
    }
    const dy = -T - fs * 1.6, dx = -T - fs * 1.6, tk = fs * 0.4;
    h += `<path class="dim" d="M0 ${dy}H${W}M0 ${dy - tk}V${dy + tk}M${W} ${dy - tk}V${dy + tk}"/><text x="${W / 2}" y="${dy - fs * 0.45}" text-anchor="middle" font-size="${fs * 0.85}" fill="#646D6B">${W} cm</text>`;
    h += `<path class="dim" d="M${dx} 0V${L}M${dx - tk} 0H${dx + tk}M${dx - tk} ${L}H${dx + tk}"/><text transform="translate(${dx - fs * 0.45} ${L / 2}) rotate(-90)" text-anchor="middle" font-size="${fs * 0.85}" fill="#646D6B">${L} cm</text>`;
    svg.innerHTML = h;
  }

  function renderSaveChip() {
    const c = $('#saveState'); if (!c) return;
    const busy = /Saving/.test(saveNote), bad = /unavailable/.test(saveNote);
    c.textContent = busy ? 'Saving…' : bad ? 'Not saved' : 'Saved'; c.className = 'save-state' + (busy ? ' busy' : bad ? ' bad' : ''); c.title = saveNote;
  }
  function renderStatus() {
    renderSaveChip();
    const r = room(), bad = clashes(r).size, sw = swingClashes(r).size;
    $('#status').innerHTML = `<span>${esc(r.name)}: ${(r.width / 100).toFixed(2)} x ${(r.length / 100).toFixed(2)} m, ceiling ${(r.height / 100).toFixed(2)} m</span>
      <span>${plural(r.items.length, 'item')}</span>
      ${bad ? `<span class="warn">${plural(bad, 'item')} overlap, extend past a wall${sw ? ' or block a door' : ''} (dashed red)</span>` : ''}<span>${esc(saveNote)}</span>`;
  }
  function renderView() {
    $('#stage').dataset.view = view;
    $$('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    if (view !== 'plan') { init3D(); resize3D(); build3D(); }
  }
  function renderAll() { renderRooms(); renderRoomPanel(); renderInspector(); renderCatalog(); renderPlan(); schedule3D(); renderStatus(); }

  // ================= 3D =================
  // Models, textures and materials live in models3d.js (window.HouseModels).
  const three = { ok: undefined, lastRoom: null };
  function init3D() {
    if (three.ok !== undefined) return;
    const host = $('#three');
    if (!window.THREE || !THREE.OrbitControls || !window.HouseModels) { three.ok = false; host.innerHTML = '<p class="empty">The 3D view could not load three.js. Check the internet connection and reload.</p>'; return; }
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch (e) { three.ok = false; host.innerHTML = '<p class="empty">The 3D view needs WebGL, which is turned off in this browser.</p>'; return; }
    HouseModels.init(THREE);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    renderer.physicallyCorrectLights = false;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 5, 20000);
    let envMap = null;
    if (THREE.RoomEnvironment) { const pm = new THREE.PMREMGenerator(renderer); envMap = pm.fromScene(new THREE.RoomEnvironment(), 0.04).texture; pm.dispose(); }
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49;
    controls.addEventListener('start', () => { three.userMoved = true; });
    const hemi = new THREE.HemisphereLight(0xffffff, 0xb9ae9e, 0.5); scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4e5, 1.6); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6; sun.shadow.radius = 4;
    scene.add(sun); scene.add(sun.target);
    const group = new THREE.Group(); scene.add(group);
    Object.assign(three, { ok: true, renderer, scene, camera, controls, hemi, sun, group, envMap, walls: {} });
    new ResizeObserver(resize3D).observe(host);
    (function loop() { requestAnimationFrame(loop); if (view === 'plan') return; controls.update(); fadeWalls(); renderer.render(scene, camera); })();
  }
  function resize3D() { if (!three.ok) return; const host = $('#three'), w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; three.renderer.setSize(w, h); three.camera.aspect = w / h; three.camera.updateProjectionMatrix(); if (!three.userMoved && three.lastRoom) fitCamera(); }
  // Walls between the camera and the room turn see-through, with everything mounted on them
  function fadeWalls() {
    const r = room(), c = three.camera.position, hide = { n: c.z < 0, s: c.z > r.length, w: c.x < 0, e: c.x > r.width };
    for (const k in three.wallArt || {}) three.wallArt[k].forEach((o) => { o.visible = !hide[k]; });
    for (const k in three.walls) {
      const t = hide[k] ? 0.1 : 1;
      for (const m of three.walls[k]) {
        const full = m.userData.opacity != null ? m.userData.opacity : 1, o = Math.min(full, t);
        if (m.opacity !== o) { m.opacity = o; m.transparent = true; m.depthWrite = o >= 0.99; m.needsUpdate = true; }
      }
    }
  }
  // Fit the room's bounding sphere in view, looking down from the front-right corner
  // The camera looks over two walls (the ones nearest it fade out), so start from the corner that hides the fewest
  // wall-standing pieces: kitchens, shelves, wardrobes, artwork, beds' headboards and so on
  function bestCorner(r) {
    const along = (it) => { const k = artWall(it), b = aabb(it); return ({ n: b.y0 < 15, s: b.y1 > r.length - 15, w: b.x0 < 15, e: b.x1 > r.width - 15 })[k] ? k : null; };
    const weight = { n: 0, e: 0, s: 0, w: 0 };
    r.items.forEach((it) => { const k = [0, 90, 180, 270].includes(it.rot) && along(it); if (k) weight[k] += it.w * Math.max(it.h, 40) * (it.type === 'counter' || it.type === 'art' ? 3 : 1); });
    const corners = [['s', 'e', [0.5, 0.75]], ['s', 'w', [-0.5, 0.75]], ['n', 'e', [0.5, -0.75]], ['n', 'w', [-0.5, -0.75]]];
    return corners.sort((a, b) => (weight[a[0]] + weight[a[1]]) - (weight[b[0]] + weight[b[1]]))[0][2];
  }
  function fitCamera() {
    const r = room(), W = r.width, L = r.length, H = r.height, cam = three.camera;
    const rad = Math.sqrt(W * W + L * L + H * H) / 2, vf = cam.fov * Math.PI / 360;
    const hf = Math.atan(Math.tan(vf) * Math.max(cam.aspect || 1, 0.4)), dist = rad / Math.sin(Math.min(vf, hf)) * 0.92;
    three.controls.target.set(W / 2, H * 0.25, L / 2);
    const [dx, dz] = bestCorner(r);
    cam.position.copy(three.controls.target).addScaledVector(new THREE.Vector3(dx, 0.78, dz).normalize(), dist);
    three.controls.update();
  }
  // Artwork pictures live in IndexedDB; load on first use, then rebuild the 3D view
  const photoLoading = new Set();
  function photoFor3D(id) {
    if (id.startsWith('url:')) return id.slice(4); // shipped with the app
    const u = photoCache.get(id);
    if (!u && !photoLoading.has(id)) { photoLoading.add(id); getPhoto(id).then((x) => { if (x) schedule3D(); }); }
    return u || null;
  }
  let queued3D = false;
  function schedule3D() { if (queued3D || view === 'plan') return; queued3D = true; requestAnimationFrame(() => { queued3D = false; build3D(); }); }
  function disposeTree(o) {
    o.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) [].concat(c.material).forEach((m) => { ['map', 'bumpMap'].forEach((k) => { if (m[k] && !m[k].keep) m[k].dispose(); }); m.dispose(); });
    });
  }
  function build3D() {
    if (!three.ok) return;
    const HM = window.HouseModels, r = room(), g = three.group, W = r.width, L = r.length, H = r.height;
    while (g.children.length) disposeTree(g.children.pop());
    three.scene.background = new THREE.Color(evening ? '#1B1E22' : '#E9EBE6');
    three.scene.environment = evening ? null : three.envMap;
    three.hemi.intensity = evening ? 0.22 : 0.3;
    three.hemi.color.set(evening ? '#FFD7A8' : '#FFFFFF'); three.hemi.groundColor.set(evening ? '#2A221B' : '#B9AE9E');
    three.renderer.toneMappingExposure = evening ? 1.3 : 0.9;
    const add = (mesh, x, y, z, list) => { mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); if (list) list.push(mesh.material); return mesh; };

    // Floor, with a slab edge under the walls
    const floor = add(new THREE.Mesh(new THREE.BoxGeometry(W, 4, L), HM.floorMaterial(r.floor, r.floorFinish, W, L)), W / 2, -2, L / 2);
    floor.castShadow = false;
    add(new THREE.Mesh(new THREE.BoxGeometry(W + 2 * T, 3.9, L + 2 * T), HM.mat('#8E8A84', { rough: 0.9 })), W / 2, -2.1, L / 2).castShadow = false;

    // Walls with openings, skirting, window frames and doors
    const spec = { n: { axis: 'x', fixed: -T / 2, start: -T, end: W + T, inward: 1 }, s: { axis: 'x', fixed: L + T / 2, start: -T, end: W + T, inward: -1 }, w: { axis: 'z', fixed: -T / 2, start: 0, end: L, inward: 1 }, e: { axis: 'z', fixed: W + T / 2, start: 0, end: L, inward: -1 } };
    three.walls = {}; three.wallArt = {};
    for (const k of Object.keys(spec)) {
      const frameM = HM.mat('#F3F2EE', { rough: 0.5 }), skirtM = HM.mat('#F6F5F1', { rough: 0.55 }); // per wall, so they fade with it
      const s = spec[k], mats = three.walls[k] = [], wm = HM.wallMaterial(r.walls[k], r.wallFinish[k], s.end - s.start, H); mats.push(wm);
      // place a box along this wall: a..b along the wall, y0..y1 high, depth dz, offset from the wall centre line (+ = into the room)
      const along = (a, b, y0, y1, dz, off, m) => {
        if (b - a < 0.3 || y1 - y0 < 0.3) return null;
        const len = b - a, hh = y1 - y0, mid = (a + b) / 2, geo = s.axis === 'x' ? new THREE.BoxGeometry(len, hh, dz) : new THREE.BoxGeometry(dz, hh, len);
        const o = s.fixed + s.inward * off, mesh = new THREE.Mesh(geo, m);
        if (s.axis === 'x') add(mesh, mid, y0 + hh / 2, o); else add(mesh, o, y0 + hh / 2, mid);
        if (!mats.includes(m)) mats.push(m); return mesh;
      };
      const ops = r.openings.filter((o) => o.wall === k).map((o) => ({ a: o.offset, b: o.offset + o.width, sill: o.sill, top: Math.min(o.sill + o.height, H), type: o.type, radiator: o.radiator, color: o.color, leaf: o.leaf, niche: o.niche || 0, nicheShelf: o.nicheShelf })).sort((p, q) => p.a - q.a);
      let cur = s.start;
      const skirt = (a, b) => along(Math.max(a, 0), Math.min(b, s.axis === 'x' ? W : L), 0, 8, 1.5, T / 2 + 0.75, skirtM);
      for (const o of ops) {
        const a = Math.max(o.a, cur);
        along(cur, a, 0, H, T, 0, wm); skirt(cur, a);
        const nd = o.type === 'window' ? o.niche : 0, back = T / 2 - nd; // room-side face of the niche back (0 niche = normal wall)
        if (nd > 0) {
          along(a, o.b, 0, o.sill, 2, back - 1, wm);                                 // back of the niche below the window
          along(a - 2, a, 0, o.top, nd, T / 2 - nd / 2, wm); along(o.b, o.b + 2, 0, o.top, nd, T / 2 - nd / 2, wm); // side returns
          along(a, o.b, -4, 0, nd, T / 2 - nd / 2, HM.floorMaterial(r.floor, r.floorFinish, o.b - a, nd)); // niche floor
          along(a, o.b, o.top - 1, o.top + 1, nd, T / 2 - nd / 2, wm);               // niche head
          if (o.nicheShelf) along(a, o.b, 72, 75, nd + 2, T / 2 - nd / 2 + 1, frameM);  // desk shelf in the niche
        } else along(a, o.b, 0, o.sill, T, 0, wm);
        along(a, o.b, o.top, H, T, 0, wm);
        if (o.b > a) {
          const fw = 5;
          along(a - fw, a, o.sill, o.top + (o.type === 'door' ? fw : 0), T + 2, 0, frameM); along(o.b, o.b + fw, o.sill, o.top + (o.type === 'door' ? fw : 0), T + 2, 0, frameM);
          along(a - (o.type === 'door' ? fw : 0), o.b + (o.type === 'door' ? fw : 0), o.top, o.top + fw, T + 2, 0, frameM);
          if (o.type === 'window') {
            along(a - 3, o.b + 3, o.sill - 3, o.sill, nd ? 8 : T + 6, nd ? back + 3 : 3, frameM); // sill
            const glass = HM.mat(evening ? '#101820' : '#CFE3EE', { rough: 0.02, metal: 0.1, transparent: true, opacity: evening ? 0.85 : 0.18 });
            glass.userData.opacity = glass.opacity;
            along(a, o.b, o.sill, o.top, 1, nd ? back - T / 2 : 0, glass);
            // casement sashes: two above 80 cm wide, each with its own frame and a handle
            const nS = o.b - a > 80 ? 2 : 1, sw = (o.b - a) / nS, sashM = HM.mat('#FAFAF8', { rough: 0.4 }), hM = HM.mat('#DADCDD', { rough: 0.3, metal: 0.8 });
            for (let i = 0; i < nS; i++) {
              const x0 = a + i * sw, x1 = x0 + sw, fz = (nd ? back : T / 2) - 3;
              along(x0, x0 + 4, o.sill, o.top, 5, fz, sashM); along(x1 - 4, x1, o.sill, o.top, 5, fz, sashM);
              along(x0, x1, o.sill, o.sill + 5, 5, fz, sashM); along(x0, x1, o.top - 4, o.top, 5, fz, sashM);
              const hx = i === 0 && nS === 2 ? x1 - 3 : x0 + 3; along(hx - 1, hx + 1, (o.sill + o.top) / 2 - 6, (o.sill + o.top) / 2 + 6, 3, fz + 3, hM);
            }
            if (o.radiator && o.sill >= 40) {
              const rw = Math.max(40, (o.b - a) * 0.9), rh = Math.min(o.nicheShelf ? 45 : 60, (o.nicheShelf ? 70 : o.sill) - 22), rad = HM.radiator(rw, rh, 12);
              const c = (a + o.b) / 2, inset = (nd ? back : T / 2) + 6;
              if (s.axis === 'x') rad.position.set(c, 0, s.fixed + s.inward * inset); else { rad.position.set(s.fixed + s.inward * inset, 0, c); rad.rotation.y = Math.PI / 2; }
              if (s.inward < 0) rad.rotation.y += Math.PI;
              g.add(rad); rad.traverse((m) => { if (m.material && !mats.includes(m.material)) mats.push(m.material); });
            }
          } else if (o.leaf !== false) {
            const leaf = along(a + 1, o.b - 1, 0, o.top - 0.5, 4, T / 2 - 2, HM.mat(o.color, { rough: 0.45 }));
            if (leaf) { const hm = HM.mat('#9A9C9E', { rough: 0.25, metal: 1 }); const hx = s.inward > 0 ? o.b - 8 : o.b - 8; along(hx - 7, hx, 100, 102.5, 2, T / 2 + 1, hm); }
          }
        }
        cur = Math.max(cur, o.b);
      }
      along(cur, s.end, 0, H, T, 0, wm); skirt(cur, s.end);
    }

    // Furniture and lights
    const lights = [];
    for (const it of r.items) {
      const light = isLight(it.type), base = it.elev || 0;
      const obj = HM.buildItem(it, { evening, kelvinHex: KELVIN[it.kelvin], roomTop: H - base - Math.max(it.h, 1) + it.h, photo: photoFor3D });
      obj.position.set(it.x, base, it.y); obj.rotation.y = -it.rot * Math.PI / 180;
      g.add(obj);
      if (it.type === 'art') (three.wallArt[artWall(it)] = three.wallArt[artWall(it)] || []).push(obj);
      if (obj.userData.wallMounted) (three.wallArt[artWall(it)] = three.wallArt[artWall(it)] || []).push(obj.userData.wallMounted); // e.g. wall units of a kitchen run
      if (light && evening) lights.push({ it, base, bulbY: obj.userData.bulbY || 0, obj });
    }
    // Evening: each lamp gets a real light source; the brightest few cast shadows
    lights.sort((a, b) => POWER[b.it.power] - POWER[a.it.power]).forEach((l, i) => {
      const it = l.it, down = it.type === 'spot' || it.type === 'ceiling' || it.type === 'pendant';
      const pl = new THREE.PointLight(new THREE.Color(KELVIN[it.kelvin]).convertSRGBToLinear(), POWER[it.power] * (down ? 3.2 : 2.6), Math.max(W, L) * 2.5, 1.2);
      const p = new THREE.Vector3(0, l.bulbY, 0); l.obj.localToWorld(p); pl.position.copy(p);
      if (i < 3) { pl.castShadow = true; pl.shadow.mapSize.set(1024, 1024); pl.shadow.bias = -0.002; pl.shadow.radius = 6; pl.shadow.camera.near = 2; }
      g.add(pl);
    });
    if (evening && !lights.length) three.hemi.intensity = 0.25;

    // Sun: comes in through the first window if there is one
    const span = Math.max(W, L), sun = three.sun, win = r.openings.find((o) => o.type === 'window');
    sun.intensity = evening ? 0 : 1.4;
    const out = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[win ? win.wall : 's'];
    const cx = win && (win.wall === 'n' || win.wall === 's') ? win.offset + win.width / 2 : W / 2, cz = win && (win.wall === 'e' || win.wall === 'w') ? win.offset + win.width / 2 : L / 2;
    sun.position.set(cx + out[0] * span * 1.2 + span * 0.3, span * 1.3, cz + out[1] * span * 1.2 + span * 0.2); sun.target.position.set(W / 2, 0, L / 2);
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 10, far: span * 5 }); sun.shadow.camera.updateProjectionMatrix();
    if (three.lastRoom !== r.id) { three.lastRoom = r.id; three.userMoved = false; fitCamera(); }
  }

  // ================= Dialogs =================
  const modal = $('#modal');
  function openModal(html, onClick) { $('#modalBody').innerHTML = html; $('#modalBody').onclick = onClick || null; if (!modal.open) modal.showModal(); hydratePhotos($('#modalBody')); }
  function closeModal() { if (modal.open) modal.close(); }
  modal.addEventListener('cancel', (e) => { e.preventDefault(); discardDraft(); closeModal(); });
  function discardDraft() { if (draft) { draft.newPhotos.forEach((id) => Store.delPhoto(id)); draft = null; } }
  const valOf = (id) => { const el = $('#' + id); return el ? el.value.trim() : ''; };

  function newRoomDialog() {
    draft = { kind: 'room', obj: { photos: [] }, newPhotos: [], removed: [] };
    const lv = levels();
    openModal(`<h2>New room</h2>
      <p class="note">Add what you have now. Everything can be changed later, and sizes can be left blank.</p>
      <div class="row2">
        <label class="field"><span>Name</span><input id="nrName" placeholder="Living room" autocomplete="off"></label>
        <label class="field"><span>Floor or level</span><input id="nrLevel" list="nrLevels" value="${esc(room().level || lv[0] || 'Ground floor')}"><datalist id="nrLevels">${lv.map((l) => `<option value="${esc(l)}">`).join('')}</datalist></label>
      </div>
      <div class="row3">
        <label class="field"><span>Width, cm</span><input id="nrW" type="number" inputmode="numeric" placeholder="400"></label>
        <label class="field"><span>Length, cm</span><input id="nrL" type="number" inputmode="numeric" placeholder="350"></label>
        <label class="field"><span>Ceiling, cm</span><input id="nrH" type="number" inputmode="numeric" placeholder="250"></label>
      </div>
      <h3>Photos</h3>${photoStrip([], 'draft')}
      <label class="field" style="margin-top:12px"><span>Notes</span><textarea id="nrNotes" rows="3" placeholder="Window positions, radiators, sockets, anything odd about the space"></textarea></label>
      <div class="modal-actions"><button class="btn light" data-a="cancel">Cancel</button><button class="btn" data-a="create">Create room</button></div>`,
    (e) => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'cancel') { discardDraft(); closeModal(); return; }
      const r = normRoom({ name: valOf('nrName') || `Room ${state.rooms.length + 1}`, level: valOf('nrLevel') || 'Ground floor',
        width: valOf('nrW') || 400, length: valOf('nrL') || 350, height: valOf('nrH') || 250, notes: valOf('nrNotes'), photos: draft.obj.photos });
      draft = null; state.rooms.push(r); state.activeRoomId = r.id; selected = null; roomTab = r.photos.length ? 'photos' : 'layout';
      closeModal(); commit(); toast(`Created ${r.name}`);
    });
    setTimeout(() => $('#nrName') && $('#nrName').focus(), 50);
  }

  function pieceDialog(existing, opts = {}) {
    const obj = existing ? clone(existing) : normPiece(opts.from ? Object.assign({}, opts.from, { id: undefined, photos: [] }) : Object.assign({ type: 'sofa', name: '' }, TYPE_DEFAULTS.sofa));
    draft = { kind: 'piece', obj, newPhotos: [], removed: [] };
    const typeOptions = (lightKind) => Object.entries(lightKind ? LIGHT_TYPES : FURNITURE_TYPES).map(([k, n]) => `<option value="${k}" ${obj.type === k ? 'selected' : ''}>${n}</option>`).join('');
    const light = isLight(obj.type);
    openModal(`<h2>${existing ? 'Edit piece' : 'New piece'}</h2>
      <div class="row2">
        <label class="field"><span>Kind</span><select id="pcKind"><option value="f" ${!light ? 'selected' : ''}>Furniture</option><option value="l" ${light ? 'selected' : ''}>Light</option></select></label>
        <label class="field"><span>Shape in the plan</span><select id="pcType">${typeOptions(light)}</select></label>
      </div>
      <label class="field"><span>Name</span><input id="pcName" value="${esc(obj.name)}" placeholder="Grey linen sofa"></label>
      <div class="row3">
        <label class="field"><span>Width, cm</span><input id="pcW" type="number" value="${obj.w}"></label>
        <label class="field"><span>Depth, cm</span><input id="pcD" type="number" value="${obj.d}"></label>
        <label class="field"><span>Height, cm</span><input id="pcH" type="number" value="${obj.h}"></label>
      </div>
      <div class="row2">
        <div class="field"><span>Color</span><input id="pcColor" type="color" value="${obj.color}"></div>
        <label class="field"><span>Status</span><select id="pcStatus">${[['own', 'Own it'], ['considering', 'Considering'], ['ordered', 'Ordered']].map(([k, n]) => `<option value="${k}" ${obj.status === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <div class="row2" id="pcLightRow" ${light ? '' : 'hidden'}>
        <label class="field"><span>Light color</span><select id="pcKelvin">${Object.keys(KELVIN).map((k) => `<option value="${k}" ${Number(k) === (obj.kelvin || 2700) ? 'selected' : ''}>${k} K</option>`).join('')}</select></label>
        <label class="field"><span>Brightness</span><select id="pcPower">${Object.keys(POWER).map((k) => `<option value="${k}" ${k === (obj.power || 'medium') ? 'selected' : ''}>${k[0].toUpperCase() + k.slice(1)}</option>`).join('')}</select></label>
      </div>
      <label class="field" style="margin-top:10px"><span>Link</span><input id="pcLink" type="url" value="${esc(obj.link)}" placeholder="Product page, optional"></label>
      <h3>Photos</h3>${photoStrip(obj.photos, 'draft')}
      <label class="field" style="margin-top:12px"><span>Notes</span><textarea id="pcNotes" rows="2" placeholder="Material, price, where it is now">${esc(obj.notes)}</textarea></label>
      <div class="modal-actions">
        ${existing ? '<button class="btn danger" data-a="delete">Delete piece</button><span class="spacer"></span>' : ''}
        <button class="btn light" data-a="cancel">Cancel</button>
        <button class="btn light" data-a="save">Save</button>
        <button class="btn" data-a="place">Save and place in ${esc(room().name)}</button>
      </div>`,
    (e) => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      const act = a.dataset.a;
      if (act === 'cancel') { discardDraft(); closeModal(); return; }
      if (act === 'delete') {
        const n = placements(existing.id);
        if (!confirm(`Delete "${existing.name}"${n ? ` and remove its ${plural(n, 'placement')}` : ''}?`)) return;
        state.catalog = state.catalog.filter((p) => p.id !== existing.id);
        if (!state.removedPieces.includes(existing.id)) state.removedPieces.push(existing.id);
        state.rooms.forEach((r) => { r.items = r.items.filter((i) => i.catalogId !== existing.id); });
        existing.photos.forEach((id) => Store.delPhoto(id)); discardDraft(); selected = null; closeModal(); commit(); toast('Piece deleted'); return;
      }
      const type = valOf('pcType');
      const p = normPiece(Object.assign(draft.obj, { type, name: valOf('pcName') || typeName(type), w: valOf('pcW'), d: valOf('pcD'), h: valOf('pcH'),
        color: valOf('pcColor'), status: valOf('pcStatus'), link: valOf('pcLink'), notes: valOf('pcNotes'), kelvin: valOf('pcKelvin'), power: valOf('pcPower') }));
      draft.removed.forEach((id) => Store.delPhoto(id));
      draft = null;
      if (existing) { Object.assign(existing, p); if (!isLight(p.type)) { delete existing.kelvin; delete existing.power; } syncFromPiece(existing); }
      else state.catalog.push(p);
      if (opts.linkItem) { opts.linkItem.catalogId = p.id; syncFromPiece(p); }
      closeModal(); catTab = 'mine';
      if (act === 'place') placePiece(existing || p); else { commit(); toast(`Saved ${p.name}`); }
    });
    const kind = $('#pcKind');
    const applyDefaults = (t) => { const d = TYPE_DEFAULTS[t]; if (!d || existing) return; $('#pcW').value = d.w; $('#pcD').value = d.d; $('#pcH').value = d.h; $('#pcColor').value = d.color; };
    kind.addEventListener('change', () => {
      const l = kind.value === 'l'; obj.type = l ? 'pendant' : 'sofa';
      $('#pcType').innerHTML = typeOptions(l); $('#pcLightRow').hidden = !l; applyDefaults(obj.type);
    });
    $('#pcType').addEventListener('change', (e) => applyDefaults(e.target.value));
  }

  function handoffDialog() {
    openModal(`<h2>Claude handoff</h2>
      <p class="note">Send photos, sizes and descriptions to Claude in chat. Claude replies with a block of data: paste it here to add or update rooms, furniture and lights. Items with an id that already exists are updated; everything else is added. A version is saved automatically before each import.</p>
      <label class="field" style="margin-top:12px"><span>Paste from Claude</span><textarea id="hoText" rows="9" spellcheck="false" placeholder='{ "rooms": [ ... ], "catalog": [ ... ] }' style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px"></textarea></label>
      <p class="note" id="hoMsg"></p>
      <div class="modal-actions"><button class="btn light" data-a="close">Close</button><button class="btn" data-a="apply">Add to plan</button></div>
      <h3>Send the current plan to Claude</h3>
      <p class="note">Copies the plan as text, without photos. Paste it into the chat when you want Claude to change something, then paste the reply back above.</p>
      <div class="btnrow" style="margin-top:8px"><button class="btn light" data-a="copyRoom">Copy ${esc(room().name)}</button><button class="btn light" data-a="copyAll">Copy whole plan</button></div>`,
    async (e) => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      const act = a.dataset.a;
      if (act === 'close') return closeModal();
      if (act === 'copyRoom' || act === 'copyAll') {
        const strip = (r) => { const c = clone(r); delete c.photos; return c; };
        const r = room(), used = new Set(r.items.map((i) => i.catalogId).filter(Boolean));
        const payload = act === 'copyRoom'
          ? { rooms: [strip(r)], catalog: state.catalog.filter((p) => used.has(p.id)).map((p) => { const c = clone(p); delete c.photos; return c; }) }
          : { name: state.name, rooms: state.rooms.map(strip), catalog: state.catalog.map((p) => { const c = clone(p); delete c.photos; return c; }) };
        const ok = await copyText('House planner data (v2):\n' + JSON.stringify(payload));
        toast(ok ? 'Copied. Paste it into the chat with Claude.' : 'Copy failed. Export a backup instead.');
        return;
      }
      if (act === 'apply') {
        const msg = $('#hoMsg');
        try {
          const raw = $('#hoText').value, s = raw.indexOf('{'), en = raw.lastIndexOf('}');
          if (s < 0 || en < s) throw new Error('No data block found. Paste the part that starts with { and ends with }.');
          const p = JSON.parse(raw.slice(s, en + 1));
          if (!Array.isArray(p.rooms) && !Array.isArray(p.catalog)) throw new Error('The block has no "rooms" or "catalog" list.');
          await saveVersion(`Before Claude import, ${new Date().toLocaleString()}`);
          const res = applyPatch(p);
          closeModal(); commit(); toast(res);
        } catch (err) { msg.textContent = `Not added: ${err.message}`; msg.style.color = 'var(--danger)'; }
      }
    });
  }
  function applyPatch(p) {
    let ra = 0, ru = 0, ca = 0, cu = 0, first = null;
    (p.catalog || []).forEach((c) => {
      const ex = c.id && piece(c.id);
      if (ex) { const keepPhotos = ex.photos; Object.assign(ex, normPiece(Object.assign({}, ex, c))); if (!c.photos) ex.photos = keepPhotos; syncFromPiece(ex); cu++; }
      else { state.catalog.push(normPiece(c)); ca++; }
    });
    (p.rooms || []).forEach((r) => {
      const items = (r.items || []).map((it) => { const pc = it.catalogId && piece(it.catalogId); return pc ? Object.assign({}, pc, { id: undefined, catalogId: pc.id, photos: undefined, status: undefined, link: undefined, notes: undefined }, it) : it; });
      const idx = r.id ? state.rooms.findIndex((x) => x.id === r.id) : -1;
      if (idx >= 0) {
        const ex = state.rooms[idx], merged = Object.assign({}, ex, r, { photos: r.photos || ex.photos });
        if (r.items) merged.items = items;
        state.rooms[idx] = normRoom(merged); ru++; first = first || ex.id;
      } else { const nr = normRoom(Object.assign({}, r, { items })); state.rooms.push(nr); ra++; first = first || nr.id; }
    });
    if (first) { state.activeRoomId = first; selected = null; roomTab = 'layout'; }
    const parts = [];
    if (ra) parts.push(`added ${plural(ra, 'room')}`); if (ru) parts.push(`updated ${plural(ru, 'room')}`);
    if (ca) parts.push(`added ${plural(ca, 'piece')}`); if (cu) parts.push(`updated ${plural(cu, 'piece')}`);
    return parts.length ? parts.join(', ').replace(/^./, (c) => c.toUpperCase()) : 'Nothing to add';
  }

  // Lightbox
  const lb = $('#lightbox'); let lbCur = null;
  async function openLightbox(owner, id) {
    lbCur = { owner, id }; $('#lbImg').src = (await getPhoto(id)) || '';
    const cap = $('#lbCap'), room = owner.startsWith('room:');
    cap.hidden = !room; cap.value = photoLabel(owner, id); lb.showModal();
  }
  $('#lbCap').addEventListener('change', (e) => {
    if (!lbCur || !lbCur.owner.startsWith('room:')) return;
    const r = state.rooms.find((x) => x.id === lbCur.owner.split(':')[1]); if (!r) return;
    const v = e.target.value.trim(); if (v) r.photoLabels[lbCur.id] = v; else delete r.photoLabels[lbCur.id];
    save(); refreshStrips(lbCur.owner);
  });
  lb.addEventListener('click', (e) => {
    const a = e.target.closest('[data-lb]'); if (!a && e.target !== lb) return;
    if (a && a.dataset.lb === 'delete' && lbCur) {
      const arr = ownerPhotos(lbCur.owner);
      if (arr) { const i = arr.indexOf(lbCur.id); if (i >= 0) arr.splice(i, 1); }
      if (lbCur.owner === 'draft') { if (draft.newPhotos.includes(lbCur.id)) Store.delPhoto(lbCur.id); else draft.removed.push(lbCur.id); }
      else {
        if (lbCur.id.startsWith('url:')) { if (!state.removedPhotos.includes(lbCur.id)) state.removedPhotos.push(lbCur.id); } else Store.delPhoto(lbCur.id);
        const r = lbCur.owner.startsWith('room:') && state.rooms.find((x) => x.id === lbCur.owner.split(':')[1]); if (r) delete r.photoLabels[lbCur.id];
        save(); renderRooms();
      }
      refreshStrips(lbCur.owner); toast('Photo deleted');
    }
    lb.close();
  });

  // ================= Actions =================
  function placePiece(p) {
    const r = room();
    const it = normItem(Object.assign({}, p, { id: undefined, catalogId: p.id, x: snap(r.width / 2), y: snap(r.length / 2), rot: 0 }), r);
    if (it.type === 'art') snapArt(it, r, wallTarget !== 'all' ? wallTarget : 'n');
    r.items.push(it); selected = { kind: 'item', id: it.id }; commit(); toast(`Placed ${p.name} in ${r.name}`);
  }
  function addFromLibrary(ci, ii) {
    const [type, name, w, d, h, color, extra] = LIBRARY[ci][1][ii], r = room();
    const it = normItem(Object.assign({ type, name, w, d, h, color, x: snap(r.width / 2), y: snap(r.length / 2) }, extra || {}), r);
    if (type === 'art') {
      it.frame = libFrame(color); it.mat = !['none', 'oakpanel'].includes(it.frame);
      if (it.frame === 'oakpanel') it.elev = 8; // sits on the skirting
      snapArt(it, r, wallTarget !== 'all' ? wallTarget : 'n');
    }
    r.items.push(it); selected = { kind: 'item', id: it.id }; commit();
  }
  function addOpening(type) {
    const r = room(), wall = wallTarget === 'all' ? 's' : wallTarget, len = wallLength(r, wall);
    const o = type === 'door' ? { id: 'o' + uid(), type, wall, offset: Math.min(20, Math.max(0, len - 90)), width: 90, height: 205, sill: 0 }
      : { id: 'o' + uid(), type, wall, offset: Math.max(0, Math.round((len - 120) / 2)), width: 120, height: 130, sill: 90, radiator: true };
    if (type === 'door') o.color = '#F7F6F2';
    r.openings.push(o); selected = { kind: 'opening', id: o.id }; commit();
  }
  const lockedMsg = () => toast('Built into the house: locked in place');
  function deleteSelected() {
    const r = room(); if (!selected) return;
    if (selected.kind === 'opening' && r.seedId) return lockedMsg();
    if (selItem() && selItem().fixed) return lockedMsg();
    if (selected.kind === 'item') r.items = r.items.filter((i) => i.id !== selected.id); else r.openings = r.openings.filter((o) => o.id !== selected.id);
    selected = null; commit();
  }
  function rotateSelected(deg) {
    const it = selItem(); if (!it) return;
    if (it.fixed) return lockedMsg();
    if (it.type === 'art') { const order = ['n', 'e', 's', 'w'], k = order[(order.indexOf(artWall(it)) + (deg < 0 ? 3 : 1)) % 4]; snapArt(it, room(), k); commit(); return; }
    it.rot = ((it.rot + deg) % 360 + 360) % 360; commit();
  }
  function duplicateSelected() {
    const it = selItem(); if (!it) return;
    const c = Object.assign(clone(it), { id: 'i' + uid(), x: it.x + 20, y: it.y + 20 });
    if (c.type === 'art') { const k = artWall(it); if (k === 'n' || k === 's') c.x = it.x + it.w + 15; else c.y = it.y + it.w + 15; snapArt(c, room(), k); }
    room().items.push(c); selected = { kind: 'item', id: c.id }; commit();
  }
  // Any common way of writing a color → #RRGGBB (null if it can't be read): hex with or without #, rgb(), hsl(),
  // hwb(), lab()/lch() where the browser knows them, CSS names, cmyk(c, m, y, k) in %, or three plain numbers as RGB.
  let colorCtx = null;
  function parseColor(str) {
    let v = String(str).trim(); if (!v) return null;
    if (/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) { v = v.replace('#', ''); if (v.length === 3) v = v.split('').map((c) => c + c).join(''); return '#' + v.toUpperCase(); }
    const cm = v.match(/^cmyk\(\s*([\d.]+)%?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?\s*\)$/i);
    if (cm) { const [c, m, y, k] = cm.slice(1).map((n) => Math.min(100, +n) / 100); return '#' + [c, m, y].map((x) => Math.round(255 * (1 - x) * (1 - k)).toString(16).padStart(2, '0')).join('').toUpperCase(); }
    const nums = v.match(/^(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})$/); if (nums) v = `rgb(${nums[1]}, ${nums[2]}, ${nums[3]})`;
    colorCtx = colorCtx || document.createElement('canvas').getContext('2d');
    colorCtx.fillStyle = '#010203'; colorCtx.fillStyle = v; const out = colorCtx.fillStyle;
    if (out === '#010203' && !/^#?010203$/i.test(v)) { colorCtx.fillStyle = '#040506'; colorCtx.fillStyle = v; if (colorCtx.fillStyle === '#040506') return null; }
    if (out.startsWith('#')) return out.toUpperCase();
    const rgb = out.match(/[\d.]+/g); return rgb ? '#' + rgb.slice(0, 3).map((n) => Math.round(+n).toString(16).padStart(2, '0')).join('').toUpperCase() : null;
  }
  function applyWallColor(h) { const r = room(); if (wallTarget === 'all') WALLS.forEach(([k]) => { r.walls[k] = h; }); else r.walls[wallTarget] = h; renderRoomPanel(); refreshDrawing(); }

  async function exportBackup() {
    const ids = new Set(); state.rooms.forEach((r) => r.photos.forEach((i) => ids.add(i))); state.catalog.forEach((p) => p.photos.forEach((i) => ids.add(i)));
    const photos = {}; for (const id of ids) { if (id.startsWith('url:')) continue; const u = await getPhoto(id); if (u) photos[id] = u; } // tour photos ship with the app
    const blob = new Blob([JSON.stringify({ format: 'house-planner-backup', version: 2, exportedAt: new Date().toISOString(), state, photos })], { type: 'application/json' });
    const slug = (state.name || 'House').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'House';
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${today()}_${slug}_Planner-Backup_v1.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    toast(`Exported backup with ${plural(Object.keys(photos).length, 'photo')}`);
  }
  async function importBackup(file) {
    try {
      const data = JSON.parse(await file.text());
      const s = data.format === 'house-planner-backup' ? data.state : data;
      if (!s || !Array.isArray(s.rooms)) throw new Error('This file is not a house planner backup.');
      if (!confirm('Replace the current plan with this backup? A version of the current plan is saved first.')) return;
      await saveVersion(`Before import, ${new Date().toLocaleString()}`);
      for (const [id, url] of Object.entries(data.photos || {})) { photoCache.set(id, url); try { await Store.putPhoto(id, url); } catch (e) { /* session only */ } }
      state = normState(s); selected = null; three.lastRoom = null; commit(); toast('Backup imported'); if ($('#saveDlg').open) $('#saveDlg').close();
    } catch (err) { alert(`Import failed: ${err.message}`); }
  }

  // ================= Events =================
  $$('.seg button').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; renderView(); }));
  $('#projectName').addEventListener('input', (e) => { state.name = e.target.value; save(); });
  $('#roomSwitch').addEventListener('change', (e) => switchRoom(e.target.value));
  $('#handoffBtn').addEventListener('click', handoffDialog);
  $('#roomList').addEventListener('click', (e) => { const b = e.target.closest('[data-room-id]'); if (b) switchRoom(b.dataset.roomId); });
  $('#eveningBtn').addEventListener('click', (e) => { evening = !evening; e.currentTarget.setAttribute('aria-pressed', String(evening)); build3D(); });
  $('#resetCam').addEventListener('click', () => { three.lastRoom = null; build3D(); });

  // Photos (global delegation so it works in panels and dialogs)
  let photoOwner = null;
  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-photo-add]');
    if (add) { photoOwner = add.dataset.photoAdd; $('#photoPicker').click(); return; }
    const op = e.target.closest('[data-photo-open]');
    if (op) openLightbox(op.dataset.owner, op.dataset.photoOpen);
  });
  $('#photoPicker').addEventListener('change', async (e) => {
    const files = [...e.target.files]; e.target.value = '';
    if (!files.length || !photoOwner) return;
    const owner = photoOwner; toast(`Adding ${plural(files.length, 'photo')}…`);
    const ids = await storePhotos(files), arr = ownerPhotos(owner);
    if (!arr) return;
    arr.push(...ids);
    if (owner === 'draft' && draft) draft.newPhotos.push(...ids); else { save(); renderRooms(); }
    refreshStrips(owner);
    if (owner.startsWith('room:')) renderRoomPanel(), hydratePhotos();
    toast(`Added ${plural(ids.length, 'photo')}`);
  });

  const rp = $('#roomPanel');
  rp.addEventListener('input', (e) => {
    const r = room(), t = e.target;
    if (t.dataset.room === 'name' || t.dataset.room === 'notes') { r[t.dataset.room] = t.value; if (t.dataset.room === 'name') { renderRooms(); rp.querySelector('h2').textContent = t.value; } save(); renderStatus(); }
    else if (t.id === 'paintPick') { $('#paintCode').value = t.value.toUpperCase(); }
    else if (t.dataset.wall) { r.walls[t.dataset.wall] = t.value; t.parentElement.querySelector('code').textContent = t.value.toUpperCase(); refreshDrawing(); }
  });
  rp.addEventListener('change', (e) => {
    const r = room(), t = e.target, f = t.dataset.room;
    if (f === 'level') { r.level = t.value.trim() || 'Ground floor'; commit(); }
    else if (t.dataset.wallfinish) { r.wallFinish[t.dataset.wallfinish] = WALL_FINISHES[t.value] ? t.value : 'paint'; commit(); }
    else if (t.id === 'wallTarget') { wallTarget = t.value; renderRoomPanel(); renderPlan(); }
  });
  rp.addEventListener('click', (e) => {
    const t = e.target, r = room();
    const tab = t.closest('[data-room-tab]'); if (tab) { roomTab = tab.dataset.roomTab; renderRoomPanel(); return; }
    const sw = t.closest('.sw');
    if (sw) { applyWallColor(sw.dataset.hex); return; }
    const dp = t.closest('[data-del-paint]'); if (dp) { state.paints = state.paints.filter((p) => p.id !== dp.dataset.delPaint); commit(); return; }
    if (t.id === 'paintAdd') {
      const code = $('#paintCode').value.trim(), hx = code ? parseColor(code) : $('#paintPick').value.toUpperCase();
      if (!hx) { toast('Could not read that color. Try #E8E0D5, rgb(232 224 213), hsl(40 25% 87%), cmyk(0 3 8 9) or a name like beige.'); return; }
      const name = $('#paintName').value.trim() || hx;
      const ex = state.paints.find((p) => p.hex === hx); if (ex) ex.name = name; else state.paints.push({ id: 'c' + uid(), name, hex: hx });
      applyWallColor(hx); commit(); toast(`${name} added to your palette`); return;
    }
    if (t.id === 'paintSaveWalls') {
      let n = 0; WALLS.forEach(([k, nm]) => { const hx = r.walls[k].toUpperCase(); if (!state.paints.some((p) => p.hex === hx)) { state.paints.push({ id: 'c' + uid(), name: `${r.name}, ${nm.toLowerCase()} wall`, hex: hx }); n++; } });
      commit(); toast(n ? `${n} color${n > 1 ? 's' : ''} saved to your palette` : 'Those colors are already in your palette'); return;
    }
    const add = t.closest('[data-add-opening]'); if (add) return addOpening(add.dataset.addOpening);
    const so = t.closest('[data-select-opening]'); if (so) { selected = { kind: 'opening', id: so.dataset.selectOpening }; renderRoomPanel(); renderInspector(); renderPlan(); return; }
    if (t.id === 'dupRoom') {
      const c = Object.assign(clone(r), { id: 'r' + uid(), name: r.name + ' copy', photos: [] });
      delete c.seedId; delete c.seedRev; // a copy is your own room, not the starter
      c.items.forEach((i) => { i.id = 'i' + uid(); }); c.openings.forEach((o) => { o.id = 'o' + uid(); });
      state.rooms.push(c); state.activeRoomId = c.id; selected = null; commit(); toast('Room duplicated (photos stay with the original)'); return;
    }
    if (t.id === 'delRoom') {
      if (state.rooms.length < 2 || !confirm(`Delete "${r.name}" with its photos and furniture placements? Pieces in My pieces are kept.`)) return;
      r.photos.forEach((id) => Store.delPhoto(id));
      if (r.seedId && !state.removedRooms.includes(r.seedId)) state.removedRooms.push(r.seedId);
      state.rooms = state.rooms.filter((x) => x.id !== r.id); state.activeRoomId = state.rooms[0].id; selected = null; commit(); return;
    }
    const row = t.closest('.wallrow[data-target]'); if (row && t.tagName !== 'INPUT') { wallTarget = row.dataset.target; renderRoomPanel(); renderPlan(); }
  });

  const ins = $('#inspector');
  ins.addEventListener('input', (e) => {
    const t = e.target, it = selItem(); if (!it) return;
    if (t.dataset.item === 'color') { it.color = t.value; t.parentElement.querySelector('code').textContent = t.value.toUpperCase(); syncToPiece(it); refreshDrawing(); }
    if (t.dataset.item === 'name') { it.name = t.value; ins.querySelector('h2').textContent = t.value; syncToPiece(it); refreshDrawing(); }
  });
  ins.addEventListener('change', (e) => {
    const t = e.target, it = selItem(), op = selOpening();
    if (it && t.dataset.item && !['color', 'name'].includes(t.dataset.item)) {
      const f = t.dataset.item;
      if (f === 'rot') it.rot = ((num(t.value, -3600, 3600, it.rot) % 360) + 360) % 360;
      else if (f === 'x' || f === 'y') it[f] = num(t.value, -1000, 5000, it[f]);
      else if (f === 'elev') it.elev = num(t.value, 0, 800, it.elev);
      else if (f === 'kelvin') it.kelvin = Number(t.value);
      else if (f === 'power') it.power = t.value;
      else if (f === 'side') it.side = t.value === 'left' ? 'left' : 'right';
      else if (f === 'doors') it.doors = SHELF_DOORS[t.value] ? t.value : 'none';
      else if (f === 'books') it.books = t.checked;
      else if (f === 'frame') { it.frame = ART_FRAMES[t.value] ? t.value : 'black'; if (['none', 'oakpanel'].includes(it.frame)) it.mat = false; }
      else if (f === 'mat') it.mat = t.value === 'cream' ? 'cream' : !!t.value;
      else it[f] = num(t.value, 1, 3000, it[f]);
      syncToPiece(it); commit();
    }
    if (it && it.type === 'art' && t.dataset.art) {
      const f = t.dataset.art, r = room();
      if (f === 'wall') snapArt(it, r, t.value);
      else if (f === 'along') { const k = artWall(it); if (k === 'n' || k === 's') it.x = num(t.value, 0, 5000, it.x); else it.y = num(t.value, 0, 5000, it.y); snapArt(it, r, k); }
      else if (f === 'centre') it.elev = Math.max(0, num(t.value, 0, 800, it.elev + it.h / 2) - it.h / 2);
      syncToPiece(it); commit(); return;
    }
    if (it && it.type === 'art' && (t.dataset.item === 'w' || t.dataset.item === 'h')) { setTimeout(() => { const a = selItem(); if (a && a.type === 'art') { snapArt(a, room(), artWall(a)); commit(); } }, 0); }
    if (op && t.dataset.op) {
      const f = t.dataset.op;
      if (f === 'type') { op.type = t.value; if (op.type === 'door') { op.sill = 0; op.height = 205; op.radiator = false; op.color = op.color || '#F7F6F2'; } else { op.sill = 90; op.height = 130; op.radiator = true; } }
      else if (f === 'wall') op.wall = t.value;
      else if (f === 'radiator') op.radiator = t.checked;
      else if (f === 'leaf') op.leaf = t.checked;
      else if (f === 'swingIn') op.swing = t.checked ? 'in' : 'out';
      else if (f === 'nicheShelf') op.nicheShelf = t.checked;
      else if (f === 'niche') op.niche = num(t.value, 0, 100, 0);
      else if (f === 'color') op.color = hex(t.value, op.color);
      else op[f] = num(t.value, 0, 3000, op[f]);
      commit();
    }
  });
  ins.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    const it = selItem();
    ({ rotate: () => rotateSelected(90), duplicate: duplicateSelected, delete: deleteSelected,
      editPiece: () => it && pieceDialog(piece(it.catalogId)),
      savePiece: () => it && pieceDialog(null, { from: it, linkItem: it }),
      artPicture: () => $('#artPicker').click(),
      artClear: () => { if (it) { delete it.image; syncToPiece(it); if (it.catalogId && piece(it.catalogId)) delete piece(it.catalogId).image; state.rooms.forEach((r) => r.items.forEach((x) => { if (it.catalogId && x.catalogId === it.catalogId) delete x.image; })); commit(); } } })[a.dataset.act]();
  });
  // Picture for the selected artwork: stored like room photos (downscaled, in this browser)
  $('#artPicker').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; const it = selItem();
    if (!f || !it || it.type !== 'art') return;
    toast('Adding picture…'); const [id] = await storePhotos([f]); if (!id) return;
    it.image = id; syncToPiece(it); commit(); toast('Picture added');
  });

  $('#catalogPanel').addEventListener('click', (e) => {
    const t = e.target;
    const tab = t.closest('[data-cat-tab]'); if (tab) { catTab = tab.dataset.catTab; renderCatalog(); return; }
    if (t.closest('[data-new-piece]')) return pieceDialog(null);
    const pl = t.closest('[data-place]'); if (pl) return placePiece(piece(pl.dataset.place));
    const ed = t.closest('[data-edit-piece]'); if (ed) return pieceDialog(piece(ed.dataset.editPiece));
    const lib = t.closest('[data-lib]'); if (lib) { const [ci, ii] = lib.dataset.lib.split(':').map(Number); addFromLibrary(ci, ii); }
  });

  $('#savePanel').addEventListener('click', async (e) => {
    const t = e.target;
    if (t.id === 'saveVersion') { if (await saveVersion(valOf('versionName'))) $('#versionName').value = ''; return; }
    if (t.id === 'exportBtn') return exportBackup();
    if (t.id === 'importBtn') return $('#importInput').click();
    const rs = t.closest('[data-restore]');
    if (rs) {
      const v = (await Store.listVersions()).find((x) => x.id === rs.dataset.restore); if (!v) return;
      if (!confirm(`Restore "${v.name}"? The current plan is saved as a version first.`)) return;
      await saveVersion(`Before restore, ${new Date().toLocaleString()}`);
      state = normState(v.data); selected = null; three.lastRoom = null; commit(); toast(`Restored "${v.name}"`); $('#saveDlg').close(); return;
    }
    const dv = t.closest('[data-del-version]');
    if (dv && confirm('Delete this saved version?')) { await Store.delVersion(dv.dataset.delVersion); renderSavePanel(); }
  });
  const saveDlg = $('#saveDlg');
  $('#saveBtn').addEventListener('click', () => { renderSavePanel(); saveDlg.showModal(); });
  saveDlg.addEventListener('click', (e) => { if (e.target === saveDlg || e.target.closest('[data-close-save]')) saveDlg.close(); });
  document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); flushSave(); renderSavePanel(); if (!saveDlg.open) saveDlg.showModal(); } });
  $('#savePanel').addEventListener('keydown', (e) => { if (e.target.id === 'versionName' && e.key === 'Enter') $('#saveVersion').click(); });
  $('#importInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importBackup(f); });

  // Plan: select, drag, wall pick
  const svg = $('#plan'); let drag = null;
  const svgPoint = (e) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
  svg.addEventListener('pointerdown', (e) => {
    const r = room(), ig = e.target.closest('.item'), og = e.target.closest('.opening'), wg = e.target.closest('.wall');
    if (ig) {
      const it = r.items.find((i) => i.id === ig.dataset.item), p = svgPoint(e);
      selected = { kind: 'item', id: it.id }; drag = it.fixed ? null : { it, dx: p.x - it.x, dy: p.y - it.y, moved: false, x0: it.x, y0: it.y, rot0: it.rot };
      if (drag) svg.setPointerCapture(e.pointerId); renderInspector(); renderPlan();
    } else if (og) { selected = { kind: 'opening', id: og.dataset.opening }; renderRoomPanel(); renderInspector(); renderPlan(); }
    else if (wg) { wallTarget = wg.dataset.wall; selected = null; roomTab = 'layout'; renderRoomPanel(); renderInspector(); renderPlan(); }
    else if (selected) { selected = null; renderRoomPanel(); renderInspector(); renderPlan(); }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = svgPoint(e), nx = snap(p.x - drag.dx), ny = snap(p.y - drag.dy);
    if (nx !== drag.it.x || ny !== drag.it.y) {
      drag.it.x = nx; drag.it.y = ny; if (drag.it.type === 'art') snapArt(drag.it, room());
      drag.moved = true; renderPlan(); schedule3D();
    }
  });
  const endDrag = () => {
    if (drag && drag.moved) {
      const r = room(), it = drag.it;
      if (inSwing(it, doorZones(r), r) && !inSwing(Object.assign({}, it, { x: drag.x0, y: drag.y0, rot: drag.rot0 }), doorZones(r), r)) {
        it.x = drag.x0; it.y = drag.y0; it.rot = drag.rot0; renderPlan(); schedule3D(); toast('Keep the door swing clear: moved it back');
      }
      save(); renderInspector(); renderStatus();
    }
    drag = null;
  };
  svg.addEventListener('pointerup', endDrag); svg.addEventListener('pointercancel', endDrag);

  document.addEventListener('keydown', (e) => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || modal.open || lb.open || !selected) return;
    const it = selItem();
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
    else if (e.key === 'Escape') { selected = null; renderAll(); }
    else if (it && (e.key === 'r' || e.key === 'R')) rotateSelected(e.shiftKey ? -15 : 90);
    else if (it && it.fixed && e.key.startsWith('Arrow')) { e.preventDefault(); lockedMsg(); }
    else if (it && e.key.startsWith('Arrow')) {
      e.preventDefault(); const step = e.shiftKey ? 25 : SNAP;
      if (e.key === 'ArrowLeft') it.x -= step; if (e.key === 'ArrowRight') it.x += step;
      if (e.key === 'ArrowUp') it.y -= step; if (e.key === 'ArrowDown') it.y += step;
      renderInspector(); refreshDrawing();
    }
  });

  // ================= Start =================
  renderAll(); renderSavePanel(); renderView();
})();
