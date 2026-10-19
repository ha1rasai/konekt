// Čuva otključani privatni ključ biznisa u pregledniku (IndexedDB), da ne mora upisivati
// lozinku pri svakom osvježavanju stranice. Ključ se ne može izvesti iz preglednika,
// a briše se pri odjavi.
const BAZA = 'konekt';
const SKLADISTE = 'kljucevi';

function otvori() {
  return new Promise((resolve, reject) => {
    const z = indexedDB.open(BAZA, 1);
    z.onupgradeneeded = () => z.result.createObjectStore(SKLADISTE);
    z.onsuccess = () => resolve(z.result);
    z.onerror = () => reject(z.error);
  });
}

async function operacija(nacin, fn) {
  const db = await otvori();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SKLADISTE, nacin);
    const z = fn(tx.objectStore(SKLADISTE));
    tx.oncomplete = () => { db.close(); resolve(z?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function sacuvajKljuc(biznisId, kljuc) {
  try { await operacija('readwrite', (s) => s.put(kljuc, `biznis-${biznisId}`)); } catch { /* privatni prozor: samo do osvježavanja */ }
}

export async function ucitajKljuc(biznisId) {
  try { return (await operacija('readonly', (s) => s.get(`biznis-${biznisId}`))) || null; } catch { return null; }
}

export async function obrisiKljuceve() {
  try { await operacija('readwrite', (s) => s.clear()); } catch { /* ništa */ }
}

