// Testovi: npm.cmd test
// Koriste bazu u memoriji i nasumične ključeve, pa ne diraju pravu bazu ni .env.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.KONEKT_TEST = 'bez-limita';
process.env.BAZA_PUT = ':memory:';
process.env.PEPPER = randomBytes(16).toString('hex');
process.env.JAVNI_URL = 'http://localhost';
process.env.ADMIN_EMAILS = 'admin@konekt.ba';

const { izracunajSlobodne } = await import('../src/termini.js');
const { hesirajLozinku, provjeriLozinku, hesTokena } = await import('../src/sigurnost.js');
const { napraviAplikaciju } = await import('../src/app.js');
const { db } = await import('../src/baza.js');
const { sada, dodajDane, danUSedmici, dodajMjesece } = await import('../src/vrijeme.js');
const { napraviSlug } = await import('../src/slug.js');
// Isti modul koji koristi preglednik.
const kripto = await import('../public/js/kripto.js');

// ---------- Čiste funkcije ----------
test('slobodni termini poštuju trajanje, pauzu i zauzeto vrijeme', () => {
  const radno = { od_min: 9 * 60, do_min: 12 * 60, pauza_od: 10 * 60 + 30, pauza_do: 11 * 60 };
  const zauzeto = [{ od_min: 9 * 60, do_min: 9 * 60 + 30 }];
  const s = izracunajSlobodne({ radno, zauzeto, trajanje: 30, korak: 30 });
  assert.deepEqual(s, [570, 600, 660, 690]); // 9:30, 10:00, 11:00, 11:30
});

test('termin ne smije prelaziti kraj radnog vremena', () => {
  const s = izracunajSlobodne({ radno: { od_min: 540, do_min: 600 }, zauzeto: [], trajanje: 45, korak: 15 });
  assert.deepEqual(s, [540, 555]);
});

test('najava odbacuje termine prije dozvoljenog vremena', () => {
  const s = izracunajSlobodne({ radno: { od_min: 540, do_min: 660 }, zauzeto: [], trajanje: 60, korak: 30, odMinimalno: 600 });
  assert.deepEqual(s, [600]);
});

test('ne radi taj dan = nema termina', () => {
  assert.deepEqual(izracunajSlobodne({ radno: null, zauzeto: [], trajanje: 30, korak: 15 }), []);
});

test('šifrovanje s kraja na kraj: samo vlasnik ključa otključava', async () => {
  const a = await kripto.pripremiNoviRacun('lozinka123');
  const b = await kripto.pripremiNoviRacun('druga-lozinka');
  const blob = await kripto.sifrujZaBiznis(a.zaServer.javni_kljuc, { ime: 'Amra Hodžić', telefon: '061 111 222' });
  assert.ok(!blob.includes('Amra'));
  assert.equal((await kripto.desifrujZaBiznis(a.privatni, blob)).ime, 'Amra Hodžić');
  await assert.rejects(kripto.desifrujZaBiznis(b.privatni, blob)); // tuđi ključ ne radi
  // Kod oporavka otključava isti ključ, i kad se upiše malim slovima i s razmacima.
  const pkcs8 = await kripto.otkljucajKodom(a.kod.toLowerCase().replace(/-/g, ' '), a.zaServer.kljuc_kodom);
  assert.equal((await kripto.desifrujZaBiznis(await kripto.uveziPrivatni(pkcs8), blob)).telefon, '061 111 222');
  await assert.rejects(kripto.otkljucajKodom(kripto.noviKod(), a.zaServer.kljuc_kodom));
});

test('auth vrijednost se hešira', async () => {
  const h = await hesirajLozinku('A'.repeat(43));
  assert.ok(await provjeriLozinku('A'.repeat(43), h));
  assert.ok(!(await provjeriLozinku('B'.repeat(43), h)));
});

test('slug i datumi', () => {
  assert.equal(napraviSlug('Salon Šećer & Đurđica'), 'salon-secer-djurdjica');
  assert.equal(danUSedmici('2026-10-19'), 1); // ponedjeljak
  assert.equal(dodajMjesece('2026-01-31', 1), '2026-02-28');
});

// ---------- API ----------
let server;
let baza;
const kolacici = {};
const nalozi = {};

