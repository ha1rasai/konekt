// Slanje emailova. Bez SMTP postavki email se samo najavi u terminalu (bez sadržaja i ličnih podataka).
import nodemailer from 'nodemailer';
import { konfig } from './konfig.js';

let transport = null;
if (konfig.smtp.host) {
  transport = nodemailer.createTransport({
    host: konfig.smtp.host,
    port: konfig.smtp.port,
    secure: konfig.smtp.secure,
    auth: konfig.smtp.korisnik ? { user: konfig.smtp.korisnik, pass: konfig.smtp.lozinka } : undefined,
  });
}

const ZNAKOVI = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ZNAKOVI[c]);

function omot(naslov, redovi, dugme) {
  const tijelo = redovi.map((r) => `<p style="margin:0 0 12px;line-height:1.5">${escape(r)}</p>`).join('');
  const btn = dugme
    ? `<p style="margin:24px 0 0"><a href="${escape(dugme.url)}" style="background:#4872b0;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block;font-weight:600">${escape(dugme.tekst)}</a></p>`
    : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f7fc;padding:24px">
<div style="max-width:520px;margin:auto;background:#fff;border-radius:14px;padding:28px;color:#1b2333">
<p style="font-size:24px;font-weight:800;margin:0 0 20px;color:#1b2333;letter-spacing:-0.5px">k<span style="color:#4872b0">o</span>nekt</p>
<h1 style="font-size:18px;margin:0 0 16px">${escape(naslov)}</h1>${tijelo}${btn}
</div></div>`;
}

export async function posaljiEmail({ za, naslov, redovi, dugme }) {
  const tekst = [...redovi, dugme ? `${dugme.tekst}: ${dugme.url}` : ''].filter(Boolean).join('\n\n');
  if (!transport) {
    console.log(`[email nije poslan jer SMTP nije podešen] naslov: "${naslov}"`);
    return;
  }
  try {
    await transport.sendMail({ from: konfig.smtp.posiljalac, to: za, subject: naslov, text: tekst, html: omot(naslov, redovi, dugme) });
  } catch (g) {
    console.error('Slanje emaila nije uspjelo:', g.message);
  }
}
