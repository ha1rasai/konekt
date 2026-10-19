// Pravi adresu profila (npr. konekt.ba/salon-amra) iz naziva.
import { db } from './baza.js';

export const REZERVISANO = new Set([
  'api', 'admin', 'panel', 'prijava', 'registracija', 'odjava', 'reset', 'nova-lozinka', 'zaboravljena-lozinka',
  'uslovi', 'privatnost', 'otkazi', 'css', 'js', 'img', 'fonts', 'favicon.ico', 'favicon.svg', 'manifest.webmanifest',
  'robots.txt', 'konekt', 'demo', 'pomoc', 'kontakt', 'cijene', 'o-nama', 'blog', 'www', 'app', 'static', 'public',
]);

export function napraviSlug(tekst) {
  const mapa = { č: 'c', ć: 'c', š: 's', ž: 'z', đ: 'dj', Č: 'c', Ć: 'c', Š: 's', Ž: 'z', Đ: 'dj' };
  return String(tekst)
    .replace(/[čćšžđČĆŠŽĐ]/g, (z) => mapa[z])
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export const ispravanSlug = (s) => /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(s) && !REZERVISANO.has(s);

const stmtPostoji = db.prepare('SELECT id FROM biznisi WHERE slug = ?');

export function slobodanSlug(osnova, osimId = null) {
  let baza = napraviSlug(osnova);
  if (baza.length < 3) baza = `profil-${baza || 'novi'}`.replace(/-+$/, '');
  if (REZERVISANO.has(baza)) baza = `${baza}-profil`;
  for (let i = 1; i < 1000; i++) {
    const kandidat = i === 1 ? baza : `${baza.slice(0, 36)}-${i}`;
    const postoji = stmtPostoji.get(kandidat);
    if (!postoji || postoji.id === osimId) return kandidat;
  }
  return `${baza.slice(0, 30)}-${Date.now().toString(36)}`;
}

export function slugZauzet(slug, osimId) {
  const postoji = stmtPostoji.get(slug);
  return Boolean(postoji && postoji.id !== osimId);
}
