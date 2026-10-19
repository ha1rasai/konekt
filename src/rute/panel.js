// Panel za vlasnika profila. Svaki upit je ograničen na req.biznis.id,
// pa vlasnik vidi i mijenja samo svoje podatke.
import { Router } from 'express';
import { db, transakcija } from '../baza.js';
import { konfig } from '../konfig.js';
import { provjeriPodatke } from '../e2e.js';
import { zahtijevaPrijavu, tekst, cijeliBroj, GreskaKorisnika } from '../srednji.js';
import { ID_TEMA, TEME, KATEGORIJE, ID_KATEGORIJA } from '../teme.js';
import { ispravanSlug, slugZauzet, napraviSlug } from '../slug.js';
import { jeDatum, uMinute, uSate, sada, dodajDane } from '../vrijeme.js';
import { stanjePretplate } from '../pretplata.js';
import { provjeriBoravak, upisiBoravak, jeSmjestaj } from '../smjestaj.js';

export const rutePanel = Router();
rutePanel.use(zahtijevaPrijavu);

const svjez = (id) => db.prepare('SELECT * FROM biznisi WHERE id = ?').get(id);

function prikazBiznisa(b) {
  return {
    kategorija_tekst: b.kategorija_tekst,
    email: b.email, vlasnik_ime: b.vlasnik_ime, vlasnik_prezime: b.vlasnik_prezime, naziv: b.naziv, slug: b.slug, kategorija: b.kategorija, opis: b.opis,
    adresa: b.adresa, grad: b.grad, telefon: b.telefon, instagram: b.instagram, tema: b.tema,
    logoUrl: b.logo_tip ? `/api/logo/${b.slug}?v=${b.logo_verzija}` : null,
    pozadinaUrl: b.pozadina_tip ? `/api/pozadina/${b.slug}?v=${b.pozadina_verzija}` : null,
    potvrda_obavezna: Boolean(b.potvrda_obavezna), korak_min: b.korak_min, najava_min: b.najava_min,
    dana_unaprijed: b.dana_unaprijed, email_obavijesti: Boolean(b.email_obavijesti),
    napomena_klijenta: Boolean(b.napomena_klijenta),
    hitni_aktivno: Boolean(b.hitni_aktivno), hitni_doplata: b.hitni_doplata, hitni_najava_min: b.hitni_najava_min,
    hitni_potvrda: Boolean(b.hitni_potvrda),
    smjestaj: jeSmjestaj(b),
    smj_cijena: b.smj_cijena, smj_cijena_vikend: b.smj_cijena_vikend, smj_min_noci: b.smj_min_noci,
    smj_max_gostiju: b.smj_max_gostiju, smj_dolazak: b.smj_dolazak, smj_odlazak: b.smj_odlazak,
    javniLink: `${konfig.javniUrl}/${b.slug}`,
    javni_kljuc: b.javni_kljuc,
    pretplata: stanjePretplate(b),
  };
}

rutePanel.get('/biznis', (req, res) => {
  res.json({ biznis: prikazBiznisa(req.biznis), teme: TEME, kategorije: KATEGORIJE });
});

