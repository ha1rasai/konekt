// Prijava, registracija i zaboravljena lozinka, sa šifrovanjem s kraja na kraj.
// Lozinka se ne šalje serveru: preglednik iz nje izvede "auth" i ključ omota (vidi kripto.js).
import { api, $, saDugmetom, obavijesti } from './zajednicko.js';
import {
  pripremiNoviRacun, izLozinke, novaSol, otkljucajPkcs8, uveziPrivatni, zakljucajPrivatni,
  otkljucajKodom, noviParKljuceva, noviKod, zakljucajKodom,
} from './kripto.js';
import { sacuvajKljuc, obrisiKljuceve } from './kljucevi.js';
import { mailtoKod, preuzmiKod, kopirajKod } from './kod-oporavka.js';
import { KATEGORIJE } from './kategorije-podaci.js';


const nacin = location.pathname.replace('/', '') || 'prijava';
const sekcija = document.querySelector(`[data-nacin="${nacin}"]`) || document.querySelector('[data-nacin="prijava"]');
sekcija.hidden = false;
document.title = `${sekcija.querySelector('h1').textContent} – Konekt`;

$('#r-kategorija').innerHTML = KATEGORIJE.map(([id, naziv]) => `<option value="${id}">${naziv}</option>`).join('');
// Uz "Ostalo" se upisuje vlastita djelatnost.
$('#r-kategorija').addEventListener('change', (e) => {
  $('#polje-r-djelatnost').hidden = e.target.value !== 'ostalo';
  if (e.target.value === 'ostalo') $('#r-djelatnost').focus();
});

// Prijavljen korisnik ne treba prijavu.
if (nacin === 'prijava' || nacin === 'registracija') {
  api('/api/auth/stanje').then(({ prijavljen }) => { if (prijavljen) location.replace('/panel'); }).catch(() => {});
}

function provjeriNovuLozinku(lozinka) {
  if (String(lozinka).length < 8) throw new Error('Lozinka mora imati bar 8 znakova.');
  if (String(lozinka).length > 200) throw new Error('Lozinka je preduga.');
}

function obradi(forma, fn) {
  const greska = forma.querySelector('.poruka.greska');
  forma.addEventListener('submit', async (e) => {
    e.preventDefault();
    greska.hidden = true;
    const dugme = forma.querySelector('button[type="submit"]');
    try {
      await saDugmetom(dugme, () => fn(new FormData(forma)));
    } catch (g) {
      greska.textContent = g.message;
      greska.hidden = false;
    }
  });
}

// ---------- Ekran s kodom oporavka ----------
function prikaziKod(email, kod, kamo) {
  document.querySelectorAll('[data-nacin]').forEach((s) => { s.hidden = true; });
  $('#sekcija-kod').hidden = false;
  document.title = 'Kod oporavka – Konekt';
  $('#kod-tekst').textContent = kod;
  $('#kod-email').href = mailtoKod(email, kod);
  $('#kod-kopiraj').onclick = async () => {
    try { await kopirajKod(kod); obavijesti('Kod je kopiran.'); } catch { obavijesti('Kopiranje nije uspjelo. Zapiši kod.', 'greska'); }
  };
  $('#kod-preuzmi').onclick = () => preuzmiKod(kod);
  $('#kod-sacuvan').onchange = (e) => { $('#kod-nastavi').disabled = !e.target.checked; };
  $('#kod-nastavi').onclick = () => { location.href = kamo; };
  window.scrollTo(0, 0);
}

// ---------- Prijava ----------
obradi($('#forma-prijava'), async (f) => {
  const email = String(f.get('email')).trim().toLowerCase();
  const { sol } = await api(`/api/auth/sol?email=${encodeURIComponent(email)}`);
  const { kljucOmota, auth } = await izLozinke(f.get('lozinka'), sol);
  const r = await api('/api/auth/prijava', { metoda: 'POST', tijelo: { email, auth } });
  await obrisiKljuceve();
  if (r.kljuc_lozinkom) {
    const privatni = await uveziPrivatni(await otkljucajPkcs8(kljucOmota, r.kljuc_lozinkom));
    await sacuvajKljuc(r.id, privatni);
  }
  location.href = '/panel';
});

