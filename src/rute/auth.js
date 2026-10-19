// Registracija, prijava, odjava, zaboravljena lozinka, promjena lozinke i brisanje računa.
//
// Lozinka nikad ne stiže na server. Preglednik iz nje izvede:
//  - "auth": šalje se serveru i služi samo za prijavu (server ga još hešira),
//  - ključ omota: ostaje u pregledniku i otključava privatni ključ biznisa.
// Vidi public/js/kripto.js.
import { Router } from 'express';
import { db, transakcija } from '../baza.js';
import { konfig } from '../konfig.js';
import { hesirajLozinku, provjeriLozinku, noviToken, hesTokena, laznaSol } from '../sigurnost.js';
import {
  otvoriSesiju, zatvoriSesiju, zahtijevaPrijavu, ograniciZahtjeve, tekst, jeEmail, jeAdmin,
  GreskaKorisnika, asinhrono,
} from '../srednji.js';
import { provjeriAuth, provjeriSol, provjeriJavniKljuc, provjeriOmot, procitajOmot } from '../e2e.js';
import { slobodanSlug } from '../slug.js';
import { ID_KATEGORIJA } from '../teme.js';
import { sada, dodajMjesece } from '../vrijeme.js';
import { posaljiEmail } from '../email.js';
import { stanjePretplate, ZAUVIJEK } from '../pretplata.js';

export const ruteAuth = Router();

const stmtPoEmailu = db.prepare('SELECT * FROM biznisi WHERE email = ?');
const stmtNoviBiznis = db.prepare(`INSERT INTO biznisi
  (email, lozinka_hash, e2e_sol, javni_kljuc, kljuc_lozinkom, kljuc_kodom, naziv, slug, kategorija,
   kategorija_tekst, vlasnik_ime, vlasnik_prezime, proba_do, placeno_do, uslovi_prihvaceni)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`);
const stmtPozivnica = db.prepare('SELECT * FROM pozivnice WHERE token = ? AND iskoristena IS NULL');

// Pozivnica: provjera prije registracije (da se popuni email i ime).
ruteAuth.get('/pozivnica/:token', ograniciZahtjeve('pozivnica', 30, 15), (req, res) => {
  const p = stmtPozivnica.get(String(req.params.token));
  if (!p) throw new GreskaKorisnika('Pozivnica nije ispravna ili je već iskorištena. Javi nam se.', 404);
  res.json({ email: p.email, ime: p.ime });
});
const stmtRadno = db.prepare('INSERT INTO radno_vrijeme (biznis_id, dan, od_min, do_min) VALUES (?, ?, ?, ?)');

// Lažni heš da prijava s nepostojećim emailom traje jednako dugo kao s postojećim.
const LAZNI_HES = await hesirajLozinku('A'.repeat(43));

const emailIz = (v) => String(v ?? '').trim().toLowerCase();

// Ključni materijal koji preglednik treba poslije prijave (sve je zaključano, server ga ne može otvoriti).
const kljucevi = (b) => ({ id: b.id, javni_kljuc: b.javni_kljuc, kljuc_lozinkom: procitajOmot(b.kljuc_lozinkom) });

// Sol za izvođenje ključa iz lozinke. Za nepostojeći email vraća lažnu (uvijek istu) sol.
ruteAuth.get('/sol', ograniciZahtjeve('sol', 30, 15), (req, res) => {
  const email = emailIz(req.query.email);
  const b = jeEmail(email) ? stmtPoEmailu.get(email) : null;
  res.json({ sol: b?.e2e_sol || laznaSol(email) });
});

