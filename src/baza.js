// SQLite baza (ugrađena u Node.js, bez instalacije servera baze).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { konfig } from './konfig.js';

if (konfig.bazaPut !== ':memory:') mkdirSync(dirname(konfig.bazaPut), { recursive: true });

export const db = new DatabaseSync(konfig.bazaPut);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- Biznis = korisnik koji ima profil (frizer, kozmetičar, ordinacija, fotograf...)
CREATE TABLE IF NOT EXISTS biznisi (
  id                 INTEGER PRIMARY KEY,
  email              TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  lozinka_hash       TEXT    NOT NULL,   -- scrypt od "auth" vrijednosti; prava lozinka nikad ne stiže na server
  e2e_sol            TEXT,               -- sol za izvođenje ključa iz lozinke (u pregledniku)
  javni_kljuc        TEXT,               -- javni ključ biznisa; njime klijenti zaključavaju ime i telefon
  kljuc_lozinkom     TEXT,               -- privatni ključ zaključan lozinkom (JSON {iv, ct})
  kljuc_kodom        TEXT,               -- privatni ključ zaključan kodom oporavka (JSON {sol, iv, ct})
  naziv              TEXT    NOT NULL,
  slug               TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  kategorija         TEXT    NOT NULL DEFAULT 'ostalo',
  opis               TEXT    NOT NULL DEFAULT '',
  adresa             TEXT    NOT NULL DEFAULT '',
  grad               TEXT    NOT NULL DEFAULT '',
  telefon            TEXT    NOT NULL DEFAULT '',
  instagram          TEXT    NOT NULL DEFAULT '',
  tema               TEXT    NOT NULL DEFAULT 'konekt',
  logo               BLOB,
  logo_tip           TEXT,
  logo_verzija       INTEGER NOT NULL DEFAULT 0,
  potvrda_obavezna   INTEGER NOT NULL DEFAULT 0,
  korak_min          INTEGER NOT NULL DEFAULT 15,
  najava_min         INTEGER NOT NULL DEFAULT 60,
  dana_unaprijed     INTEGER NOT NULL DEFAULT 30,
  email_obavijesti   INTEGER NOT NULL DEFAULT 1,
  aktivan            INTEGER NOT NULL DEFAULT 1,
  proba_do           TEXT    NOT NULL,
  placeno_do         TEXT,
  uslovi_prihvaceni  TEXT    NOT NULL,
  kreirano           TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Radno vrijeme: dan 1 = ponedjeljak ... 7 = nedjelja. Nema reda = ne radi taj dan.
CREATE TABLE IF NOT EXISTS radno_vrijeme (
  biznis_id  INTEGER NOT NULL REFERENCES biznisi(id) ON DELETE CASCADE,
  dan        INTEGER NOT NULL CHECK (dan BETWEEN 1 AND 7),
  od_min     INTEGER NOT NULL,
  do_min     INTEGER NOT NULL,
  pauza_od   INTEGER,
  pauza_do   INTEGER,
  PRIMARY KEY (biznis_id, dan),
  CHECK (od_min >= 0 AND do_min <= 1440 AND od_min < do_min)
);

CREATE TABLE IF NOT EXISTS neradni_dani (
  biznis_id  INTEGER NOT NULL REFERENCES biznisi(id) ON DELETE CASCADE,
  datum      TEXT    NOT NULL,
  PRIMARY KEY (biznis_id, datum)
);

CREATE TABLE IF NOT EXISTS usluge (
  id            INTEGER PRIMARY KEY,
  biznis_id     INTEGER NOT NULL REFERENCES biznisi(id) ON DELETE CASCADE,
  naziv         TEXT    NOT NULL,
  opis          TEXT    NOT NULL DEFAULT '',
  trajanje_min  INTEGER NOT NULL CHECK (trajanje_min BETWEEN 5 AND 720),
  cijena        REAL,
  aktivna       INTEGER NOT NULL DEFAULT 1,
  obrisana      INTEGER NOT NULL DEFAULT 0,
  redoslijed    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS usluge_biznis ON usluge(biznis_id);

-- Termini i blokirano vrijeme. Ime i telefon klijenta su zaključani u pregledniku
-- javnim ključem biznisa (podaci_sif). Server ih ne može pročitati.
-- Namjerno NEMA polja "razlog posjete".
CREATE TABLE IF NOT EXISTS termini (
  id            INTEGER PRIMARY KEY,
  biznis_id     INTEGER NOT NULL REFERENCES biznisi(id) ON DELETE CASCADE,
  usluga_id     INTEGER REFERENCES usluge(id) ON DELETE SET NULL,
  usluga_naziv  TEXT    NOT NULL DEFAULT '',
  vrsta         TEXT    NOT NULL DEFAULT 'termin' CHECK (vrsta IN ('termin','blok')),
  datum         TEXT    NOT NULL,
  od_min        INTEGER NOT NULL,
  do_min        INTEGER NOT NULL,
  status        TEXT    NOT NULL CHECK (status IN ('ceka','potvrden','odbijen','otkazan')),
  izvor         TEXT    NOT NULL DEFAULT 'online' CHECK (izvor IN ('online','rucno')),
  podaci_sif    TEXT,
  napomena      TEXT    NOT NULL DEFAULT '',
  otkaz_token   TEXT    UNIQUE,
  kreirano      TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (od_min >= 0 AND do_min <= 1440 AND od_min < do_min)
);
CREATE INDEX IF NOT EXISTS termini_dan ON termini(biznis_id, datum);

-- Zaštita od duplih termina NA NIVOU BAZE: ako se aktivni termin preklapa
-- s drugim aktivnim terminom istog biznisa, baza odbija upis.
CREATE TRIGGER IF NOT EXISTS termini_bez_preklapanja_ins
BEFORE INSERT ON termini
WHEN NEW.status IN ('ceka','potvrden')
BEGIN
  SELECT RAISE(ABORT, 'TERMIN_ZAUZET')
  WHERE EXISTS (
    SELECT 1 FROM termini t
    WHERE t.biznis_id = NEW.biznis_id AND t.datum = NEW.datum
      AND t.status IN ('ceka','potvrden')
      AND t.od_min < NEW.do_min AND t.do_min > NEW.od_min
  );
END;

CREATE TRIGGER IF NOT EXISTS termini_bez_preklapanja_upd
BEFORE UPDATE OF status, datum, od_min, do_min ON termini
WHEN NEW.status IN ('ceka','potvrden')
BEGIN
  SELECT RAISE(ABORT, 'TERMIN_ZAUZET')
  WHERE EXISTS (
    SELECT 1 FROM termini t
    WHERE t.biznis_id = NEW.biznis_id AND t.datum = NEW.datum AND t.id <> NEW.id
      AND t.status IN ('ceka','potvrden')
      AND t.od_min < NEW.do_min AND t.do_min > NEW.od_min
  );
END;

CREATE TABLE IF NOT EXISTS sesije (
  token_hash  TEXT    PRIMARY KEY,
  biznis_id   INTEGER NOT NULL REFERENCES biznisi(id) ON DELETE CASCADE,
  istice      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS reset_tokeni (
  token_hash  TEXT    PRIMARY KEY,
  biznis_id   INTEGER NOT NULL REFERENCES biznisi(id) ON DELETE CASCADE,
  istice      TEXT    NOT NULL
);
`);

// Dodaje kolone koje nedostaju u starijoj bazi.
function dodajKolonu(tabela, kolona, tip) {
  const postoji = db.prepare(`PRAGMA table_info(${tabela})`).all().some((k) => k.name === kolona);
  if (!postoji) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${kolona} ${tip}`);
}
for (const k of ["e2e_sol", "javni_kljuc", "kljuc_lozinkom", "kljuc_kodom"]) dodajKolonu("biznisi", k, "TEXT");
dodajKolonu("termini", "podaci_sif", "TEXT");
// Vlastita pozadinska slika profila (umjesto ili uz temu).
dodajKolonu("biznisi", "pozadina", "BLOB");
dodajKolonu("biznisi", "pozadina_tip", "TEXT");
dodajKolonu("biznisi", "pozadina_verzija", "INTEGER NOT NULL DEFAULT 0");

// Ime i prezime vlasnika računa (vidi ih admin; to su podaci tvog kupca, ne njegovih klijenata).
dodajKolonu("biznisi", "vlasnik_ime", "TEXT NOT NULL DEFAULT ''");
dodajKolonu("biznisi", "vlasnik_prezime", "TEXT NOT NULL DEFAULT ''");
// Kad je kategorija "ostalo", biznis sam upiše djelatnost (npr. "Stolar").
dodajKolonu("biznisi", "kategorija_tekst", "TEXT NOT NULL DEFAULT ''");
db.exec("UPDATE biznisi SET kategorija = 'ostalo', kategorija_tekst = 'Tetovaže' WHERE kategorija = 'tetovaze'");
// Može li klijent uz rezervaciju dodati napomenu (zaključana kao ime i telefon).
dodajKolonu("biznisi", "napomena_klijenta", "INTEGER NOT NULL DEFAULT 1");
// Hitni termini: uključeno, doplata u %, najkraća najava u minutama.
dodajKolonu("biznisi", "hitni_aktivno", "INTEGER NOT NULL DEFAULT 0");
dodajKolonu("biznisi", "hitni_doplata", "INTEGER NOT NULL DEFAULT 30");
dodajKolonu("biznisi", "hitni_najava_min", "INTEGER NOT NULL DEFAULT 0");
// Posebna potvrda za hitne termine, nezavisno od potvrde običnih termina (1 = salon potvrđuje).
dodajKolonu("biznisi", "hitni_potvrda", "INTEGER NOT NULL DEFAULT 1");
// Grupa usluge (npr. "Šišanje", "Pregledi") za pregledan prikaz kad usluga ima mnogo.
dodajKolonu("usluge", "grupa", "TEXT NOT NULL DEFAULT ''");
// Termin: hitan, ukupna cijena u trenutku rezervacije, i da li ga je vlasnik ručno potvrdio.
dodajKolonu("termini", "hitan", "INTEGER NOT NULL DEFAULT 0");
dodajKolonu("termini", "cijena", "REAL");
dodajKolonu("termini", "potvrdio", "INTEGER NOT NULL DEFAULT 0");
// Usluge koje traju više dana (npr. popravak auta 2 dana): broj radnih dana; 0 = obična usluga u minutama.
dodajKolonu("usluge", "dani", "INTEGER NOT NULL DEFAULT 0");
// Višednevni termin je više redova (po jedan za svaki radni dan) povezanih istim brojem "veza".
dodajKolonu("termini", "veza", "INTEGER");
// Smještaj (vikendice, apartmani): cijena po noći, cijena za petak i subotu, minimum noćenja,
// najviše gostiju, vrijeme dolaska i odlaska.
dodajKolonu("biznisi", "smj_cijena", "REAL");
dodajKolonu("biznisi", "smj_cijena_vikend", "REAL");
dodajKolonu("biznisi", "smj_min_noci", "INTEGER NOT NULL DEFAULT 1");
dodajKolonu("biznisi", "smj_max_gostiju", "INTEGER NOT NULL DEFAULT 4");
dodajKolonu("biznisi", "smj_dolazak", "TEXT NOT NULL DEFAULT '14:00'");
dodajKolonu("biznisi", "smj_odlazak", "TEXT NOT NULL DEFAULT '10:00'");

db.exec(`
-- Kada biznis prima hitne termine (dan 1 = ponedjeljak ... 7 = nedjelja). Nema reda = taj dan ne.
CREATE TABLE IF NOT EXISTS hitno_vrijeme (
  biznis_id  INTEGER NOT NULL REFERENCES biznisi(id) ON DELETE CASCADE,
  dan        INTEGER NOT NULL CHECK (dan BETWEEN 1 AND 7),
  od_min     INTEGER NOT NULL,
  do_min     INTEGER NOT NULL,
  PRIMARY KEY (biznis_id, dan),
  CHECK (od_min >= 0 AND do_min <= 1440 AND od_min < do_min)
);

-- Pozivnice: profil se može otvoriti samo uz pozivnicu, koju admin napravi kad kupac plati.
CREATE TABLE IF NOT EXISTS pozivnice (
  token       TEXT    PRIMARY KEY,
  email       TEXT    NOT NULL COLLATE NOCASE,
  ime         TEXT    NOT NULL DEFAULT '',
  mjeseci     INTEGER NOT NULL,          -- plaćeni mjeseci od dana registracije; 0 = zauvijek
  kreirano    TEXT    NOT NULL DEFAULT (datetime('now')),
  iskoristena TEXT,
  biznis_id   INTEGER REFERENCES biznisi(id) ON DELETE SET NULL
);
`);

// Pomoćna funkcija za transakcije.
export function transakcija(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (g) {
    db.exec('ROLLBACK');
    throw g;
  }
}
