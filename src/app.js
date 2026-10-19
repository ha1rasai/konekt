// Sastavlja Express aplikaciju (odvojeno od server.js da bi se mogla testirati).
import express from 'express';
import { join } from 'node:path';
import { konfig, KORIJEN } from './konfig.js';
import { db } from './baza.js';
import { ucitajSesiju, zastitaCsrf, GreskaKorisnika, jeAdmin } from './srednji.js';
import { ruteAuth } from './rute/auth.js';
import { rutePanel } from './rute/panel.js';
import { ruteJavno } from './rute/javno.js';
import { ruteAdmin } from './rute/admin.js';
import { REZERVISANO } from './slug.js';

export function napraviAplikaciju() {
  const app = express();
  const PUBLIC = join(KORIJEN, 'public');
  const stranica = (ime) => join(PUBLIC, ime);

  app.disable('x-powered-by');
  if (konfig.izaProxyja) app.set('trust proxy', 1);

  // Sigurnosna zaglavlja
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': [
        "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:", "font-src 'self'", "connect-src 'self'",
        "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (konfig.produkcija) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  app.use(express.json({ limit: '2.5mb' })); // pozadinska slika može biti do ~1,5 MB

  // Fontovi se serviraju s našeg servera (bez Google Fonts, zbog privatnosti klijenata).
  app.use('/fonts/urbanist', express.static(join(KORIJEN, 'node_modules/@fontsource/urbanist/files'), { maxAge: '365d', immutable: true }));
  app.use('/fonts/figtree', express.static(join(KORIJEN, 'node_modules/@fontsource/figtree/files'), { maxAge: '365d', immutable: true }));
  app.use(express.static(PUBLIC, { index: false, extensions: [], maxAge: konfig.produkcija ? '1h' : 0 }));

  // ---------- API ----------
  app.use('/api', ucitajSesiju, zastitaCsrf);
  app.use('/api/auth', ruteAuth);
  app.use('/api/panel', rutePanel);
  app.use('/api/admin', ruteAdmin);
  app.use('/api', ruteJavno);
  app.use('/api', (_req, res) => res.status(404).json({ greska: 'Ne postoji.' }));

  // ---------- Stranice ----------
  const posalji = (ime) => (_req, res) => res.sendFile(stranica(ime));
  app.get('/', posalji('index.html'));
  app.get(['/prijava', '/registracija', '/zaboravljena-lozinka', '/nova-lozinka'], posalji('prijava.html'));
  app.get('/panel', posalji('panel.html'));
  // Admin stranicu vidi samo email iz ADMIN_EMAILS; svi ostali dobiju običnu stranicu "nije pronađeno".
  app.get('/admin', ucitajSesiju, (req, res) => {
    if (!jeAdmin(req.biznis)) return res.status(404).sendFile(stranica('404.html'));
    res.sendFile(stranica('admin.html'));
  });
  app.get('/uslovi', posalji('uslovi.html'));
  app.get('/privatnost', posalji('privatnost.html'));
  app.get('/otkazi/:token', posalji('otkazi.html'));
  app.get('/demo', (_req, res) => (konfig.demoSlug ? res.redirect(`/${konfig.demoSlug}`) : res.redirect('/')));

  const stmtPostoji = db.prepare('SELECT 1 FROM biznisi WHERE slug = ?');
  app.get('/:slug', (req, res, next) => {
    const slug = String(req.params.slug).toLowerCase();
    if (REZERVISANO.has(slug) || !stmtPostoji.get(slug)) return next();
    res.sendFile(stranica('profil.html'));
  });

  app.use((_req, res) => res.status(404).sendFile(stranica('404.html')));

  // ---------- Greške ----------
  app.use((err, req, res, _next) => {
    if (err instanceof GreskaKorisnika) return res.status(err.status).json({ greska: err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ greska: 'Zahtjev je prevelik.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ greska: 'Neispravan zahtjev.' });
    console.error(`Greška na ${req.method} ${req.path}:`, err);
    res.status(500).json({ greska: 'Nešto nije u redu na serveru. Pokušaj ponovo.' });
  });

  return app;
}