rutePanel.put('/biznis', (req, res) => {
  const b = req.body || {};
  const izmjene = {};
  if ('naziv' in b) izmjene.naziv = tekst(b.naziv, { ime: 'Naziv', obavezno: true, min: 2, max: 80 });
  if ('opis' in b) izmjene.opis = tekst(b.opis, { ime: 'Opis', max: 600 });
  if ('adresa' in b) izmjene.adresa = tekst(b.adresa, { ime: 'Adresa', max: 120 });
  if ('grad' in b) izmjene.grad = tekst(b.grad, { ime: 'Grad', max: 60 });
  if ('telefon' in b) izmjene.telefon = tekst(b.telefon, { ime: 'Telefon', max: 30 });
  if ('instagram' in b) {
    izmjene.instagram = tekst(b.instagram, { ime: 'Instagram', max: 60 })
      .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/\/.*$/, '');
    if (izmjene.instagram && !/^[A-Za-z0-9._]{1,30}$/.test(izmjene.instagram)) throw new GreskaKorisnika('Instagram korisničko ime nije ispravno.');
  }
  if ('kategorija' in b) {
    if (!ID_KATEGORIJA.has(b.kategorija)) throw new GreskaKorisnika('Nepoznata kategorija.');
    izmjene.kategorija = b.kategorija;
  }
  if ('kategorija_tekst' in b || 'kategorija' in b) {
    const kat = izmjene.kategorija ?? req.biznis.kategorija;
    izmjene.kategorija_tekst = kat === 'ostalo'
      ? tekst(b.kategorija_tekst ?? req.biznis.kategorija_tekst, { ime: 'Djelatnost', obavezno: true, min: 2, max: 60 })
      : '';
  }
  if ('tema' in b) {
    if (!ID_TEMA.has(b.tema)) throw new GreskaKorisnika('Nepoznata tema.');
    izmjene.tema = b.tema;
  }
  if ('slug' in b) {
    const slug = napraviSlug(b.slug);
    if (!ispravanSlug(slug)) throw new GreskaKorisnika('Adresa profila mora imati 3–40 znakova (slova, brojevi i crtice) i ne smije biti rezervisana riječ.');
    if (slugZauzet(slug, req.biznis.id)) throw new GreskaKorisnika('Ta adresa je zauzeta. Izaberi drugu.');
    izmjene.slug = slug;
  }
  if ('potvrda_obavezna' in b) izmjene.potvrda_obavezna = b.potvrda_obavezna ? 1 : 0;
  if ('vlasnik_ime' in b) izmjene.vlasnik_ime = tekst(b.vlasnik_ime, { ime: 'Ime vlasnika', obavezno: true, min: 2, max: 40 });
  if ('vlasnik_prezime' in b) izmjene.vlasnik_prezime = tekst(b.vlasnik_prezime, { ime: 'Prezime vlasnika', obavezno: true, min: 2, max: 40 });
  if ('napomena_klijenta' in b) izmjene.napomena_klijenta = b.napomena_klijenta ? 1 : 0;
  if ('hitni_aktivno' in b) izmjene.hitni_aktivno = b.hitni_aktivno ? 1 : 0;
  if ('hitni_doplata' in b) izmjene.hitni_doplata = cijeliBroj(b.hitni_doplata, { ime: 'Doplata za hitan termin (%)', min: 0, max: 300 });
  if ('hitni_potvrda' in b) izmjene.hitni_potvrda = b.hitni_potvrda ? 1 : 0;
  // Smještaj
  const cijenaIli = (v, ime) => {
    const s = String(v ?? '').replace(',', '.').trim();
    if (s === '') return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0 || n > 100000) throw new GreskaKorisnika(`${ime} nije ispravna.`);
    return n;
  };
  if ('smj_cijena' in b) izmjene.smj_cijena = cijenaIli(b.smj_cijena, 'Cijena po noći');
  if ('smj_cijena_vikend' in b) izmjene.smj_cijena_vikend = cijenaIli(b.smj_cijena_vikend, 'Cijena za vikend');
  if ('smj_min_noci' in b) izmjene.smj_min_noci = cijeliBroj(b.smj_min_noci, { ime: 'Najmanje noćenja', min: 1, max: 30 });
  if ('smj_max_gostiju' in b) izmjene.smj_max_gostiju = cijeliBroj(b.smj_max_gostiju, { ime: 'Najviše gostiju', min: 1, max: 50 });
  if ('smj_dolazak' in b) {
    if (uMinute(b.smj_dolazak) == null) throw new GreskaKorisnika('Vrijeme dolaska nije ispravno.');
    izmjene.smj_dolazak = b.smj_dolazak;
  }
  if ('smj_odlazak' in b) {
    if (uMinute(b.smj_odlazak) == null) throw new GreskaKorisnika('Vrijeme odlaska nije ispravno.');
    izmjene.smj_odlazak = b.smj_odlazak;
  }
  if ('hitni_najava_min' in b) izmjene.hitni_najava_min = cijeliBroj(b.hitni_najava_min, { ime: 'Najava za hitan termin', min: 0, max: 1440 });
  if ('email_obavijesti' in b) izmjene.email_obavijesti = b.email_obavijesti ? 1 : 0;
  if ('korak_min' in b) {
    izmjene.korak_min = cijeliBroj(b.korak_min, { ime: 'Razmak između termina', min: 5, max: 240 });
  }
  if ('najava_min' in b) izmjene.najava_min = cijeliBroj(b.najava_min, { ime: 'Najava', min: 0, max: 10080 });
  if ('dana_unaprijed' in b) izmjene.dana_unaprijed = cijeliBroj(b.dana_unaprijed, { ime: 'Dana unaprijed', min: 1, max: 365 });

  const kljucevi = Object.keys(izmjene);
  if (kljucevi.length) {
    db.prepare(`UPDATE biznisi SET ${kljucevi.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...kljucevi.map((k) => izmjene[k]), req.biznis.id);
  }
  res.json({ biznis: prikazBiznisa(svjez(req.biznis.id)) });
});

// ---------- Logo / profilna slika ----------
// Slika se u pregledniku smanji na 512x512 i pošalje kao data URL.
function prepoznajSliku(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function procitajSliku(dataUrl, maksKB) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new GreskaKorisnika('Slika mora biti PNG, JPG ili WEBP.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > maksKB * 1024) throw new GreskaKorisnika(`Slika je prevelika (najviše ${maksKB} KB).`);
  const tip = prepoznajSliku(buf);
  if (!tip) throw new GreskaKorisnika('Fajl nije ispravna slika.');
  return { buf, tip };
}

rutePanel.put('/logo', (req, res) => {
  const { buf, tip } = procitajSliku(req.body?.slika, 700);
  db.prepare('UPDATE biznisi SET logo = ?, logo_tip = ?, logo_verzija = logo_verzija + 1 WHERE id = ?').run(buf, tip, req.biznis.id);
  res.json({ biznis: prikazBiznisa(svjez(req.biznis.id)) });
});

rutePanel.delete('/logo', (req, res) => {
  db.prepare('UPDATE biznisi SET logo = NULL, logo_tip = NULL, logo_verzija = logo_verzija + 1 WHERE id = ?').run(req.biznis.id);
  res.json({ biznis: prikazBiznisa(svjez(req.biznis.id)) });
});

// ---------- Pozadinska slika (iz galerije) ----------
// Preglednik je smanji na najviše 1600 px. Boje kartica i dugmadi i dalje daje izabrana tema.
rutePanel.put('/pozadina', (req, res) => {
  const { buf, tip } = procitajSliku(req.body?.slika, 1500);
  db.prepare('UPDATE biznisi SET pozadina = ?, pozadina_tip = ?, pozadina_verzija = pozadina_verzija + 1 WHERE id = ?').run(buf, tip, req.biznis.id);
  res.json({ biznis: prikazBiznisa(svjez(req.biznis.id)) });
});

rutePanel.delete('/pozadina', (req, res) => {
  db.prepare('UPDATE biznisi SET pozadina = NULL, pozadina_tip = NULL, pozadina_verzija = pozadina_verzija + 1 WHERE id = ?').run(req.biznis.id);
  res.json({ biznis: prikazBiznisa(svjez(req.biznis.id)) });
});

// ---------- Radno vrijeme ----------
const stmtRadnoSve = db.prepare('SELECT * FROM radno_vrijeme WHERE biznis_id = ? ORDER BY dan');

function prikazRadnog(biznisId) {
  const redovi = new Map(stmtRadnoSve.all(biznisId).map((r) => [r.dan, r]));
  return Array.from({ length: 7 }, (_, i) => {
    const r = redovi.get(i + 1);
    return r
      ? { dan: i + 1, radi: true, od: uSate(r.od_min), do: uSate(r.do_min), pauza_od: r.pauza_od != null ? uSate(r.pauza_od) : '', pauza_do: r.pauza_do != null ? uSate(r.pauza_do) : '' }
      : { dan: i + 1, radi: false, od: '09:00', do: '17:00', pauza_od: '', pauza_do: '' };
  });
}

rutePanel.get('/radno-vrijeme', (req, res) => res.json({ dani: prikazRadnog(req.biznis.id) }));

rutePanel.put('/radno-vrijeme', (req, res) => {
  const dani = Array.isArray(req.body?.dani) ? req.body.dani : [];
  const NAZIVI = ['', 'ponedjeljak', 'utorak', 'srijedu', 'četvrtak', 'petak', 'subotu', 'nedjelju'];
  const redovi = [];
  for (const d of dani) {
    const dan = cijeliBroj(d.dan, { ime: 'Dan', min: 1, max: 7 });
    if (!d.radi) continue;
    const od = uMinute(d.od);
    const doM = uMinute(d.do);
    if (od == null || doM == null || od >= doM) throw new GreskaKorisnika(`Provjeri radno vrijeme za ${NAZIVI[dan]}.`);
    let pOd = null;
    let pDo = null;
    if (d.pauza_od || d.pauza_do) {
      pOd = uMinute(d.pauza_od);
      pDo = uMinute(d.pauza_do);
      if (pOd == null || pDo == null || pOd >= pDo || pOd < od || pDo > doM) {
        throw new GreskaKorisnika(`Pauza za ${NAZIVI[dan]} mora biti unutar radnog vremena.`);
      }
    }
    redovi.push([dan, od, doM, pOd, pDo]);
  }
  transakcija(() => {
    db.prepare('DELETE FROM radno_vrijeme WHERE biznis_id = ?').run(req.biznis.id);
    const ins = db.prepare('INSERT INTO radno_vrijeme (biznis_id, dan, od_min, do_min, pauza_od, pauza_do) VALUES (?, ?, ?, ?, ?, ?)');
    for (const r of redovi) ins.run(req.biznis.id, ...r);
  });
  res.json({ dani: prikazRadnog(req.biznis.id) });
});

// ---------- Hitni termini: kada se primaju ----------
const stmtHitnoSve = db.prepare('SELECT * FROM hitno_vrijeme WHERE biznis_id = ? ORDER BY dan');

function prikazHitnog(biznisId) {
  const redovi = new Map(stmtHitnoSve.all(biznisId).map((r) => [r.dan, r]));
  return Array.from({ length: 7 }, (_, i) => {
    const r = redovi.get(i + 1);
    return r ? { dan: i + 1, radi: true, od: uSate(r.od_min), do: uSate(r.do_min) } : { dan: i + 1, radi: false, od: '08:00', do: '20:00' };
  });
}

rutePanel.get('/hitno-vrijeme', (req, res) => res.json({ dani: prikazHitnog(req.biznis.id) }));

rutePanel.put('/hitno-vrijeme', (req, res) => {
  const dani = Array.isArray(req.body?.dani) ? req.body.dani : [];
  const redovi = [];
  for (const d of dani) {
    const dan = cijeliBroj(d.dan, { ime: 'Dan', min: 1, max: 7 });
    if (!d.radi) continue;
    const od = uMinute(d.od);
    const doM = uMinute(d.do);
    if (od == null || doM == null || od >= doM) throw new GreskaKorisnika('Provjeri vrijeme za hitne termine (od mora biti prije do).');
    redovi.push([dan, od, doM]);
  }
  transakcija(() => {
    db.prepare('DELETE FROM hitno_vrijeme WHERE biznis_id = ?').run(req.biznis.id);
    const ins = db.prepare('INSERT INTO hitno_vrijeme (biznis_id, dan, od_min, do_min) VALUES (?, ?, ?, ?)');
    for (const r of redovi) ins.run(req.biznis.id, ...r);
  });
  res.json({ dani: prikazHitnog(req.biznis.id) });
});

// ---------- Neradni dani ----------
rutePanel.get('/neradni-dani', (req, res) => {
  const redovi = db.prepare('SELECT datum FROM neradni_dani WHERE biznis_id = ? AND datum >= ? ORDER BY datum').all(req.biznis.id, sada().datum);
  res.json({ dani: redovi.map((r) => r.datum) });
});

rutePanel.post('/neradni-dani', (req, res) => {
  const { od, do: doD } = req.body || {};
  if (!jeDatum(od)) throw new GreskaKorisnika('Izaberi datum.');
  const zadnji = doD && jeDatum(doD) ? doD : od;
  if (zadnji < od) throw new GreskaKorisnika('Krajnji datum je prije početnog.');
  const ins = db.prepare('INSERT OR IGNORE INTO neradni_dani (biznis_id, datum) VALUES (?, ?)');
  transakcija(() => {
    let d = od;
    for (let i = 0; i < 366 && d <= zadnji; i++, d = dodajDane(d, 1)) ins.run(req.biznis.id, d);
  });
  res.json({ ok: true });
});

rutePanel.delete('/neradni-dani/:datum', (req, res) => {
  db.prepare('DELETE FROM neradni_dani WHERE biznis_id = ? AND datum = ?').run(req.biznis.id, req.params.datum);
  res.json({ ok: true });
});

// ---------- Usluge ----------
const stmtUsluge = db.prepare('SELECT id, naziv, opis, grupa, trajanje_min, dani, cijena, aktivna, redoslijed FROM usluge WHERE biznis_id = ? AND obrisana = 0 ORDER BY redoslijed, id');

function procitajUslugu(b) {
  const cijenaTekst = String(b.cijena ?? '').replace(',', '.').trim();
  let cijena = null;
  if (cijenaTekst !== '') {
    cijena = Number(cijenaTekst);
    if (!Number.isFinite(cijena) || cijena < 0 || cijena > 100000) throw new GreskaKorisnika('Cijena nije ispravna.');
  }
  return {
    naziv: tekst(b.naziv, { ime: 'Naziv usluge', obavezno: true, max: 80 }),
    opis: tekst(b.opis, { ime: 'Opis usluge', max: 300 }),
    grupa: tekst(b.grupa, { ime: 'Grupa', max: 50 }),
    // Trajanje: do 12 sati u minutama, ili 1–30 radnih dana (tada se zauzimaju cijeli dani).
    dani: b.dani ? cijeliBroj(b.dani, { ime: 'Trajanje u danima', min: 1, max: 30 }) : 0,
    trajanje: b.dani ? 60 : cijeliBroj(b.trajanje_min, { ime: 'Trajanje (u minutama, najviše 12 sati)', min: 5, max: 720 }),
    cijena,
    aktivna: b.aktivna === false ? 0 : 1,
  };
}

rutePanel.get('/usluge', (req, res) => res.json({ usluge: stmtUsluge.all(req.biznis.id) }));

rutePanel.post('/usluge', (req, res) => {
  const u = procitajUslugu(req.body || {});
  const broj = db.prepare('SELECT COUNT(*) AS n FROM usluge WHERE biznis_id = ? AND obrisana = 0').get(req.biznis.id).n;
  if (broj >= 300) throw new GreskaKorisnika('Možeš imati najviše 300 usluga.');
  db.prepare('INSERT INTO usluge (biznis_id, naziv, opis, grupa, trajanje_min, dani, cijena, aktivna, redoslijed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.biznis.id, u.naziv, u.opis, u.grupa, u.trajanje, u.dani, u.cijena, u.aktivna, broj);
  res.status(201).json({ usluge: stmtUsluge.all(req.biznis.id) });
});

rutePanel.put('/usluge/:id', (req, res) => {
  const u = procitajUslugu(req.body || {});
  const r = db.prepare('UPDATE usluge SET naziv = ?, opis = ?, grupa = ?, trajanje_min = ?, dani = ?, cijena = ?, aktivna = ? WHERE id = ? AND biznis_id = ? AND obrisana = 0')
    .run(u.naziv, u.opis, u.grupa, u.trajanje, u.dani, u.cijena, u.aktivna, Number(req.params.id), req.biznis.id);
  if (!r.changes) throw new GreskaKorisnika('Usluga nije pronađena.', 404);
  res.json({ usluge: stmtUsluge.all(req.biznis.id) });
});

rutePanel.put('/usluge-redoslijed', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  const upd = db.prepare('UPDATE usluge SET redoslijed = ? WHERE id = ? AND biznis_id = ?');
  transakcija(() => ids.forEach((id, i) => upd.run(i, id, req.biznis.id)));
  res.json({ usluge: stmtUsluge.all(req.biznis.id) });
});

rutePanel.delete('/usluge/:id', (req, res) => {
  // Meko brisanje: stari termini zadržavaju naziv usluge.
  db.prepare('UPDATE usluge SET obrisana = 1, aktivna = 0 WHERE id = ? AND biznis_id = ?').run(Number(req.params.id), req.biznis.id);
  res.json({ usluge: stmtUsluge.all(req.biznis.id) });
});

// ---------- Kalendar i termini ----------
function prikazTermina(t) {
  return {
    id: t.id, vrsta: t.vrsta, datum: t.datum, od: uSate(t.od_min), do: uSate(t.do_min),
    od_min: t.od_min, do_min: t.do_min, status: t.status, izvor: t.izvor, usluga: t.usluga_naziv,
    hitan: Boolean(t.hitan), cijena: t.cijena, potvrdio: Boolean(t.potvrdio),
    veza: t.veza, dan_br: t.dan_br, dana_ukupno: t.dana_ukupno,
    // Zaključano ime i telefon; otključava ih preglednik vlasnika.
    podaci: t.podaci_sif, napomena: t.napomena, kreirano: t.kreirano,
  };
}

rutePanel.get('/termini', (req, res) => {
  const datum = req.query.datum;
  if (!jeDatum(datum)) throw new GreskaKorisnika('Neispravan datum.');
  // Za višednevne termine: koji je ovo dan po redu (dan_br) od ukupno (dana_ukupno).
  const VISEDNEVNO = `, (SELECT COUNT(*) FROM termini x WHERE x.veza = t.veza) AS dana_ukupno,
    (SELECT COUNT(*) FROM termini x WHERE x.veza = t.veza AND x.datum <= t.datum) AS dan_br`;
  const redovi = db.prepare(`SELECT t.*${VISEDNEVNO} FROM termini t WHERE t.biznis_id = ? AND t.datum = ?
    AND t.status IN ('ceka','potvrden') ORDER BY t.od_min`).all(req.biznis.id, datum);
  const otkazani = db.prepare(`SELECT t.*${VISEDNEVNO} FROM termini t WHERE t.biznis_id = ? AND t.datum = ?
    AND t.status IN ('odbijen','otkazan') AND t.vrsta = 'termin' ORDER BY t.od_min`).all(req.biznis.id, datum);
  const neradan = Boolean(db.prepare('SELECT 1 FROM neradni_dani WHERE biznis_id = ? AND datum = ?').get(req.biznis.id, datum));
  res.json({ termini: redovi.map(prikazTermina), otkazani: otkazani.map(prikazTermina), neradan });
});

// Broj termina po danu (za tačkice u kalendaru).
rutePanel.get('/termini/pregled', (req, res) => {
  const { od, do: doD } = req.query;
  if (!jeDatum(od) || !jeDatum(doD)) throw new GreskaKorisnika('Neispravan raspon.');
  const redovi = db.prepare(`SELECT datum, COUNT(*) AS broj, SUM(status = 'ceka') AS ceka FROM termini
    WHERE biznis_id = ? AND datum BETWEEN ? AND ? AND vrsta = 'termin' AND status IN ('ceka','potvrden')
    GROUP BY datum`).all(req.biznis.id, od, doD);
  res.json({ dani: redovi });
});

rutePanel.get('/termini/na-cekanju', (req, res) => {
  // Višednevni termin se na čekanju prikazuje jednom (prvi dan).
  const redovi = db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM termini x WHERE x.veza = t.veza) AS dana_ukupno, 1 AS dan_br
    FROM termini t WHERE t.biznis_id = ? AND t.status = 'ceka' AND t.datum >= ? AND (t.veza IS NULL OR t.veza = t.id)
    ORDER BY t.datum, t.od_min LIMIT 100`).all(req.biznis.id, sada().datum);
  res.json({ termini: redovi.map(prikazTermina) });
});

