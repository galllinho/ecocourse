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
async function notify(exceptUser, title, body, tag) {
  const snap = await db().child('tokens').get();
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
  if (Object.keys(dead).length) await db().update(dead);
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