ruteAuth.post('/registracija', ograniciZahtjeve('registracija', 8, 60), asinhrono(async (req, res) => {
  const b = req.body || {};
  const email = tekst(b.email, { ime: 'Email', obavezno: true, max: 254 }).toLowerCase();
  if (!jeEmail(email)) throw new GreskaKorisnika('Upiši ispravan email.');
  const naziv = tekst(b.naziv, { ime: 'Naziv', obavezno: true, min: 2, max: 80 });
  const vlasnikIme = tekst(b.vlasnik_ime, { ime: 'Ime vlasnika', obavezno: true, min: 2, max: 40 });
  const vlasnikPrezime = tekst(b.vlasnik_prezime, { ime: 'Prezime vlasnika', obavezno: true, min: 2, max: 40 });
  const kategorija = ID_KATEGORIJA.has(b.kategorija) ? b.kategorija : 'ostalo';
  const kategorijaTekst = kategorija === 'ostalo' ? tekst(b.kategorija_tekst, { ime: 'Djelatnost', obavezno: true, min: 2, max: 60 }) : '';

  // Profil se otvara samo uz pozivnicu (dobije se poslije uplate). Admin se registruje bez nje.
  const admin = konfig.adminEmails.includes(email);
  const pozivnica = admin ? null : stmtPozivnica.get(String(b.pozivnica ?? ''));
  if (!admin && !pozivnica) {
    throw new GreskaKorisnika('Profil se može otvoriti samo uz pozivnicu, koju dobiješ nakon uplate pretplate. Javi nam se.', 403);
  }
  if (pozivnica && pozivnica.email.toLowerCase() !== email) {
    throw new GreskaKorisnika(`Ova pozivnica je za email ${pozivnica.email}. Upiši taj email.`);
  }
  if (b.uslovi !== true) throw new GreskaKorisnika('Za otvaranje računa potrebno je prihvatiti uslove korištenja.');
  const auth = provjeriAuth(b.auth);
  const sol = provjeriSol(b.sol);
  const javni = provjeriJavniKljuc(b.javni_kljuc);
  const omotLozinka = provjeriOmot(b.kljuc_lozinkom);
  const omotKod = provjeriOmot(b.kljuc_kodom, { saSoli: true });
  if (stmtPoEmailu.get(email)) throw new GreskaKorisnika('Račun s tim emailom već postoji. Prijavi se.');

  const hes = await hesirajLozinku(auth);
  const danas = sada().datum;
  // Nema probnog perioda: pretplata važi onoliko koliko je plaćeno (iz pozivnice).
  const placenoDo = admin || pozivnica.mjeseci === 0 ? ZAUVIJEK : dodajMjesece(danas, pozivnica.mjeseci);
  const id = transakcija(() => {
    const r = stmtNoviBiznis.run(email, hes, sol, javni, omotLozinka, omotKod, naziv, slobodanSlug(naziv), kategorija,
      kategorijaTekst, vlasnikIme, vlasnikPrezime, danas, placenoDo);
    const biznisId = Number(r.lastInsertRowid);
    if (kategorija === 'smjestaj') {
      db.prepare('UPDATE biznisi SET dana_unaprijed = 365, potvrda_obavezna = 1, najava_min = 0 WHERE id = ?').run(biznisId);
    }
    if (pozivnica) {
      db.prepare("UPDATE pozivnice SET iskoristena = datetime('now'), biznis_id = ? WHERE token = ?").run(biznisId, pozivnica.token);
    }
    // Početno radno vrijeme: pon–pet 9–17, subota 9–14. Biznis ga poslije uredi.
    for (let dan = 1; dan <= 5; dan++) stmtRadno.run(biznisId, dan, 9 * 60, 17 * 60);
    stmtRadno.run(biznisId, 6, 9 * 60, 14 * 60);
    return biznisId;
  });
  otvoriSesiju(res, id);
  res.status(201).json({ ok: true, id });
}));

ruteAuth.post('/prijava', ograniciZahtjeve('prijava', 10, 15), asinhrono(async (req, res) => {
  const biznis = stmtPoEmailu.get(emailIz(req.body?.email));
  const auth = typeof req.body?.auth === 'string' ? req.body.auth : '';
  const tacno = await provjeriLozinku(auth, biznis ? biznis.lozinka_hash : LAZNI_HES);
  if (!biznis || !tacno) throw new GreskaKorisnika('Pogrešan email ili lozinka.', 401);
  otvoriSesiju(res, biznis.id);
  res.json({ ok: true, ...kljucevi(biznis) });
}));

ruteAuth.post('/odjava', (req, res) => {
  zatvoriSesiju(req, res);
  res.json({ ok: true });
});

// Provjera prijave bez greške (za početnu i stranicu prijave).
ruteAuth.get('/stanje', (req, res) => res.json({ prijavljen: Boolean(req.biznis) }));

ruteAuth.get('/ja', zahtijevaPrijavu, (req, res) => {
  const b = req.biznis;
  res.json({
    id: b.id, email: b.email, naziv: b.naziv, slug: b.slug, tema: b.tema,
    admin: jeAdmin(b), pretplata: stanjePretplate(b), javniUrl: konfig.javniUrl,
  });
});

// Ključni materijal za otključavanje na novom uređaju (traži lozinku u pregledniku).
ruteAuth.get('/kljuc', zahtijevaPrijavu, (req, res) => {
  res.json({ sol: req.biznis.e2e_sol, ...kljucevi(req.biznis) });
});

// ---------- Zaboravljena lozinka ----------
const stmtNoviReset = db.prepare("INSERT INTO reset_tokeni (token_hash, biznis_id, istice) VALUES (?, ?, datetime('now', '+1 hour'))");
const stmtReset = db.prepare(`SELECT b.* FROM reset_tokeni r JOIN biznisi b ON b.id = r.biznis_id
  WHERE r.token_hash = ? AND r.istice > datetime('now')`);

ruteAuth.post('/zaboravljena', ograniciZahtjeve('zaboravljena', 5, 60), asinhrono(async (req, res) => {
  const email = emailIz(req.body?.email);
  const biznis = jeEmail(email) ? stmtPoEmailu.get(email) : null;
  if (biznis) {
    const token = noviToken();
    stmtNoviReset.run(hesTokena(token), biznis.id);
    await posaljiEmail({
      za: biznis.email,
      naslov: 'Nova lozinka za Konekt',
      redovi: [
        'Neko je zatražio novu lozinku za tvoj Konekt račun.',
        'Pripremi kod oporavka koji si dobio/la pri otvaranju računa. Uz njega ostaju sačuvana imena i telefoni tvojih klijenata.',
        'Link važi 1 sat. Ako nisi ti tražio/la novu lozinku, samo zanemari ovaj email.',
      ],
      dugme: { tekst: 'Postavi novu lozinku', url: `${konfig.javniUrl}/nova-lozinka?token=${token}` },
    });
  }
  // Isti odgovor bez obzira postoji li račun, da se ne može provjeravati ko ima račun.
  res.json({ ok: true });
}));

