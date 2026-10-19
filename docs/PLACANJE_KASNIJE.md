# Automatska pretplata (kasnije, kad se registruje obrt)

Sada se pretplata evidentira ručno u admin pregledu. Kolona `biznisi.placeno_do` govori do kada važi plaćeni period. Sve ostalo u aplikaciji (blokiranje zakazivanja, obavijesti u panelu) već radi preko funkcije `stanjePretplate` u `src/pretplata.js`.

## Šta treba za automatsku naplatu

1. **Registrovan obrt i poslovni račun.** Bez toga nijedan procesor plaćanja ne otvara račun trgovca.
2. **Procesor plaćanja koji radi s firmama iz BiH i podržava ponavljajuća plaćanja.** Provjeri trenutne uslove prije odluke:
   - Monri (BiH), s tokenizacijom kartice za mjesečno terećenje;
   - banke u BiH koje nude internet naplatu;
   - „merchant of record“ servisi poput Paddle ili Lemon Squeezy, koji sami obračunavaju porez, pa provjeri isplate na račun u BiH.

   Stripe za sada ne otvara račune firmama iz BiH, ali to provjeri u trenutku odluke.
3. **Fiskalizacija i računi** u skladu sa zakonom. Pitaj knjigovođu kako se izdaju računi za online pretplatu.

## Kako se spaja s kodom

1. Nova tabela `uplate`: `id`, `biznis_id`, `iznos`, `valuta`, `period_od`, `period_do`, `procesor_id`, `status`, `kreirano`.
2. Ruta `POST /api/panel/pretplata/zapocni` vodi biznis na stranicu plaćanja procesora.
3. Ruta `POST /api/webhook/<procesor>` prima potvrdu uspješne naplate:
   - prvo provjeri potpis webhooka;
   - zatim upiše red u `uplate` i produži `biznisi.placeno_do` za mjesec dana, kao što danas radi `/api/admin/biznisi/:id/uplata`.
4. U panelu, pod „Račun“, dodaj dugme „Plati karticom“ i listu uplata.
5. Ručna evidencija u admin pregledu ostaje, za one koji plaćaju gotovinom.

Podaci o kartici nikad ne prolaze kroz Konekt server. Unose se na stranici procesora.
