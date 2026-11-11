'use strict';
// Which peer addresses may supply X-Forwarded-For. Only Caddy should qualify. The ingress network
// is a /16 that also contains the bridge gateway (the VPS host itself) and this container, and the
// host can reach this container directly, so a range alone is too wide: the network and broadcast
// addresses, the gateway (first host) and every address of this container are always excluded.
const net = require('node:net');
const os = require('node:os');
const toInt = ip => ip.split('.').reduce((n, part) => (n << 8 | Number(part)) >>> 0, 0);
function canonical(ip) {
  if (typeof ip !== 'string' || ip.includes('%')) return null;
  const family = net.isIP(ip);
  if (family === 4) return ip;
  if (family !== 6) return null;
  let host; try { host = new URL('http://[' + ip + ']/').hostname.slice(1, -1); } catch { return null; }
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!mapped) return host;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}
function localAddresses() {
  const found = [];
  for (const list of Object.values(os.networkInterfaces())) for (const entry of list || []) { const c = canonical(entry.address); if (c) found.push(c); }
  return found;
}
// spec: { ip: single legacy address, cidr: one private IPv4 range, exclude: comma list, local: own addresses }
function parseTrustedProxies({ ip, cidr, exclude, local = localAddresses() } = {}) {
  const exact = new Set(), excluded = new Set();
  for (const own of local) { const c = canonical(own); if (c) excluded.add(c); }
  for (const item of String(exclude || '').split(',').map(s => s.trim()).filter(Boolean)) { const c = canonical(item); if (!c) throw Error('Invalid trusted proxy exclusion'); excluded.add(c); }
  if (ip) { const c = canonical(ip); if (!c) throw Error('Invalid trusted proxy address'); exact.add(c); }
  let range = null;
  if (cidr) {
    const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(String(cidr).trim());
    if (!m || net.isIP(m[1]) !== 4) throw Error('Invalid trusted proxy range');
    const prefix = Number(m[2]), base = toInt(m[1]);
    if (prefix < 16 || prefix > 30) throw Error('Trusted proxy range must be /16 to /30');
    const mask = (0xffffffff << (32 - prefix)) >>> 0, network = (base & mask) >>> 0;
    if (network !== base) throw Error('Trusted proxy range must start at its network address');
    const private_ = (network >>> 24 === 10) || (network >>> 20 === (172 << 4 | 1)) || (network >>> 16 === (192 << 8 | 168));
    if (!private_) throw Error('Trusted proxy range must be private');
    const broadcast = (network | (~mask >>> 0)) >>> 0;
    range = { network, broadcast, gateway: (network + 1) >>> 0, mask };
  }
  const blocked = address => excluded.has(address) || (range && (toInt(address) === range.network || toInt(address) === range.broadcast || toInt(address) === range.gateway));
  return Object.freeze({
    configured: exact.size > 0 || range !== null,
    trusts(address) {
      const c = canonical(address); if (!c) return false;
      if (exact.has(c)) return !excluded.has(c);
      if (!range || net.isIP(c) !== 4 || blocked(c)) return false;
      return (toInt(c) & range.mask) >>> 0 === range.network;
    }
  });
}
module.exports = { parseTrustedProxies, localAddresses, canonical };
