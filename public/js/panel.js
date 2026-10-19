// Panel za vlasnika profila.
import {
  api, $, $$, h, esc, obavijesti, postaviTemu, cijena, trajanje, citljivDatum, danUSedmici,
  dodajDane, danas, DANI, DANI_KRATKO, inicijali, saDugmetom, postaviPozadinu, sirovo,
} from './zajednicko.js';
import {
  izLozinke, novaSol, otkljucajPkcs8, uveziPrivatni, zakljucajPrivatni, sifrujZaBiznis, desifrujZaBiznis,
  noviKod, zakljucajKodom,
} from './kripto.js';
import { sacuvajKljuc, ucitajKljuc, obrisiKljuceve } from './kljucevi.js';
import { mailtoKod, preuzmiKod, kopirajKod } from './kod-oporavka.js';

const stanje = {
  ja: null, biznis: null, teme: [], kategorije: [], usluge: [], radno: [],
  datum: danas(), cekanje: [],
  kljuc: null, // otključani privatni ključ (samo u ovom pregledniku)
};

// ===================== Početak =====================
async function pokreni() {
  try {
    stanje.ja = await api('/api/auth/ja');
  } catch {
    location.replace('/prijava');
    return;
  }
  const [b, u, r] = await Promise.all([api('/api/panel/biznis'), api('/api/panel/usluge'), api('/api/panel/radno-vrijeme')]);
  stanje.biznis = b.biznis;
  stanje.teme = b.teme;
  stanje.kategorije = b.kategorije;
  stanje.usluge = u.usluge;
  stanje.radno = r.dani;

  stanje.kljuc = await ucitajKljuc(stanje.ja.id);
  if (!stanje.kljuc) $('#dijalog-otkljucaj').showModal();

  $('#link-admin').hidden = !stanje.ja.admin;
  prilagodiZaSmjestaj();
  osvjeziZaglavlje();
  prikaziPretplatu();
  prikaziDobrodoslicu();
  postaviTabove();
  ucitajKalendar();
  ucitajCekanje();
}

// Vikendica / apartman: panel pokazuje samo ono što smještaju treba.
function prilagodiZaSmjestaj() {
  const smj = Boolean(stanje.biznis.smjestaj);
  document.body.classList.toggle('smjestaj', smj);
  $('[data-tab="usluge"]').hidden = smj;
  $('#kartica-radno').hidden = smj;
  $('#kartica-hitni').hidden = smj;
  $('#polje-korak').hidden = smj;
  $('#dugme-blokiraj').hidden = smj;
  $('#kartica-smjestaj').hidden = !smj;
  $('#dugme-novi-termin').textContent = smj ? '+ Rezervacija' : '+ Termin';
  const tabRadno = $('[data-tab="radno"]');
  tabRadno.querySelector('.tab-pun').textContent = smj ? 'Zatvoreni dani' : 'Radno vrijeme';
  tabRadno.querySelector('.tab-kratko').textContent = smj ? 'Zatvoreno' : 'Vrijeme';
  $('#neradni-naslov').textContent = smj ? 'Zatvoreni dani' : 'Neradni dani';
  $('#neradni-opis').textContent = smj
    ? 'Noći kad ne iznajmljuješ (renoviranje, lični boravak, rezervacija s druge strane…). Gosti ih vide kao zauzete.'
    : 'Praznici, godišnji odmor, bolovanje… Tih dana niko ne može zakazati.';
}

