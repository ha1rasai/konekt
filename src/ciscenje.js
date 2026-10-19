// Automatsko brisanje starih podataka (manje podataka = manji rizik).
import { db } from './baza.js';
import { konfig } from './konfig.js';
import { sada, dodajMjesece } from './vrijeme.js';

export function ocisti() {
  const granica = dodajMjesece(sada().datum, -konfig.cuvanjeMjeseci);
  const termini = db.prepare('DELETE FROM termini WHERE datum < ?').run(granica).changes;
  db.prepare("DELETE FROM neradni_dani WHERE datum < date('now', '-30 days')").run();
  db.prepare("DELETE FROM sesije WHERE istice < datetime('now')").run();
  db.prepare("DELETE FROM reset_tokeni WHERE istice < datetime('now')").run();
  if (termini) console.log(`Čišćenje: obrisano ${termini} termina starijih od ${konfig.cuvanjeMjeseci} mjeseci.`);
}

export function pokreniCiscenje() {
  ocisti();
  setInterval(ocisti, 6 * 60 * 60 * 1000).unref();
}
