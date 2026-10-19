// Pravi .env fajl sa nasumičnom tajnom (PEPPER) (pokreće se jednom: npm.cmd run postavi).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const korijen = join(dirname(fileURLToPath(import.meta.url)), '..');
const putEnv = join(korijen, '.env');

export function napraviEnv({ tiho = false } = {}) {
  if (existsSync(putEnv)) {
    if (!tiho) console.log('.env već postoji, ništa nije promijenjeno.');
    return false;
  }
  const primjer = readFileSync(join(korijen, '.env.example'), 'utf8');
  const sadrzaj = primjer
    .replace(/^PEPPER=.*$/m, `PEPPER=${randomBytes(16).toString('hex')}`);
  writeFileSync(putEnv, sadrzaj, { encoding: 'utf8', flag: 'wx' });
  console.log('Napravljen je .env sa novim tajnim ključevima.');
  return true;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase()) napraviEnv();