function osvjeziZaglavlje() {
  const b = stanje.biznis;
  postaviTemu(b.tema);
  $('#glava-naziv').textContent = b.naziv;
  $('#glava-link').textContent = b.javniLink.replace(/^https?:\/\//, '');
  $('#glava-avatar').innerHTML = b.logoUrl ? h`<img src="${b.logoUrl}" alt="">` : esc(inicijali(b.naziv));
  $('#pogled-klijenta').href = b.javniLink;
  postaviPozadinu(b.pozadinaUrl);
}

// Klik na okruglu sliku (s olovkom) otvara izbor nove slike iz galerije.
$('#glava-avatar-dugme').addEventListener('click', () => $('#logo-fajl').click());
$('#logo-pregled-dugme').addEventListener('click', () => $('#logo-fajl').click());

$('#glava-link').addEventListener('click', () => kopiraj(stanje.biznis.javniLink));

async function kopiraj(tekst) {
  try {
    await navigator.clipboard.writeText(tekst);
    obavijesti('Link je kopiran. Zalijepi ga na Instagram.');
  } catch {
    obavijesti('Kopiranje nije uspjelo. Označi link i kopiraj ga ručno.', 'greska');
  }
}

$('#dugme-odjava').addEventListener('click', async () => {
  await api('/api/auth/odjava', { metoda: 'POST' }).catch(() => {});
  await obrisiKljuceve();
  location.href = '/';
});

// ===================== Pretplata =====================
function formatDatum(d) {
  const [g, m, dan] = d.split('-').map(Number);
  return `${dan}.${m}.${g}.`;
}

function danaDo(datum) {
  return Math.round((Date.parse(`${datum}T00:00:00Z`) - Date.parse(`${danas()}T00:00:00Z`)) / 86400000);
}

function prikaziPretplatu() {
  const p = stanje.biznis.pretplata;
  const kutija = $('#obavijest-pretplata');
  const preostalo = danaDo(p.aktivnaDo);
  let html = '';
  if (p.zauvijek && !p.blokiranOdAdmina) {
    html = '';
  } else if (p.blokiranOdAdmina) {
    html = h`<div class="poruka greska">Tvoj profil je privremeno isključen i klijenti ne mogu zakazivati. Pozovi ili pošalji poruku na ${p.kontakt}.</div>`;
  } else if (!p.vazi) {
    html = h`<div class="poruka upozorenje"><b>Pretplata je istekla</b> i klijenti trenutno ne mogu online zakazivati. Kalendar i dalje radi. ${p.upute}</div>`;
  } else if (p.uProbi && preostalo <= 7) {
    html = h`<div class="poruka info">Besplatni mjesec traje još <b>${preostalo} ${preostalo === 1 ? 'dan' : 'dana'}</b>. Da profil nastavi raditi, pretplata je ${p.cijenaKM} KM mjesečno. ${p.upute}</div>`;
  } else if (!p.uProbi && preostalo <= 5) {
    html = h`<div class="poruka info">Pretplata ističe za <b>${preostalo} ${preostalo === 1 ? 'dan' : 'dana'}</b> (${formatDatum(p.aktivnaDo)}). ${p.upute}</div>`;
  }
  kutija.innerHTML = String(html);

  $('#pretplata-detalji').innerHTML = String(h`
    <div class="pretplata-stanje">
      <div><span class="oznaka-status ${p.vazi ? 'potvrden' : 'otkazan'}">${p.zauvijek ? 'Plaćeno zauvijek' : p.vazi ? 'Aktivna' : 'Istekla'}</span></div>
      <div class="iznos">${p.cijenaKM} KM <span class="prigusen malo">/ mjesečno</span></div>
      <p class="prigusen">${p.zauvijek ? 'Pretplata važi zauvijek.' : p.vazi ? `Važi do ${formatDatum(p.aktivnaDo)}.` : `Istekla je ${formatDatum(p.aktivnaDo)}.`}</p>
      <p class="malo">${p.upute}${p.kontakt ? ` Telefon (poziv, Viber, WhatsApp, SMS): ${p.kontakt}` : ''}</p>
    </div>`);
}

// ===================== Dobrodošlica i kontrolna lista =====================
function prikaziDobrodoslicu() {
  const b = stanje.biznis;
  const koraci = [
    b.smjestaj
      ? { gotovo: b.smj_cijena != null, tekst: 'Upiši cijenu noćenja i pravila smještaja', tab: 'postavke' }
      : { gotovo: stanje.usluge.length > 0, tekst: 'Dodaj usluge s trajanjem i cijenom', tab: 'usluge' },
    { gotovo: true, tekst: 'Provjeri radno vrijeme', tab: 'radno', mekano: true },
    { gotovo: true, tekst: 'Izaberi da li ti potvrđuješ termine ili se potvrđuju sami', tab: 'postavke', mekano: true },
    { gotovo: Boolean(b.logoUrl), tekst: 'Učitaj logo ili profilnu sliku', tab: 'izgled' },
    { gotovo: b.tema !== 'konekt', tekst: 'Izaberi temu pozadine', tab: 'izgled', mekano: true },
    { gotovo: false, tekst: 'Kopiraj link i stavi ga na Instagram', tab: 'izgled', mekano: true },
  ];
  let skriveno = false;
  try { skriveno = localStorage.getItem('konekt-dobrodoslica-skrivena') === '1'; } catch { /* ništa */ }
  const novi = new URLSearchParams(location.search).has('dobrodoslica');
  const fali = koraci.some((k) => !k.gotovo && !k.mekano);
  if (!(novi || (fali && !skriveno))) return;
  $('#kontrolna-lista').innerHTML = koraci.map((k) => h`
    <li class="${k.gotovo && !k.mekano ? 'gotovo' : ''}"><span class="tacka">${k.gotovo && !k.mekano ? '✓' : ''}</span>
    <span><button type="button" data-idi="${k.tab}">${k.tekst}</button></span></li>`).join('');
  $$('#kontrolna-lista [data-idi]').forEach((d) => d.addEventListener('click', () => otvoriTab(d.dataset.idi)));
  $('#dobrodoslica').hidden = false;
  if (novi) history.replaceState(null, '', '/panel');
}

$('#zatvori-dobrodoslicu').addEventListener('click', () => {
  $('#dobrodoslica').hidden = true;
  try { localStorage.setItem('konekt-dobrodoslica-skrivena', '1'); } catch { /* ništa */ }
});

// ===================== Tabovi =====================
const ucitaniTabovi = new Set(['kalendar']);
function postaviTabove() {
  $$('[role="tab"]').forEach((t) => t.addEventListener('click', () => otvoriTab(t.dataset.tab)));
  const izHasha = () => {
    const ime = location.hash.slice(1);
    if (ime && $(`[data-tab="${ime}"]`)) otvoriTab(ime);
  };
  izHasha();
  // Link poput /panel#usluge otvara taj tab i kad je panel već otvoren.
  window.addEventListener('hashchange', izHasha);
}

function otvoriTab(ime) {
  $$('[role="tab"]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === ime)));
  $$('[data-sadrzaj]').forEach((s) => { s.hidden = s.dataset.sadrzaj !== ime; });
  history.replaceState(null, '', ime === 'kalendar' ? '/panel' : `#${ime}`);
  if (window.matchMedia('(max-width: 720px)').matches) window.scrollTo({ top: 0, behavior: 'smooth' });
  if (!ucitaniTabovi.has(ime)) {
    ucitaniTabovi.add(ime);
    if (ime === 'usluge') prikaziUsluge();
    if (ime === 'radno') { prikaziRadno(); ucitajNeradne(); }
    if (ime === 'postavke') { prikaziPravila(); ucitajHitno(); prikaziSmjestaj(); }
    if (ime === 'izgled') prikaziIzgled();
    if (ime === 'racun') { $('#racun-email').textContent = stanje.biznis.email; prikaziVlasnika(); }
  }
}

// ===================== Ključ i otključavanje =====================
// Izvodi ključ iz lozinke i otključava privatni ključ. Baca grešku za pogrešnu lozinku.
async function otkljucajLozinkom(lozinka) {
  const { sol, kljuc_lozinkom: omot } = await api('/api/auth/kljuc');
  const { kljucOmota, auth } = await izLozinke(lozinka, sol);
  let pkcs8;
  try {
    pkcs8 = await otkljucajPkcs8(kljucOmota, omot);
  } catch {
    throw new Error('Lozinka nije tačna.');
  }
  return { pkcs8, auth };
}

obradiDijalog($('#forma-otkljucaj'), async (f) => {
  const { pkcs8 } = await otkljucajLozinkom(f.get('lozinka'));
  stanje.kljuc = await uveziPrivatni(pkcs8);
  await sacuvajKljuc(stanje.ja.id, stanje.kljuc);
  $('#forma-otkljucaj').reset();
  obavijesti('Klijenti su otključani na ovom uređaju.');
  ucitajKalendar();
  ucitajCekanje();
});

// Otključava ime i telefon svakog termina (u pregledniku).
async function otkljucajTermine(lista) {
  await Promise.all(lista.map(async (t) => {
    if (t.vrsta !== 'termin' || !t.podaci) return;
    if (!stanje.kljuc) { t.zakljucano = true; return; }
    try {
      const p = await desifrujZaBiznis(stanje.kljuc, t.podaci);
      t.ime = p.ime;
      t.telefon = p.telefon;
      t.poruka = p.napomena || '';
      t.gosti = p.gosti || null;
    } catch {
      t.zakljucano = true; // zaključano starim ključem (nova lozinka bez koda oporavka)
    }
  }));
  return lista;
}

// ===================== Kalendar =====================
function radnoZaDan(datum) {
  return stanje.radno.find((r) => r.dan === danUSedmici(datum));
}

async function ucitajKalendar() {
  const datum = stanje.datum;
  $('#izbor-datuma').value = datum;
  $('#dan-naslov').textContent = citljivDatum(datum);
  prikaziSedmicu();
  $('#lista-dan').innerHTML = '<div class="skelet"></div><div class="skelet"></div>';
  try {
    const { termini, otkazani, neradan } = await api(`/api/panel/termini?datum=${datum}`);
    await otkljucajTermine([...termini, ...otkazani]);
    if (stanje.datum !== datum) return;
    const r = radnoZaDan(datum);
    $('#dan-radno').textContent = neradan ? 'Označen kao neradni dan.'
      : r && r.radi ? `Radno vrijeme ${r.od}–${r.do}${r.pauza_od ? `, pauza ${r.pauza_od}–${r.pauza_do}` : ''}` : 'Ne radiš ovaj dan.';
    $('#lista-dan').innerHTML = termini.length
      ? termini.map(redTermina).join('')
      : '<div class="prazno">Nema termina za ovaj dan.</div>';
    $('#otkazani-omot').hidden = !otkazani.length;
    $('#otkazani-broj').textContent = otkazani.length;
    $('#lista-otkazani').innerHTML = otkazani.map(redTermina).join('');
  } catch (g) {
    $('#lista-dan').innerHTML = h`<div class="poruka greska">${g.message}</div>`;
  }
}

// Jasan status: automatski zakazan termin nije isto što i termin koji si ti potvrdio/la.
function nazivStatusa(t) {
  if (t.status === 'ceka') return ['ceka', 'Čeka tvoju potvrdu'];
  if (t.status === 'otkazan') return ['otkazan', 'Otkazan'];
  if (t.status === 'odbijen') return ['odbijen', 'Odbijen'];
  if (t.izvor === 'rucno') return ['blok', 'Upisan ručno'];
  if (t.potvrdio) return ['potvrden', 'Potvrđen'];
  return ['info', 'Zakazan automatski'];
}

function redTermina(t, { saDatumom = false } = {}) {
  if (t.vrsta === 'blok') {
    return h`<div class="termin-red blok">
      <div class="termin-vrijeme">${t.od}<small>do ${t.do}</small></div>
      <div class="termin-info"><strong>Blokirano</strong><span class="detalji">${t.napomena || 'Nije dostupno za zakazivanje'}</span></div>
      <div class="termin-akcije"><button class="dugme tekstualno malo" data-akcija="obrisi" data-id="${t.id}">Ukloni</button></div>
    </div>`;
  }
  const akcije = [];
  if (t.status === 'ceka') {
    akcije.push(h`<button class="dugme malo" data-akcija="potvrden" data-id="${t.id}">Potvrdi</button>`);
    akcije.push(h`<button class="dugme drugo malo" data-akcija="odbijen" data-id="${t.id}">Odbij</button>`);
  } else if (t.status === 'potvrden') {
    akcije.push(h`<button class="dugme tekstualno malo" data-akcija="otkazan" data-id="${t.id}">Otkaži</button>`);
  }
  const tel = t.telefon ? h`<a href="tel:${t.telefon.replace(/[^\d+]/g, '')}">${t.telefon}</a>` : '';
  if (t.usluga === 'Smještaj') {
    // Noćenje: umjesto sata piše "noć 2/3", uz broj gostiju.
    const tekstNoci = t.dana_ukupno > 1 ? `noć ${t.dan_br}/${t.dana_ukupno}` : '1 noć';
    return h`<div class="termin-red ${t.status}">
      <div class="termin-vrijeme">Noćenje<small>${saDatumom ? citljivDatum(t.datum, { kratko: true }) : tekstNoci}</small></div>
      <div class="termin-info">
        ${t.zakljucano ? h`<strong class="zakljucano">Zaključano 🔒</strong>` : h`<strong>${t.ime || 'Gost'}</strong>`}
        <span class="detalji">${t.gosti ? h`<span>${t.gosti} ${t.gosti === 1 ? 'gost' : t.gosti % 10 >= 2 && t.gosti % 10 <= 4 && (t.gosti % 100 < 12 || t.gosti % 100 > 14) ? 'gosta' : 'gostiju'}</span>` : ''}${tel}
          ${t.cijena != null ? h`<span>ukupno ${cijena(t.cijena)}</span>` : ''}
          <span class="oznaka-status ${nazivStatusa(t)[0]}">${nazivStatusa(t)[1].replace('Zakazan automatski', 'Rezervisano')}</span></span>
        ${t.poruka ? h`<span class="napomena-klijenta">„${t.poruka}“</span>` : ''}
      </div>
      <div class="termin-akcije">${akcije}</div>
    </div>`;
  }
  return h`<div class="termin-red ${t.status}">
    <div class="termin-vrijeme">${t.od}<small>${saDatumom ? citljivDatum(t.datum, { kratko: true }) : `do ${t.do}`}</small></div>
    <div class="termin-info">
      ${t.zakljucano ? h`<strong class="zakljucano">Zaključano 🔒</strong>` : h`<strong>${t.ime || 'Klijent'}</strong>`}
      <span class="detalji"><span>${t.usluga}${t.dana_ukupno > 1 ? ` · dan ${t.dan_br}/${t.dana_ukupno}` : ''}</span>${tel}
        ${t.cijena != null ? h`<span>${cijena(t.cijena)}</span>` : ''}
        ${t.hitan ? h`<span class="oznaka-status hitno">Hitno</span>` : ''}
        <span class="oznaka-status ${nazivStatusa(t)[0]}">${nazivStatusa(t)[1]}</span></span>
      ${t.poruka ? h`<span class="napomena-klijenta">„${t.poruka}“</span>` : ''}
    </div>
    <div class="termin-akcije">${akcije}</div>
  </div>`;
}

async function prikaziSedmicu() {
  // Sedmica od ponedjeljka u kojoj je izabrani datum.
  const pon = dodajDane(stanje.datum, 1 - danUSedmici(stanje.datum));
  const dani = Array.from({ length: 7 }, (_, i) => dodajDane(pon, i));
  const danasD = danas();
  const crtaj = (brojevi = {}) => {
    $('#sedmica').innerHTML = dani.map((d) => {
      const n = brojevi[d] || { broj: 0, ceka: 0 };
      const tackice = Array.from({ length: Math.min(n.broj, 4) }, (_, i) => (i < n.ceka ? '<i class="ceka"></i>' : '<i></i>')).join('');
      return `<button type="button" data-datum="${d}" class="${d === danasD ? 'danas' : ''}" ${d === stanje.datum ? 'aria-current="date"' : ''}
        aria-label="${esc(citljivDatum(d))}, ${n.broj} termina"><small>${DANI_KRATKO[danUSedmici(d)]}</small><b>${Number(d.slice(8))}</b><span class="tackice">${tackice}</span></button>`;
    }).join('');
    $$('#sedmica button').forEach((b) => b.addEventListener('click', () => idiNaDatum(b.dataset.datum)));
  };
  crtaj();
  try {
    const { dani: pregled } = await api(`/api/panel/termini/pregled?od=${dani[0]}&do=${dani[6]}`);
    crtaj(Object.fromEntries(pregled.map((p) => [p.datum, p])));
  } catch { /* tačkice nisu bitne */ }
}

function idiNaDatum(d) {
  if (!d) return;
  stanje.datum = d;
  ucitajKalendar();
}

$('#dan-nazad').addEventListener('click', () => idiNaDatum(dodajDane(stanje.datum, -1)));
$('#dan-naprijed').addEventListener('click', () => idiNaDatum(dodajDane(stanje.datum, 1)));
$('#dan-danas').addEventListener('click', () => idiNaDatum(danas()));
$('#izbor-datuma').addEventListener('change', (e) => idiNaDatum(e.target.value));

async function ucitajCekanje() {
  try {
    const { termini } = await api('/api/panel/termini/na-cekanju');
    await otkljucajTermine(termini);
    stanje.cekanje = termini;
    $('#cekanje').hidden = !termini.length;
    $('#broj-cekanje').hidden = !termini.length;
    $('#broj-cekanje').textContent = termini.length;
    $('#lista-cekanje').innerHTML = termini.map((t) => redTermina(t, { saDatumom: true })).join('');
  } catch { /* ništa */ }
}

// Akcije na terminima (potvrdi, odbij, otkaži, ukloni blokadu)
document.addEventListener('click', async (e) => {
  const dugme = e.target.closest('[data-akcija]');
  if (!dugme) return;
  const { akcija, id } = dugme.dataset;
  const pitanja = { otkazan: 'Otkazati ovaj termin?', odbijen: 'Odbiti ovaj termin?', obrisi: 'Ukloniti blokadu?' };
  if (pitanja[akcija] && !confirm(pitanja[akcija])) return;
  try {
    await saDugmetom(dugme, () => (akcija === 'obrisi'
      ? api(`/api/panel/termini/${id}`, { metoda: 'DELETE' })
      : api(`/api/panel/termini/${id}`, { metoda: 'PATCH', tijelo: { status: akcija } })));
    obavijesti({ potvrden: 'Termin je potvrđen.', odbijen: 'Termin je odbijen.', otkazan: 'Termin je otkazan.', obrisi: 'Blokada je uklonjena.' }[akcija]);
    ucitajKalendar();
    ucitajCekanje();
  } catch (g) {
    obavijesti(g.message, 'greska');
  }
});

// ===================== Dijalozi (zajedničko) =====================
$$('dialog [data-zatvori]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

function obradiDijalog(forma, fn) {
  forma.addEventListener('submit', async (e) => {
    e.preventDefault();
    const greska = forma.querySelector('.poruka.greska');
    if (greska) greska.hidden = true;
    try {
      await saDugmetom(forma.querySelector('button[type="submit"]'), () => fn(new FormData(forma)));
      forma.closest('dialog').close();
    } catch (g) {
      if (greska) { greska.textContent = g.message; greska.hidden = false; } else obavijesti(g.message, 'greska');
    }
  });
}

// Novi termin (ručno)
$('#dugme-novi-termin').addEventListener('click', () => {
  if (stanje.biznis.smjestaj) {
    const f = $('#forma-boravak');
    f.reset();
    f.querySelector('.poruka').hidden = true;
    f.dolazak.value = stanje.datum;
    f.odlazak.value = dodajDane(stanje.datum, Math.max(1, stanje.biznis.smj_min_noci));
    $('#dijalog-boravak').showModal();
    return;
  }
  if (!stanje.usluge.length) {
    obavijesti('Prvo dodaj bar jednu uslugu.', 'greska');
    otvoriTab('usluge');
    return;
  }
  const f = $('#forma-termin');
  f.reset();
  f.querySelector('.poruka').hidden = true;
  $('#t-usluga').innerHTML = stanje.usluge.filter((u) => u.aktivna).concat(stanje.usluge.filter((u) => !u.aktivna))
    .filter((u) => !u.dani)
    .map((u) => h`<option value="${u.id}">${u.naziv} (${trajanje(u.trajanje_min)})</option>`).join('');
  $('#t-datum').value = stanje.datum;
  $('#dijalog-termin').showModal();
});

obradiDijalog($('#forma-termin'), async (f) => {
  const ime = String(f.get('ime')).trim();
  if (ime.length < 2) throw new Error('Upiši ime klijenta.');
  // Zaključaj ime i telefon svojim javnim ključem prije slanja.
  const podaci_sif = await sifrujZaBiznis(stanje.biznis.javni_kljuc, { ime: ime.slice(0, 80), telefon: String(f.get('telefon')).trim().slice(0, 30) });
  await api('/api/panel/termini', {
    metoda: 'POST',
    tijelo: { usluga_id: Number(f.get('usluga_id')), datum: f.get('datum'), od: f.get('od'), podaci_sif },
  });
  obavijesti('Termin je dodan.');
  idiNaDatum(f.get('datum'));
});

obradiDijalog($('#forma-boravak'), async (f) => {
  const ime = String(f.get('ime')).trim();
  if (ime.length < 2) throw new Error('Upiši ime gosta.');
  const gosti = Math.max(1, Number(f.get('gosti')) || 1);
  const podaci_sif = await sifrujZaBiznis(stanje.biznis.javni_kljuc, { ime: ime.slice(0, 80), telefon: String(f.get('telefon')).trim().slice(0, 30), gosti });
  const r = await api('/api/panel/boravak', { metoda: 'POST', tijelo: { dolazak: f.get('dolazak'), odlazak: f.get('odlazak'), podaci_sif } });
  obavijesti(`Rezervacija je upisana (${r.noci} ${r.noci === 1 ? 'noćenje' : 'noćenja'}).`);
  idiNaDatum(f.get('dolazak'));
});

// Blokiranje vremena
$('#dugme-blokiraj').addEventListener('click', () => {
  const f = $('#forma-blok');
  f.reset();
  f.querySelector('.poruka').hidden = true;
  $('#b-datum').value = stanje.datum;
  $('#b-od').innerHTML = opcijeVremena('12:00');
  $('#b-do').innerHTML = opcijeVremena('13:00');
  $('#dijalog-blok').showModal();
});

obradiDijalog($('#forma-blok'), async (f) => {
  await api('/api/panel/blokade', {
    metoda: 'POST',
    tijelo: { datum: f.get('datum'), od: f.get('od'), do: f.get('do'), napomena: f.get('napomena') },
  });
  obavijesti('Vrijeme je blokirano.');
  idiNaDatum(f.get('datum'));
});

// ===================== Usluge =====================
// Trajanje usluge: salon sam upisuje broj i bira minute, sate ili radne dane.
const trajanjeUsluge = (u) => (u.dani ? `${u.dani} ${u.dani === 1 ? 'radni dan' : 'radna dana'}` : trajanje(u.trajanje_min));

function pomocTrajanja() {
  const dan = $('#u-jedinica').value === 'dan';
  $('#u-trajanje').step = dan ? '1' : 'any';
  $('#u-trajanje-pomoc').textContent = dan
    ? 'Usluga zauzima cijele radne dane (npr. popravak auta). Klijent bira dan kad dolazi, na početku radnog vremena.'
    : 'Upiši koliko traje, npr. 45 minuta ili 1,5 sat (najviše 12 sati).';
}
$('#u-jedinica').addEventListener('change', pomocTrajanja);

// Iz forme u { trajanje_min } ili { dani }.
function procitajTrajanje(f) {
  const broj = Number(String(f.get('trajanje_broj')).replace(',', '.'));
  const jedinica = f.get('trajanje_jedinica');
  if (!Number.isFinite(broj) || broj <= 0) throw new Error('Upiši trajanje usluge.');
  if (jedinica === 'dan') {
    if (!Number.isInteger(broj) || broj > 30) throw new Error('Trajanje u danima mora biti cijeli broj od 1 do 30.');
    return { dani: broj };
  }
  const minute = Math.round(jedinica === 'h' ? broj * 60 : broj);
  if (minute < 5 || minute > 720) throw new Error('Trajanje mora biti od 5 minuta do 12 sati. Za duže usluge izaberi "radnih dana".');
  return { trajanje_min: minute };
}

const normalizuj = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'dj');

function prikaziUsluge() {
  const kutija = $('#lista-usluga');
  const trazi = $('#trazi-uslugu');
  trazi.hidden = stanje.usluge.length <= 8;
  $('#grupe-usluga').innerHTML = [...new Set(stanje.usluge.map((u) => u.grupa).filter(Boolean))].map((g) => h`<option value="${g}">`).join('');
  if (!stanje.usluge.length) {
    kutija.innerHTML = '<div class="prazno">Još nemaš usluga. Dodaj prvu, npr. „Šišanje, 30 min, 20 KM“.</div>';
    return;
  }
  const upit = normalizuj(trazi.value);
  const vidljive = upit ? stanje.usluge.filter((u) => normalizuj(`${u.naziv} ${u.grupa} ${u.opis}`).includes(upit)) : stanje.usluge;
  if (!vidljive.length) {
    kutija.innerHTML = '<div class="prazno">Nema usluge s tim nazivom.</div>';
    return;
  }
  kutija.innerHTML = vidljive.map((u) => {
    const i = stanje.usluge.indexOf(u);
    return h`
    <div class="usluga-red ${u.aktivna ? '' : 'neaktivna'}">
      <div class="redoslijed">
        <button type="button" data-pomjeri="-1" data-id="${u.id}" aria-label="Pomjeri gore" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" data-pomjeri="1" data-id="${u.id}" aria-label="Pomjeri dole" ${i === stanje.usluge.length - 1 ? 'disabled' : ''}>▼</button>
      </div>
      <div>
        <strong>${u.naziv}</strong>
        <span class="detalji">${u.grupa ? h`<span class="grupa-oznaka">${u.grupa}</span>` : ''}${trajanjeUsluge(u)}${u.cijena != null ? ` · ${cijena(u.cijena)}` : ''}${u.aktivna ? '' : ' · skrivena'}</span>
      </div>
      <div class="termin-akcije">
        <button class="dugme drugo malo" type="button" data-uredi="${u.id}">Uredi</button>
        <button class="dugme tekstualno malo" type="button" data-obrisi-uslugu="${u.id}">Obriši</button>
      </div>
    </div>`;
  }).join('');
  if (upit) kutija.querySelectorAll('.redoslijed').forEach((r) => { r.hidden = true; });
}
$('#trazi-uslugu').addEventListener('input', () => prikaziUsluge());

let uredjujeUslugu = null;
function otvoriUslugu(u = null) {
  uredjujeUslugu = u;
  const f = $('#forma-usluga');
  f.reset();
  f.querySelector('.poruka').hidden = true;
  $('#usluga-naslov').textContent = u ? 'Uredi uslugu' : 'Nova usluga';
  if (u) {
    f.naziv.value = u.naziv;
    if (u.dani) { f.trajanje_broj.value = u.dani; f.trajanje_jedinica.value = 'dan'; }
    else if (u.trajanje_min % 60 === 0) { f.trajanje_broj.value = u.trajanje_min / 60; f.trajanje_jedinica.value = 'h'; }
    else { f.trajanje_broj.value = u.trajanje_min; f.trajanje_jedinica.value = 'min'; }
    f.cijena.value = u.cijena ?? '';
    f.opis.value = u.opis || '';
    f.grupa.value = u.grupa || '';
    f.aktivna.checked = Boolean(u.aktivna);
  } else {
    f.trajanje_broj.value = '30';
    f.trajanje_jedinica.value = 'min';
  }
  pomocTrajanja();
  $('#dijalog-usluga').showModal();
}

$('#dugme-nova-usluga').addEventListener('click', () => otvoriUslugu());

obradiDijalog($('#forma-usluga'), async (f) => {
  const tijelo = {
    naziv: f.get('naziv'), ...procitajTrajanje(f), cijena: f.get('cijena'),
    opis: f.get('opis'), grupa: f.get('grupa'), aktivna: Boolean(f.get('aktivna')),
  };
  const r = uredjujeUslugu
    ? await api(`/api/panel/usluge/${uredjujeUslugu.id}`, { metoda: 'PUT', tijelo })
    : await api('/api/panel/usluge', { metoda: 'POST', tijelo });
  stanje.usluge = r.usluge;
  prikaziUsluge();
  obavijesti('Usluga je sačuvana.');
});

$('#lista-usluga').addEventListener('click', async (e) => {
  const uredi = e.target.closest('[data-uredi]');
  const obrisi = e.target.closest('[data-obrisi-uslugu]');
  const pomjeri = e.target.closest('[data-pomjeri]');
  try {
    if (uredi) otvoriUslugu(stanje.usluge.find((u) => u.id === Number(uredi.dataset.uredi)));
    if (obrisi && confirm('Obrisati ovu uslugu? Postojeći termini ostaju u kalendaru.')) {
      stanje.usluge = (await api(`/api/panel/usluge/${obrisi.dataset.obrisiUslugu}`, { metoda: 'DELETE' })).usluge;
      prikaziUsluge();
    }
    if (pomjeri) {
      const ids = stanje.usluge.map((u) => u.id);
      const i = ids.indexOf(Number(pomjeri.dataset.id));
      const j = i + Number(pomjeri.dataset.pomjeri);
      [ids[i], ids[j]] = [ids[j], ids[i]];
      stanje.usluge = (await api('/api/panel/usluge-redoslijed', { metoda: 'PUT', tijelo: { ids } })).usluge;
      prikaziUsluge();
    }
  } catch (g) {
    obavijesti(g.message, 'greska');
  }
});

// ===================== Radno vrijeme =====================
// Izbor vremena od 00:00 do 24:00 (svakih 15 min). Polje tipa "time" ne zna za 24:00.
function opcijeVremena(izabrano = '', { prazno = '' } = {}) {
  const vremena = [];
  for (let m = 0; m <= 1440; m += 15) vremena.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  if (izabrano && !vremena.includes(izabrano)) vremena.push(izabrano);
  vremena.sort();
  return (prazno ? `<option value="">${prazno}</option>` : '')
    + vremena.map((v) => `<option value="${v}"${v === izabrano ? ' selected' : ''}>${v}</option>`).join('');
}

function prikaziRadno() {
  $('#radni-dani').innerHTML = stanje.radno.map((d) => h`
    <div class="radni-dan ${d.radi ? '' : 'ne-radi'}" data-dan="${d.dan}">
      <label class="kvacica"><input type="checkbox" name="radi" ${d.radi ? 'checked' : ''}><span>${DANI[d.dan]}</span></label>
      <div class="vremena">
        <select name="od" aria-label="${DANI[d.dan]} od">${sirovo(opcijeVremena(d.od))}</select>
        <span>–</span>
        <select name="do" aria-label="${DANI[d.dan]} do">${sirovo(opcijeVremena(d.do))}</select>
        <span class="pauza">pauza
          <select name="pauza_od" aria-label="${DANI[d.dan]} pauza od">${sirovo(opcijeVremena(d.pauza_od, { prazno: 'bez' }))}</select>
          –
          <select name="pauza_do" aria-label="${DANI[d.dan]} pauza do">${sirovo(opcijeVremena(d.pauza_do, { prazno: 'bez' }))}</select>
        </span>
        <button type="button" class="dugme tekstualno malo" data-cijeli-dan>0–24 h</button>
      </div>
    </div>`).join('');
  $$('#radni-dani [data-cijeli-dan]').forEach((b) => b.addEventListener('click', () => {
    const red = b.closest('.radni-dan');
    red.querySelector('[name="od"]').value = '00:00';
    red.querySelector('[name="do"]').value = '24:00';
    red.querySelector('[name="pauza_od"]').value = '';
    red.querySelector('[name="pauza_do"]').value = '';
  }));
  $$('#radni-dani [name="radi"]').forEach((c) => c.addEventListener('change', () => {
    c.closest('.radni-dan').classList.toggle('ne-radi', !c.checked);
  }));
}

$('#forma-radno').addEventListener('submit', async (e) => {
  e.preventDefault();
  const dani = $$('#radni-dani .radni-dan').map((red) => ({
    dan: Number(red.dataset.dan),
    radi: red.querySelector('[name="radi"]').checked,
    od: red.querySelector('[name="od"]').value,
    do: red.querySelector('[name="do"]').value,
    pauza_od: red.querySelector('[name="pauza_od"]').value,
    pauza_do: red.querySelector('[name="pauza_do"]').value,
  }));
  try {
    await saDugmetom(e.submitter || $('#forma-radno button'), async () => {
      stanje.radno = (await api('/api/panel/radno-vrijeme', { metoda: 'PUT', tijelo: { dani } })).dani;
    });
    prikaziRadno();
    obavijesti('Radno vrijeme je sačuvano.');
    ucitajKalendar();
  } catch (g) {
    obavijesti(g.message, 'greska');
  }
});

async function ucitajNeradne() {
  const { dani } = await api('/api/panel/neradni-dani');
  $('#neradni-lista').innerHTML = dani.length
    ? dani.map((d) => h`<span>${citljivDatum(d, { kratko: true })} ${d.slice(0, 4)}.<button type="button" data-neradni="${d}" aria-label="Ukloni">×</button></span>`).join('')
    : '<p class="prigusen malo">Nema označenih neradnih dana.</p>';
}

$('#neradni-od').min = danas();
$('#neradni-do').min = danas();
$('#forma-neradni').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/panel/neradni-dani', { metoda: 'POST', tijelo: { od: $('#neradni-od').value, do: $('#neradni-do').value || undefined } });
    e.target.reset();
    ucitajNeradne();
    ucitajKalendar();
    obavijesti('Neradni dani su dodani.');
  } catch (g) {
    obavijesti(g.message, 'greska');
  }
});

