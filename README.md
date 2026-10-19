# Konekt

Web aplikacija za online zakazivanje termina. Frizer, kozmetičarka, doktor, fotograf ili bilo ko ko radi po terminima otvori profil, a link (npr. `konekt.ba/salon-amra`) stavi na Instagram. Klijent otvori link, izabere uslugu, dan i slobodan termin, upiše ime, prezime i telefon i termin je zakazan.

## Pokretanje na računaru

Potreban je Node.js 22.13 ili noviji (na ovom računaru je 24). Baza je SQLite i ugrađena je u Node, pa nema instalacije servera baze.

```
npm.cmd install
npm.cmd start
```

Zatim otvori http://localhost:3000.

- `npm.cmd run dev` pokreće server koji se sam restartuje kad promijeniš kod.
- `npm.cmd test` pokreće testove.
- Pri prvom pokretanju sam se napravi `.env` s jednom tajnom (`PEPPER`) za tokene.
- U PowerShellu koristi `npm.cmd`, jer `npm` blokira pravilo izvršavanja skripti.

Admin pregled (`/admin`) vidi račun čiji je email u `ADMIN_EMAILS` u `.env`. Registruj se tim emailom.

## Šta aplikacija ima

| Dio | Adresa | Za koga |
|---|---|---|
| Početna (prodajna) stranica | `/` | budući korisnici |
| Registracija, prijava, nova lozinka | `/registracija`, `/prijava` | biznisi |
| Panel: kalendar, usluge, radno vrijeme, profil i tema, račun | `/panel` | biznisi |
| Javni profil za zakazivanje | `/ime-profila` | klijenti |
| Otkazivanje termina preko linka | `/otkazi/...` | klijenti |
| Admin pregled i ručne uplate | `/admin` | ti |
| Uslovi korištenja, privatnost | `/uslovi`, `/privatnost` | svi |

**Pretplata i pozivnice (nema besplatnog probnog perioda).**
1. Kupac ti plati pretplatu, gotovinom ili na račun.
2. U admin pregledu napraviš pozivnicu: email kupca i koliko je plaćeno (1, 3, 6 ili 12 mjeseci, ili zauvijek).
3. Kopiraš link i pošalješ ga kupcu, npr. na WhatsApp ili Viber. Samo s njim otvori profil.
4. Kad plati sljedeći put, u admin pregledu klikneš „+1 mj“, „+12 mj“ ili „Zauvijek“.

Admin (email iz `ADMIN_EMAILS`) otvara profil bez pozivnice na `/registracija?admin=1`.

**Primjer profila.** `DEMO_PROFIL` u .env (npr. `ordinacija-osmijeh`) je profil koji budući korisnici vide na `/demo` i s početne stranice. Posjetioci mogu sve isprobati, ali se termin ne upisuje. Vlasnik tog profila, kad je prijavljen, zakazuje normalno.

**Pogled klijenta.** Dugme „Pogledaj kao klijent“ u panelu otvara javni profil, s natpisom da je to pregled.

**Postavke na jednom mjestu** (tab „Postavke“): da li salon sam potvrđuje termine, napomena klijenta, razmak termina, najava i koliko unaprijed, te hitni termini.

**Hitni termini.** Salon bira dane i sate kad prima hitne termine, najkraću najavu i doplatu u procentima. Klijent označi „Hitan termin“, vidi samo hitne slobodne termine, a cijena se uveća automatski. Plaćanje je uvijek na licu mjesta.

**Trajanje usluge i najava** se upisuju slobodno: broj i jedinica (minute, sati ili dani). Usluga može trajati i **više radnih dana** (npr. popravak auta 2 dana): tada zauzima cijele radne dane, klijent bira dan predaje na početku radnog vremena, neradni dani se preskaču, a otkazivanje oslobađa sve dane.

**Smještaj (vikendice, apartmani) bez provizije.** Djelatnost „Vikendica / apartman“ pretvara profil u rezervaciju po noćenjima: domaćin u Postavkama upisuje cijenu po noći, posebnu cijenu za petak i subotu, minimum noćenja, najviše gostiju i vrijeme dolaska i odlaska. Gost u kalendaru bira dolazak i odlazak, broj gostiju i vidi ukupnu cijenu. Svaka noć je zaseban red u bazi, pa ista noć ne može biti rezervisana dvaput, a dan odlaska je slobodan za novog gosta. Zatvoreni dani (lični boravak, renoviranje, rezervacija s druge strane) upisuju se kao neradni dani. Domaćin može ručno upisati i goste koji zovu telefonom.

**Napomena klijenta.** Ako je salon uključi, klijent može dopisati npr. „Želim kraću frizuru“. Napomena je zaključana zajedno s imenom i telefonom.

**Mnogo usluga.** Usluge mogu imati grupu (npr. Pregledi, Laboratorija). Na profilu se slažu u grupe koje se otvaraju, a od 7 usluga naviše pojavi se tražilica.

**Statusi termina:** „Zakazan automatski“, „Čeka tvoju potvrdu“, „Potvrđen“, „Upisan ručno“, „Otkazan“, „Odbijen“.

**Više usluga u jednom terminu.** Klijent može označiti više usluga, a trajanje i cijena se sabiraju. Slobodni termini se računaju za ukupno trajanje.

**Radno vrijeme od 00:00 do 24:00.** Dugme „0–24 h“ postavlja cijeli dan.

**Logo i pozadina.** Klik na okruglu sliku s olovkom mijenja logo. Pod „Profil i izgled“ biznis može staviti svoju sliku iz galerije kao pozadinu; boje kartica i dugmadi i dalje daje tema.

