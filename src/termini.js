// Računanje slobodnih termina.
import { db } from './baza.js';
import { sada, danUSedmici, dodajDane } from './vrijeme.js';

const stmtRadno = db.prepare('SELECT od_min, do_min, pauza_od, pauza_do FROM radno_vrijeme WHERE biznis_id = ? AND dan = ?');
const stmtNeradni = db.prepare('SELECT 1 FROM neradni_dani WHERE biznis_id = ? AND datum = ?');
const stmtZauzeto = db.prepare(`SELECT od_min, do_min FROM termini
  WHERE biznis_id = ? AND datum = ? AND status IN ('ceka','potvrden')`);

/**
 * Čista funkcija (lako se testira): vraća početke (u minutama od ponoći) slobodnih termina.
 * radno: { od_min, do_min, pauza_od, pauza_do } ili null ako taj dan ne radi
 * zauzeto: [{ od_min, do_min }] postojeći termini i blokade
 * odMinimalno: najranija minuta od koje se smije zakazati (zbog najave)
 */
export function izracunajSlobodne({ radno, zauzeto, trajanje, korak, odMinimalno = 0 }) {
  if (!radno || trajanje <= 0 || korak <= 0) return [];
  const prepreke = [...zauzeto];
  if (radno.pauza_od != null && radno.pauza_do != null && radno.pauza_od < radno.pauza_do) {
    prepreke.push({ od_min: radno.pauza_od, do_min: radno.pauza_do });
  }
  const rezultat = [];
  for (let pocetak = radno.od_min; pocetak + trajanje <= radno.do_min; pocetak += korak) {
    if (pocetak < odMinimalno) continue;
    const kraj = pocetak + trajanje;
    if (prepreke.some((p) => p.od_min < kraj && p.do_min > pocetak)) continue;
    rezultat.push(pocetak);
  }
  return rezultat;
}

// Granice u kojima klijent smije zakazivati: od danas do danas + (dana_unaprijed - 1).
export function prozorZakazivanja(biznis, trenutak = sada()) {
  return { prvi: trenutak.datum, zadnji: dodajDane(trenutak.datum, Math.max(0, biznis.dana_unaprijed - 1)) };
}

const stmtImaTermina = db.prepare(`SELECT 1 FROM termini WHERE biznis_id = ? AND datum = ? AND status IN ('ceka','potvrden') LIMIT 1`);

/**
 * Usluga od N radnih dana: klijent ostavlja (npr. auto) na početku radnog vremena prvog dana.
 * Traži N radnih dana zaredom (neradni dani se preskaču) koji su potpuno slobodni.
 * Vraća { od_min, dani: [{ datum, od_min, do_min }] } ili null.
 */
export function visednevniTermin(biznis, brojDana, datum, trenutak = sada()) {
  const { prvi, zadnji } = prozorZakazivanja(biznis, trenutak);
  if (datum < prvi || datum > zadnji) return null;
  const prviRadno = !stmtNeradni.get(biznis.id, datum) && stmtRadno.get(biznis.id, danUSedmici(datum));
  if (!prviRadno) return null;
  // Najava: predaja na otvaranju mora biti bar najava_min od sada.
  if (datum === trenutak.datum && trenutak.minute + biznis.najava_min > prviRadno.od_min) return null;
  if (datum === dodajDane(trenutak.datum, 1) && trenutak.minute + biznis.najava_min - 1440 > prviRadno.od_min) return null;
  const dani = [];
  for (let d = datum, koraka = 0; dani.length < brojDana && koraka < 120; d = dodajDane(d, 1), koraka++) {
    if (stmtNeradni.get(biznis.id, d)) continue;
    const r = stmtRadno.get(biznis.id, danUSedmici(d));
    if (!r) continue;
    if (stmtImaTermina.get(biznis.id, d)) return null; // svaki dan rada mora biti potpuno slobodan
    dani.push({ datum: d, od_min: r.od_min, do_min: r.do_min });
  }
  if (dani.length < brojDana) return null;
  return { od_min: dani[0].od_min, dani };
}

const stmtHitno = db.prepare('SELECT od_min, do_min FROM hitno_vrijeme WHERE biznis_id = ? AND dan = ?');

// Hitni termini: biznis bira dane i sate kad ih prima, i kraću najavu.
// Postojeći termini i blokade i dalje se poštuju (nema preklapanja).
export function slobodniTermini(biznis, usluga, datum, trenutak = sada(), { hitno = false } = {}) {
  if (hitno && !biznis.hitni_aktivno) return [];
  const { prvi, zadnji } = prozorZakazivanja(biznis, trenutak);
  if (datum < prvi || datum > zadnji) return [];
  if (stmtNeradni.get(biznis.id, datum)) return [];
  const radno = hitno ? stmtHitno.get(biznis.id, danUSedmici(datum)) : stmtRadno.get(biznis.id, danUSedmici(datum));
  if (!radno) return [];

  // Najava: ne može se zakazati manje od najava_min minuta unaprijed.
  let odMinimalno = 0;
  const granica = trenutak.minute + (hitno ? biznis.hitni_najava_min : biznis.najava_min);
  if (datum === trenutak.datum) odMinimalno = granica;
  else if (datum === dodajDane(trenutak.datum, 1) && granica > 1440) odMinimalno = granica - 1440;

  return izracunajSlobodne({
    radno,
    zauzeto: stmtZauzeto.all(biznis.id, datum),
    trajanje: usluga.trajanje_min,
    korak: biznis.korak_min,
    odMinimalno,
  });
}
