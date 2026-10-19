// Šifrovanje s kraja na kraj (radi u pregledniku i u Node.js testovima, preko Web Crypto API-ja).
//
// Ideja:
// - Svaki biznis ima par ključeva (ECDH P-256). Javni ključ je na serveru i svako ga može dobiti.
// - Privatni ključ je zaključan ključem izvedenim iz lozinke biznisa (PBKDF2). Lozinka NIKAD ne ide
//   na server: iz nje se izvede "auth" (za prijavu) i "ključ omota" (ostaje u pregledniku).
// - Klijent na javnom profilu zaključa ime i telefon javnim ključem biznisa prije slanja.
//   Otključati ih može samo biznis, u svom pregledniku.
// - Kod oporavka je druga brava na istom privatnom ključu, za slučaj zaboravljene lozinke.
//
// Server (pa ni vlasnica Konekta) nema ništa čime bi mogao otključati podatke klijenata.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const ITERACIJE_LOZINKA = 600000;
const ITERACIJE_KOD = 100000;
const KRIVULJA = { name: 'ECDH', namedCurve: 'P-256' };

export function uB64(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function izB64(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}

const nasumicno = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
export const novaSol = () => uB64(nasumicno(16));

// Iz lozinke: ključ omota (ostaje u pregledniku) + auth (šalje se serveru umjesto lozinke).
export async function izLozinke(lozinka, sol) {
  const baza = await subtle.importKey('raw', enc.encode(String(lozinka).normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bitovi = new Uint8Array(await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: izB64(sol), iterations: ITERACIJE_LOZINKA }, baza, 512,
  ));
  const kljucOmota = await subtle.importKey('raw', bitovi.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { kljucOmota, auth: uB64(bitovi.slice(32)) };
}

async function zakljucaj(kljucAes, podaci) {
  const iv = nasumicno(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, kljucAes, podaci);
  return { iv: uB64(iv), ct: uB64(ct) };
}

async function otkljucaj(kljucAes, omot) {
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: izB64(omot.iv) }, kljucAes, izB64(omot.ct)));
}

// ---------- Par ključeva biznisa ----------
export async function noviParKljuceva() {
  const par = await subtle.generateKey(KRIVULJA, true, ['deriveBits']);
  return {
    javni: uB64(await subtle.exportKey('spki', par.publicKey)),
    pkcs8: new Uint8Array(await subtle.exportKey('pkcs8', par.privateKey)),
  };
}

export const zakljucajPrivatni = (kljucOmota, pkcs8) => zakljucaj(kljucOmota, pkcs8);
export const otkljucajPkcs8 = (kljucOmota, omot) => otkljucaj(kljucOmota, omot);

// Privatni ključ za upotrebu: ne može se izvesti iz preglednika (extractable = false).
export const uveziPrivatni = (pkcs8) => subtle.importKey('pkcs8', pkcs8, KRIVULJA, false, ['deriveBits']);

// ---------- Kod oporavka ----------
const ABECEDA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bez I, O, 0 i 1 da se ne miješaju
export function noviKod() {
  const b = nasumicno(20); // 20 znakova x 5 bita = 100 bita
  return Array.from(b, (x) => ABECEDA[x % 32]).join('').match(/.{4}/g).join('-');
}
export const ocistiKod = (kod) => String(kod).toUpperCase().replace(/[^A-Z0-9]/g, '');

async function izKoda(kod, sol) {
  const baza = await subtle.importKey('raw', enc.encode(ocistiKod(kod)), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: izB64(sol), iterations: ITERACIJE_KOD },
    baza, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export async function zakljucajKodom(kod, pkcs8) {
  const sol = novaSol();
  return { sol, ...(await zakljucaj(await izKoda(kod, sol), pkcs8)) };
}

export async function otkljucajKodom(kod, omot) {
  return otkljucaj(await izKoda(kod, omot.sol), omot);
}

// ---------- Podaci klijenta ----------
async function dijeljeniKljuc(privatni, javni) {
  const bitovi = await subtle.deriveBits({ name: 'ECDH', public: javni }, privatni, 256);
  const hk = await subtle.importKey('raw', bitovi, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('konekt-termin-v1') },
    hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

// Klijent zaključava { ime, telefon } javnim ključem biznisa. Rezultat: "v1.<efemerni>.<iv>.<sifrat>".
export async function sifrujZaBiznis(javniB64, objekat) {
  const javni = await subtle.importKey('spki', izB64(javniB64), KRIVULJA, false, []);
  const efemerni = await subtle.generateKey(KRIVULJA, true, ['deriveBits']);
  const kljuc = await dijeljeniKljuc(efemerni.privateKey, javni);
  const iv = nasumicno(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, kljuc, enc.encode(JSON.stringify(objekat)));
  const efemRaw = await subtle.exportKey('raw', efemerni.publicKey);
  return `v1.${uB64(efemRaw)}.${uB64(iv)}.${uB64(ct)}`;
}

// Biznis otključava svojim privatnim ključem. Baca grešku ako ključ ne odgovara.
export async function desifrujZaBiznis(privatni, blob) {
  const [v, e, iv, ct] = String(blob).split('.');
  if (v !== 'v1' || !e || !iv || !ct) throw new Error('Nepoznat format.');
  const efemerni = await subtle.importKey('raw', izB64(e), KRIVULJA, false, []);
  const kljuc = await dijeljeniKljuc(privatni, efemerni);
  const tekst = await subtle.decrypt({ name: 'AES-GCM', iv: izB64(iv) }, kljuc, izB64(ct));
  return JSON.parse(dec.decode(tekst));
}

// ---------- Sve za novi račun / nove ključeve ----------
// Vraća ono što ide serveru (bez ičega tajnog) + kod oporavka i privatni ključ za preglednik.
export async function pripremiNoviRacun(lozinka) {
  const sol = novaSol();
  const { kljucOmota, auth } = await izLozinke(lozinka, sol);
  const { javni, pkcs8 } = await noviParKljuceva();
  const kod = noviKod();
  return {
    zaServer: {
      sol, auth, javni_kljuc: javni,
      kljuc_lozinkom: await zakljucajPrivatni(kljucOmota, pkcs8),
      kljuc_kodom: await zakljucajKodom(kod, pkcs8),
    },
    kod,
    privatni: await uveziPrivatni(pkcs8),
  };
}
