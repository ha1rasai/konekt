// Provjera oblika podataka za šifrovanje s kraja na kraj (server ih samo čuva, ne razumije ih).
import { GreskaKorisnika } from './srednji.js';

const B64 = /^[A-Za-z0-9_-]+$/;

const b64 = (v, min, max) => typeof v === 'string' && B64.test(v) && v.length >= min && v.length <= max;

export function provjeriAuth(v) {
  if (!b64(v, 43, 43)) throw new GreskaKorisnika('Neispravan zahtjev za prijavu.');
  return v;
}

export function provjeriSol(v) {
  if (!b64(v, 22, 22)) throw new GreskaKorisnika('Neispravan zahtjev.');
  return v;
}

export function provjeriJavniKljuc(v) {
  if (!b64(v, 80, 200)) throw new GreskaKorisnika('Neispravan javni ključ.');
  return v;
}

// Omot privatnog ključa: { iv, ct } ili { sol, iv, ct } -> čuva se kao JSON tekst.
export function provjeriOmot(v, { saSoli = false } = {}) {
  const ok = v && typeof v === 'object'
    && b64(v.iv, 16, 16) && b64(v.ct, 100, 400)
    && (!saSoli || b64(v.sol, 22, 22));
  if (!ok) throw new GreskaKorisnika('Neispravan zaključani ključ.');
  return JSON.stringify(saSoli ? { sol: v.sol, iv: v.iv, ct: v.ct } : { iv: v.iv, ct: v.ct });
}

// Zaključani podaci klijenta: "v1.<efemerni>.<iv>.<sifrat>"
export function provjeriPodatke(v) {
  if (typeof v !== 'string' || v.length > 3000 || !/^v1\.[A-Za-z0-9_-]{80,100}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{20,2800}$/.test(v)) {
    throw new GreskaKorisnika('Podaci nisu ispravno zaključani. Osvježi stranicu i pokušaj ponovo.');
  }
  return v;
}

export const procitajOmot = (tekst) => (tekst ? JSON.parse(tekst) : null);
