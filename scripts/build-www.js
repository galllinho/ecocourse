// Assemble le dossier www/ : page complète + Firebase en local (l'appli démarre même hors ligne).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), www = path.join(root, 'www');
fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(path.join(www, 'vendor'), { recursive: true });
const body = fs.readFileSync(path.join(root, 'src/app.html'), 'utf8');
fs.writeFileSync(path.join(www, 'index.html'),
  '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' +
  '<meta name="theme-color" content="#2c6847">\n<link rel="manifest" href="manifest.webmanifest">\n<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">\n' +
  '<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="EcoCourse">\n<meta name="apple-mobile-web-app-status-bar-style" content="default">\n<script src="vendor/capacitor.js"></script>\n<style>body{margin:0}[hidden]{display:none!important}</style>\n</head>\n<body>\n' +
  body + '\n</body>\n</html>\n');
const hasPush = fs.existsSync(path.join(root, 'android-config/google-services.json'));
fs.writeFileSync(path.join(www, 'config.js'), fs.readFileSync(path.join(root, 'src/config.js'), 'utf8') +
  `\nwindow.ECOCOURSE_PUSH = ${hasPush};\nwindow.ECOCOURSE_BUILD = ${parseInt(process.env.GITHUB_RUN_NUMBER || '0', 10)};\n`);
fs.copyFileSync(path.join(root, 'node_modules/@capacitor/core/dist/capacitor.js'), path.join(www, 'vendor', 'capacitor.js'));
fs.copyFileSync(path.join(root, 'src/data.js'), path.join(www, 'data.js'));
// Version web installable (iPhone) : manifeste, icônes, service worker
for (const f of ['manifest.webmanifest', 'sw.js']) fs.copyFileSync(path.join(root, 'src', f), path.join(www, f));
fs.mkdirSync(path.join(www, 'icons'), { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'src/icons'))) fs.copyFileSync(path.join(root, 'src/icons', f), path.join(www, 'icons', f));
// Lecture des tickets : PDF (pdf.js) et photo (Tesseract, français), tout en local
const nm = p => path.join(root, 'node_modules', p);
fs.copyFileSync(nm('pdfjs-dist/legacy/build/pdf.min.js'), path.join(www, 'vendor/pdf.min.js'));
fs.copyFileSync(nm('pdfjs-dist/legacy/build/pdf.worker.min.js'), path.join(www, 'vendor/pdf.worker.min.js'));
const tdir = path.join(www, 'vendor/tesseract'); fs.mkdirSync(path.join(tdir, 'lang'), { recursive: true });
fs.copyFileSync(nm('tesseract.js/dist/tesseract.min.js'), path.join(tdir, 'tesseract.min.js'));
fs.copyFileSync(nm('tesseract.js/dist/worker.min.js'), path.join(tdir, 'worker.min.js'));
for (const f of fs.readdirSync(nm('tesseract.js-core'))) if (/lstm\.wasm\.js$/.test(f)) fs.copyFileSync(nm('tesseract.js-core/' + f), path.join(tdir, f));
fs.copyFileSync(nm('@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz'), path.join(tdir, 'lang/fra.traineddata.gz'));
for (const f of ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-database-compat.js', 'firebase-messaging-compat.js'])
  fs.copyFileSync(path.join(root, 'node_modules/firebase', f), path.join(www, 'vendor', f));
console.log('www/ prêt');