function upisiTermin(vrijednosti) {
  try {
    return db.prepare(`INSERT INTO termini (biznis_id, usluga_id, usluga_naziv, vrsta, datum, od_min, do_min, status, izvor, podaci_sif, napomena)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...vrijednosti);
  } catch (g) {
    if (String(g.message).includes('TERMIN_ZAUZET')) throw new GreskaKorisnika('To vrijeme se preklapa s drugim terminom ili blokadom.', 409);
    throw g;
  }
}

// Ručno dodavanje termina (npr. klijent je zvao telefonom).
rutePanel.post('/termini', (req, res) => {
  const b = req.body || {};
  if (!jeDatum(b.datum)) throw new GreskaKorisnika('Izaberi datum.');
  const od = uMinute(b.od);
  if (od == null) throw new GreskaKorisnika('Upiši vrijeme početka.');
  const usluga = db.prepare('SELECT * FROM usluge WHERE id = ? AND biznis_id = ? AND obrisana = 0').get(Number(b.usluga_id), req.biznis.id);
  if (!usluga) throw new GreskaKorisnika('Izaberi uslugu.');
  if (usluga.dani) throw new GreskaKorisnika('Usluga koja traje više dana upisuje se kroz "Blokiraj vrijeme" za svaki dan, ili je klijent zakaže preko linka.');
  const trajanje = b.trajanje_min ? cijeliBroj(b.trajanje_min, { ime: 'Trajanje', min: 5, max: 720 }) : usluga.trajanje_min;
  if (od + trajanje > 1440) throw new GreskaKorisnika('Termin ne može prelaziti ponoć.');
  // Ime i telefon je zaključao preglednik vlasnika njegovim javnim ključem.
  const podaci = provjeriPodatke(b.podaci_sif);
  upisiTermin([req.biznis.id, usluga.id, usluga.naziv, 'termin', b.datum, od, od + trajanje, 'potvrden', 'rucno', podaci, '']);
  res.status(201).json({ ok: true });
});

// Ručni upis boravka (gost je zvao telefonom). Ime, telefon i broj gostiju zaključava preglednik vlasnika.
rutePanel.post('/boravak', (req, res) => {
  const b = req.body || {};
  if (!jeSmjestaj(req.biznis)) throw new GreskaKorisnika('Ovo je samo za smještaj.');
  const noci = provjeriBoravak(req.biznis, b.dolazak, b.odlazak, { rucno: true });
  upisiBoravak(req.biznis, noci, { status: 'potvrden', izvor: 'rucno', podaci: provjeriPodatke(b.podaci_sif) });
  res.status(201).json({ ok: true, noci: noci.length });
});

// Blokiranje vremena (pauza, privatna obaveza...).
rutePanel.post('/blokade', (req, res) => {
  const b = req.body || {};
  if (!jeDatum(b.datum)) throw new GreskaKorisnika('Izaberi datum.');
  const od = uMinute(b.od);
  const doM = uMinute(b.do);
  if (od == null || doM == null || od >= doM) throw new GreskaKorisnika('Provjeri vrijeme od-do.');
  const napomena = tekst(b.napomena, { ime: 'Napomena', max: 80 });
  upisiTermin([req.biznis.id, null, '', 'blok', b.datum, od, doM, 'potvrden', 'rucno', null, napomena]);
  res.status(201).json({ ok: true });
});

rutePanel.patch('/termini/:id', (req, res) => {
  const status = req.body?.status;
  if (!['potvrden', 'odbijen', 'otkazan'].includes(status)) throw new GreskaKorisnika('Nepoznat status.');
  const t = db.prepare('SELECT * FROM termini WHERE id = ? AND biznis_id = ?').get(Number(req.params.id), req.biznis.id);
  if (!t) throw new GreskaKorisnika('Termin nije pronađen.', 404);
  if (status === 'potvrden' && t.status !== 'ceka') throw new GreskaKorisnika('Samo termin na čekanju se može potvrditi.');
  if (status === 'odbijen' && t.status !== 'ceka') throw new GreskaKorisnika('Samo termin na čekanju se može odbiti.');
  try {
    // potvrdio = 1 znači da je vlasnik termin ručno potvrdio (za razliku od automatski zakazanog).
    // Višednevni termin: promjena važi za sve njegove dane.
    transakcija(() => db.prepare(`UPDATE termini SET status = ?, potvrdio = CASE WHEN ? = 'potvrden' THEN 1 ELSE potvrdio END
      WHERE biznis_id = ? AND (id = ? OR (? IS NOT NULL AND veza = ?))`).run(status, status, req.biznis.id, t.id, t.veza, t.veza));
  } catch (g) {
    if (String(g.message).includes('TERMIN_ZAUZET')) throw new GreskaKorisnika('To vrijeme je u međuvremenu zauzeto.', 409);
    throw g;
  }
  res.json({ ok: true });
});

rutePanel.delete('/termini/:id', (req, res) => {
  const r = db.prepare("DELETE FROM termini WHERE id = ? AND biznis_id = ? AND vrsta = 'blok'").run(Number(req.params.id), req.biznis.id);
  if (!r.changes) throw new GreskaKorisnika('Brisati se mogu samo blokade. Termin otkaži.', 400);
  res.json({ ok: true });
});
