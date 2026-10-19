// Javni dio: profil biznisa, slobodni termini, rezervacija i otkazivanje od strane klijenta.
import { Router } from 'express';
import { db, transakcija } from '../baza.js';
import { konfig } from '../konfig.js';
import { noviToken } from '../sigurnost.js';
import { ograniciZahtjeve, GreskaKorisnika, asinhrono } from '../srednji.js';
import { provjeriPodatke } from '../e2e.js';
import { slobodniTermini, prozorZakazivanja, visednevniTermin } from '../termini.js';
import { jeDatum, uSate, sada, dodajDane, citljivDatum } from '../vrijeme.js';
import { stanjePretplate } from '../pretplata.js';
import { KATEGORIJE } from '../teme.js';
import { posaljiEmail } from '../email.js';
import { jeSmjestaj, zauzeteNoci, provjeriBoravak, upisiBoravak, cijenaBoravka, MAKS_NOCI } from '../smjestaj.js';

export const ruteJavno = Router();

const NAZIV_KATEGORIJE = Object.fromEntries(KATEGORIJE);
const stmtPoSlugu = db.prepare('SELECT * FROM biznisi WHERE slug = ?');
const stmtUslugeJavno = db.prepare(`SELECT id, naziv, opis, grupa, trajanje_min, dani, cijena FROM usluge
  WHERE biznis_id = ? AND aktivna = 1 AND obrisana = 0 ORDER BY redoslijed, id`);
const stmtUsluga = db.prepare('SELECT * FROM usluge WHERE id = ? AND biznis_id = ? AND aktivna = 1 AND obrisana = 0');
const stmtRadno = db.prepare('SELECT dan, od_min, do_min, pauza_od, pauza_do FROM radno_vrijeme WHERE biznis_id = ? ORDER BY dan');
const stmtHitno = db.prepare('SELECT dan, od_min, do_min FROM hitno_vrijeme WHERE biznis_id = ? ORDER BY dan');

// Primjer profila (DEMO_PROFIL): posjetioci mogu sve isprobati, ali se termin ne upisuje.
// Vlasnik tog profila (prijavljen) zakazuje normalno.
const jeDemo = (b, req) => Boolean(konfig.demoSlug) && b.slug === konfig.demoSlug && req.biznis?.id !== b.id;
const jeHitno = (v) => v === true || v === '1' || v === 1;

// Ukupna cijena: zbir cijena usluga, uvećan za doplatu ako je termin hitan.
function ukupnaCijena(b, usluga, hitno) {
  const saCijenom = usluga.lista.filter((u) => u.cijena != null);
  if (!saCijenom.length) return null;
  const osnovna = saCijenom.reduce((z, u) => z + Number(u.cijena), 0);
  return Math.round(osnovna * (1 + (hitno ? b.hitni_doplata : 0) / 100) * 100) / 100;
}

