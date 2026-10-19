// Javni profil: klijent bira uslugu, dan i termin, pa upisuje ime i telefon.
import {
  api, $, h, esc, sirovo, postaviTemu, cijena, trajanje, citljivDatum, danUSedmici, DANI, DANI_KRATKO,
  inicijali, saDugmetom, obavijesti, danas, postaviPozadinu, MJESECI, dodajDane,
} from './zajednicko.js';
import { sifrujZaBiznis } from './kripto.js';

const slug = decodeURIComponent(location.pathname.slice(1)).toLowerCase();
const stanje = { profil: null, usluga: null, izabrane: [], hitno: false, datum: null, odMin: null, dani: [], rezervacija: null };

const IKONE = {
  telefon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  mapa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="9.5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17.2" cy="6.8" r="1.1" fill="currentColor"/></svg>',
  kvacica: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sat: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

async function ucitaj() {
  try {
    stanje.profil = await api(`/api/profil/${encodeURIComponent(slug)}`);
  } catch {
    $('#ucitavanje').hidden = true;
    $('#nema-profila').hidden = false;
    return;
  }
  const p = stanje.profil;
  postaviTemu(p.tema);
  postaviPozadinu(p.pozadinaUrl);
  document.title = `${p.naziv} – zakaži termin`;

  // Zaglavlje
  $('#p-avatar').innerHTML = p.logoUrl ? h`<img src="${p.logoUrl}" alt="${p.naziv}">` : esc(inicijali(p.naziv));
  $('#p-naziv').textContent = p.naziv;
  $('#p-kat').textContent = [p.kategorija, p.grad].filter(Boolean).join(' · ');
  if (p.opis) { $('#p-opis').textContent = p.opis; $('#p-opis').hidden = false; }
  const kontakti = [];
  if (p.telefon) kontakti.push(h`<a href="tel:${p.telefon.replace(/[^\d+]/g, '')}">${IKONE_HTML('telefon')}${p.telefon}</a>`);
  if (p.adresa) kontakti.push(h`<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.adresa, p.grad].filter(Boolean).join(', '))}" target="_blank" rel="noopener">${IKONE_HTML('mapa')}${p.adresa}</a>`);
  if (p.instagram) kontakti.push(h`<a href="https://instagram.com/${p.instagram}" target="_blank" rel="noopener">${IKONE_HTML('instagram')}@${p.instagram}</a>`);
  $('#p-kontakti').innerHTML = kontakti.join('');

  // Radno vrijeme
  const radno = new Map(p.radnoVrijeme.map((r) => [r.dan, r]));
  const danasDan = danUSedmici(danas());
  $('#p-radno').innerHTML = [1, 2, 3, 4, 5, 6, 7].map((d) => {
    const r = radno.get(d);
    const cijeliDan = r && r.od === '00:00' && r.do === '24:00';
    const vrijeme = !r ? 'Ne radi' : cijeliDan && !r.pauza ? 'Cijeli dan (0–24 h)' : `${r.od}–${r.do}${r.pauza ? ` (pauza ${r.pauza})` : ''}`;
    const klasa = d === danasDan ? 'danas' : '';
    return h`<dt class="${klasa}">${DANI[d]}</dt><dd class="${klasa}">${vrijeme}</dd>`;
  }).join('');

  $('#saglasnost-tekst').textContent = `Pristajem da ${p.naziv} koristi moje ime i broj telefona samo radi ${p.smjestaj ? 'ove rezervacije' : 'ovog termina'}.`;
  $('#saglasnost-tekst').insertAdjacentHTML('beforeend', ' <a href="/privatnost" target="_blank">Privatnost</a>');

  // Vlasnik gleda svoj profil očima klijenta / posjetilac gleda primjer profila.
  if (p.jeVlasnik) {
    $('#pregled-traka').innerHTML = '<span>👁 Ovo je tvoj profil, onako kako ga vide klijenti.</span><a class="dugme malo" href="/panel">Nazad u panel</a>';
    $('#pregled-traka').hidden = false;
  } else if (p.demo) {
    $('#pregled-traka').innerHTML = '<span>Ovo je primjer Konekt profila. Slobodno isprobaj zakazivanje, ništa se neće stvarno zakazati.</span><a class="dugme malo" href="/">Saznaj više</a>';
    $('#pregled-traka').hidden = false;
  }

  if (p.napomena_klijenta) {
    $('#polje-napomena').hidden = false;
    if (p.smjestaj) $('#napomena').placeholder = 'npr. Dolazimo oko 18 h, trebamo krevetac za bebu…';
    $('#napomena-pomoc').textContent = `Napomenu vidi samo ${p.naziv}.`;
  }
  if (p.hitni && p.hitni.dani.length) {
    $('#hitno-izbor').hidden = false;
    $('#hitno-doplata').textContent = p.hitni.doplata ? `(+${p.hitni.doplata} %)` : '';
    const opis = p.hitni.dani.map((d) => `${DANI_KRATKO[d.dan]} ${d.od === '00:00' && d.do === '24:00' ? '0–24 h' : `${d.od}–${d.do}`}`).join(', ');
    $('#hitno-opis').textContent = `Kad ti treba što prije. Hitni termini: ${opis}.${p.hitni.potvrda ? ' Salon potvrđuje hitan termin.' : ''}`;
  }

  $('#ucitavanje').hidden = true;
  $('#profil').hidden = false;

  if (!p.zakazivanjeAktivno) {
    prikaziNedostupno(`Online zakazivanje trenutno nije dostupno.${p.telefon ? ` Za termin se javi na ${p.telefon}.` : ''}`);
    return;
  }
  if (p.smjestaj) {
    pokreniSmjestaj();
    return;
  }
  if (!p.usluge.length) {
    prikaziNedostupno('Usluge još nisu dodane. Uskoro ćeš ovdje moći zakazati termin.');
    return;
  }
  prikaziUsluge();
}

const IKONE_HTML = (ime) => sirovo(IKONE[ime]);

function prikaziNedostupno(tekst) {
  $('#nedostupno').textContent = tekst;
  $('#nedostupno').hidden = false;
  $('#zakazivanje').hidden = true;
}

// ---------- 1. Usluge (može ih biti više) ----------
const normalizuj = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'dj');

