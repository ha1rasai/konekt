// Smještaj (vikendice, apartmani, kuće za odmor): rezervacija po noćenjima.
// Svaka noć je jedan red u tabeli termini (od 00:00 do 24:00), a sve noći jednog boravka
// povezane su istim brojem "veza". Zaštita od duplih rezervacija je isti trigger u bazi.
import { db } from './baza.js';
import { GreskaKorisnika } from './srednji.js';
import { sada, jeDatum, dodajDane, danUSedmici, uMinute } from './vrijeme.js';
import { prozorZakazivanja } from './termini.js';

export const MAKS_NOCI = 60;
export const jeSmjestaj = (b) => b.kategorija === 'smjestaj';

const stmtZauzeto = db.prepare(`SELECT DISTINCT datum FROM termini
  WHERE biznis_id = ? AND datum BETWEEN ? AND ? AND status IN ('ceka','potvrden')`);
const stmtZatvoreno = db.prepare('SELECT datum FROM neradni_dani WHERE biznis_id = ? AND datum BETWEEN ? AND ?');

// Noći (datumi) koje nisu slobodne: rezervisane ili zatvorene (neradni dani).
export function zauzeteNoci(b, od, doDatum) {
  return [...new Set([
    ...stmtZauzeto.all(b.id, od, doDatum).map((r) => r.datum),
    ...stmtZatvoreno.all(b.id, od, doDatum).map((r) => r.datum),
  ])].sort();
}

// Noći boravka: od dana dolaska do dana prije odlaska.
export function nociBoravka(dolazak, odlazak) {
  const noci = [];
  for (let d = dolazak; d < odlazak && noci.length <= MAKS_NOCI; d = dodajDane(d, 1)) noci.push(d);
  return noci;
}

// Petak i subota su "vikend noći" (ako domaćin ima posebnu cijenu za vikend).
export function cijenaBoravka(b, noci) {
  if (b.smj_cijena == null) return null;
  const ukupno = noci.reduce((z, d) => {
    const vikend = [5, 6].includes(danUSedmici(d)) && b.smj_cijena_vikend != null;
    return z + Number(vikend ? b.smj_cijena_vikend : b.smj_cijena);
  }, 0);
  return Math.round(ukupno * 100) / 100;
}

// Provjera boravka prije upisa. Vraća listu noći ili baca grešku s jasnom porukom.
export function provjeriBoravak(b, dolazak, odlazak, { rucno = false, trenutak = sada() } = {}) {
  if (!jeDatum(dolazak) || !jeDatum(odlazak)) throw new GreskaKorisnika('Izaberi datum dolaska i odlaska.');
  if (odlazak <= dolazak) throw new GreskaKorisnika('Odlazak mora biti poslije dolaska.');
  const noci = nociBoravka(dolazak, odlazak);
  if (noci.length > MAKS_NOCI) throw new GreskaKorisnika(`Najviše ${MAKS_NOCI} noćenja u jednoj rezervaciji.`);
  if (!rucno) {
    if (noci.length < b.smj_min_noci) throw new GreskaKorisnika(`Najmanje ${b.smj_min_noci} ${b.smj_min_noci === 1 ? 'noćenje' : 'noćenja'}.`);
    const { prvi, zadnji } = prozorZakazivanja(b, trenutak);
    if (dolazak < prvi) throw new GreskaKorisnika('Dolazak ne može biti u prošlosti.');
    if (dolazak > zadnji) throw new GreskaKorisnika('Taj datum još nije otvoren za rezervacije.');
    // Najava: za dolazak danas mora ostati bar najava_min do vremena dolaska.
    const dolazakMin = uMinute(b.smj_dolazak) ?? 14 * 60;
    if (dolazak === trenutak.datum && trenutak.minute + b.najava_min > dolazakMin) {
      throw new GreskaKorisnika('Za danas je prekasno. Izaberi drugi datum dolaska.');
    }
  }
  const zauzeto = new Set(zauzeteNoci(b, noci[0], noci.at(-1)));
  if (noci.some((d) => zauzeto.has(d))) throw new GreskaKorisnika('Neke od izabranih noći su zauzete. Izaberi druge datume.', 409);
  return noci;
}

// Upis boravka: po jedan red za svaku noć, povezani brojem "veza" (id prve noći).
export function upisiBoravak(b, noci, { status, izvor, podaci, token = null, cijena = null }) {
  const upis = db.prepare(`INSERT INTO termini (biznis_id, usluga_naziv, vrsta, datum, od_min, do_min, status, izvor, podaci_sif, otkaz_token, cijena, veza)
    VALUES (?, 'Smještaj', 'termin', ?, 0, 1440, ?, ?, ?, ?, ?, ?)`);
  let veza = null;
  db.exec('BEGIN IMMEDIATE');
  try {
    noci.forEach((d, i) => {
      const r = upis.run(b.id, d, status, izvor, podaci, i === 0 ? token : null, i === 0 ? cijena : null, veza);
      if (i === 0) {
        veza = Number(r.lastInsertRowid);
        db.prepare('UPDATE termini SET veza = ? WHERE id = ?').run(veza, veza);
      }
    });
    db.exec('COMMIT');
  } catch (g) {
    db.exec('ROLLBACK');
    if (String(g.message).includes('TERMIN_ZAUZET')) throw new GreskaKorisnika('Neko je upravo rezervisao neku od tih noći. Izaberi druge datume.', 409);
    throw g;
  }
  return veza;
}
