// Stanje pretplate. Nema besplatnog probnog perioda: kupac plati uživo ili na račun,
// admin mu napravi pozivnicu, a pri registraciji se upiše do kada je plaćeno.
// Kasnije se ovdje može spojiti automatska naplata (vidi docs/PLACANJE_KASNIJE.md).
import { konfig } from './konfig.js';
import { sada } from './vrijeme.js';

// Datum koji znači "plaćeno zauvijek" (npr. tvoj vlastiti profil).
export const ZAUVIJEK = '9999-12-31';

export function stanjePretplate(biznis, danas = sada().datum) {
  const placenoDo = biznis.placeno_do || null;
  const aktivnaDo = [biznis.proba_do, placenoDo].filter(Boolean).sort().at(-1);
  const vazi = Boolean(biznis.aktivan) && aktivnaDo >= danas;
  const placenoVazi = Boolean(placenoDo && placenoDo >= danas);
  return {
    vazi,
    uProbi: vazi && biznis.proba_do >= danas && !placenoVazi,
    zauvijek: placenoDo === ZAUVIJEK,
    aktivnaDo,
    placenoDo,
    probaDo: biznis.proba_do,
    blokiranOdAdmina: !biznis.aktivan,
    cijenaKM: konfig.cijenaKM,
    upute: konfig.placanjeUpute,
    kontakt: konfig.kontaktTelefon,
  };
}
