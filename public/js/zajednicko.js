// Zajedničke funkcije za sve stranice.

// Poziv API-ja. Baca Error s porukom sa servera ako nešto ne valja.
export async function api(putanja, { metoda = 'GET', tijelo } = {}) {
  const opcije = { method: metoda, headers: { 'X-Konekt': '1' }, credentials: 'same-origin' };
  if (tijelo !== undefined) {
    opcije.headers['Content-Type'] = 'application/json';
    opcije.body = JSON.stringify(tijelo);
  }
  let odgovor;
  try {
    odgovor = await fetch(putanja, opcije);
  } catch {
    throw new Error('Nema veze sa serverom. Provjeri internet i pokušaj ponovo.');
  }
  const podaci = await odgovor.json().catch(() => ({}));
  if (!odgovor.ok) {
    const g = new Error(podaci.greska || 'Nešto nije u redu. Pokušaj ponovo.');
    g.status = odgovor.status;
    throw g;
  }
  return podaci;
}

// Siguran HTML: sve vrijednosti u ${} se escapuju. Za već siguran HTML koristi sirovo().
const ZNAKOVI = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (z) => ZNAKOVI[z]);
class Sirovo { constructor(s) { this.s = s; } toString() { return this.s; } }
export const sirovo = (s) => new Sirovo(s);
export function h(dijelovi, ...vrijednosti) {
  let rezultat = dijelovi[0];
  vrijednosti.forEach((v, i) => {
    const dio = Array.isArray(v) ? v.map((x) => (x instanceof Sirovo ? x.s : esc(x))).join('') : (v instanceof Sirovo ? v.s : esc(v));
    rezultat += dio + dijelovi[i + 1];
  });
  return sirovo(rezultat);
}

export const $ = (sel, korijen = document) => korijen.querySelector(sel);
export const $$ = (sel, korijen = document) => [...korijen.querySelectorAll(sel)];

// Kratko obavještenje na dnu ekrana.
export function obavijesti(tekst, vrsta = 'info') {
  let kutija = document.getElementById('obavjestenja');
  if (!kutija) {
    kutija = document.createElement('div');
    kutija.id = 'obavjestenja';
    kutija.setAttribute('role', 'status');
    kutija.setAttribute('aria-live', 'polite');
    document.body.append(kutija);
  }
  const el = document.createElement('div');
  el.className = `obavjestenje ${vrsta}`;
  el.textContent = tekst;
  kutija.append(el);
  setTimeout(() => el.remove(), vrsta === 'greska' ? 6000 : 3500);
}

export const SAT_SVG = '<svg class="sat" viewBox="0 0 40 40" aria-hidden="true"><circle class="lice" cx="20" cy="20" r="13"/><circle class="prsten" cx="20" cy="20" r="16"/><path class="kazaljke" d="M20 20V11.5M20 20l6.5 4"/></svg>';
export const LOGO_HTML = `<a class="wordmark" href="/" aria-label="Konekt">k${SAT_SVG}nekt</a>`;

export function postaviTemu(tema) {
  document.documentElement.dataset.tema = tema || 'konekt';
  const boja = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
  }
  meta.content = boja;
}

export function cijena(vrijednost) {
  if (vrijednost === null || vrijednost === undefined || vrijednost === '') return '';
  const n = Number(vrijednost);
  return `${n.toLocaleString('bs-BA', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })} KM`;
}

export function trajanje(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const DANI_KRATKO = ['', 'Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned'];
export const DANI = ['', 'Ponedjeljak', 'Utorak', 'Srijeda', 'Četvrtak', 'Petak', 'Subota', 'Nedjelja'];
export const MJESECI = ['januar', 'februar', 'mart', 'april', 'maj', 'juni', 'juli', 'august', 'septembar', 'oktobar', 'novembar', 'decembar'];

// Datum "YYYY-MM-DD" <-> dijelovi (bez vremenskih zona).
export const danUSedmici = (datum) => { const d = new Date(`${datum}T12:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };
export function dodajDane(datum, n) {
  const d = new Date(`${datum}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function danas() {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sarajevo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return d;
}
export function citljivDatum(datum, { kratko = false } = {}) {
  const [g, m, d] = datum.split('-').map(Number);
  const dan = DANI[danUSedmici(datum)];
  return kratko ? `${dan.slice(0, 3)}, ${d}. ${MJESECI[m - 1]}` : `${dan}, ${d}. ${MJESECI[m - 1]} ${g}.`;
}

export function inicijali(naziv) {
  return String(naziv || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((r) => r[0].toUpperCase()).join('');
}

// Zaključa dugme dok traje akcija.
export async function saDugmetom(dugme, fn) {
  const tekst = dugme.innerHTML;
  dugme.disabled = true;
  dugme.innerHTML = '<span class="ucitavanje" aria-hidden="true"></span>';
  try {
    return await fn();
  } finally {
    dugme.disabled = false;
    dugme.innerHTML = tekst;
  }
}

// Ubaci logo u sve elemente s [data-logo].
export function ubaciLogo() {
  document.querySelectorAll('[data-logo]').forEach((el) => { el.innerHTML = LOGO_HTML; });
}

// Vlastita pozadinska slika biznisa (ili ništa, pa ostaje pozadina teme).
export function postaviPozadinu(url) {
  document.body.classList.toggle('ima-pozadinu', Boolean(url));
  if (url) document.body.style.setProperty('--slika-pozadine', `url("${url}")`);
  else document.body.style.removeProperty('--slika-pozadine');
}