// ---------- Registracija (samo uz pozivnicu) ----------
if (nacin === 'registracija') {
  const parametri = new URLSearchParams(location.search);
  const token = parametri.get('pozivnica');
  const forma = $('#forma-registracija');
  if (token) {
    api(`/api/auth/pozivnica/${encodeURIComponent(token)}`).then((p) => {
      forma.hidden = false;
      forma.pozivnica.value = token;
      forma.email.value = p.email;
      forma.email.readOnly = true;
      if (p.ime) forma.naziv.placeholder = p.ime;
    }).catch((g) => {
      $('#bez-pozivnice').hidden = false;
      $('#bez-pozivnice').insertAdjacentHTML('afterbegin', '<div class="poruka greska"></div>');
      $('#bez-pozivnice .poruka.greska').textContent = g.message;
    });
  } else if (parametri.has('admin')) {
    forma.hidden = false; // admin (email iz ADMIN_EMAILS) otvara profil bez pozivnice
  } else {
    $('#bez-pozivnice').hidden = false;
  }
}

obradi($('#forma-registracija'), async (f) => {
  if (!f.get('uslovi')) throw new Error('Za otvaranje profila potrebno je prihvatiti uslove korištenja.');
  if (f.get('kategorija') === 'ostalo' && String(f.get('kategorija_tekst') || '').trim().length < 2) throw new Error('Upiši čime se baviš (npr. Stolar).');
  if (String(f.get('vlasnik_ime')).trim().length < 2 || String(f.get('vlasnik_prezime')).trim().length < 2) throw new Error('Upiši svoje ime i prezime.');
  provjeriNovuLozinku(f.get('lozinka'));
  const email = String(f.get('email')).trim().toLowerCase();
  const { zaServer, kod, privatni } = await pripremiNoviRacun(f.get('lozinka'));
  const r = await api('/api/auth/registracija', {
    metoda: 'POST',
    tijelo: {
      naziv: f.get('naziv'), kategorija: f.get('kategorija'), kategorija_tekst: f.get('kategorija_tekst') || undefined, email, uslovi: true,
      vlasnik_ime: f.get('vlasnik_ime'), vlasnik_prezime: f.get('vlasnik_prezime'), pozivnica: f.get('pozivnica') || undefined,
      ...zaServer,
    },
  });
  await obrisiKljuceve();
  await sacuvajKljuc(r.id, privatni);
  prikaziKod(email, kod, '/panel?dobrodoslica=1');
});

// ---------- Zaboravljena lozinka ----------
obradi($('#forma-zaboravljena'), async (f) => {
  await api('/api/auth/zaboravljena', { metoda: 'POST', tijelo: { email: f.get('email') } });
  $('#forma-zaboravljena').hidden = true;
  $('#zaboravljena-ok').hidden = false;
});

// ---------- Nova lozinka (iz linka u emailu) ----------
const bezKoda = $('#n-bez-koda');
bezKoda.addEventListener('change', () => { $('#polje-kod').hidden = bezKoda.checked; });

obradi($('#forma-nova'), async (f) => {
  const token = new URLSearchParams(location.search).get('token') || '';
  const lozinka = f.get('lozinka');
  provjeriNovuLozinku(lozinka);
  const sol = novaSol();
  const { kljucOmota, auth } = await izLozinke(lozinka, sol);

  if (!bezKoda.checked) {
    // Otključaj postojeći privatni ključ kodom oporavka i zaključaj ga novom lozinkom.
    if (!String(f.get('kod')).trim()) throw new Error('Upiši kod oporavka ili označi da ga nemaš.');
    const { kljuc_kodom: omotKod } = await api('/api/auth/reset-podaci', { metoda: 'POST', tijelo: { token } });
    let pkcs8;
    try {
      pkcs8 = await otkljucajKodom(f.get('kod'), omotKod);
    } catch {
      throw new Error('Kod oporavka nije tačan. Provjeri ga i pokušaj ponovo.');
    }
    const r = await api('/api/auth/nova-lozinka', {
      metoda: 'POST', tijelo: { token, sol, auth, kljuc_lozinkom: await zakljucajPrivatni(kljucOmota, pkcs8) },
    });
    await obrisiKljuceve();
    await sacuvajKljuc(r.id, await uveziPrivatni(pkcs8));
    location.href = '/panel';
    return;
  }

  // Bez koda: novi ključevi i novi kod. Stara imena i telefoni ostaju zaključani.
  const { javni, pkcs8 } = await noviParKljuceva();
  const kod = noviKod();
  const r = await api('/api/auth/nova-lozinka', {
    metoda: 'POST',
    tijelo: {
      token, sol, auth, novi_kljucevi: true, javni_kljuc: javni,
      kljuc_lozinkom: await zakljucajPrivatni(kljucOmota, pkcs8),
      kljuc_kodom: await zakljucajKodom(kod, pkcs8),
    },
  });
  await obrisiKljuceve();
  await sacuvajKljuc(r.id, await uveziPrivatni(pkcs8));
  const ja = await api('/api/auth/ja');
  prikaziKod(ja.email, kod, '/panel');
});