$('#neradni-lista').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-neradni]');
  if (!b) return;
  await api(`/api/panel/neradni-dani/${b.dataset.neradni}`, { metoda: 'DELETE' }).catch((g) => obavijesti(g.message, 'greska'));
  ucitajNeradne();
  ucitajKalendar();
});

// Najava u minutama -> broj + najveća jedinica koja ide bez ostatka (minuta, sati, dana).
function postaviNajavu(f, ime, minute) {
  const jedinica = minute && minute % 1440 === 0 ? 1440 : minute && minute % 60 === 0 ? 60 : 1;
  f[`${ime}_broj`].value = minute / jedinica;
  f[`${ime}_jedinica`].value = String(jedinica);
}
function procitajNajavu(f, ime, maks, naziv) {
  const broj = Number(f[`${ime}_broj`].value);
  if (!Number.isFinite(broj) || broj < 0) throw new Error(`Upiši broj za "${naziv}".`);
  const minute = Math.round(broj * Number(f[`${ime}_jedinica`].value));
  if (minute > maks) throw new Error(`"${naziv}" može biti najviše ${maks / 1440} ${maks === 1440 ? 'dan' : 'dana'}.`);
  return minute;
}

function postaviIzbor(select, vrijednost) {
  if (![...select.options].some((o) => o.value === String(vrijednost))) {
    select.insertAdjacentHTML('beforeend', `<option value="${Number(vrijednost)}">${Number(vrijednost)}</option>`);
  }
  select.value = String(vrijednost);
}

