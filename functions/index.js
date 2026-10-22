// Notifications EcoCourse : envoyées à l'autre personne à chaque ajout, achat,
// commande en cours ou dépense, et un rappel DLC chaque soir à 18 h.
const { onValueWritten, onValueCreated } = require('firebase-functions/v2/database');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
admin.initializeApp();

const REGION = 'europe-west1';
const INSTANCE = 'ecocourse-6abb0-default-rtdb';
const ROOT = '/households/main';
const db = () => admin.database().ref(ROOT);
const euro = n => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

// Envoie à tous les téléphones, sauf ceux de "exceptUser" (celui qui a fait l'action)
async function notify(exceptUser, title, body, tag, hh = 'main') {
  const snap = await admin.database().ref(`households/${hh}/tokens`).get();
  const entries = Object.entries(snap.val() || {}).filter(([, t]) => t && t.token && (!exceptUser || t.user !== exceptUser));
  if (!entries.length) return;
  const res = await admin.messaging().sendEachForMulticast({
    tokens: entries.map(([, t]) => t.token),
    notification: { title, body },
    android: { priority: 'high', notification: { channelId: 'ecocourse', tag, color: '#2c6847' } },
  });
  // Nettoyage des téléphones désinstallés
  const dead = {};
  res.responses.forEach((r, i) => {
    const code = r.error && r.error.code;
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') dead[`tokens/${entries[i][0]}`] = null;
  });
  if (Object.keys(dead).length) await admin.database().ref(`households/${hh}`).update(dead);
}

const opts = path => ({ ref: `${ROOT}/${path}`, instance: INSTANCE, region: REGION });

// Article ajouté ou pris
exports.articleChange = onValueWritten(opts('items/{id}'), async ev => {
  const before = ev.data.before.val(), after = ev.data.after.val();
  if (!after) return;
  const qty = after.qty > 1 ? `${after.qty}× ` : '';
  if (!before) {
    const where = after.store ? ` (${after.store})` : '';
    return notify(after.addedBy, 'Liste de courses', `${after.addedBy} a ajouté ${qty}${after.name}${where}`, `add-${ev.params.id}`);
  }
  if (!before.checked && after.checked && after.checkedBy) {
    return notify(after.checkedBy, 'Dans le panier', `${after.checkedBy} a pris ${qty}${after.name}`, `take-${ev.params.id}`);
  }
});

// Commande en cours
exports.commandeEnCours = onValueWritten(opts('status'), async ev => {
  const before = ev.data.before.val(), after = ev.data.after.val();
  if (!after || (before && before.at === after.at)) return;
  return notify(after.by, `Commande ${after.store} en cours`, `${after.by} prépare la commande. Ajoutez vos oublis maintenant !`, 'commande');
});

// Dépense ajoutée + alerte budget
exports.depense = onValueCreated(opts('expenses/{id}'), async ev => {
  const e = ev.data.val();
  if (!e) return;
  await notify(e.by, 'Budget courses', `${e.by} a ajouté une dépense de ${euro(e.amount)} (${e.store || 'Autre'})`, `exp-${ev.params.id}`);
  const all = (await db().get()).val() || {};
  const budget = all.budget || 0;
  if (!budget) return;
  const month = e.date.slice(0, 7);
  const total = Object.values(all.expenses || {}).filter(x => x.date && x.date.startsWith(month)).reduce((a, x) => a + x.amount, 0);
  const prev = total - e.amount;
  if (prev < budget && total >= budget) return notify(null, 'Budget dépassé', `Ce mois-ci : ${euro(total)} pour un budget de ${euro(budget)}.`, 'budget');
  if (prev < budget * 0.8 && total >= budget * 0.8) return notify(null, '80 % du budget atteint', `Ce mois-ci : ${euro(total)} sur ${euro(budget)}. Il reste ${euro(budget - total)}.`, 'budget');
});

