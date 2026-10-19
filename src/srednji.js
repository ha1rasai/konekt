// Middleware: sesije, zaštita od CSRF-a, ograničenje broja zahtjeva i pomoćne funkcije.
import { db } from './baza.js';
import { konfig } from './konfig.js';
import { hesTokena, noviToken } from './sigurnost.js';

export const KOLACIC = 'konekt_sesija';
const TRAJANJE_SESIJE_DANA = 30;

export class GreskaKorisnika extends Error {
  constructor(poruka, status = 400) {
    super(poruka);
    this.status = status;
  }
}

// ---------- Kolačići ----------
function procitajKolacice(req) {
  const rezultat = {};
  for (const dio of (req.headers.cookie || '').split(';')) {
    const i = dio.indexOf('=');
    if (i > 0) rezultat[dio.slice(0, i).trim()] = decodeURIComponent(dio.slice(i + 1).trim());
  }
  return rezultat;
}

const stmtNovaSesija = db.prepare("INSERT INTO sesije (token_hash, biznis_id, istice) VALUES (?, ?, datetime('now', ?))");
const stmtSesija = db.prepare(`SELECT b.* FROM sesije s JOIN biznisi b ON b.id = s.biznis_id
  WHERE s.token_hash = ? AND s.istice > datetime('now')`);
const stmtObrisiSesiju = db.prepare('DELETE FROM sesije WHERE token_hash = ?');

export function otvoriSesiju(res, biznisId) {
  const token = noviToken();
  stmtNovaSesija.run(hesTokena(token), biznisId, `+${TRAJANJE_SESIJE_DANA} days`);
  res.cookie(KOLACIC, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: konfig.produkcija,
    maxAge: TRAJANJE_SESIJE_DANA * 24 * 3600 * 1000,
    path: '/',
  });
}

export function zatvoriSesiju(req, res) {
  const token = procitajKolacice(req)[KOLACIC];
  if (token) stmtObrisiSesiju.run(hesTokena(token));
  res.clearCookie(KOLACIC, { path: '/' });
}

// Učita prijavljeni biznis (ako postoji) u req.biznis.
export function ucitajSesiju(req, _res, next) {
  const token = procitajKolacice(req)[KOLACIC];
  req.biznis = token ? stmtSesija.get(hesTokena(token)) || null : null;
  next();
}

export const jeAdmin = (biznis) => Boolean(biznis && konfig.adminEmails.includes(String(biznis.email).toLowerCase()));

export function zahtijevaPrijavu(req, res, next) {
  if (!req.biznis) return res.status(401).json({ greska: 'Prijavi se ponovo.' });
  next();
}

export function zahtijevaAdmina(req, res, next) {
  // Isti odgovor kao za nepostojeću adresu, da niko ne zna da admin dio postoji.
  if (!jeAdmin(req.biznis)) return res.status(404).json({ greska: 'Ne postoji.' });
  next();
}

// ---------- CSRF ----------
// Svaki zahtjev koji mijenja podatke mora imati zaglavlje X-Konekt: 1.
// Drugi sajtovi ne mogu poslati to zaglavlje bez dozvole preglednika.
export function zastitaCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Konekt') !== '1') return res.status(403).json({ greska: 'Zahtjev je odbijen.' });
  const origin = req.get('Origin');
  if (origin) {
    const dozvoljeno = new Set([konfig.javniUrl, `${req.protocol}://${req.get('host')}`]);
    if (!dozvoljeno.has(origin)) return res.status(403).json({ greska: 'Zahtjev je odbijen.' });
  }
  next();
}

// ---------- Ograničenje broja zahtjeva (u memoriji) ----------
const brojaci = new Map();
export function ograniciZahtjeve(ime, maks, prozorMinuta) {
  const prozor = prozorMinuta * 60 * 1000;
  return (req, res, next) => {
    if (process.env.KONEKT_TEST === 'bez-limita') return next();
    const kljuc = `${ime}:${req.ip}`;
    const sad = Date.now();
    let z = brojaci.get(kljuc);
    if (!z || z.reset < sad) z = { broj: 0, reset: sad + prozor };
    z.broj += 1;
    brojaci.set(kljuc, z);
    if (z.broj > maks) {
      res.set('Retry-After', String(Math.ceil((z.reset - sad) / 1000)));
      return res.status(429).json({ greska: 'Previše pokušaja. Pokušaj ponovo malo kasnije.' });
    }
    next();
  };
}
setInterval(() => {
  const sad = Date.now();
  for (const [k, z] of brojaci) if (z.reset < sad) brojaci.delete(k);
}, 10 * 60 * 1000).unref();

// ---------- Validacija ----------
export function tekst(vrijednost, { ime, min = 0, max = 200, obavezno = false } = {}) {
  const s = String(vrijednost ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (obavezno && !s) throw new GreskaKorisnika(`Polje "${ime}" je obavezno.`);
  if (s.length < min) throw new GreskaKorisnika(`Polje "${ime}" mora imati bar ${min} znakova.`);
  if (s.length > max) throw new GreskaKorisnika(`Polje "${ime}" može imati najviše ${max} znakova.`);
  return s;
}

export function cijeliBroj(vrijednost, { ime, min, max }) {
  const n = Number(vrijednost);
  if (!Number.isInteger(n) || n < min || n > max) throw new GreskaKorisnika(`Polje "${ime}" mora biti broj od ${min} do ${max}.`);
  return n;
}

export const jeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254;

// Omotač za async rute: greške idu u zajednički rukovalac.
export const asinhrono = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