before(async () => {
  server = napraviAplikaciju().listen(0);
  await new Promise((r) => server.once('listening', r));
  baza = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function zahtjev(putanja, { metoda = 'GET', tijelo, ko } = {}) {
  const headers = { 'X-Konekt': '1' };
  if (tijelo) headers['Content-Type'] = 'application/json';
  if (ko && kolacici[ko]) headers.Cookie = kolacici[ko];
  const r = await fetch(baza + putanja, { method: metoda, headers, body: tijelo ? JSON.stringify(tijelo) : undefined });
  const kolacic = r.headers.get('set-cookie');
  if (ko && kolacic) kolacici[ko] = kolacic.split(';')[0];
  return { status: r.status, podaci: await r.json().catch(() => null) };
}

// Registracija kao u pregledniku: lozinka se ne šalje serveru.
// Profil se otvara uz pozivnicu (osim admina), pa test prvo napravi pozivnicu u bazi.
async function registruj(ko, email, naziv, lozinka = 'lozinka123') {
  const r = await kripto.pripremiNoviRacun(lozinka);
  nalozi[ko] = { privatni: r.privatni, kod: r.kod, javni: r.zaServer.javni_kljuc };
  const pozivnica = `poziv-${ko}`;
  db.prepare('INSERT OR IGNORE INTO pozivnice (token, email, mjeseci) VALUES (?, ?, 1)').run(pozivnica, email);
  return zahtjev('/api/auth/registracija', {
    metoda: 'POST', ko,
    tijelo: { email, naziv, kategorija: 'frizer', uslovi: true, vlasnik_ime: 'Amra', vlasnik_prezime: 'Test', pozivnica, ...r.zaServer },
  });
}

// Prvi radni dan (pon–pet) koji je bar 2 dana od danas.
function sljedeciRadniDan() {
  let d = dodajDane(sada().datum, 2);
  while (danUSedmici(d) > 5) d = dodajDane(d, 1);
  return d;
}

test('cijeli tok: registracija, rezervacija, privatnost, dupli termin, otkazivanje', async () => {
  // Bez X-Konekt zaglavlja zahtjev se odbija (CSRF zaštita).
  const bezZaglavlja = await fetch(`${baza}/api/auth/prijava`, { method: 'POST' });
  assert.equal(bezZaglavlja.status, 403);

  let r = await registruj('salon', 'amra@test.ba', 'Salon Amra');
  assert.equal(r.status, 201);

  r = await zahtjev('/api/panel/usluge', { metoda: 'POST', ko: 'salon', tijelo: { naziv: 'Šišanje', trajanje_min: 30, cijena: '20' } });
  assert.equal(r.status, 201);
  const usluga = r.podaci.usluge[0];

  r = await zahtjev('/api/panel/biznis', { metoda: 'PUT', ko: 'salon', tijelo: { tema: 'lavanda', korak_min: 30 } });
  assert.equal(r.podaci.biznis.tema, 'lavanda');
  r = await zahtjev('/api/panel/biznis', { metoda: 'PUT', ko: 'salon', tijelo: { tema: 'nepostojeca' } });
  assert.equal(r.status, 400);

  // Javni profil daje javni ključ za zaključavanje.
  r = await zahtjev('/api/profil/salon-amra');
  assert.equal(r.status, 200);
  assert.equal(r.podaci.tema, 'lavanda');
  assert.equal(r.podaci.javni_kljuc, nalozi.salon.javni);

  const dan = sljedeciRadniDan();
  r = await zahtjev(`/api/profil/salon-amra/slobodno?usluga=${usluga.id}&datum=${dan}`);
  assert.equal(r.podaci.termini[0].od, '09:00');
  assert.equal(r.podaci.termini.length, 16); // 9:00–17:00 svakih 30 min

  // Klijent zaključava ime i telefon u pregledniku.
  const podaci_sif = await kripto.sifrujZaBiznis(nalozi.salon.javni, { ime: 'Lejla Test', telefon: '061 123 456' });
  const rezervacija = { usluga_id: usluga.id, datum: dan, od_min: 540, podaci_sif, saglasnost: true };
  r = await zahtjev('/api/profil/salon-amra/rezervacija', { metoda: 'POST', tijelo: rezervacija });
  assert.equal(r.status, 201);
  assert.equal(r.podaci.status, 'potvrden');
  const otkazLink = r.podaci.otkazLink;

  // Nezaključani podaci se odbijaju.
  r = await zahtjev('/api/profil/salon-amra/rezervacija', { metoda: 'POST', tijelo: { ...rezervacija, od_min: 600, podaci_sif: 'Lejla 061' } });
  assert.equal(r.status, 400);

  // Isti termin drugi put: odbijen.
  r = await zahtjev('/api/profil/salon-amra/rezervacija', { metoda: 'POST', tijelo: rezervacija });
  assert.equal(r.status, 409);

  // Zaštita i na nivou baze.
  const biznisId = db.prepare("SELECT id FROM biznisi WHERE slug = 'salon-amra'").get().id;
  assert.throws(() => db.prepare("INSERT INTO termini (biznis_id, datum, od_min, do_min, status) VALUES (?, ?, 550, 580, 'potvrden')").run(biznisId, dan), /TERMIN_ZAUZET/);

  // Ime i telefon nisu nigdje čitljivi na serveru: ni u bazi ni u odgovoru panela.
  const red = db.prepare('SELECT * FROM termini WHERE biznis_id = ? AND datum = ?').get(biznisId, dan);
  assert.ok(!JSON.stringify(red).includes('Lejla') && !JSON.stringify(red).includes('061'));
  r = await zahtjev(`/api/panel/termini?datum=${dan}`, { ko: 'salon' });
  assert.ok(!JSON.stringify(r.podaci).includes('Lejla'));
  // Vlasnik otključava u svom pregledniku.
  assert.equal((await kripto.desifrujZaBiznis(nalozi.salon.privatni, r.podaci.termini[0].podaci)).ime, 'Lejla Test');

  // Termin više nije među slobodnima.
  r = await zahtjev(`/api/profil/salon-amra/slobodno?usluga=${usluga.id}&datum=${dan}`);
  assert.equal(r.podaci.termini[0].od, '09:30');

  // Otkazivanje preko linka oslobađa termin.
  const token = otkazLink.split('/').pop();
  r = await zahtjev(`/api/otkazivanje/${token}`, { metoda: 'POST' });
  assert.equal(r.status, 200);
  r = await zahtjev(`/api/profil/salon-amra/slobodno?usluga=${usluga.id}&datum=${dan}`);
  assert.equal(r.podaci.termini[0].od, '09:00');
});

test('ručni termin iz panela je zaključan', async () => {
  const usluga = (await zahtjev('/api/panel/usluge', { ko: 'salon' })).podaci.usluge[0];
  const dan = sljedeciRadniDan();
  const podaci_sif = await kripto.sifrujZaBiznis(nalozi.salon.javni, { ime: 'Selma', telefon: '' });
  let r = await zahtjev('/api/panel/termini', { metoda: 'POST', ko: 'salon', tijelo: { usluga_id: usluga.id, datum: dan, od: '15:00', podaci_sif } });
  assert.equal(r.status, 201);
  r = await zahtjev('/api/panel/termini', { metoda: 'POST', ko: 'salon', tijelo: { usluga_id: usluga.id, datum: dan, od: '16:00', ime: 'Otvoreno ime' } });
  assert.equal(r.status, 400);
});

test('potvrda obavezna: termin čeka, pa ga vlasnik potvrdi', async () => {
  await zahtjev('/api/panel/biznis', { metoda: 'PUT', ko: 'salon', tijelo: { potvrda_obavezna: true } });
  const usluga = (await zahtjev('/api/panel/usluge', { ko: 'salon' })).podaci.usluge[0];
  const dan = sljedeciRadniDan();
  const podaci_sif = await kripto.sifrujZaBiznis(nalozi.salon.javni, { ime: 'Emina Test', telefon: '062 333 444' });
  let r = await zahtjev('/api/profil/salon-amra/rezervacija', { metoda: 'POST', tijelo: { usluga_id: usluga.id, datum: dan, od_min: 600, podaci_sif, saglasnost: true } });
  assert.equal(r.podaci.status, 'ceka');
  r = await zahtjev('/api/panel/termini/na-cekanju', { ko: 'salon' });
  assert.equal(r.podaci.termini.length, 1);
  r = await zahtjev(`/api/panel/termini/${r.podaci.termini[0].id}`, { metoda: 'PATCH', ko: 'salon', tijelo: { status: 'potvrden' } });
  assert.equal(r.status, 200);
});

test('drugi biznis ne vidi tuđe termine, a admin nema imena klijenata', async () => {
  await registruj('drugi', 'drugi@test.ba', 'Studio X');
  const dan = sljedeciRadniDan();
  const r = await zahtjev(`/api/panel/termini?datum=${dan}`, { ko: 'drugi' });
  assert.equal(r.podaci.termini.length, 0);
  assert.equal((await zahtjev('/api/admin/biznisi', { ko: 'drugi' })).status, 404);
  // Ni stranica /admin ne postoji za druge.
  const stranica = await fetch(`${baza}/admin`, { headers: { Cookie: kolacici.drugi } });
  assert.equal(stranica.status, 404);
  assert.ok((await stranica.text()).includes('Ovdje nema ničega'));

  await registruj('admin', 'admin@konekt.ba', 'Konekt Admin');
  const a = await zahtjev('/api/admin/biznisi', { ko: 'admin' });
  assert.equal(a.status, 200);
  const tekst = JSON.stringify(a.podaci);
  assert.ok(!tekst.includes('Lejla') && !tekst.includes('Emina') && !tekst.includes('v1.'));

  const id = a.podaci.biznisi.find((b) => b.slug === 'salon-amra').id;
  const u = await zahtjev(`/api/admin/biznisi/${id}/uplata`, { metoda: 'POST', ko: 'admin', tijelo: { mjeseci: 1 } });
  assert.equal(u.status, 200);
  assert.ok(u.podaci.placeno_do > sada().datum);
});

test('istekla pretplata isključuje online zakazivanje', async () => {
  db.prepare("UPDATE biznisi SET proba_do = '2020-01-01', placeno_do = NULL WHERE slug = 'studio-x'").run();
  const r = await zahtjev('/api/profil/studio-x');
  assert.equal(r.podaci.zakazivanjeAktivno, false);
});

test('prijava bez slanja lozinke, pa nova lozinka uz kod oporavka', async () => {
  // Prijava: sol, pa auth izveden u pregledniku, pa otključavanje ključa lozinkom.
  const { podaci: { sol } } = await zahtjev('/api/auth/sol?email=amra@test.ba');
  const { kljucOmota, auth } = await kripto.izLozinke('lozinka123', sol);
  let r = await zahtjev('/api/auth/prijava', { metoda: 'POST', ko: 'salon2', tijelo: { email: 'amra@test.ba', auth } });
  assert.equal(r.status, 200);
  const privatni = await kripto.uveziPrivatni(await kripto.otkljucajPkcs8(kljucOmota, r.podaci.kljuc_lozinkom));
  const blob = await kripto.sifrujZaBiznis(nalozi.salon.javni, { ime: 'Test', telefon: '060 000 000' });
  assert.equal((await kripto.desifrujZaBiznis(privatni, blob)).ime, 'Test');

  // Pogrešna lozinka se odbija; nepostojeći email dobija lažnu, ali uvijek istu sol.
  const losa = await kripto.izLozinke('pogresna', sol);
  assert.equal((await zahtjev('/api/auth/prijava', { metoda: 'POST', tijelo: { email: 'amra@test.ba', auth: losa.auth } })).status, 401);
  const lazna1 = (await zahtjev('/api/auth/sol?email=nema@test.ba')).podaci.sol;
  const lazna2 = (await zahtjev('/api/auth/sol?email=nema@test.ba')).podaci.sol;
  assert.equal(lazna1, lazna2);

  // Zaboravljena lozinka: kodom oporavka se zadrži isti ključ, pa stari klijenti ostaju čitljivi.
  const token = 'test-token-123';
  const id = db.prepare("SELECT id FROM biznisi WHERE email = 'amra@test.ba'").get().id;
  db.prepare("INSERT INTO reset_tokeni (token_hash, biznis_id, istice) VALUES (?, ?, datetime('now', '+1 hour'))").run(hesTokena(token), id);
  r = await zahtjev('/api/auth/reset-podaci', { metoda: 'POST', tijelo: { token } });
  const pkcs8 = await kripto.otkljucajKodom(nalozi.salon.kod, r.podaci.kljuc_kodom);
  const novaSol = kripto.novaSol();
  const novo = await kripto.izLozinke('nova-lozinka-1', novaSol);
  r = await zahtjev('/api/auth/nova-lozinka', {
    metoda: 'POST',
    tijelo: { token, sol: novaSol, auth: novo.auth, kljuc_lozinkom: await kripto.zakljucajPrivatni(novo.kljucOmota, pkcs8) },
  });
  assert.equal(r.status, 200);
  r = await zahtjev('/api/auth/prijava', { metoda: 'POST', tijelo: { email: 'amra@test.ba', auth: novo.auth } });
  assert.equal(r.status, 200);
  const isti = await kripto.uveziPrivatni(await kripto.otkljucajPkcs8(novo.kljucOmota, r.podaci.kljuc_lozinkom));
  assert.equal((await kripto.desifrujZaBiznis(isti, blob)).ime, 'Test');
});

test('više usluga u jednom terminu, rad 0–24 h i pozadinska slika', async () => {
  await registruj('vise', 'vise@test.ba', 'Studio Vise');
  // Radi cijeli dan, svaki dan.
  const dani = Array.from({ length: 7 }, (_, i) => ({ dan: i + 1, radi: true, od: '00:00', do: '24:00', pauza_od: '', pauza_do: '' }));
  let r = await zahtjev('/api/panel/radno-vrijeme', { metoda: 'PUT', ko: 'vise', tijelo: { dani } });
  assert.equal(r.status, 200);
  assert.equal(r.podaci.dani[0].do, '24:00');
  await zahtjev('/api/panel/biznis', { metoda: 'PUT', ko: 'vise', tijelo: { korak_min: 30 } });

  await zahtjev('/api/panel/usluge', { metoda: 'POST', ko: 'vise', tijelo: { naziv: 'Šišanje', trajanje_min: 30, cijena: '20' } });
  r = await zahtjev('/api/panel/usluge', { metoda: 'POST', ko: 'vise', tijelo: { naziv: 'Farbanje', trajanje_min: 90, cijena: '60' } });
  const ids = r.podaci.usluge.map((u) => u.id);

  const dan = dodajDane(sada().datum, 3);
  r = await zahtjev(`/api/profil/studio-vise/slobodno?usluge=${ids.join(',')}&datum=${dan}`);
  assert.equal(r.podaci.termini[0].od, '00:00');
  assert.equal(r.podaci.termini.at(-1).od, '22:00'); // 2 h ukupno mora stati do 24:00

  const podaci_sif = await kripto.sifrujZaBiznis(nalozi.vise.javni, { ime: 'Ana Test', telefon: '061 222 333' });
  r = await zahtjev('/api/profil/studio-vise/rezervacija', { metoda: 'POST', tijelo: { usluge_ids: ids, datum: dan, od_min: 600, podaci_sif, saglasnost: true } });
  assert.equal(r.status, 201);
  assert.equal(r.podaci.usluga, 'Šišanje + Farbanje');
  // Termin traje 10:00–12:00, pa 11:00 više nije slobodno za jednu uslugu od 30 min.
  r = await zahtjev(`/api/panel/termini?datum=${dan}`, { ko: 'vise' });
  assert.equal(r.podaci.termini[0].do, '12:00');
  r = await zahtjev(`/api/profil/studio-vise/slobodno?usluge=${ids[0]}&datum=${dan}`);
  const slobodno = r.podaci.termini.map((t) => t.od);
  assert.ok(!slobodno.includes('11:00') && slobodno.includes('12:00'));

  // Pozadinska slika (najmanji ispravan PNG).
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  r = await zahtjev('/api/panel/pozadina', { metoda: 'PUT', ko: 'vise', tijelo: { slika: png } });
  assert.equal(r.status, 200);
  assert.ok(r.podaci.biznis.pozadinaUrl);
  const profil = await zahtjev('/api/profil/studio-vise');
  assert.equal(profil.podaci.pozadinaUrl, r.podaci.biznis.pozadinaUrl);
  const slika = await fetch(baza + profil.podaci.pozadinaUrl);
  assert.equal(slika.headers.get('content-type'), 'image/png');
  r = await zahtjev('/api/panel/pozadina', { metoda: 'PUT', ko: 'vise', tijelo: { slika: 'data:image/png;base64,AAAA' } });
  assert.equal(r.status, 400);
  r = await zahtjev('/api/panel/pozadina', { metoda: 'DELETE', ko: 'vise' });
  assert.equal(r.podaci.biznis.pozadinaUrl, null);
});

test('registracija samo uz pozivnicu, bez probnog perioda', async () => {
  const r0 = await kripto.pripremiNoviRacun('lozinka123');
  const osnova = { email: 'bez@test.ba', naziv: 'Bez Pozivnice', kategorija: 'frizer', uslovi: true, vlasnik_ime: 'Ana', vlasnik_prezime: 'Anić', ...r0.zaServer };
  let r = await zahtjev('/api/auth/registracija', { metoda: 'POST', tijelo: osnova });
  assert.equal(r.status, 403);

  // Admin napravi pozivnicu za 3 mjeseca.
  r = await zahtjev('/api/admin/pozivnice', { metoda: 'POST', ko: 'admin', tijelo: { email: 'novi@test.ba', ime: 'Salon Novi', mjeseci: 3 } });
  assert.equal(r.status, 201);
  const token = new URL(r.podaci.link).searchParams.get('pozivnica');
  assert.equal((await zahtjev(`/api/auth/pozivnica/${token}`)).podaci.email, 'novi@test.ba');

  // Pozivnica važi samo za svoj email.
  r = await zahtjev('/api/auth/registracija', { metoda: 'POST', tijelo: { ...osnova, pozivnica: token } });
  assert.equal(r.status, 400);
  // Bez imena vlasnika ne ide.
  r = await zahtjev('/api/auth/registracija', { metoda: 'POST', tijelo: { ...osnova, email: 'novi@test.ba', pozivnica: token, vlasnik_ime: '' } });
  assert.equal(r.status, 400);

  r = await zahtjev('/api/auth/registracija', { metoda: 'POST', ko: 'novi', tijelo: { ...osnova, email: 'novi@test.ba', pozivnica: token } });
  assert.equal(r.status, 201);
  const b = (await zahtjev('/api/panel/biznis', { ko: 'novi' })).podaci.biznis;
  assert.equal(b.vlasnik_ime, 'Ana');
  assert.equal(b.pretplata.uProbi, false);
  assert.equal(b.pretplata.placenoDo, dodajMjesece(sada().datum, 3));

  // Pozivnica se ne može iskoristiti dvaput.
  assert.equal((await zahtjev(`/api/auth/pozivnica/${token}`)).status, 404);

  // Admin može označiti "zauvijek".
  const a = await zahtjev('/api/admin/biznisi', { ko: 'admin' });
  const id = a.podaci.biznisi.find((x) => x.email === 'novi@test.ba').id;
  r = await zahtjev(`/api/admin/biznisi/${id}/uplata`, { metoda: 'POST', ko: 'admin', tijelo: { zauvijek: true } });
  assert.equal(r.podaci.placeno_do, '9999-12-31');
  assert.equal((await zahtjev('/api/panel/biznis', { ko: 'novi' })).podaci.biznis.pretplata.zauvijek, true);
});

test('hitan termin: samo u izabrano vrijeme, s doplatom na cijenu', async () => {
  // Studio Vise radi 0–24 ponedjeljkom (iz ranijeg testa); hitni termini samo 18–20 svaki dan, +50 %.
  const hitniDani = Array.from({ length: 7 }, (_, i) => ({ dan: i + 1, radi: true, od: '18:00', do: '20:00' }));
  let r = await zahtjev('/api/panel/hitno-vrijeme', { metoda: 'PUT', ko: 'vise', tijelo: { dani: hitniDani } });
  assert.equal(r.status, 200);
  const usluge = (await zahtjev('/api/panel/usluge', { ko: 'vise' })).podaci.usluge;
  const sisanje = usluge.find((u) => u.naziv === 'Šišanje'); // 30 min, 20 KM
  const dan = dodajDane(sada().datum, 4);

  // Dok hitni termini nisu uključeni, nema ih.
  r = await zahtjev(`/api/profil/studio-vise/slobodno?usluge=${sisanje.id}&datum=${dan}&hitno=1`);
  assert.equal(r.podaci.termini.length, 0);

  await zahtjev('/api/panel/biznis', { metoda: 'PUT', ko: 'vise', tijelo: { hitni_aktivno: true, hitni_doplata: 50, hitni_najava_min: 0 } });
  const profil = (await zahtjev('/api/profil/studio-vise')).podaci;
  assert.equal(profil.hitni.doplata, 50);
  r = await zahtjev(`/api/profil/studio-vise/slobodno?usluge=${sisanje.id}&datum=${dan}&hitno=1`);
  assert.deepEqual(r.podaci.termini.map((t) => t.od), ['18:00', '18:30', '19:00', '19:30']);

  // Hitan termin izvan hitnog vremena se odbija.
  const podaci_sif = await kripto.sifrujZaBiznis(nalozi.vise.javni, { ime: 'Hitna Test', telefon: '061 555 666', napomena: 'Molim što prije' });
  r = await zahtjev('/api/profil/studio-vise/rezervacija', { metoda: 'POST', tijelo: { usluge_ids: [sisanje.id], datum: dan, od_min: 600, podaci_sif, saglasnost: true, hitno: true } });
  assert.equal(r.status, 409);

  r = await zahtjev('/api/profil/studio-vise/rezervacija', { metoda: 'POST', tijelo: { usluge_ids: [sisanje.id], datum: dan, od_min: 18 * 60, podaci_sif, saglasnost: true, hitno: true } });
  assert.equal(r.status, 201);
  assert.equal(r.podaci.cijena, 30); // 20 KM + 50 %
  assert.equal(r.podaci.hitno, true);

  // Vlasnik vidi hitno, cijenu, status "automatski" i napomenu (otključanu u pregledniku).
  r = await zahtjev(`/api/panel/termini?datum=${dan}`, { ko: 'vise' });
  const t = r.podaci.termini.find((x) => x.od === '18:00');
  assert.equal(t.hitan, true);
  assert.equal(t.cijena, 30);
  assert.equal(t.potvrdio, false);
  assert.equal((await kripto.desifrujZaBiznis(nalozi.vise.privatni, t.podaci)).napomena, 'Molim što prije');

  // Posebna potvrda za hitne: obični se potvrđuju sami, hitni čekaju salon (zadano).
  assert.equal(t.status, 'ceka');
  const obicni = await kripto.sifrujZaBiznis(nalozi.vise.javni, { ime: 'Obicna', telefon: '061 000 111' });
  r = await zahtjev('/api/profil/studio-vise/rezervacija', { metoda: 'POST', tijelo: { usluge_ids: [sisanje.id], datum: dan, od_min: 8 * 60, podaci_sif: obicni, saglasnost: true } });
  assert.equal(r.podaci.status, 'potvrden');
  // Kad se isključi posebna potvrda, i hitni se potvrđuju sami.
  await zahtjev('/api/panel/biznis', { metoda: 'PUT', ko: 'vise', tijelo: { hitni_potvrda: false } });
  r = await zahtjev('/api/profil/studio-vise/rezervacija', { metoda: 'POST', tijelo: { usluge_ids: [sisanje.id], datum: dan, od_min: 19 * 60, podaci_sif, saglasnost: true, hitno: true } });
  assert.equal(r.podaci.status, 'potvrden');
});

test('primjer profila: posjetilac isproba, ali se ništa ne upisuje', async () => {
  const { konfig } = await import('../src/konfig.js');
  konfig.demoSlug = 'studio-vise';
  try {
    const profil = (await zahtjev('/api/profil/studio-vise')).podaci;
    assert.equal(profil.demo, true);
    const usluga = profil.usluge[0];
    const dan = dodajDane(sada().datum, 5);
    const prije = db.prepare('SELECT COUNT(*) AS n FROM termini').get().n;
    const podaci_sif = await kripto.sifrujZaBiznis(profil.javni_kljuc, { ime: 'Demo', telefon: '060 000 000' });
    const r = await zahtjev('/api/profil/studio-vise/rezervacija', { metoda: 'POST', tijelo: { usluge_ids: [usluga.id], datum: dan, od_min: 8 * 60, podaci_sif, saglasnost: true } });
    assert.equal(r.podaci.demo, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM termini').get().n, prije);
    // Vlasnik tog profila vidi pravi profil (nije demo za njega).
    assert.equal((await zahtjev('/api/profil/studio-vise', { ko: 'vise' })).podaci.demo, false);
    assert.equal((await zahtjev('/api/profil/studio-vise', { ko: 'vise' })).podaci.jeVlasnik, true);
  } finally {
    konfig.demoSlug = '';
  }
});

test('djelatnost "Ostalo" s vlastitim nazivom', async () => {
  const r0 = await kripto.pripremiNoviRacun('lozinka123');
  db.prepare("INSERT INTO pozivnice (token, email, mjeseci) VALUES ('poziv-stolar', 'stolar@test.ba', 1)").run();
  const osnova = { email: 'stolar@test.ba', naziv: 'Stolarija Drvo', uslovi: true, vlasnik_ime: 'Mujo', vlasnik_prezime: 'Mujić', pozivnica: 'poziv-stolar', kategorija: 'ostalo', ...r0.zaServer };
  // Bez upisane djelatnosti ne ide.
  let r = await zahtjev('/api/auth/registracija', { metoda: 'POST', tijelo: osnova });
  assert.equal(r.status, 400);
  r = await zahtjev('/api/auth/registracija', { metoda: 'POST', ko: 'stolar', tijelo: { ...osnova, kategorija_tekst: 'Stolar' } });
  assert.equal(r.status, 201);
  assert.equal((await zahtjev('/api/profil/stolarija-drvo')).podaci.kategorija, 'Stolar');
  // Prelazak na auto servis briše vlastiti naziv.
  r = await zahtjev('/api/panel/biznis', { metoda: 'PUT', ko: 'stolar', tijelo: { kategorija: 'autoservis' } });
  assert.equal(r.podaci.biznis.kategorija_tekst, '');
  assert.equal((await zahtjev('/api/profil/stolarija-drvo')).podaci.kategorija, 'Auto servis');
  // Tetovaže više nisu na popisu.
  r = await zahtjev('/api/panel/biznis', { metoda: 'PUT', ko: 'stolar', tijelo: { kategorija: 'tetovaze' } });
  assert.equal(r.status, 400);
});

test('usluga od više dana: zauzima cijele radne dane, otkazuje se cijela', async () => {
  // Mehaničar radi pon–pet 8–16; popravak traje 2 radna dana.
  db.prepare("INSERT INTO pozivnice (token, email, mjeseci) VALUES ('poziv-meh', 'meh@test.ba', 1)").run();
  const r0 = await kripto.pripremiNoviRacun('lozinka123');
  nalozi.meh = { privatni: r0.privatni, javni: r0.zaServer.javni_kljuc };
  let r = await zahtjev('/api/auth/registracija', { metoda: 'POST', ko: 'meh', tijelo: { email: 'meh@test.ba', naziv: 'Auto Meh', kategorija: 'mehanicar', uslovi: true, vlasnik_ime: 'Ado', vlasnik_prezime: 'Adić', pozivnica: 'poziv-meh', ...r0.zaServer } });
  assert.equal(r.status, 201);
  const dani = Array.from({ length: 7 }, (_, i) => ({ dan: i + 1, radi: i < 5, od: '08:00', do: '16:00', pauza_od: '', pauza_do: '' }));
  await zahtjev('/api/panel/radno-vrijeme', { metoda: 'PUT', ko: 'meh', tijelo: { dani } });
  // Trajanje u danima i najava od 1 dana (1440 min).
  r = await zahtjev('/api/panel/usluge', { metoda: 'POST', ko: 'meh', tijelo: { naziv: 'Generalni servis motora', dani: 2, cijena: '300' } });
  const servis = r.podaci.usluge[0];
  assert.equal(servis.dani, 2);
  r = await zahtjev('/api/panel/usluge', { metoda: 'POST', ko: 'meh', tijelo: { naziv: 'Zamjena ulja', trajanje_min: 30, cijena: '40' } });
  const ulje = r.podaci.usluge.find((u) => u.naziv === 'Zamjena ulja');
  r = await zahtjev('/api/panel/biznis', { metoda: 'PUT', ko: 'meh', tijelo: { najava_min: 1440 } });
  assert.equal(r.podaci.biznis.najava_min, 1440);

  // Ponedjeljak bar 3 dana od danas.
  let pon = dodajDane(sada().datum, 3);
  while (danUSedmici(pon) !== 1) pon = dodajDane(pon, 1);
  const pet = dodajDane(pon, 4);

  // Ne može se kombinovati s drugim uslugama.
  r = await zahtjev(`/api/profil/auto-meh/slobodno?usluge=${servis.id},${ulje.id}&datum=${pon}`);
  assert.equal(r.status, 400);

  r = await zahtjev(`/api/profil/auto-meh/slobodno?usluge=${servis.id}&datum=${pon}`);
  assert.equal(r.podaci.termini.length, 1);
  assert.equal(r.podaci.termini[0].od, '08:00');
  assert.equal(r.podaci.termini[0].do_datum, dodajDane(pon, 1));

  // Petak + 2 dana preskače vikend: završetak u ponedjeljak.
  r = await zahtjev(`/api/profil/auto-meh/slobodno?usluge=${servis.id}&datum=${pet}`);
  assert.equal(r.podaci.termini[0].do_datum, dodajDane(pet, 3));

  const podaci_sif = await kripto.sifrujZaBiznis(nalozi.meh.javni, { ime: 'Vozač Test', telefon: '061 777 888' });
  r = await zahtjev('/api/profil/auto-meh/rezervacija', { metoda: 'POST', tijelo: { usluge_ids: [servis.id], datum: pon, od_min: 480, podaci_sif, saglasnost: true } });
  assert.equal(r.status, 201);
  assert.match(r.podaci.citljivo, /završetak/);
  const token = r.podaci.otkazLink.split('/').pop();

  // Oba dana su zauzeta (ni zamjena ulja ne može), u panelu "dan 1/2" i "dan 2/2".
  r = await zahtjev(`/api/profil/auto-meh/slobodno?usluge=${ulje.id}&datum=${dodajDane(pon, 1)}`);
  assert.equal(r.podaci.termini.length, 0);
  r = await zahtjev(`/api/panel/termini?datum=${dodajDane(pon, 1)}`, { ko: 'meh' });
  assert.equal(r.podaci.termini[0].dan_br, 2);
  assert.equal(r.podaci.termini[0].dana_ukupno, 2);

  // Otkazivanje oslobađa oba dana.
  r = await zahtjev(`/api/otkazivanje/${token}`, { metoda: 'POST' });
  assert.equal(r.status, 200);
  r = await zahtjev(`/api/profil/auto-meh/slobodno?usluge=${ulje.id}&datum=${dodajDane(pon, 1)}`);
  assert.ok(r.podaci.termini.length > 0);
});

test('smještaj: rezervacija po noćenjima, cijena vikendom, bez duplih noći', async () => {
  db.prepare("INSERT INTO pozivnice (token, email, mjeseci) VALUES ('poziv-vik', 'vik@test.ba', 1)").run();
  const r0 = await kripto.pripremiNoviRacun('lozinka123');
  nalozi.vik = { privatni: r0.privatni, javni: r0.zaServer.javni_kljuc };
  let r = await zahtjev('/api/auth/registracija', { metoda: 'POST', ko: 'vik', tijelo: { email: 'vik@test.ba', naziv: 'Vikendica Jahorina', kategorija: 'smjestaj', uslovi: true, vlasnik_ime: 'Ena', vlasnik_prezime: 'Enić', pozivnica: 'poziv-vik', ...r0.zaServer } });
  assert.equal(r.status, 201);
  // Bez cijene nema online rezervacije.
  assert.equal((await zahtjev('/api/profil/vikendica-jahorina')).podaci.zakazivanjeAktivno, false);
  r = await zahtjev('/api/panel/biznis', { metoda: 'PUT', ko: 'vik', tijelo: { smj_cijena: '100', smj_cijena_vikend: '150', smj_min_noci: 2, smj_max_gostiju: 6 } });
  assert.equal(r.podaci.biznis.smjestaj, true);
  assert.equal(r.podaci.biznis.dana_unaprijed, 365); // zadano za smještaj
  const profil = (await zahtjev('/api/profil/vikendica-jahorina')).podaci;
  assert.equal(profil.smjestaj.cijena, 100);

  // Četvrtak -> nedjelja = noći čet, pet, sub = 100 + 150 + 150.
  let cet = dodajDane(sada().datum, 7);
  while (danUSedmici(cet) !== 4) cet = dodajDane(cet, 1);
  const ned = dodajDane(cet, 3);
  const podaci_sif = await kripto.sifrujZaBiznis(nalozi.vik.javni, { ime: 'Gost Test', telefon: '061 444 555', gosti: 4 });
  // Jedna noć je ispod minimuma.
  r = await zahtjev('/api/profil/vikendica-jahorina/boravak', { metoda: 'POST', tijelo: { dolazak: cet, odlazak: dodajDane(cet, 1), gosti: 4, podaci_sif, saglasnost: true } });
  assert.equal(r.status, 400);
  // Previše gostiju.
  r = await zahtjev('/api/profil/vikendica-jahorina/boravak', { metoda: 'POST', tijelo: { dolazak: cet, odlazak: ned, gosti: 9, podaci_sif, saglasnost: true } });
  assert.equal(r.status, 400);
  r = await zahtjev('/api/profil/vikendica-jahorina/boravak', { metoda: 'POST', tijelo: { dolazak: cet, odlazak: ned, gosti: 4, podaci_sif, saglasnost: true } });
  assert.equal(r.status, 201);
  assert.equal(r.podaci.noci, 3);
  assert.equal(r.podaci.cijena, 400);
  assert.equal(r.podaci.status, 'ceka'); // domaćin potvrđuje (zadano za smještaj)
  const token = r.podaci.otkazLink.split('/').pop();

  // Noći su zauzete, a dan odlaska (nedjelja) je slobodan za novi dolazak.
  const n = (await zahtjev('/api/profil/vikendica-jahorina/nocenja')).podaci;
  assert.ok(n.zauzeto.includes(cet) && n.zauzeto.includes(dodajDane(cet, 2)) && !n.zauzeto.includes(ned));
  r = await zahtjev('/api/profil/vikendica-jahorina/boravak', { metoda: 'POST', tijelo: { dolazak: dodajDane(cet, 1), odlazak: dodajDane(cet, 4), gosti: 2, podaci_sif, saglasnost: true } });
  assert.equal(r.status, 409);
  r = await zahtjev('/api/profil/vikendica-jahorina/boravak', { metoda: 'POST', tijelo: { dolazak: ned, odlazak: dodajDane(ned, 2), gosti: 2, podaci_sif, saglasnost: true } });
  assert.equal(r.status, 201);

  // Ručni upis domaćina i potvrda cijelog boravka odjednom.
  const pon2 = dodajDane(ned, 8);
  r = await zahtjev('/api/panel/boravak', { metoda: 'POST', ko: 'vik', tijelo: { dolazak: pon2, odlazak: dodajDane(pon2, 1), podaci_sif } });
  assert.equal(r.status, 201);
  r = await zahtjev(`/api/panel/termini?datum=${cet}`, { ko: 'vik' });
  const prva = r.podaci.termini[0];
  assert.equal(prva.usluga, 'Smještaj');
  assert.equal(prva.dana_ukupno, 3);
  assert.equal((await kripto.desifrujZaBiznis(nalozi.vik.privatni, prva.podaci)).gosti, 4);
  r = await zahtjev(`/api/panel/termini/${prva.id}`, { metoda: 'PATCH', ko: 'vik', tijelo: { status: 'potvrden' } });
  assert.equal(r.status, 200);
  r = await zahtjev(`/api/panel/termini?datum=${dodajDane(cet, 2)}`, { ko: 'vik' });
  assert.equal(r.podaci.termini[0].status, 'potvrden');

  // Gost otkaže: sve tri noći se oslobode, a stranica otkazivanja piše dolazak i odlazak.
  const info = (await zahtjev(`/api/otkazivanje/${token}`)).podaci;
  assert.match(info.citljivo, /dolazak .* odlazak/);
  await zahtjev(`/api/otkazivanje/${token}`, { metoda: 'POST' });
  const n2 = (await zahtjev('/api/profil/vikendica-jahorina/nocenja')).podaci;
  assert.ok(!n2.zauzeto.includes(cet) && !n2.zauzeto.includes(dodajDane(cet, 2)));
});