// Rappel DLC chaque soir
exports.rappelDlc = onSchedule({ schedule: '0 18 * * *', timeZone: 'Europe/Paris', region: REGION }, async () => {
  const frigo = Object.values((await db().child('frigo').get()).val() || {});
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  today.setHours(0, 0, 0, 0);
  const days = iso => { const [y, m, d] = iso.split('-').map(Number); return Math.round((new Date(y, m - 1, d) - today) / 864e5); };
  const dated = frigo.filter(f => f.dlc).map(f => ({ ...f, d: days(f.dlc) }));
  const soon = dated.filter(f => f.d >= 0 && f.d <= 1).sort((a, b) => a.d - b.d);
  const expired = dated.filter(f => f.d < 0);
  if (!soon.length && !expired.length) return;
  const names = soon.slice(0, 4).map(f => f.name).join(', ') + (soon.length > 4 ? '…' : '');
  const parts = [];
  if (soon.length) parts.push(`À consommer d'ici demain : ${names}`);
  if (expired.length) parts.push(`${expired.length} produit${expired.length > 1 ? 's' : ''} périmé${expired.length > 1 ? 's' : ''}`);
  return notify(null, soon.length ? `${soon.length} produit${soon.length > 1 ? 's' : ''} à consommer vite` : 'Produits périmés', parts.join(' · '), 'dlc');
});