const dugmeUsluge = (u) => h`
    <button type="button" class="usluga" role="checkbox" aria-checked="${stanje.izabrane.includes(u.id)}" data-id="${u.id}"
      data-trazi="${normalizuj(`${u.naziv} ${u.grupa} ${u.opis}`)}">
      <span class="usluga-kvacica" aria-hidden="true"></span>
      <span class="usluga-naziv">${u.naziv}</span>
      <span class="usluga-cijena">${cijena(u.cijena)}</span>
      <span class="usluga-info">${trajanjeUsluge(u)}${u.opis ? ` · ${u.opis}` : ''}</span>
    </button>`;

// Kad usluga ima mnogo (npr. ordinacija s 50 usluga): grupe koje se otvaraju i tražilica.
function prikaziUsluge() {
  const kutija = $('#usluge');
  const usluge = stanje.profil.usluge;
  $('#trazi-usluge').hidden = usluge.length <= 6;
  const grupe = new Map();
  for (const u of usluge) {
    const g = u.grupa || '';
    if (!grupe.has(g)) grupe.set(g, []);
    grupe.get(g).push(u);
  }
  const imaGrupe = [...grupe.keys()].some(Boolean);
  if (!imaGrupe) {
    kutija.innerHTML = usluge.map(dugmeUsluge).join('');
  } else {
    const otvoreno = usluge.length <= 12;
    let prva = true;
    kutija.innerHTML = [...grupe.entries()].map(([g, lista]) => {
      const html = h`<details class="grupa-usluga" ${otvoreno || prva ? 'open' : ''}>
        <summary><span>${g || 'Ostalo'}</span><small>${lista.length}</small></summary>
        <div class="usluge">${lista.map(dugmeUsluge)}</div>
      </details>`;
      prva = false;
      return html;
    }).join('');
  }
  kutija.querySelectorAll('.usluga').forEach((b) => b.addEventListener('click', () => promijeniUslugu(Number(b.dataset.id))));
  if (stanje.profil.usluge.length === 1) promijeniUslugu(stanje.profil.usluge[0].id, { bezSkrola: true });
}

const trajanjeUsluge = (u) => (u.dani ? `${u.dani} ${u.dani === 1 ? 'radni dan' : 'radna dana'}` : trajanje(u.trajanje_min));