// Klijent može izabrati više usluga: "1,2,3" ili [1,2,3]. Trajanje se sabira.
const MAKS_USLUGA = 10;
function izabraneUsluge(b, vrijednost) {
  const ids = [...new Set((Array.isArray(vrijednost) ? vrijednost : String(vrijednost ?? '').split(','))
    .map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) throw new GreskaKorisnika('Izaberi bar jednu uslugu.');
  if (ids.length > MAKS_USLUGA) throw new GreskaKorisnika(`Možeš izabrati najviše ${MAKS_USLUGA} usluga.`);
  const lista = ids.map((id) => stmtUsluga.get(id, b.id));
  if (lista.some((u) => !u)) throw new GreskaKorisnika('Neka od izabranih usluga više ne postoji. Osvježi stranicu.', 404);
  lista.sort((x, y) => x.redoslijed - y.redoslijed || x.id - y.id);
  // Usluga od više dana zauzima cijele radne dane, pa se zakazuje sama.
  const visednevna = lista.find((u) => u.dani > 0);
  if (visednevna && lista.length > 1) throw new GreskaKorisnika(`"${visednevna.naziv}" traje više dana i zakazuje se sama, bez drugih usluga.`);
  const trajanje = lista.reduce((z, u) => z + u.trajanje_min, 0);
  if (trajanje > 720) throw new GreskaKorisnika('Izabrane usluge zajedno traju predugo (najviše 12 sati).');
  return {
    lista,
    prva: lista[0],
    naziv: lista.map((u) => u.naziv).join(' + '),
    trajanje_min: trajanje,
    dani: visednevna ? visednevna.dani : 0,
  };
}

function nadjiBiznis(slug) {
  const b = stmtPoSlugu.get(String(slug || '').toLowerCase());
  if (!b) throw new GreskaKorisnika('Profil nije pronađen.', 404);
  return b;
}

ruteJavno.get('/profil/:slug', (req, res) => {
  const b = nadjiBiznis(req.params.slug);
  // Zakazivanje radi samo ako je pretplata aktivna i biznis ima javni ključ za zaključavanje podataka.
  const p = stanjePretplate(b);
  const smjestaj = jeSmjestaj(b);
  const aktivno = p.vazi && Boolean(b.javni_kljuc) && (!smjestaj || b.smj_cijena != null);
  res.json({
    naziv: b.naziv, slug: b.slug, kategorija: b.kategorija === 'ostalo' ? b.kategorija_tekst : (NAZIV_KATEGORIJE[b.kategorija] || ''), opis: b.opis,
    adresa: b.adresa, grad: b.grad, telefon: b.telefon, instagram: b.instagram, tema: b.tema,
    logoUrl: b.logo_tip ? `/api/logo/${b.slug}?v=${b.logo_verzija}` : null,
    pozadinaUrl: b.pozadina_tip ? `/api/pozadina/${b.slug}?v=${b.pozadina_verzija}` : null,
    potvrda_obavezna: Boolean(b.potvrda_obavezna),
    napomena_klijenta: Boolean(b.napomena_klijenta),
    hitni: b.hitni_aktivno ? {
      doplata: b.hitni_doplata,
      potvrda: Boolean(b.hitni_potvrda),
      dani: stmtHitno.all(b.id).map((r) => ({ dan: r.dan, od: uSate(r.od_min), do: uSate(r.do_min) })),
    } : null,
    demo: jeDemo(b, req),
    smjestaj: smjestaj ? {
      cijena: b.smj_cijena, cijena_vikend: b.smj_cijena_vikend, min_noci: b.smj_min_noci,
      max_gostiju: b.smj_max_gostiju, dolazak: b.smj_dolazak, odlazak: b.smj_odlazak, maks_noci: MAKS_NOCI,
    } : null,
    jeVlasnik: req.biznis?.id === b.id,
    zakazivanjeAktivno: aktivno,
    javni_kljuc: aktivno ? b.javni_kljuc : null,
    usluge: aktivno ? stmtUslugeJavno.all(b.id) : [],
    radnoVrijeme: stmtRadno.all(b.id).map((r) => ({
      dan: r.dan, od: uSate(r.od_min), do: uSate(r.do_min),
      pauza: r.pauza_od != null ? `${uSate(r.pauza_od)}–${uSate(r.pauza_do)}` : null,
    })),
  });
});

// Dani u kojima ima bar jedan slobodan termin za izabranu uslugu.
ruteJavno.get('/profil/:slug/dani', (req, res) => {
  const b = nadjiBiznis(req.params.slug);
  if (!stanjePretplate(b).vazi) return res.json({ dani: [] });
  const usluga = izabraneUsluge(b, req.query.usluge ?? req.query.usluga);
  const trenutak = sada();
  const { prvi, zadnji } = prozorZakazivanja(b, trenutak);
  const dani = [];
  for (let d = prvi; d <= zadnji && dani.length < 366; d = dodajDane(d, 1)) {
    const slobodno = usluga.dani
      ? !jeHitno(req.query.hitno) && Boolean(visednevniTermin(b, usluga.dani, d, trenutak))
      : slobodniTermini(b, usluga, d, trenutak, { hitno: jeHitno(req.query.hitno) }).length > 0;
    dani.push({ datum: d, slobodno });
  }
  res.json({ dani });
});

ruteJavno.get('/profil/:slug/slobodno', (req, res) => {
  const b = nadjiBiznis(req.params.slug);
  if (!stanjePretplate(b).vazi) return res.json({ termini: [] });
  const usluga = izabraneUsluge(b, req.query.usluge ?? req.query.usluga);
  if (!jeDatum(req.query.datum)) throw new GreskaKorisnika('Neispravan datum.');
  if (usluga.dani) {
    const plan = jeHitno(req.query.hitno) ? null : visednevniTermin(b, usluga.dani, req.query.datum);
    const zadnji = plan?.dani.at(-1);
    return res.json({ termini: plan ? [{ od_min: plan.od_min, od: uSate(plan.od_min), visednevno: true, do_datum: zadnji.datum, do: uSate(zadnji.do_min) }] : [] });
  }
  const termini = slobodniTermini(b, usluga, req.query.datum, undefined, { hitno: jeHitno(req.query.hitno) })
    .map((m) => ({ od_min: m, od: uSate(m) }));
  res.json({ termini });
});

ruteJavno.post('/profil/:slug/rezervacija', ograniciZahtjeve('rezervacija', 8, 60), asinhrono(async (req, res) => {
  const b = nadjiBiznis(req.params.slug);
  const body = req.body || {};
  // Skriveno polje: ljudi ga ne vide, botovi ga popune.
  if (body.web) return res.status(201).json({ status: 'ceka' });
  if (!stanjePretplate(b).vazi || !b.javni_kljuc) throw new GreskaKorisnika('Online zakazivanje trenutno nije dostupno za ovaj profil.', 403);
  if (body.saglasnost !== true) throw new GreskaKorisnika('Potrebna je saglasnost za obradu podataka.');

  const usluga = izabraneUsluge(b, body.usluge_ids ?? body.usluga_id);
  if (!jeDatum(body.datum)) throw new GreskaKorisnika('Izaberi datum.');
  const od = Number(body.od_min);
  // Ime i telefon je zaključao klijentov preglednik javnim ključem biznisa.
  // Server ih ne vidi, pa ih ne može ni provjeriti; provjera je u pregledniku (profil.js).
  const podaci = provjeriPodatke(body.podaci_sif);

  // Termin mora biti među slobodnim (unutar radnog vremena, ne u prošlosti, ne preklapa se).
  const hitno = usluga.dani ? false : jeHitno(body.hitno);
  const plan = usluga.dani ? visednevniTermin(b, usluga.dani, body.datum) : null;
  if (usluga.dani ? !plan || plan.od_min !== od : !slobodniTermini(b, usluga, body.datum, undefined, { hitno }).includes(od)) {
    throw new GreskaKorisnika('Taj termin više nije slobodan. Izaberi drugi.', 409);
  }

  const cijena = ukupnaCijena(b, usluga, hitno);
  // Primjer profila: sve kao pravo, ali se ništa ne upisuje.
  const citljivo = plan
    ? `predaja ${citljivDatum(body.datum)} u ${uSate(od)}, završetak ${citljivDatum(plan.dani.at(-1).datum)}`
    : `${citljivDatum(body.datum)} u ${uSate(od)}`;
  if (jeDemo(b, req)) return res.json({ demo: true, usluga: usluga.naziv, hitno, cijena, citljivo });

  // Hitni termini imaju svoju potvrdu, nezavisno od običnih.
  const trebaPotvrda = hitno ? b.hitni_potvrda : b.potvrda_obavezna;
  const status = trebaPotvrda ? 'ceka' : 'potvrden';
  const token = noviToken();
  try {
    const upis = db.prepare(`INSERT INTO termini (biznis_id, usluga_id, usluga_naziv, vrsta, datum, od_min, do_min, status, izvor, podaci_sif, otkaz_token, hitan, cijena, veza)
      VALUES (?, ?, ?, 'termin', ?, ?, ?, ?, 'online', ?, ?, ?, ?, ?)`);
    if (plan) {
      // Po jedan red za svaki radni dan; svi povezani brojem "veza" (id prvog dana).
      transakcija(() => {
        let veza = null;
        plan.dani.forEach((d, i) => {
          const r = upis.run(b.id, usluga.prva.id, usluga.naziv, d.datum, d.od_min, d.do_min, status, podaci, i === 0 ? token : null, 0, i === 0 ? cijena : null, veza);
          if (i === 0) {
            veza = Number(r.lastInsertRowid);
            db.prepare('UPDATE termini SET veza = ? WHERE id = ?').run(veza, veza);
          }
        });
      });
    } else {
      upis.run(b.id, usluga.prva.id, usluga.naziv, body.datum, od, od + usluga.trajanje_min, status, podaci, token, hitno ? 1 : 0, cijena, null);
    }
  } catch (g) {
    // Zaštita na nivou baze: dva klijenta su kliknula isti termin u istom trenutku.
    if (String(g.message).includes('TERMIN_ZAUZET')) throw new GreskaKorisnika('Neko je upravo zauzeo taj termin. Izaberi drugi.', 409);
    throw g;
  }

  if (b.email_obavijesti) {
    const kada = citljivo;
    posaljiEmail({
      za: b.email,
      naslov: `${hitno ? 'HITNO – ' : ''}${status === 'ceka' ? 'Termin čeka potvrdu' : 'Nova rezervacija'}: ${usluga.naziv}, ${kada}`,
      redovi: [
        `Usluga: ${usluga.naziv}`,
        ...(hitno ? [`Hitan termin (+${b.hitni_doplata} %)`] : []),
        ...(cijena != null ? [`Cijena: ${cijena.toFixed(2).replace('.', ',')} KM (plaća se na licu mjesta)`] : []),
        `Termin: ${kada}`,
        'Ime i telefon klijenta vidiš samo u svom panelu, jer su zaključani tvojim ključem.',
        status === 'ceka' ? 'Termin čeka tvoju potvrdu u Konekt panelu.' : 'Termin je automatski potvrđen.',
      ],
      dugme: { tekst: 'Otvori kalendar', url: `${konfig.javniUrl}/panel` },
    });
  }

  res.status(201).json({
    status,
    usluga: usluga.naziv,
    hitno,
    cijena,
    datum: body.datum,
    od: uSate(od),
    citljivo,
    do_datum: plan ? plan.dani.at(-1).datum : null,
    do: plan ? uSate(plan.dani.at(-1).do_min) : null,
    otkazLink: `${konfig.javniUrl}/otkazi/${token}`,
  });
}));

// ---------- Smještaj: slobodne noći i rezervacija boravka ----------
// Vraća samo datume zauzetih noći (bez ikakvih podataka o gostima).
ruteJavno.get('/profil/:slug/nocenja', (req, res) => {
  const b = nadjiBiznis(req.params.slug);
  if (!jeSmjestaj(b)) throw new GreskaKorisnika('Ovaj profil nije smještaj.');
  const { prvi, zadnji } = prozorZakazivanja(b);
  // Do zadnjeg dana prozora + najviše noćenja, da se vidi i odlazak.
  res.json({ prvi, zadnji, zauzeto: zauzeteNoci(b, prvi, dodajDane(zadnji, MAKS_NOCI)) });
});

ruteJavno.post('/profil/:slug/boravak', ograniciZahtjeve('rezervacija', 8, 60), asinhrono(async (req, res) => {
  const b = nadjiBiznis(req.params.slug);
  const body = req.body || {};
  if (body.web) return res.status(201).json({ status: 'ceka' });
  if (!jeSmjestaj(b) || !stanjePretplate(b).vazi || !b.javni_kljuc || b.smj_cijena == null) {
    throw new GreskaKorisnika('Online rezervacija trenutno nije dostupna za ovaj smještaj.', 403);
  }
  if (body.saglasnost !== true) throw new GreskaKorisnika('Potrebna je saglasnost za obradu podataka.');
  const gosti = Number(body.gosti);
  if (!Number.isInteger(gosti) || gosti < 1 || gosti > b.smj_max_gostiju) throw new GreskaKorisnika(`Broj gostiju mora biti od 1 do ${b.smj_max_gostiju}.`);
  const noci = provjeriBoravak(b, body.dolazak, body.odlazak);
  const podaci = provjeriPodatke(body.podaci_sif);
  const cijena = cijenaBoravka(b, noci);
  const citljivo = `dolazak ${citljivDatum(body.dolazak)} od ${b.smj_dolazak}, odlazak ${citljivDatum(body.odlazak)} do ${b.smj_odlazak}`;
  if (jeDemo(b, req)) return res.json({ demo: true, usluga: 'Smještaj', cijena, citljivo, noci: noci.length });

  const status = b.potvrda_obavezna ? 'ceka' : 'potvrden';
  const token = noviToken();
  upisiBoravak(b, noci, { status, izvor: 'online', podaci, token, cijena });
  res.status(201).json({
    status, usluga: 'Smještaj', noci: noci.length, gosti, cijena, citljivo,
    datum: body.dolazak, od: b.smj_dolazak, do_datum: body.odlazak, do: b.smj_odlazak,
    otkazLink: `${konfig.javniUrl}/otkazi/${token}`,
  });
}));

// ---------- Otkazivanje od strane klijenta (preko linka iz potvrde) ----------
const stmtPoTokenu = db.prepare(`SELECT t.*, b.naziv AS biznis_naziv, b.slug, b.email, b.email_obavijesti, b.tema,
    b.smj_dolazak, b.smj_odlazak,
    (SELECT MAX(x.datum) FROM termini x WHERE x.veza = t.veza) AS zadnji_datum
  FROM termini t JOIN biznisi b ON b.id = t.biznis_id WHERE t.otkaz_token = ?`);

// Opis termina za stranicu otkazivanja; za smještaj dolazak i odlazak.
function opisTermina(t) {
  if (t.usluga_naziv === 'Smještaj' && t.veza) {
    return `dolazak ${citljivDatum(t.datum)} od ${t.smj_dolazak}, odlazak ${citljivDatum(dodajDane(t.zadnji_datum, 1))} do ${t.smj_odlazak}`;
  }
  if (t.veza && t.zadnji_datum !== t.datum) return `predaja ${citljivDatum(t.datum)} u ${uSate(t.od_min)}, završetak ${citljivDatum(t.zadnji_datum)}`;
  return `${citljivDatum(t.datum)} u ${uSate(t.od_min)}`;
}

function mozeOtkazati(t) {
  const s = sada();
  return ['ceka', 'potvrden'].includes(t.status) && (t.datum > s.datum || (t.datum === s.datum && t.od_min > s.minute));
}

ruteJavno.get('/otkazivanje/:token', ograniciZahtjeve('otkazivanje', 30, 15), (req, res) => {
  const t = stmtPoTokenu.get(String(req.params.token));
  if (!t) throw new GreskaKorisnika('Termin nije pronađen.', 404);
  res.json({
    biznis: t.biznis_naziv, slug: t.slug, tema: t.tema, usluga: t.usluga_naziv,
    citljivo: opisTermina(t), status: t.status, mozeOtkazati: mozeOtkazati(t),
  });
});

ruteJavno.post('/otkazivanje/:token', ograniciZahtjeve('otkazivanje', 30, 15), (req, res) => {
  const t = stmtPoTokenu.get(String(req.params.token));
  if (!t) throw new GreskaKorisnika('Termin nije pronađen.', 404);
  if (!mozeOtkazati(t)) throw new GreskaKorisnika('Ovaj termin se više ne može otkazati.');
  // Višednevni termin se otkazuje cijeli (svi dani).
  db.prepare("UPDATE termini SET status = 'otkazan' WHERE id = ? OR (? IS NOT NULL AND veza = ?)").run(t.id, t.veza, t.veza);
  if (t.email_obavijesti) {
    posaljiEmail({
      za: t.email,
      naslov: `Klijent je otkazao termin: ${t.usluga_naziv}, ${citljivDatum(t.datum)} u ${uSate(t.od_min)}`,
      redovi: ['Termin je otkazan preko linka iz potvrde i ponovo je slobodan za druge klijente.'],
      dugme: { tekst: 'Otvori kalendar', url: `${konfig.javniUrl}/panel` },
    });
  }
  res.json({ ok: true });
});

// ---------- Pozadinska slika ----------
ruteJavno.get('/pozadina/:slug', (req, res) => {
  const b = db.prepare('SELECT pozadina, pozadina_tip FROM biznisi WHERE slug = ?').get(String(req.params.slug).toLowerCase());
  if (!b || !b.pozadina) return res.status(404).end();
  res.set('Content-Type', b.pozadina_tip);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(b.pozadina));
});

// ---------- Logo ----------
ruteJavno.get('/logo/:slug', (req, res) => {
  const b = db.prepare('SELECT logo, logo_tip FROM biznisi WHERE slug = ?').get(String(req.params.slug).toLowerCase());
  if (!b || !b.logo) return res.status(404).end();
  res.set('Content-Type', b.logo_tip);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(b.logo));
});