// ---------- Rappel Conso : rappels officiels de produits (data.economie.gouv.fr) ----------
// On compare les codes-barres des produits suivis (scannés) aux fiches de rappel publiées.
const RC_DATASETS = ['rappelconso-v2-gtin-trie', 'rappelconso-v2-gtin-espaces'];
const pick = (rec, re) => { for (const [k, v] of Object.entries(rec)) if (re.test(k) && v != null && String(v).trim()) return Array.isArray(v) ? v.join(', ') : String(v); return ''; };
async function rappelsPour(code) {
  for (const ds of RC_DATASETS) {
    const url = `https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/${ds}/records?where=${encodeURIComponent(`search("${code}")`)}&limit=10`;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'EcoCourse (appli familiale)' } });
      if (!r.ok) { console.warn('RappelConso', ds, r.status); continue; }
      const { results = [] } = await r.json();
      return results.filter(rec => JSON.stringify(rec).replace(/\s/g, '').includes(code)).map(rec => ({
        ref: String(pick(rec, /^(id|numero_fiche|reference_fiche|rappel_guid|rappelguid)$/i) || pick(rec, /fiche|guid/i) || code).slice(0, 60),
        title: pick(rec, /^(titre|libelle|nom_de_la_marque_du_produit|noms_des_modeles_ou_references)$/i) || pick(rec, /libelle|titre|modele/i),
        brand: pick(rec, /marque_produit|nom_de_la_marque|marque/i),
        risk: pick(rec, /risques?_encourus|motif_rappel|motif/i),
        advice: pick(rec, /conduites?_a_tenir|conduite/i),
        link: pick(rec, /lien_vers_la_fiche|fiche_rappel/i) || (pick(rec, /lien/i).startsWith('http') ? pick(rec, /lien/i) : ''),
      }));
    } catch (e) { console.warn('RappelConso', ds, e.message); }
  }
  return [];
}
async function verifierRappels(produits) {
  const known = (await db().child('recalls').get()).val() || {};
  const parCode = {};
  produits.filter(p => p && p.code && /^\d{8,14}$/.test(p.code)).forEach(p => { (parCode[p.code] = parCode[p.code] || []).push(p); });
  const nouveaux = [];
  for (const code of Object.keys(parCode)) {
    for (const rc of await rappelsPour(code)) {
      const id = `${code}_${rc.ref}`.replace(/[.#$\/\[\]\s]/g, '_');
      if (known[id]) continue;
      const entry = { id, code, product: parCode[code][0].name, title: rc.title || '', brand: rc.brand || '', risk: rc.risk || '', advice: rc.advice || '', link: rc.link || '', at: Date.now() };
      await db().child(`recalls/${id}`).set(entry); known[id] = entry; nouveaux.push(entry);
    }
  }
  for (const r of nouveaux) await notify(null, 'Rappel produit', `${r.product} fait l'objet d'un rappel officiel. Ne le consommez pas.`, `rappel-${r.id}`);
  return nouveaux.length;
}
// Dès qu'un produit scanné rejoint le frigo
exports.rappelNouveauProduit = onValueCreated(opts('frigo/{id}'), async ev => {
  const f = ev.data.val();
  if (f && f.code) await verifierRappels([f]);
});
// Tous les matins, pour les rappels publiés après l'achat
exports.rappelConsoQuotidien = onSchedule({ schedule: '0 9 * * *', timeZone: 'Europe/Paris', region: REGION }, async () => {
  const frigo = Object.values((await db().child('frigo').get()).val() || {});
  const n = await verifierRappels(frigo);
  console.log(`RappelConso : ${frigo.filter(f => f.code).length} code(s) vérifié(s), ${n} nouveau(x) rappel(s)`);
});

// ---------- Espace Famille (Nabs, Gigi, Maman, Sami, Sonia) ----------
const famOpts = path => ({ ref: `/households/famille/${path}`, instance: INSTANCE, region: REGION });
const FAM = 'famille';
exports.famArticle = onValueWritten(famOpts('items/{id}'), async ev => {
  const before = ev.data.before.val(), after = ev.data.after.val();
  if (!after) return;
  const qty = after.qty > 1 ? `${after.qty}× ` : '';
  if (!before) return notify(after.addedBy, 'Courses de la famille', `${after.addedBy} a ajouté ${qty}${after.name}`, `fadd-${ev.params.id}`, FAM);
  if (after.takenBy && before.takenBy !== after.takenBy) return notify(after.takenBy, 'Courses de la famille', `${after.takenBy} s'occupe de : ${qty}${after.name}`, `ftake-${ev.params.id}`, FAM);
  if (!before.checked && after.checked && after.checkedBy) return notify(after.checkedBy, 'Courses de la famille', `${after.checkedBy} a acheté ${qty}${after.name}`, `fbuy-${ev.params.id}`, FAM);
});
exports.famCommande = onValueWritten(famOpts('status'), async ev => {
  const before = ev.data.before.val(), after = ev.data.after.val();
  if (!after || (before && before.at === after.at)) return;
  return notify(after.by, `Courses chez ${after.store}`, `${after.by} fait les courses. Ajoutez ce qu'il faut maintenant !`, 'fcommande', FAM);
});
const jourFR = (date, slot) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }) + (slot === 'soir' ? ' soir' : ' midi'); };
exports.famRepas = onValueCreated(famOpts('meals/{id}'), async ev => {
  const m = ev.data.val(); if (!m) return;
  return notify(m.by, `Nouveau repas : ${m.title}`, `${jourFR(m.date, m.slot)}${m.place ? ' · ' + m.place : ''}. Dites ce que vous apportez !`, `frepas-${ev.params.id}`, FAM);
});
exports.famPlat = onValueWritten(famOpts('dishes/{id}'), async ev => {
  const before = ev.data.before.val(), after = ev.data.after.val();
  if (!after) return;
  const meal = (await admin.database().ref(`households/famille/meals/${after.meal}`).get()).val() || {};
  const quand = meal.date ? ` (${jourFR(meal.date, meal.slot)})` : '';
  if (after.bringBy && (!before || before.bringBy !== after.bringBy)) return notify(after.bringBy, meal.title || 'Repas de famille', `${after.bringBy} apporte : ${after.name}${quand}`, `fplat-${ev.params.id}`, FAM);
  if (!before && !after.bringBy) return notify(after.by, meal.title || 'Repas de famille', `Qui apporte : ${after.name} ?${quand}`, `fplat-${ev.params.id}`, FAM);
});