// Uključi/isključi uslugu i izračunaj zbir (trajanje i cijena).
// Usluga od više dana (npr. popravak auta) zakazuje se sama, bez drugih usluga.
let tajmerUsluga = null;
function promijeniUslugu(id, { bezSkrola = false } = {}) {
  const i = stanje.izabrane.indexOf(id);
  const kliknuta = stanje.profil.usluge.find((u) => u.id === id);
  if (i >= 0) stanje.izabrane.splice(i, 1);
  else if (kliknuta?.dani) stanje.izabrane = [id];
  else stanje.izabrane = stanje.izabrane.filter((x) => !stanje.profil.usluge.find((u) => u.id === x)?.dani).concat(id);
  const lista = stanje.profil.usluge.filter((u) => stanje.izabrane.includes(u.id));
  document.querySelectorAll('.usluga').forEach((b) => b.setAttribute('aria-checked', String(stanje.izabrane.includes(Number(b.dataset.id)))));
  stanje.datum = null;
  stanje.odMin = null;
  $('#korak-podaci').hidden = true;
  if (!lista.length) {
    stanje.usluga = null;
    $('#izbor-zbir').hidden = true;
    $('#korak-termin').hidden = true;
    return;
  }
  const saCijenom = lista.filter((u) => u.cijena != null);
  stanje.usluga = {
    ids: lista.map((u) => u.id),
    naziv: lista.map((u) => u.naziv).join(' + '),
    trajanje_min: lista.reduce((z, u) => z + u.trajanje_min, 0),
    cijena: saCijenom.length ? saCijenom.reduce((z, u) => z + Number(u.cijena), 0) : null,
    broj: lista.length,
    dani: lista.length === 1 ? lista[0].dani || 0 : 0,
  };
  // Hitan termin ne važi za usluge od više dana.
  if (stanje.profil.hitni && stanje.profil.hitni.dani.length) {
    $('#hitno-izbor').hidden = Boolean(stanje.usluga.dani);
    if (stanje.usluga.dani) { stanje.hitno = false; $('#hitno').checked = false; }
  }
  $('#izbor-zbir').hidden = false;
  osvjeziZbir();
  clearTimeout(tajmerUsluga);
  tajmerUsluga = setTimeout(() => ucitajDane({ bezSkrola: bezSkrola || stanje.izabrane.length > 1 }), 350);
}

$('#trazi-usluge').addEventListener('input', (e) => {
  const upit = normalizuj(e.target.value.trim());
  let ima = 0;
  document.querySelectorAll('#usluge .usluga').forEach((b) => {
    const vidi = !upit || b.dataset.trazi.includes(upit);
    b.hidden = !vidi;
    if (vidi) ima += 1;
  });
  document.querySelectorAll('#usluge .grupa-usluga').forEach((g) => {
    const vidljivih = g.querySelectorAll('.usluga:not([hidden])').length;
    g.hidden = vidljivih === 0;
    if (upit && vidljivih) g.open = true;
  });
  $('#nema-usluga').hidden = ima > 0;
});

// Cijena s doplatom za hitan termin.
function konacnaCijena() {
  const osnovna = stanje.usluga?.cijena;
  if (osnovna == null) return null;
  const doplata = stanje.hitno && stanje.profil.hitni ? stanje.profil.hitni.doplata : 0;
  return Math.round(osnovna * (1 + doplata / 100) * 100) / 100;
}

