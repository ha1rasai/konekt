// Rad s datumima i vremenom u zoni Europe/Sarajevo.
export const ZONA = 'Europe/Sarajevo';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// Trenutni datum ("YYYY-MM-DD") i minute od ponoći u Sarajevu.
export function sada(trenutak = new Date()) {
  const d = Object.fromEntries(fmt.formatToParts(trenutak).map((p) => [p.type, p.value]));
  return { datum: `${d.year}-${d.month}-${d.day}`, minute: Number(d.hour) * 60 + Number(d.minute) };
}

export function jeDatum(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

export function dodajDane(datum, n) {
  const d = new Date(`${datum}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dodajMjesece(datum, n) {
  const d = new Date(`${datum}T00:00:00Z`);
  const dan = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const zadnji = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dan, zadnji));
  return d.toISOString().slice(0, 10);
}

// 1 = ponedjeljak ... 7 = nedjelja
export function danUSedmici(datum) {
  const d = new Date(`${datum}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function uMinute(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? ''));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

export const uSate = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const DANI = ['', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota', 'nedjelja'];
export function citljivDatum(datum) {
  const [g, m, d] = datum.split('-');
  return `${DANI[danUSedmici(datum)]}, ${Number(d)}.${Number(m)}.${g}.`;
}
