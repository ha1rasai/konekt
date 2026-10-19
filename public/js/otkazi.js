// Klijent otkazuje termin preko linka iz potvrde.
import { api, $, h, postaviTemu, saDugmetom } from './zajednicko.js';

const token = location.pathname.split('/').pop();
const STATUS = { otkazan: 'Ovaj termin je već otkazan.', odbijen: 'Ovaj termin je odbio salon.' };

async function ucitaj() {
  let t;
  try {
    t = await api(`/api/otkazivanje/${encodeURIComponent(token)}`);
  } catch {
    $('#ucitavanje').hidden = true;
    $('#nema').hidden = false;
    return;
  }
  postaviTemu(t.tema);
  $('#detalji').innerHTML = String(h`
    <div><span>Kod</span><b>${t.biznis}</b></div>
    <div><span>Usluga</span><b>${t.usluga}</b></div>
    <div><span>Termin</span><b>${t.citljivo}</b></div>`);
  $('#link-profil').href = `/${t.slug}`;
  if (t.mozeOtkazati) {
    $('#opis').textContent = 'Ako ne možeš doći, otkaži termin da ga neko drugi može zauzeti.';
    $('#dugme-otkazi').hidden = false;
  } else {
    $('#opis').textContent = STATUS[t.status] || 'Ovaj termin je prošao i više se ne može otkazati.';
  }
  $('#ucitavanje').hidden = true;
  $('#sadrzaj').hidden = false;
}

$('#dugme-otkazi').addEventListener('click', async (e) => {
  if (!confirm('Sigurno želiš otkazati termin?')) return;
  try {
    await saDugmetom(e.currentTarget, () => api(`/api/otkazivanje/${encodeURIComponent(token)}`, { metoda: 'POST' }));
    $('#naslov').textContent = 'Termin je otkazan';
    $('#opis').textContent = 'Hvala što si javio/la na vrijeme.';
    $('#dugme-otkazi').hidden = true;
  } catch (g) {
    $('#greska').textContent = g.message;
    $('#greska').hidden = false;
  }
});

ucitaj();
