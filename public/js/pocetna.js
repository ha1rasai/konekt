// Početna stranica: isprobavanje tema na primjeru telefona.
import { $, $$, h, api } from './zajednicko.js';
import { TEME } from './teme-podaci.js';

const telefon = $('#demo-telefon');

function postaviDemoTemu(id) {
  telefon.dataset.tema = id;
  $$('[data-demo-tema]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.demoTema === id)));
  $$('#teme-pocetna .tema-opcija').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tema === id)));
}

// Boje kružića u heroju
$$('[data-demo-tema]').forEach((b) => {
  const t = TEME.find((x) => x.id === b.dataset.demoTema);
  b.style.background = `linear-gradient(135deg, ${t.pozadina} 50%, ${t.akcent} 50%)`;
  b.addEventListener('click', () => postaviDemoTemu(t.id));
});

// Mreža svih tema
$('#teme-pocetna').innerHTML = TEME.map((t) => h`
  <button type="button" class="tema-opcija" data-tema="${t.id}" aria-pressed="${t.id === 'konekt'}">
    <span class="tema-uzorak" style="background:${t.pozadina}">
      <i style="background:${t.akcent}"></i><i style="background:${t.povrsina}"></i><i style="background:${t.akcent};opacity:.35"></i>
    </span>
    <span>${t.naziv}</span>
  </button>`).join('');
$$('#teme-pocetna .tema-opcija').forEach((b) => b.addEventListener('click', () => {
  postaviDemoTemu(b.dataset.tema);
  telefon.scrollIntoView({ behavior: 'smooth', block: 'center' });
}));

// Ako je korisnik već prijavljen, dugme "Prijava" vodi u panel.
api('/api/auth/stanje').then(({ prijavljen }) => {
  if (!prijavljen) return;
  const link = $('#link-prijava');
  link.textContent = 'Moj panel';
  link.href = '/panel';
}).catch(() => {});