**Teme pozadine.** Svaki biznis bira jednu od 10 tema (Konekt, Noć, Breskva, Ruža, Lavanda, Menta, More, Pijesak, Grafit, Šampanj) u panelu, pod „Profil i izgled“. Tema važi za njegov javni profil i za njegov panel. Nova tema se dodaje u `public/css/teme.css` i `public/js/teme-podaci.js`.

**Privatnost: šifrovanje s kraja na kraj.** Ni vlasnica Konekta ne može pročitati klijente, ni tehnički:
- Svaki biznis ima svoj par ključeva. Privatni ključ je zaključan lozinkom biznisa, a lozinka nikad ne ide na server. Preglednik iz nje izvede vrijednost za prijavu i ključ za otključavanje (`public/js/kripto.js`).
- Klijent na javnom profilu zaključa ime i telefon javnim ključem biznisa prije slanja. U bazi je samo nečitljiv tekst.
- Biznis otključava klijente u svom pregledniku. Otključan ključ se čuva na uređaju (IndexedDB) i briše pri odjavi.
- Za zaboravljenu lozinku biznis ima **kod oporavka**, koji dobije pri registraciji. Dugme „Pošalji sebi na email“ otvara njegov email program, pa kod ne prolazi kroz server. Bez koda dobija nove ključeve, a stara imena ostaju zaključana.
- Obavijesti o rezervacijama za sada se vide u panelu. Kasnije je planirana obavijest SMS-om, bez imena klijenta u poruci.
- **Postavljanje profila umjesto biznisa:** neka biznis sam otvori račun i upiše lozinku, a ti poslije dodaj usluge i radno vrijeme. Ako ti znaš njegovu lozinku, mogla bi otključati klijente.
- Nema polja „razlog posjete“.
- Admin pregled ne prikazuje imena ni telefone klijenata.
- Svaki biznis vidi samo svoje termine.
- Termini stariji od 12 mjeseci brišu se automatski (`TERMINI_CUVANJE_MJESECI`).
- Fontovi se serviraju s našeg servera, bez Google Fonts.

**Dupli termini** se odbijaju na nivou baze (trigger u `src/baza.js`), čak i kad dva klijenta kliknu isti termin u istoj sekundi.

**Plaćanje** je za sada ručno: biznis plati gotovinom ili na račun, a ti u admin pregledu klikneš „+1 mj“ ili „+12 mj“. Prvi mjesec je besplatan. Kad istekne pretplata, klijenti ne mogu online zakazivati, a biznis i dalje vidi kalendar. Plan za automatsku naplatu je u [docs/PLACANJE_KASNIJE.md](docs/PLACANJE_KASNIJE.md).

## Struktura

```
server.js              pokretanje servera
src/
  konfig.js            čitanje .env
  baza.js              tabele, zaštita od duplih termina
  sigurnost.js         heširanje prijave i tokena
  e2e.js               provjera zaključanih podataka (server ih ne može otvoriti)
  srednji.js           prijava (kolačić), CSRF zaštita, ograničenje zahtjeva, validacija
  termini.js           računanje slobodnih termina
  vrijeme.js           datumi u zoni Europe/Sarajevo
  pretplata.js         stanje pretplate
  email.js             slanje emailova (SMTP)
  ciscenje.js          automatsko brisanje starih podataka
  slug.js, teme.js     adrese profila, kategorije
  rute/                auth, panel, javno, admin
public/                stranice (HTML), css/, js/ (kripto.js = šifrovanje u pregledniku), img/
test/                  testovi
podaci/                SQLite baza (ne ide na git)
```

## Logo

U `public/img/`:
- `logo.svg` i `logo.png` za svijetlu podlogu;
- `logo-tamni.svg` i `logo-tamni.png` za tamnu podlogu;
- `logo-bijeli.svg` sav bijeli;
- `ikona.svg` i `ikona-512.png` kao ikona aplikacije;
- `instagram-profil.png` (1080×1080) kao slika profila na Instagramu;
- `og.png` kao slika koja se prikaže kad se link podijeli.

Slova su pretvorena u oblike, pa logo izgleda isto na svakom računaru.

## Postavljanje na internet

Aplikacija mora stalno raditi, a SQLite baza mora biti na **trajnom disku**. Dvije jednostavne opcije, a cijene provjeri prije odluke:
1. **Mali VPS** (npr. Hetzner, oko 4–5 € mjesečno): Node.js + Caddy ili Nginx za HTTPS, a aplikaciju drži upaljenom `pm2` ili systemd.
2. **Render ili Railway** s trajnim diskom (volume). Besplatni planovi nemaju trajni disk, pa ne odgovaraju.

U `.env` na serveru postavi:
- `NODE_ENV=production`;
- `JAVNI_URL=https://konekt.ba` (tvoja domena);
- `IZA_PROXYJA=1`;
- `BAZA_PUT` na trajni disk;
- SMTP podatke, da emailovi stvarno idu. Pogodan je npr. Brevo ili SMTP od domene.

**Backup:** jednom dnevno kopiraj `podaci/konekt.db` (zajedno s `-wal` fajlom) na drugo mjesto. Ni backup ne sadrži čitljiva imena ni telefone klijenata.

**HTTPS je obavezan** na internetu, jer preglednik dozvoljava šifrovanje (Web Crypto) samo na https adresama i na localhostu.

## Prije prvih korisnika

- U `public/uslovi.html` i `public/privatnost.html` upiši podatke o obrtu kad ga registruješ.
- Neka uslove pogleda pravnik, posebno ako uključuješ ordinacije.
- Postavi SMTP, da radi „Zaboravljena lozinka“ (link za novu lozinku ide emailom).