function prikaziPravila() {
  const f = $('#forma-pravila');
  const b = stanje.biznis;
  f.querySelector(`[name="potvrda"][value="${b.potvrda_obavezna ? 1 : 0}"]`).checked = true;
  f.napomena_klijenta.checked = b.napomena_klijenta;
  postaviIzbor(f.korak_min, b.korak_min);
  postaviNajavu(f, 'najava', b.najava_min);
  postaviIzbor(f.dana_unaprijed, b.dana_unaprijed);
}

$('#forma-pravila').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await saDugmetom(f.querySelector('button[type="submit"]'), async () => {
      stanje.biznis = (await api('/api/panel/biznis', {
        metoda: 'PUT',
        tijelo: {
          potvrda_obavezna: f.potvrda.value === '1',
          napomena_klijenta: f.napomena_klijenta.checked,
          korak_min: Number(f.korak_min.value), najava_min: procitajNajavu(f, 'najava', 10080, 'Klijent može zakazati najkasnije'), dana_unaprijed: Number(f.dana_unaprijed.value),
        },
      })).biznis;
    });
    obavijesti('Postavke su sačuvane.');
  } catch (g) {
    obavijesti(g.message, 'greska');
  }
});

// ===================== Hitni termini =====================
async function ucitajHitno() {
  const { dani } = await api('/api/panel/hitno-vrijeme');
  const f = $('#forma-hitno');
  const b = stanje.biznis;
  f.hitni_aktivno.checked = b.hitni_aktivno;
  f.hitni_doplata.value = b.hitni_doplata;
  f.querySelector(`[name="hitni_potvrda"][value="${b.hitni_potvrda ? 1 : 0}"]`).checked = true;
  postaviNajavu(f, 'hitni_najava', b.hitni_najava_min);
  $('#hitni-dani').innerHTML = dani.map((d) => h`
    <div class="radni-dan ${d.radi ? '' : 'ne-radi'}" data-dan="${d.dan}">
      <label class="kvacica"><input type="checkbox" name="radi" ${d.radi ? 'checked' : ''}><span>${DANI[d.dan]}</span></label>
      <div class="vremena">
        <select name="od" aria-label="${DANI[d.dan]} hitni od">${sirovo(opcijeVremena(d.od))}</select>
        <span>–</span>
        <select name="do" aria-label="${DANI[d.dan]} hitni do">${sirovo(opcijeVremena(d.do))}</select>
        <button type="button" class="dugme tekstualno malo" data-cijeli-dan>0–24 h</button>
      </div>
    </div>`).join('');
  $$('#hitni-dani [data-cijeli-dan]').forEach((d) => d.addEventListener('click', () => {
    const red = d.closest('.radni-dan');
    red.querySelector('[name="od"]').value = '00:00';
    red.querySelector('[name="do"]').value = '24:00';
  }));
  $$('#hitni-dani [name="radi"]').forEach((c) => c.addEventListener('change', () => {
    c.closest('.radni-dan').classList.toggle('ne-radi', !c.checked);
  }));
  osvjeziHitno();
}

