// Associe chaque compte EcoCourse à un prénom et à ses espaces.
// Usage (dans Cloud Shell) : node scripts/membres.js comptes.json  → écrit membres.json
// Les fichiers comptes.json et membres.json restent dans Cloud Shell : ne les envoyez pas sur GitHub.
const fs = require('fs');
const readline = require('readline');
const PERSONNES = ['Nabs', 'Gigi', 'Maman', 'Sami', 'Sonia'];
const COUPLE = ['Nabs', 'Gigi'];
const src = process.argv[2] || 'comptes.json';
const users = (JSON.parse(fs.readFileSync(src, 'utf8')).users || []).filter(u => u.email);
if (!users.length) { console.log('Aucun compte trouvé dans ' + src); process.exit(1); }
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();
const ask = async q => { process.stdout.write(q); const r = await lines.next(); if (r.done) { console.log('\nSaisie interrompue.'); process.exit(1); } return r.value.trim(); };
(async () => {
  const out = { main: {}, famille: {} };
  console.log('\nPour chaque compte, tapez le numéro de la personne (0 = ignorer) :');
  PERSONNES.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  for (const u of users) {
    let n;
    do { n = parseInt(await ask(`\n${u.email} → `), 10); } while (isNaN(n) || n < 0 || n > PERSONNES.length);
    if (!n) continue;
    const nom = PERSONNES[n - 1];
    out.famille[u.localId] = nom;
    if (COUPLE.includes(nom)) out.main[u.localId] = nom;
  }
  rl.close();
  fs.writeFileSync('membres.json', JSON.stringify(out, null, 2));
  console.log('\nEspace Nabs & Gigi : ' + Object.values(out.main).join(', '));
  console.log('Espace Famille : ' + Object.values(out.famille).join(', '));
  if (!Object.values(out.main).includes('Nabs') || !Object.values(out.main).includes('Gigi'))
    console.log('\nATTENTION : Nabs et Gigi doivent tous les deux être associés, sinon vous perdrez l’accès à votre liste. Relancez le script.');
  else console.log('\nmembres.json est prêt.');
})();
