// Pomoćne funkcije za prikaz i čuvanje koda oporavka (bez slanja kroz Konekt server).

const TEKST = (kod) => [
  'Konekt – kod oporavka',
  '',
  kod,
  '',
  'Ovim kodom otključavaš imena i telefone svojih klijenata ako zaboraviš lozinku.',
  'Čuvaj ga na sigurnom i ne dijeli ga ni s kim. Konekt ga nema i ne može ti ga poslati ponovo.',
].join('\n');

// Otvara email program korisnika s kodom, adresiran na njegov email.
export function mailtoKod(email, kod) {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('Konekt – kod oporavka')}&body=${encodeURIComponent(TEKST(kod))}`;
}

export function preuzmiKod(kod) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([TEKST(kod)], { type: 'text/plain;charset=utf-8' }));
  a.download = 'konekt-kod-oporavka.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function kopirajKod(kod) {
  await navigator.clipboard.writeText(kod);
}