function osvjeziHitno() {
  const f = $('#forma-hitno');
  $('#hitno-detalji').classList.toggle('ugaseno', !f.hitni_aktivno.checked);
  const posto = Math.max(0, Number(f.hitni_doplata.value) || 0);
  $('#hitno-primjer').textContent = `Primjer: usluga od 50 KM kao hitna košta ${cijena(Math.round(50 * (1 + posto / 100) * 100) / 100)}.`;
}
$('#forma-hitno').addEventListener('input', osvjeziHitno);
$('#forma-hitno').addEventListener('change', osvjeziHitno);

$('#forma-hitno').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const dani = $$('#hitni-dani .radni-dan').map((red) => ({
    dan: Number(red.dataset.dan),
    radi: red.querySelector('[name="radi"]').checked,
    od: red.querySelector('[name="od"]').value,
    do: red.querySelector('[name="do"]').value,
  }));
  try {
    if (f.hitni_aktivno.checked && !dani.some((d) => d.radi)) throw new Error('Označi bar jedan dan kada primaš hitne termine.');
    await saDugmetom(f.querySelector('button[type="submit"]'), async () => {
      await api('/api/panel/hitno-vrijeme', { metoda: 'PUT', tijelo: { dani } });
      stanje.biznis = (await api('/api/panel/biznis', {
        metoda: 'PUT',
        tijelo: { hitni_aktivno: f.hitni_aktivno.checked, hitni_doplata: Number(f.hitni_doplata.value) || 0, hitni_najava_min: procitajNajavu(f, 'hitni_najava', 1440, 'Hitan termin najkasnije prije'), hitni_potvrda: f.hitni_potvrda.value === '1' },
      })).biznis;
    });
    obavijesti('Hitni termini su sačuvani.');
  } catch (g) {
    obavijesti(g.message, 'greska');
  }
});

