// Pokretanje: npm.cmd start   (ili npm.cmd run dev za automatski restart pri izmjeni koda)
import { konfig } from './src/konfig.js';
import { napraviAplikaciju } from './src/app.js';
import { pokreniCiscenje } from './src/ciscenje.js';
import { db } from './src/baza.js';

const app = napraviAplikaciju();
pokreniCiscenje();

const server = app.listen(konfig.port, () => {
  console.log(`Konekt radi na ${konfig.javniUrl} (port ${konfig.port})`);
  if (!konfig.smtp.host) console.log('Napomena: SMTP nije podešen, pa se emailovi ne šalju.');
});

function ugasi() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', ugasi);
process.on('SIGTERM', ugasi);
