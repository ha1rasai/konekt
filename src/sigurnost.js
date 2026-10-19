// Heširanje "auth" vrijednosti i tokena.
// Imena i telefoni klijenata se NE šifruju ovdje: zaključava ih preglednik (public/js/kripto.js),
// a server nema ključ kojim bi ih otključao.
import { randomBytes, scrypt, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { konfig } from './konfig.js';

const scryptAsync = promisify(scrypt);

// "auth" je izveden iz lozinke u pregledniku; server ga dodatno hešira prije upisa u bazu.
export async function hesirajLozinku(auth) {
  const so = randomBytes(16);
  const hes = await scryptAsync(auth, so, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${so.toString('base64url')}$${hes.toString('base64url')}`;
}

export async function provjeriLozinku(auth, sacuvano) {
  const [alg, so, hes] = String(sacuvano).split('$');
  if (alg !== 'scrypt' || !so || !hes) return false;
  const ocekivano = Buffer.from(hes, 'base64url');
  const dobijeno = await scryptAsync(String(auth), Buffer.from(so, 'base64url'), ocekivano.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(ocekivano, dobijeno);
}

export const noviToken = () => randomBytes(32).toString('base64url');
export const hesTokena = (token) => createHmac('sha256', konfig.pepper).update(String(token)).digest('hex');

// Lažna sol za nepostojeći email (uvijek ista za isti email), da se ne može provjeriti ko ima račun.
export const laznaSol = (email) => createHmac('sha256', konfig.pepper).update(`sol:${email}`).digest().subarray(0, 16).toString('base64url');
