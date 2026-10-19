// Admin pregled: biznisi, ručna evidencija uplata i pozivnice za otvaranje profila.
import { api, $, h, obavijesti, saDugmetom } from './zajednicko.js';

let biznisi = [];

const formatDatum = (d) => {
  if (!d) return '–';
  if (d === '9999-12-31') return 'zauvijek';
  return `${d.split('-').reverse().map(Number).join('.')}.`;
};
const mjeseciTekst = (m) => (m === 0 ? 'zauvijek' : `${m} ${m === 1 ? 'mjesec' : m < 5 ? 'mjeseca' : 'mjeseci'}`);

async function ucitaj() {
  try {
    const podaci = await api('/api/admin/biznisi');
    biznisi = podaci.biznisi;
    const z = podaci.zbir;
    $('#zbir').innerHTML = String(h`
      <div class="kartica"><b>${z.ukupno}</b><span>ukupno profila</span></div>
      <div class="kartica"><b>${z.placaju}</b><span>plaćaju</span></div>
      <div class="kartica"><b>${z.zauvijek}</b><span>plaćeno zauvijek</span></div>
      <div class="kartica"><b>${z.istekli}</b><span>istekla pretplata</span></div>`);
    crtaj();
    ucitajPozivnice();
  } catch (g) {
    if (g.status === 401) location.replace('/prijava');
    else if (g.status === 403) document.querySelector('main').innerHTML = '<div class="kartica"><h1>Nemaš pristup</h1><p>Admin pregled je dostupan samo emailovima iz ADMIN_EMAILS u .env fajlu.</p></div>';
    else obavijesti(g.message, 'greska');
  }
}

function crtaj() {
  const upit = $('#pretraga').value.trim().toLowerCase();
  const lista = biznisi.filter((b) => !upit || [b.naziv, b.email, b.grad, b.slug, b.vlasnik_ime, b.vlasnik_prezime].join(' ').toLowerCase().includes(upit));
  $('#tabela').innerHTML = lista.length ? lista.map((b) => {
    const p = b.pretplata;
    const status = !b.aktivan ? ['otkazan', 'Isključen'] : p.zauvijek ? ['potvrden', 'Zauvijek'] : !p.vazi ? ['otkazan', 'Istekla'] : ['potvrden', 'Plaća'];
    return h`<tr class="${b.aktivan ? '' : 'neaktivan'}">
      <td data-oznaka="Biznis"><a href="/${b.slug}" target="_blank" rel="noopener"><b>${b.naziv}</b></a><span class="malo prigusen">${b.kategorija === 'ostalo' ? b.kategorija_tekst || 'ostalo' : b.kategorija}${b.grad ? ` · ${b.grad}` : ''} · ${b.usluga} usluga</span></td>
      <td data-oznaka="Vlasnik">${[b.vlasnik_ime, b.vlasnik_prezime].filter(Boolean).join(' ') || '–'}<span class="malo prigusen">${b.email}</span></td>
      <td data-oznaka="Pretplata"><span class="oznaka-status ${status[0]}">${status[1]}</span><span class="malo prigusen">${p.zauvijek ? 'bez isteka' : `do ${formatDatum(p.aktivnaDo)}`}</span></td>
      <td data-oznaka="Termini">${b.termina_ovaj_mjesec}<span class="malo prigusen">ovaj mjesec · ${b.termina_ukupno} ukupno</span></td>
      <td data-oznaka="Akcije"><div class="akcije">
        <button class="dugme malo" data-uplata="${b.id}" data-mjeseci="1">+1 mj</button>
        <button class="dugme drugo malo" data-uplata="${b.id}" data-mjeseci="12">+12 mj</button>
        <button class="dugme drugo malo" data-zauvijek="${b.id}">Zauvijek</button>
        <button class="dugme tekstualno malo" data-aktivan="${b.id}" data-vrijednost="${b.aktivan ? '0' : '1'}">${b.aktivan ? 'Isključi' : 'Uključi'}</button>
      </div></td>
    </tr>`;
  }).join('') : '<tr><td colspan="5" class="prazno">Nema rezultata.</td></tr>';
}

$('#pretraga').addEventListener('input', crtaj);