// Preglednik dobije ključ zaključan kodom oporavka, da ga otključa kodom koji samo biznis zna.
ruteAuth.post('/reset-podaci', ograniciZahtjeve('nova-lozinka', 20, 60), (req, res) => {
  const b = stmtReset.get(hesTokena(String(req.body?.token ?? '')));
  if (!b) throw new GreskaKorisnika('Link je istekao ili nije ispravan. Zatraži novi.');
  res.json({ kljuc_kodom: procitajOmot(b.kljuc_kodom) });
});

ruteAuth.post('/nova-lozinka', ograniciZahtjeve('nova-lozinka', 10, 60), asinhrono(async (req, res) => {
  const body = req.body || {};
  const b = stmtReset.get(hesTokena(String(body.token ?? '')));
  if (!b) throw new GreskaKorisnika('Link je istekao ili nije ispravan. Zatraži novi.');
  const auth = provjeriAuth(body.auth);
  const sol = provjeriSol(body.sol);
  const omotLozinka = provjeriOmot(body.kljuc_lozinkom);
  // Bez koda oporavka biznis pravi nove ključeve; stari termini ostaju zaključani.
  const noviKljucevi = body.novi_kljucevi === true;
  const javni = noviKljucevi ? provjeriJavniKljuc(body.javni_kljuc) : null;
  const omotKod = noviKljucevi ? provjeriOmot(body.kljuc_kodom, { saSoli: true }) : null;
  const hes = await hesirajLozinku(auth);
  transakcija(() => {
    if (noviKljucevi) {
      db.prepare('UPDATE biznisi SET lozinka_hash = ?, e2e_sol = ?, kljuc_lozinkom = ?, javni_kljuc = ?, kljuc_kodom = ? WHERE id = ?')
        .run(hes, sol, omotLozinka, javni, omotKod, b.id);
    } else {
      db.prepare('UPDATE biznisi SET lozinka_hash = ?, e2e_sol = ?, kljuc_lozinkom = ? WHERE id = ?').run(hes, sol, omotLozinka, b.id);
    }
    db.prepare('DELETE FROM reset_tokeni WHERE biznis_id = ?').run(b.id);
    db.prepare('DELETE FROM sesije WHERE biznis_id = ?').run(b.id);
  });
  otvoriSesiju(res, b.id);
  res.json({ ok: true, id: b.id });
}));

// ---------- Promjena lozinke, novi kod oporavka, brisanje računa ----------
async function provjeriTrenutni(req, auth) {
  if (!(await provjeriLozinku(String(auth ?? ''), req.biznis.lozinka_hash))) {
    throw new GreskaKorisnika('Trenutna lozinka nije tačna.');
  }
}

ruteAuth.post('/promjena-lozinke', zahtijevaPrijavu, ograniciZahtjeve('promjena', 10, 15), asinhrono(async (req, res) => {
  const body = req.body || {};
  await provjeriTrenutni(req, body.stari_auth);
  const hes = await hesirajLozinku(provjeriAuth(body.auth));
  db.prepare('UPDATE biznisi SET lozinka_hash = ?, e2e_sol = ?, kljuc_lozinkom = ? WHERE id = ?')
    .run(hes, provjeriSol(body.sol), provjeriOmot(body.kljuc_lozinkom), req.biznis.id);
  db.prepare('DELETE FROM sesije WHERE biznis_id = ?').run(req.biznis.id);
  otvoriSesiju(res, req.biznis.id);
  res.json({ ok: true });
}));

ruteAuth.post('/kod-oporavka', zahtijevaPrijavu, ograniciZahtjeve('promjena', 10, 15), asinhrono(async (req, res) => {
  await provjeriTrenutni(req, req.body?.auth);
  db.prepare('UPDATE biznisi SET kljuc_kodom = ? WHERE id = ?').run(provjeriOmot(req.body?.kljuc_kodom, { saSoli: true }), req.biznis.id);
  res.json({ ok: true });
}));

ruteAuth.post('/obrisi-racun', zahtijevaPrijavu, ograniciZahtjeve('brisanje', 5, 15), asinhrono(async (req, res) => {
  await provjeriTrenutni(req, req.body?.auth);
  // Briše biznis i SVE njegove podatke (usluge, termine, klijente) zbog ON DELETE CASCADE.
  db.prepare('DELETE FROM biznisi WHERE id = ?').run(req.biznis.id);
  zatvoriSesiju(req, res);
  res.json({ ok: true });
}));
