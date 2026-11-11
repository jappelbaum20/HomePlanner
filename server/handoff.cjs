'use strict';
// Short-lived proof that a browser just completed Google sign-in for a subject that is not (yet)
// approved. It grants no data access: it only lets that browser view its request status and submit
// one request. Signed (HMAC) with a key derived from the auth secret under its own label, bound to
// issuer, subject, verified email, issue time and expiry, and carries its own CSRF token.
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const COOKIE = '__Host-hp-request', TTL = 600, ISSUER = 'https://accounts.google.com';
const SUBJECT = /^[\x21-\x7e]{1,255}$/, TOKEN = /^[A-Za-z0-9_-]{43}$/;
const keyFor = secret => createHmac('sha256', secret).update('homeplanner-request-handoff-v1\0').digest();
const mac = (secret, body) => createHmac('sha256', keyFor(secret)).update(body).digest('base64url');
function seal(secret, claims, now = Date.now()) {
  const iat = Math.floor(now / 1000), csrf = randomBytes(32).toString('base64url');
  const payload = { v: 1, iss: claims.issuer, sub: claims.subject, email: claims.email, name: claims.name || '', iat, exp: iat + TTL, csrf };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { value: body + '.' + mac(secret, body), csrf, maxAge: TTL };
}
function open(secret, value, now = Date.now()) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  const parts = value.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !TOKEN.test(parts[1])) return null;
  const expected = Buffer.from(mac(secret, parts[0])), given = Buffer.from(parts[1]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let p; try { p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { return null; }
  const t = Math.floor(now / 1000);
  if (!p || p.v !== 1 || p.iss !== ISSUER || typeof p.sub !== 'string' || !SUBJECT.test(p.sub) || typeof p.email !== 'string' || p.email !== p.email.toLowerCase() || p.email.length > 254 || typeof p.name !== 'string' || p.name.length > 120 ||
      !Number.isInteger(p.iat) || !Number.isInteger(p.exp) || p.exp - p.iat !== TTL || p.iat > t + 5 || p.exp <= t || typeof p.csrf !== 'string' || !TOKEN.test(p.csrf)) return null;
  return { issuer: p.iss, subject: p.sub, email: p.email, name: p.name, csrf: p.csrf, expiresAt: p.exp };
}
function fromRequest(secret, req, now) {
  const header = req.headers?.cookie; if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    if (part.slice(0, i).trim() === COOKIE) return open(secret, part.slice(i + 1).trim(), now);
  }
  return null;
}
const cookieOptions = { maxAge: TTL, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' };
function setCookieHeader(value, maxAge = TTL) { return `${COOKIE}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`; }
function csrfMatches(handoff, token) {
  if (typeof token !== 'string' || !TOKEN.test(token)) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(handoff.csrf));
}
module.exports = { COOKIE, TTL, ISSUER, seal, open, fromRequest, cookieOptions, setCookieHeader, csrfMatches };
