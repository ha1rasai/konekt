// Admin pregled za vlasnicu Konekta.
// NAMJERNO ne prikazuje imena ni telefone klijenata (ionako su zaključani ključem svakog biznisa).
// Vidiš: biznise, vlasnike, pretplate, broj termina i pozivnice.
import { Router } from 'express';
import { db } from '../baza.js';
import { konfig } from '../konfig.js';
import { zahtijevaPrijavu, zahtijevaAdmina, cijeliBroj, tekst, jeEmail, GreskaKorisnika, asinhrono } from '../srednji.js';
import { stanjePretplate, ZAUVIJEK } from '../pretplata.js';
import { sada, dodajMjesece } from '../vrijeme.js';
import { noviToken } from '../sigurnost.js';
import { posaljiEmail } from '../email.js';

export const ruteAdmin = Router();
ruteAdmin.use(zahtijevaPrijavu, zahtijevaAdmina);

ruteAdmin.get('/biznisi', (_req, res) => {
  const danas = sada().datum;
  const mjesecOd = `${danas.slice(0, 7)}-01`;
  const redovi = db.prepare(`SELECT b.id, b.naziv, b.slug, b.email, b.kategorija, b.grad, b.kreirano,
      b.vlasnik_ime, b.vlasnik_prezime, b.kategorija_tekst, b.proba_do, b.placeno_do, b.aktivan,
      (SELECT COUNT(*) FROM termini t WHERE t.biznis_id = b.id AND t.vrsta = 'termin' AND t.datum >= ?) AS termina_ovaj_mjesec,
      (SELECT COUNT(*) FROM termini t WHERE t.biznis_id = b.id AND t.vrsta = 'termin') AS termina_ukupno,
      (SELECT COUNT(*) FROM usluge u WHERE u.biznis_id = b.id AND u.obrisana = 0) AS usluga
    FROM biznisi b ORDER BY b.kreirano DESC`).all(mjesecOd);
  const biznisi = redovi.map((b) => ({ ...b, aktivan: Boolean(b.aktivan), pretplata: stanjePretplate(b, danas) }));
  res.json({
    biznisi,
    zbir: {
      ukupno: biznisi.length,
      placaju: biznisi.filter((b) => b.pretplata.vazi && !b.pretplata.zauvijek).length,
      zauvijek: biznisi.filter((b) => b.pretplata.zauvijek).length,
      istekli: biznisi.filter((b) => !b.pretplata.vazi).length,
    },
  });
});

// Evidentira ručnu uplatu: produži pretplatu za N mjeseci (od danas ili od trenutnog kraja), ili zauvijek.
ruteAdmin.post('/biznisi/:id/uplata', (req, res) => {
  const b = db.prepare('SELECT * FROM biznisi WHERE id = ?').get(Number(req.params.id));
  if (!b) throw new GreskaKorisnika('Biznis nije pronađen.', 404);
  let novo;
  if (req.body?.zauvijek === true) {
    novo = ZAUVIJEK;
  } else {
    const mjeseci = cijeliBroj(req.body?.mjeseci, { ime: 'Mjeseci', min: 1, max: 24 });
    const danas = sada().datum;
    const kraj = stanjePretplate(b, danas).aktivnaDo;
    novo = dodajMjesece(kraj && kraj >= danas && kraj !== ZAUVIJEK ? kraj : danas, mjeseci);
  }
  db.prepare('UPDATE biznisi SET placeno_do = ? WHERE id = ?').run(novo, b.id);
  res.json({ ok: true, placeno_do: novo });
});

// Ručno postavljanje datuma (npr. ispravka greške); null = nije plaćeno.
ruteAdmin.post('/biznisi/:id/placeno-do', (req, res) => {
  const datum = req.body?.datum || null;
  if (datum !== null && !/^\d{4}-\d{2}-\d{2}$/.test(datum)) throw new GreskaKorisnika('Neispravan datum.');
  db.prepare('UPDATE biznisi SET placeno_do = ? WHERE id = ?').run(datum, Number(req.params.id));
  res.json({ ok: true });
});

ruteAdmin.post('/biznisi/:id/aktivan', (req, res) => {
  db.prepare('UPDATE biznisi SET aktivan = ? WHERE id = ?').run(req.body?.aktivan ? 1 : 0, Number(req.params.id));
  res.json({ ok: true });
});

// ---------- Pozivnice ----------
// Kupac plati -> ti napraviš pozivnicu -> on dobije link i otvori profil.
const linkPozivnice = (token) => `${konfig.javniUrl}/registracija?pozivnica=${token}`;

ruteAdmin.get('/pozivnice', (_req, res) => {
  const redovi = db.prepare(`SELECT p.token, p.email, p.ime, p.mjeseci, p.kreirano, p.iskoristena, b.naziv AS biznis
    FROM pozivnice p LEFT JOIN biznisi b ON b.id = p.biznis_id ORDER BY p.kreirano DESC LIMIT 200`).all();
  res.json({ pozivnice: redovi.map((p) => ({ ...p, link: p.iskoristena ? null : linkPozivnice(p.token) })) });
});

ruteAdmin.post('/pozivnice', asinhrono(async (req, res) => {
  const email = tekst(req.body?.email, { ime: 'Email', obavezno: true, max: 254 }).toLowerCase();
  if (!jeEmail(email)) throw new GreskaKorisnika('Upiši ispravan email.');
  const ime = tekst(req.body?.ime, { ime: 'Ime ili naziv', max: 80 });
  const mjeseci = req.body?.zauvijek === true ? 0 : cijeliBroj(req.body?.mjeseci, { ime: 'Mjeseci', min: 1, max: 24 });
  if (db.prepare('SELECT 1 FROM biznisi WHERE email = ?').get(email)) throw new GreskaKorisnika('Taj email već ima profil.');
  const token = noviToken();
  db.prepare('INSERT INTO pozivnice (token, email, ime, mjeseci) VALUES (?, ?, ?, ?)').run(token, email, ime, mjeseci);
  const link = linkPozivnice(token);
  if (req.body?.posalji === true) {
    await posaljiEmail({
      za: email,
      naslov: 'Tvoj Konekt profil je spreman za otvaranje',
      redovi: [
        `Zdravo${ime ? ` ${ime}` : ''}, hvala na uplati!`,
        'Klikni na dugme ispod i otvori svoj profil za online zakazivanje. Link važi samo za ovaj email.',
      ],
      dugme: { tekst: 'Otvori profil', url: link },
    });
  }
  res.status(201).json({ ok: true, link });
}));

ruteAdmin.delete('/pozivnice/:token', (req, res) => {
  db.prepare('DELETE FROM pozivnice WHERE token = ? AND iskoristena IS NULL').run(String(req.params.token));
  res.json({ ok: true });
});