// ===================== Smještaj =====================
function prikaziSmjestaj() {
  if (!stanje.biznis.smjestaj) return;
  const f = $('#forma-smjestaj');
  const b = stanje.biznis;
  f.smj_cijena.value = b.smj_cijena ?? '';
  f.smj_cijena_vikend.value = b.smj_cijena_vikend ?? '';
  f.smj_min_noci.value = b.smj_min_noci;
  f.smj_max_gostiju.value = b.smj_max_gostiju;
  f.smj_dolazak.value = b.smj_dolazak;
  f.smj_odlazak.value = b.smj_odlazak;
}

$('#forma-smjestaj').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    if (!String(f.smj_cijena.value).trim()) throw new Error('Upiši cijenu po noći.');
    await saDugmetom(f.querySelector('button[type="submit"]'), async () => {
      stanje.biznis = (await api('/api/panel/biznis', {
        metoda: 'PUT',
        tijelo: {
          smj_cijena: f.smj_cijena.value, smj_cijena_vikend: f.smj_cijena_vikend.value,
          smj_min_noci: Number(f.smj_min_noci.value), smj_max_gostiju: Number(f.smj_max_gostiju.value),
          smj_dolazak: f.smj_dolazak.value, smj_odlazak: f.smj_odlazak.value,
        },
      })).biznis;
    });
    obavijesti('Smještaj je sačuvan.');
  } catch (g) {
    obavijesti(g.message, 'greska');
  }
});