$('#tabela').addEventListener('click', async (e) => {
  const uplata = e.target.closest('[data-uplata]');
  const zauvijek = e.target.closest('[data-zauvijek]');
  const aktivan = e.target.closest('[data-aktivan]');
  try {
    if (uplata) {
      const b = biznisi.find((x) => x.id === Number(uplata.dataset.uplata));
      const mj = Number(uplata.dataset.mjeseci);
      if (!confirm(`Evidentirati uplatu za ${mjeseciTekst(mj)} za "${b.naziv}"?`)) return;
      const r = await saDugmetom(uplata, () => api(`/api/admin/biznisi/${b.id}/uplata`, { metoda: 'POST', tijelo: { mjeseci: mj } }));
      obavijesti(`Pretplata važi do ${formatDatum(r.placeno_do)}.`);
      ucitaj();
    }
    if (zauvijek) {
      const b = biznisi.find((x) => x.id === Number(zauvijek.dataset.zauvijek));
      if (!confirm(`Označiti da je "${b.naziv}" platio pretplatu zauvijek?`)) return;
      await api(`/api/admin/biznisi/${b.id}/uplata`, { metoda: 'POST', tijelo: { zauvijek: true } });
      obavijesti('Pretplata važi zauvijek.');
      ucitaj();
    }
    if (aktivan) {
      const ukljuci = aktivan.dataset.vrijednost === '1';
      if (!ukljuci && !confirm('Isključiti ovaj profil? Klijenti neće moći zakazivati.')) return;
      await api(`/api/admin/biznisi/${aktivan.dataset.aktivan}/aktivan`, { metoda: 'POST', tijelo: { aktivan: ukljuci } });
      ucitaj();
    }
  } catch (g) {
    obavijesti(g.message, 'greska');
  }
});

// ---------- Pozivnice ----------
async function ucitajPozivnice() {
  const { pozivnice } = await api('/api/admin/pozivnice');
  $('#tabela-pozivnice').innerHTML = pozivnice.length ? pozivnice.map((p) => h`<tr>
      <td data-oznaka="Kupac"><b>${p.email}</b>${p.ime ? h`<span class="malo prigusen">${p.ime}</span>` : ''}</td>
      <td data-oznaka="Plaćeno">${mjeseciTekst(p.mjeseci)}</td>
      <td data-oznaka="Stanje">${p.iskoristena
    ? h`<span class="oznaka-status potvrden">Profil otvoren</span><span class="malo prigusen">${p.biznis || ''}</span>`
    : h`<span class="oznaka-status ceka">Čeka registraciju</span>`}</td>
      <td data-oznaka="">${p.link ? h`<div class="akcije">
        <button class="dugme drugo malo" data-kopiraj="${p.link}">Kopiraj link</button>
        <button class="dugme tekstualno malo" data-obrisi-pozivnicu="${p.token}">Obriši</button></div>` : ''}</td>
    </tr>`).join('') : '<tr><td colspan="4" class="prazno">Još nema pozivnica.</td></tr>';
}

$('#forma-pozivnica').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const r = await saDugmetom(f.querySelector('button[type="submit"]'), () => api('/api/admin/pozivnice', {
      metoda: 'POST',
      tijelo: {
        email: f.email.value, ime: f.ime.value,
        ...(f.mjeseci.value === 'zauvijek' ? { zauvijek: true } : { mjeseci: Number(f.mjeseci.value) }),
      },
    }));
    const kutija = $('#nova-pozivnica');
    kutija.hidden = false;
    kutija.innerHTML = String(h`Pozivnica je napravljena. Pošalji kupcu ovaj link (npr. na WhatsApp):<br><code class="link-pozivnice">${r.link}</code>
      <button class="dugme malo" type="button" data-kopiraj="${r.link}">Kopiraj link</button>`);
    f.reset();
    ucitajPozivnice();
  } catch (g) {
    obavijesti(g.message, 'greska');
  }
});

document.addEventListener('click', async (e) => {
  const kopiraj = e.target.closest('[data-kopiraj]');
  const obrisi = e.target.closest('[data-obrisi-pozivnicu]');
  if (kopiraj) {
    try { await navigator.clipboard.writeText(kopiraj.dataset.kopiraj); obavijesti('Link je kopiran.'); } catch { obavijesti('Kopiranje nije uspjelo.', 'greska'); }
  }
  if (obrisi && confirm('Obrisati ovu pozivnicu? Link prestaje raditi.')) {
    await api(`/api/admin/pozivnice/${obrisi.dataset.obrisiPozivnicu}`, { metoda: 'DELETE' }).catch((g) => obavijesti(g.message, 'greska'));
    ucitajPozivnice();
  }
});

ucitaj();