function osvjeziZbir() {
  if (!stanje.usluga) return;
  const broj = stanje.usluga.broj;
  $('#izbor-zbir').innerHTML = String(h`<span>${broj === 1 ? '1 usluga' : `${broj} usluge`} · ${trajanjeUsluge(stanje.usluga)}${stanje.hitno ? ' · hitno' : ''}</span>
    <b>${cijena(konacnaCijena())}</b><button type="button" class="dugme malo" id="zbir-dalje">Dalje ↓</button>`);
  $('#zbir-dalje').addEventListener('click', () => $('#korak-termin').scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

$('#hitno').addEventListener('change', (e) => {
  stanje.hitno = e.target.checked;
  osvjeziZbir();
  ucitajDane({ bezSkrola: true });
});

async function ucitajDane({ bezSkrola = false } = {}) {
  if (!stanje.usluga) return;
  const ids = stanje.usluga.ids.join(',');
  $('#korak-podaci').hidden = true;
  $('#korak-termin').hidden = false;
  $('#dani').innerHTML = '<div class="skelet" style="width:100%;height:70px"></div>';
  $('#termini').innerHTML = '';
  $('#izabrani-dan').textContent = '';
  if (!bezSkrola) $('#korak-termin').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const { dani } = await api(`/api/profil/${encodeURIComponent(slug)}/dani?usluge=${ids}${stanje.hitno ? '&hitno=1' : ''}`);
    if (ids !== stanje.usluga?.ids.join(',')) return; // u međuvremenu promijenjen izbor
    stanje.datum = null;
    stanje.dani = dani;
    prikaziDane();
  } catch (g) {
    $('#dani').innerHTML = h`<p class="prigusen">${g.message}</p>`;
  }
}

// ---------- 2. Dan i termin ----------
function prikaziDane() {
  const kutija = $('#dani');
  if (!stanje.dani.some((d) => d.slobodno)) {
    kutija.innerHTML = '';
    $('#izabrani-dan').textContent = stanje.hitno ? 'Trenutno nema slobodnih hitnih termina. Isključi „Hitan termin“ za redovne termine.' : 'Nažalost, trenutno nema slobodnih termina za izabrane usluge. Probaj s manje usluga.';
    return;
  }
  kutija.innerHTML = stanje.dani.map((d) => {
    const [, m, dan] = d.datum.split('-').map(Number);
    return h`<button type="button" class="dan" role="radio" aria-checked="false" data-datum="${d.datum}" ${d.slobodno ? '' : 'disabled'}
      aria-label="${citljivDatum(d.datum)}${d.slobodno ? '' : ', nema slobodnih termina'}">
      <small>${DANI_KRATKO[danUSedmici(d.datum)]}</small><b>${dan}</b><span>${m}.</span></button>`;
  }).join('');
  kutija.querySelectorAll('.dan').forEach((b) => b.addEventListener('click', () => izaberiDan(b.dataset.datum)));
  const prvi = stanje.dani.find((d) => d.slobodno);
  izaberiDan(prvi.datum);
}

async function izaberiDan(datum) {
  stanje.datum = datum;
  stanje.odMin = null;
  $('#korak-podaci').hidden = true;
  document.querySelectorAll('.dan').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.datum === datum)));
  document.querySelector(`.dan[data-datum="${datum}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  $('#izabrani-dan').textContent = citljivDatum(datum);
  $('#termini').innerHTML = '<div class="skelet"></div><div class="skelet"></div><div class="skelet"></div>';
  try {
    const { termini } = await api(`/api/profil/${encodeURIComponent(slug)}/slobodno?usluge=${stanje.usluga.ids.join(',')}&datum=${datum}${stanje.hitno ? '&hitno=1' : ''}`);
    if (stanje.datum !== datum) return;
    if (!termini.length) {
      $('#termini').innerHTML = '<p class="prigusen">Za ovaj dan više nema slobodnih termina.</p>';
      return;
    }
    if (termini[0].visednevno) {
      // Usluga od više dana: jedan izbor, predaja na početku radnog vremena.
      const t = termini[0];
      $('#termini').innerHTML = String(h`<button type="button" class="termin termin-visednevni" role="radio" aria-checked="false" data-od="${t.od_min}">
        <b>Predaja u ${t.od}</b><small>završetak: ${citljivDatum(t.do_datum)}</small></button>`);
      $('#termini .termin').addEventListener('click', () => izaberiTermin(t.od_min, t.od, t));
      return;
    }
    $('#termini').innerHTML = termini.map((t) => h`<button type="button" class="termin" role="radio" aria-checked="false" data-od="${t.od_min}">${t.od}</button>`).join('');
    $('#termini').querySelectorAll('.termin').forEach((b) => b.addEventListener('click', () => izaberiTermin(Number(b.dataset.od), b.textContent)));
  } catch (g) {
    $('#termini').innerHTML = h`<p class="prigusen">${g.message}</p>`;
  }
}

function izaberiTermin(odMin, odTekst, visednevni = null) {
  stanje.odMin = odMin;
  document.querySelectorAll('.termin').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.od) === odMin)));
  const u = stanje.usluga;
  $('#sazetak').innerHTML = h`
    <div><span>${u.broj > 1 ? 'Usluge' : 'Usluga'}</span><b>${u.naziv}</b></div>
    ${visednevni
    ? h`<div><span>Predaja</span><b>${citljivDatum(stanje.datum)} u ${odTekst}</b></div>
         <div><span>Završetak</span><b>${citljivDatum(visednevni.do_datum)}, do ${visednevni.do}</b></div>`
    : h`<div><span>Termin</span><b>${citljivDatum(stanje.datum)} u ${odTekst}</b></div>`}
    <div><span>Trajanje</span><b>${trajanjeUsluge(u)}</b></div>
    ${stanje.hitno ? h`<div><span>Hitan termin</span><b>+${stanje.profil.hitni.doplata} %</b></div>` : ''}
    ${u.cijena != null ? h`<div><span>Cijena</span><b>${cijena(konacnaCijena())}</b></div>` : ''}
    <div class="sazetak-napomena">Plaćanje na licu mjesta.</div>`;
  $('#korak-podaci').hidden = false;
  $('#korak-podaci').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#dani-lijevo').addEventListener('click', () => { $('#dani').scrollLeft -= 280; });
$('#dani-desno').addEventListener('click', () => { $('#dani').scrollLeft += 280; });

// ---------- Smještaj: kalendar dolaska i odlaska ----------
const gostiTekst = (n) => `${n} ${n === 1 ? 'gost' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'gosta' : 'gostiju'}`;
const boravak = { zauzeto: new Set(), prvi: null, zadnji: null, mjesec: null, dolazak: null, odlazak: null };

function nociIzmedju(od, doD) {
  const noci = [];
  for (let d = od; d < doD; d = dodajDane(d, 1)) noci.push(d);
  return noci;
}

function cijenaNoci(noci) {
  const s = stanje.profil.smjestaj;
  if (s.cijena == null) return null;
  return Math.round(noci.reduce((z, d) => {
    const vikend = [5, 6].includes(danUSedmici(d)) && s.cijena_vikend != null;
    return z + Number(vikend ? s.cijena_vikend : s.cijena);
  }, 0) * 100) / 100;
}

async function pokreniSmjestaj() {
  const s = stanje.profil.smjestaj;
  $('#korak-usluga').hidden = true;
  $('#korak-boravak').hidden = false;
  document.querySelector('#korak-podaci .korak-broj').textContent = '2';
  $('#boravak-info').textContent = [
    `${cijena(s.cijena)} po noći${s.cijena_vikend != null ? `, petak i subota ${cijena(s.cijena_vikend)}` : ''}`,
    s.min_noci > 1 ? `najmanje ${s.min_noci} noćenja` : '',
    `dolazak od ${s.dolazak}, odlazak do ${s.odlazak}`,
  ].filter(Boolean).join(' · ');
  $('#gosti').innerHTML = Array.from({ length: s.max_gostiju }, (_, i) => `<option value="${i + 1}">${i + 1} ${i === 0 ? 'gost' : i < 4 ? 'gosta' : 'gostiju'}</option>`).join('');
  $('#gosti').value = String(Math.min(2, s.max_gostiju));
  $('#gosti').addEventListener('change', osvjeziBoravak);
  try {
    const n = await api(`/api/profil/${encodeURIComponent(slug)}/nocenja`);
    boravak.zauzeto = new Set(n.zauzeto);
    boravak.prvi = n.prvi;
    boravak.zadnji = n.zadnji;
    boravak.mjesec = n.prvi.slice(0, 7);
    crtajKalendar();
  } catch (g) {
    $('#kal-poruka').textContent = g.message;
  }
}

function crtajKalendar() {
  const [g, m] = boravak.mjesec.split('-').map(Number);
  $('#kal-mjesec').textContent = `${MJESECI[m - 1][0].toUpperCase()}${MJESECI[m - 1].slice(1)} ${g}.`;
  const prvi = `${boravak.mjesec}-01`;
  const pomak = danUSedmici(prvi) - 1;
  const brojDana = new Date(Date.UTC(g, m, 0)).getUTCDate();
  const zadnjiOdlazak = dodajDane(boravak.zadnji, stanje.profil.smjestaj.maks_noci);
  const celije = Array.from({ length: pomak }, () => '<span class="kal-prazno"></span>');
  for (let i = 1; i <= brojDana; i++) {
    const d = `${boravak.mjesec}-${String(i).padStart(2, '0')}`;
    const klase = ['kal-dan'];
    const van = d < boravak.prvi || d > zadnjiOdlazak;
    if (van) klase.push('van');
    if (boravak.zauzeto.has(d)) klase.push('zauzeto');
    if (d === boravak.dolazak) klase.push('pocetak');
    if (d === boravak.odlazak) klase.push('kraj');
    if (boravak.dolazak && boravak.odlazak && d > boravak.dolazak && d < boravak.odlazak) klase.push('u-rasponu');
    celije.push(`<button type="button" class="${klase.join(' ')}" data-datum="${d}" ${van ? 'disabled' : ''} aria-label="${citljivDatum(d)}${boravak.zauzeto.has(d) ? ', zauzeto' : ''}">${i}</button>`);
  }
  $('#kal-mreza').innerHTML = celije.join('');
  $('#kal-mreza').querySelectorAll('.kal-dan:not(.van)').forEach((b) => b.addEventListener('click', () => kliknutDan(b.dataset.datum)));
  $('#kal-nazad').disabled = boravak.mjesec <= boravak.prvi.slice(0, 7);
  $('#kal-naprijed').disabled = boravak.mjesec >= boravak.zadnji.slice(0, 7);
}

function pomjeriMjesec(n) {
  const [g, m] = boravak.mjesec.split('-').map(Number);
  const d = new Date(Date.UTC(g, m - 1 + n, 1));
  boravak.mjesec = d.toISOString().slice(0, 7);
  crtajKalendar();
}
$('#kal-nazad').addEventListener('click', () => pomjeriMjesec(-1));
$('#kal-naprijed').addEventListener('click', () => pomjeriMjesec(1));

function kliknutDan(d) {
  const s = stanje.profil.smjestaj;
  const poruka = $('#kal-poruka');
  poruka.textContent = '';
  const mozeDolazak = (x) => !boravak.zauzeto.has(x) && x <= boravak.zadnji && x >= boravak.prvi;
  if (!boravak.dolazak || boravak.odlazak || d <= boravak.dolazak) {
    // Bira se (novi) dan dolaska.
    if (!mozeDolazak(d)) { poruka.textContent = 'Taj dan nije slobodan za dolazak.'; return; }
    boravak.dolazak = d;
    boravak.odlazak = null;
    poruka.textContent = 'Sada izaberi dan odlaska.';
  } else {
    const noci = nociIzmedju(boravak.dolazak, d);
    if (noci.some((x) => boravak.zauzeto.has(x))) {
      poruka.textContent = 'Između tih datuma ima zauzetih noći. Izaberi kraći boravak ili druge datume.';
      if (mozeDolazak(d)) { boravak.dolazak = d; boravak.odlazak = null; }
    } else if (noci.length < s.min_noci) {
      poruka.textContent = `Najmanje ${s.min_noci} noćenja.`;
    } else if (noci.length > s.maks_noci) {
      poruka.textContent = `Najviše ${s.maks_noci} noćenja.`;
    } else {
      boravak.odlazak = d;
    }
  }
  crtajKalendar();
  osvjeziBoravak();
}

function osvjeziBoravak() {
  const zbir = $('#boravak-zbir');
  if (!boravak.dolazak || !boravak.odlazak) {
    zbir.hidden = true;
    $('#korak-podaci').hidden = true;
    return;
  }
  const noci = nociIzmedju(boravak.dolazak, boravak.odlazak);
  const ukupno = cijenaNoci(noci);
  const gosti = Number($('#gosti').value);
  zbir.hidden = false;
  zbir.innerHTML = String(h`<span>${noci.length} ${noci.length === 1 ? 'noćenje' : 'noćenja'} · ${gostiTekst(gosti)}</span>
    <b>${cijena(ukupno)}</b><button type="button" class="dugme malo" id="boravak-dalje">Dalje ↓</button>`);
  $('#boravak-dalje').addEventListener('click', () => $('#korak-podaci').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  const s = stanje.profil.smjestaj;
  $('#sazetak').innerHTML = String(h`
    <div><span>Dolazak</span><b>${citljivDatum(boravak.dolazak)}, od ${s.dolazak}</b></div>
    <div><span>Odlazak</span><b>${citljivDatum(boravak.odlazak)}, do ${s.odlazak}</b></div>
    <div><span>Boravak</span><b>${noci.length} ${noci.length === 1 ? 'noćenje' : 'noćenja'}, ${gostiTekst(gosti)}</b></div>
    ${ukupno != null ? h`<div><span>Cijena</span><b>${cijena(ukupno)}</b></div>` : ''}
    <div class="sazetak-napomena">Plaćanje domaćinu, na licu mjesta.</div>`);
  $('#korak-podaci').hidden = false;
}

// ---------- 3. Rezervacija ----------
const forma = $('#forma-rezervacija');
forma.addEventListener('submit', async (e) => {
  e.preventDefault();
  const greska = forma.querySelector('.poruka.greska');
  greska.hidden = true;
  const f = new FormData(forma);
  if (!f.get('saglasnost')) {
    greska.textContent = 'Označi saglasnost da bi zakazao/la termin.';
    greska.hidden = false;
    return;
  }
  const ime = String(f.get('ime')).trim();
  const prezime = String(f.get('prezime')).trim();
  const telefon = String(f.get('telefon')).trim();
  const problem = ime.length < 2 ? 'Upiši ime.'
    : prezime.length < 2 ? 'Upiši prezime.'
      : (!/^\+?[0-9 ()/-]{6,25}$/.test(telefon) || telefon.replace(/\D/g, '').length < 6) ? 'Upiši ispravan broj telefona.' : '';
  if (problem) {
    greska.textContent = problem;
    greska.hidden = false;
    return;
  }
  try {
    await saDugmetom($('#dugme-zakazi'), async () => {
      // Ime i telefon se zaključavaju ovdje, u pregledniku, ključem salona.
      // Na server stižu zaključani i može ih otključati samo salon.
      const napomena = stanje.profil.napomena_klijenta ? String(f.get('napomena') || '').trim().slice(0, 300) : '';
      const podaci_sif = await sifrujZaBiznis(stanje.profil.javni_kljuc, { ime: `${ime} ${prezime}`.slice(0, 80), telefon, napomena });
      if (stanje.profil.smjestaj) {
        const gosti = Number($('#gosti').value);
        const sifra = await sifrujZaBiznis(stanje.profil.javni_kljuc, { ime: `${ime} ${prezime}`.slice(0, 80), telefon, napomena, gosti });
        stanje.rezervacija = await api(`/api/profil/${encodeURIComponent(slug)}/boravak`, {
          metoda: 'POST',
          tijelo: { dolazak: boravak.dolazak, odlazak: boravak.odlazak, gosti, podaci_sif: sifra, saglasnost: true, web: f.get('web') || undefined },
        });
        return;
      }
      stanje.rezervacija = await api(`/api/profil/${encodeURIComponent(slug)}/rezervacija`, {
        metoda: 'POST',
        tijelo: {
          usluge_ids: stanje.usluga.ids, datum: stanje.datum, od_min: stanje.odMin, hitno: stanje.hitno,
          podaci_sif,
          saglasnost: true, web: f.get('web') || undefined,
        },
      });
    });
    prikaziPotvrdu();
  } catch (g) {
    greska.textContent = g.message;
    greska.hidden = false;
    if (g.status === 409 && stanje.profil.smjestaj) {
      obavijesti('Neke noći su u međuvremenu zauzete. Osvježavam kalendar…', 'greska');
      boravak.dolazak = null;
      boravak.odlazak = null;
      pokreniSmjestaj();
    } else if (g.status === 409) {
      obavijesti('Termin je u međuvremenu zauzet. Osvježavam slobodne termine…', 'greska');
      izaberiDan(stanje.datum);
    }
  }
});

function prikaziPotvrdu() {
  const r = stanje.rezervacija;
  if (r.demo) {
    $('#zakazivanje').hidden = true;
    $('#potvrda').hidden = false;
    $('#potvrda-ikona').className = 'potvrda-ikona';
    $('#potvrda-ikona').innerHTML = IKONE.kvacica;
    $('#potvrda-naslov').textContent = 'Ovako izgleda zakazivanje';
    $('#potvrda-tekst').textContent = 'Ovo je primjer profila, pa termin nije stvarno zakazan. Na tvom profilu bi tvoj klijent sada dobio ovu potvrdu.';
    $('#potvrda-sazetak').innerHTML = h`<div><span>Usluga</span><b>${r.usluga}</b></div><div><span>Termin</span><b>${r.citljivo}</b></div>
      ${r.cijena != null ? h`<div><span>Cijena</span><b>${cijena(r.cijena)}</b></div>` : ''}`;
    document.querySelector('.potvrda-dugmad').hidden = true;
    $('#link-otkazivanje').closest('p').hidden = true;
    $('#link-otkazivanje').closest('p').previousElementSibling.hidden = true;
    $('#potvrda').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const ceka = r.status === 'ceka';
  $('#zakazivanje').hidden = true;
  const p = $('#potvrda');
  p.hidden = false;
  $('#potvrda-ikona').className = `potvrda-ikona${ceka ? ' ceka' : ''}`;
  $('#potvrda-ikona').innerHTML = ceka ? IKONE.sat : IKONE.kvacica;
  $('#potvrda-naslov').textContent = ceka ? 'Zahtjev je poslan' : 'Termin je zakazan';
  $('#potvrda-tekst').textContent = ceka
    ? `${stanje.profil.naziv} treba potvrditi termin. Ako bude problema, javiće ti se na telefon.`
    : `Vidimo se! ${stanje.profil.naziv} te očekuje.`;
  $('#potvrda-sazetak').innerHTML = h`
    <div><span>Usluga</span><b>${r.usluga}</b></div>
    <div><span>${r.noci ? 'Datumi' : 'Termin'}</span><b>${r.citljivo}</b></div>
    ${r.noci ? h`<div><span>Boravak</span><b>${r.noci} ${r.noci === 1 ? 'noćenje' : 'noćenja'}, ${gostiTekst(r.gosti)}</b></div>` : ''}
    ${r.hitno ? h`<div><span>Hitan termin</span><b>da</b></div>` : ''}
    ${r.cijena != null ? h`<div><span>Cijena</span><b>${cijena(r.cijena)}</b></div>` : ''}
    ${stanje.profil.adresa ? h`<div><span>Adresa</span><b>${stanje.profil.adresa}</b></div>` : ''}
    <div class="sazetak-napomena">Plaćanje na licu mjesta.</div>`;
  const link = $('#link-otkazivanje');
  link.href = r.otkazLink;
  link.textContent = r.otkazLink;
  p.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#dugme-kopiraj').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(stanje.rezervacija.otkazLink);
    obavijesti('Link je kopiran.');
  } catch {
    obavijesti('Kopiranje nije uspjelo. Označi link ispod i kopiraj ga.', 'greska');
  }
});

// Fajl za kalendar telefona (.ics)
$('#dugme-kalendar').addEventListener('click', () => {
  const r = stanje.rezervacija;
  const [hh, mm] = r.od.split(':').map(Number);
  const pocetak = hh * 60 + mm;
  const fmt = (min, datum = r.datum) => `${datum.replace(/-/g, '')}T${String(Math.floor(min / 60)).padStart(2, '0')}${String(min % 60).padStart(2, '0')}00`;
  // Višednevna usluga: u kalendaru traje do kraja radnog vremena zadnjeg dana.
  const kraj = r.do_datum ? fmt(Number(r.do.slice(0, 2)) * 60 + Number(r.do.slice(3)), r.do_datum) : fmt(pocetak + stanje.usluga.trajanje_min);
  const ocisti = (s) => String(s).replace(/[\\;,]/g, (z) => `\\${z}`).replace(/\n/g, '\\n');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Konekt//BS', 'BEGIN:VEVENT',
    `UID:${Date.now()}@konekt`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART:${fmt(pocetak)}`, `DTEND:${kraj}`,
    `SUMMARY:${ocisti(`${r.usluga} – ${stanje.profil.naziv}`)}`,
    stanje.profil.adresa ? `LOCATION:${ocisti([stanje.profil.adresa, stanje.profil.grad].filter(Boolean).join(', '))}` : '',
    `DESCRIPTION:${ocisti(`Otkazivanje: ${r.otkazLink}`)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = 'termin.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#dugme-novi').addEventListener('click', () => {
  stanje.rezervacija = null;
  forma.reset();
  $('#potvrda').hidden = true;
  $('#zakazivanje').hidden = false;
  $('#korak-podaci').hidden = true;
  if (stanje.profil.smjestaj) { boravak.dolazak = null; boravak.odlazak = null; pokreniSmjestaj(); }
  else if (stanje.usluga) ucitajDane();
});

ucitaj();