// ===================== Vlasnik računa =====================
function prikaziVlasnika() {
  const f = $('#forma-vlasnik');
  f.vlasnik_ime.value = stanje.biznis.vlasnik_ime || '';
  f.vlasnik_prezime.value = stanje.biznis.vlasnik_prezime || '';
}

$('#forma-vlasnik').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    stanje.biznis = (await api('/api/panel/biznis', { metoda: 'PUT', tijelo: { vlasnik_ime: f.vlasnik_ime.value, vlasnik_prezime: f.vlasnik_prezime.value } })).biznis;
    obavijesti('Sačuvano.');
  } catch (g) {
    obavijesti(g.message, 'greska');
  }
});

// ===================== Profil i izgled =====================
function prikaziIzgled() {
  const b = stanje.biznis;
  $('#javni-link').textContent = b.javniLink;
  $('#otvori-link').href = b.javniLink;
  $('#slug-prefiks').textContent = `${b.javniLink.replace(/^https?:\/\//, '').replace(/[^/]+$/, '')}`;
  prikaziLogo();
  prikaziTeme();
  prikaziPozadinu();
  const f = $('#forma-profil');
  $('#f-kategorija').innerHTML = stanje.kategorije.map(([id, naziv]) => h`<option value="${id}">${naziv}</option>`).join('');
  for (const polje of ['naziv', 'kategorija', 'kategorija_tekst', 'opis', 'adresa', 'grad', 'telefon', 'instagram', 'slug']) f[polje].value = b[polje] || '';
  $('#polje-f-djelatnost').hidden = f.kategorija.value !== 'ostalo';
}

$('#kopiraj-link').addEventListener('click', () => kopiraj(stanje.biznis.javniLink));
$('#f-kategorija').addEventListener('change', (e) => { $('#polje-f-djelatnost').hidden = e.target.value !== 'ostalo'; });

function prikaziTeme() {
  $('#izbor-tema').innerHTML = stanje.teme.map((t) => h`
    <button type="button" class="tema-opcija" data-tema-id="${t.id}" aria-pressed="${t.id === stanje.biznis.tema}">
      <span class="tema-uzorak" style="background:${t.pozadina}">
        <i style="background:${t.akcent}"></i><i style="background:${t.povrsina}"></i><i style="background:${t.akcent};opacity:.35"></i>
      </span>
      <span>${t.naziv}</span>
    </button>`).join('');
}

$('#izbor-tema').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-tema-id]');
  if (!b) return;
  const prethodna = stanje.biznis.tema;
  const nova = b.dataset.temaId;
  postaviTemu(nova);
  $$('#izbor-tema .tema-opcija').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  try {
    stanje.biznis = (await api('/api/panel/biznis', { metoda: 'PUT', tijelo: { tema: nova } })).biznis;
    obavijesti('Tema je sačuvana.');
  } catch (g) {
    postaviTemu(prethodna);
    prikaziTeme();
    obavijesti(g.message, 'greska');
  }
});

function prikaziLogo() {
  const b = stanje.biznis;
  $('#logo-pregled').innerHTML = b.logoUrl ? h`<img src="${b.logoUrl}" alt="Logo">` : esc(inicijali(b.naziv));
  $('#logo-ukloni').hidden = !b.logoUrl;
}

