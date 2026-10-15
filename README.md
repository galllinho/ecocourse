# EcoCourse

Liste de courses partagée, frigo avec DLC et budget des commandes drive, pour Nabs et Gigi.

- `src/app.html` : l'application
- `src/config.js` : configuration Firebase
- `firebase/database.rules.json` : règles de sécurité de la base
- `.github/workflows/build.yml` : construit l'APK (onglet Releases) et la version de test (GitHub Pages) à chaque mise à jour

## Lien avec AnounisFitness

Les deux applis partagent le projet Firebase `ecocourse-6abb0`.

- **EcoCourse lit** `fitness/couple/{profil}` (publié par AnounisFitness) : `name`, `objectif` (`perte`, `recompo`, `muscle`, `forme`) et `last` (dernière séance). L'onglet Recettes › Healthy s'adapte à l'objectif.
- **AnounisFitness peut ajouter des courses** en écrivant dans `households/main/items/{id}` :
  `{ id, name, qty, store: "", rayon: "au", addedBy: "Nabs" | "Gigi", addedAt: Date.now(), checked: false }`.
  L'article apparaît aussitôt dans EcoCourse et l'autre personne reçoit la notification « … a ajouté … ».

## Déployer les fonctions serveur et les règles

Dans Cloud Shell :

```
cd ~/ecocourse && git pull && cd functions && npm install && cd ..
npx -y firebase-tools@13 deploy --only functions,database --project ecocourse-6abb0
```
