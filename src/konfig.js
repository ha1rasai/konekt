// Učitava .env i daje sve postavke na jednom mjestu.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';
import { napraviEnv } from '../scripts/postavi.js';

export const KORIJEN = join(dirname(fileURLToPath(import.meta.url)), '..');
const putEnv = join(KORIJEN, '.env');

if (!process.env.KONEKT_TEST) {
  if (!existsSync(putEnv)) napraviEnv({ tiho: true });
  process.loadEnvFile(putEnv);
}

const e = process.env;
const broj = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const konfig = {
  produkcija: e.NODE_ENV === 'production',
  port: broj(e.PORT, 3000),
  javniUrl: (e.JAVNI_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  bazaPut: e.BAZA_PUT === ':memory:' ? ':memory:'
    : (isAbsolute(e.BAZA_PUT || '') ? e.BAZA_PUT : join(KORIJEN, e.BAZA_PUT || 'podaci/konekt.db')),
  izaProxyja: e.IZA_PROXYJA === '1',
  pepper: e.PEPPER || '',
  adminEmails: (e.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  cijenaKM: broj(e.PRETPLATA_CIJENA_KM, 50),
  demoSlug: (e.DEMO_PROFIL || '').trim().toLowerCase(), // javni primjer profila za buduće korisnike
  placanjeUpute: e.PLACANJE_UPUTE || '',
  kontaktTelefon: e.KONTAKT_TELEFON || '067-140-6698',
  cuvanjeMjeseci: broj(e.TERMINI_CUVANJE_MJESECI, 12),
  smtp: {
    host: e.SMTP_HOST || '',
    port: broj(e.SMTP_PORT, 587),
    secure: e.SMTP_SECURE === '1',
    korisnik: e.SMTP_KORISNIK || '',
    lozinka: e.SMTP_LOZINKA || '',
    posiljalac: e.EMAIL_POSILJALAC || 'Konekt <no-reply@konekt.ba>',
  },
};

if (!konfig.pepper) throw new Error('PEPPER u .env je prazan. Pokreni: npm.cmd run postavi');