// Smanji sliku u pregledniku na kvadrat 512x512 (izreže sredinu).
function pripremiSliku(fajl) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(fajl.type)) return reject(new Error('Izaberi PNG, JPG ili WEBP sliku.'));
    if (fajl.size > 15 * 1024 * 1024) return reject(new Error('Slika je prevelika (najviše 15 MB).'));
    const img = new Image();
    const url = URL.createObjectURL(fajl);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const strana = Math.min(img.naturalWidth, img.naturalHeight);
      const velicina = Math.min(512, strana);
      const c = document.createElement('canvas');
      c.width = velicina;
      c.height = velicina;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (img.naturalWidth - strana) / 2, (img.naturalHeight - strana) / 2, strana, strana, 0, 0, velicina, velicina);
      let podaci = c.toDataURL('image/webp', 0.88);
      if (!podaci.startsWith('data:image/webp')) podaci = c.toDataURL('image/png');
      if (podaci.length > 900000) podaci = c.toDataURL('image/jpeg', 0.85);
      resolve(podaci);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Slika se ne može otvoriti.')); };
    img.src = url;
  });
}

$('#logo-fajl').addEventListener('change', async (e) => {
  const fajl = e.target.files[0];
  e.target.value = '';
  if (!fajl) return;
  try {
    const slika = await pripremiSliku(fajl);
    stanje.biznis = (await api('/api/panel/logo', { metoda: 'PUT', tijelo: { slika } })).biznis;
    prikaziLogo();
    osvjeziZaglavlje();
    obavijesti('Logo je sačuvan.');
  } catch (g) {
    obavijesti(g.message, 'greska');
  }
});

$('#logo-ukloni').addEventListener('click', async () => {
  if (!confirm('Ukloniti logo?')) return;
  stanje.biznis = (await api('/api/panel/logo', { metoda: 'DELETE' })).biznis;
  prikaziLogo();
  osvjeziZaglavlje();
});

$('#forma-profil').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const stariSlug = stanje.biznis.slug;
  try {
    await saDugmetom(e.target.querySelector('button[type="submit"]'), async () => {
      stanje.biznis = (await api('/api/panel/biznis', { metoda: 'PUT', tijelo: Object.fromEntries(f) })).biznis;
    });
    osvjeziZaglavlje();
    prikaziIzgled();
    prilagodiZaSmjestaj();
    obavijesti(stariSlug !== stanje.biznis.slug ? 'Sačuvano. Link je promijenjen, ažuriraj ga na Instagramu.' : 'Podaci su sačuvani.');
  } catch (g) {
    obavijesti(g.message, 'greska');
  }
});

// ===================== Pozadinska slika =====================
function prikaziPozadinu() {
  const url = stanje.biznis.pozadinaUrl;
  const pregled = $('#pozadina-pregled');
  pregled.style.backgroundImage = url ? `url("${url}")` : '';
  pregled.classList.toggle('ima-sliku', Boolean(url));
  $('#pozadina-ukloni').hidden = !url;
}

// Smanji sliku na najviše 1600 px po dužoj strani (bez rezanja).
function pripremiPozadinu(fajl) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(fajl.type)) return reject(new Error('Izaberi PNG, JPG ili WEBP sliku.'));
    if (fajl.size > 25 * 1024 * 1024) return reject(new Error('Slika je prevelika (najviše 25 MB).'));
    const img = new Image();
    const url = URL.createObjectURL(fajl);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const omjer = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * omjer);
      c.height = Math.round(img.naturalHeight * omjer);
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, c.width, c.height);
      for (const kvalitet of [0.82, 0.7, 0.55]) {
        let podaci = c.toDataURL('image/webp', kvalitet);
        if (!podaci.startsWith('data:image/webp')) podaci = c.toDataURL('image/jpeg', kvalitet);
        // 1500 KB slike je oko 2 MB kao base64 tekst
        if (podaci.length < 1450 * 1024 * 1.37) return resolve(podaci);
      }
      reject(new Error('Slika je prevelika i nakon smanjivanja. Probaj drugu.'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Slika se ne može otvoriti.')); };
    img.src = url;
  });
}

$('#pozadina-fajl').addEventListener('change', async (e) => {
  const fajl = e.target.files[0];
  e.target.value = '';
  if (!fajl) return;
  try {
    obavijesti('Učitavam sliku…');
    const slika = await pripremiPozadinu(fajl);
    stanje.biznis = (await api('/api/panel/pozadina', { metoda: 'PUT', tijelo: { slika } })).biznis;
    prikaziPozadinu();
    osvjeziZaglavlje();
    obavijesti('Pozadina je sačuvana.');
  } catch (g) {
    obavijesti(g.message, 'greska');
  }
});

$('#pozadina-ukloni').addEventListener('click', async () => {
  if (!confirm('Ukloniti sliku i vratiti pozadinu teme?')) return;
  stanje.biznis = (await api('/api/panel/pozadina', { metoda: 'DELETE' })).biznis;
  prikaziPozadinu();
  osvjeziZaglavlje();
});

// ===================== Račun =====================
$('#forma-lozinka').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await saDugmetom(e.target.querySelector('button[type="submit"]'), async () => {
      if (String(f.get('nova')).length < 8) throw new Error('Nova lozinka mora imati bar 8 znakova.');
      let staro;
      try { staro = await otkljucajLozinkom(f.get('stara')); } catch { throw new Error('Trenutna lozinka nije tačna.'); }
      const sol = novaSol();
      const { kljucOmota, auth } = await izLozinke(f.get('nova'), sol);
      await api('/api/auth/promjena-lozinke', {
        metoda: 'POST',
        tijelo: { stari_auth: staro.auth, sol, auth, kljuc_lozinkom: await zakljucajPrivatni(kljucOmota, staro.pkcs8) },
      });
    });
    e.target.reset();
    obavijesti('Lozinka je promijenjena.');
  } catch (g) {
    obavijesti(g.message, 'greska');
  }
});

$('#dugme-obrisi-racun').addEventListener('click', () => {
  $('#forma-brisanje').reset();
  $('#dijalog-brisanje').showModal();
});

obradiDijalog($('#forma-brisanje'), async (f) => {
  const { sol } = await api('/api/auth/kljuc');
  const { auth } = await izLozinke(f.get('lozinka'), sol);
  await api('/api/auth/obrisi-racun', { metoda: 'POST', tijelo: { auth } });
  await obrisiKljuceve();
  location.href = '/';
});

// Novi kod oporavka
$('#dugme-novi-kod').addEventListener('click', () => {
  $('#forma-lozinka-kod').reset();
  $('#dijalog-lozinka-kod').showModal();
});

obradiDijalog($('#forma-lozinka-kod'), async (f) => {
  const { pkcs8, auth } = await otkljucajLozinkom(f.get('lozinka'));
  const kod = noviKod();
  await api('/api/auth/kod-oporavka', { metoda: 'POST', tijelo: { auth, kljuc_kodom: await zakljucajKodom(kod, pkcs8) } });
  $('#novi-kod-tekst').textContent = kod;
  $('#novi-kod-email').href = mailtoKod(stanje.biznis.email, kod);
  $('#novi-kod-kopiraj').onclick = async () => {
    try { await kopirajKod(kod); obavijesti('Kod je kopiran.'); } catch { obavijesti('Kopiranje nije uspjelo. Zapiši kod.', 'greska'); }
  };
  $('#novi-kod-preuzmi').onclick = () => preuzmiKod(kod);
  setTimeout(() => $('#dijalog-kod').showModal(), 0);
});

pokreni();
