// Assemble le dossier www/ : page complète + Firebase en local (l'appli démarre même hors ligne).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), www = path.join(root, 'www');
fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(path.join(www, 'vendor'), { recursive: true });
const body = fs.readFileSync(path.join(root, 'src/app.html'), 'utf8');
fs.writeFileSync(path.join(www, 'index.html'),
  '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' +
  '<meta name="theme-color" content="#2c6847">\n<style>body{margin:0}[hidden]{display:none!important}</style>\n</head>\n<body>\n' +
  body + '\n</body>\n</html>\n');
const hasPush = fs.existsSync(path.join(root, 'android-config/google-services.json'));
fs.writeFileSync(path.join(www, 'config.js'), fs.readFileSync(path.join(root, 'src/config.js'), 'utf8') +
  `\nwindow.ECOCOURSE_PUSH = ${hasPush};\n`);
for (const f of ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-database-compat.js'])
  fs.copyFileSync(path.join(root, 'node_modules/firebase', f), path.join(www, 'vendor', f));
console.log('www/ prêt');
