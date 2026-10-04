# Les Artistes — App mobile (Expo / React Native)

App mobile du site privé `les--artistes.fr`. Backend Supabase **partagé avec le site web** (même URL, mêmes tables, mêmes RLS).

## Stack

- **Expo SDK 54** (Managed) + React Native 0.81
- **Expo Router** (file-based routing dans `app/`)
- **TypeScript**
- **Supabase JS v2** + AsyncStorage pour persister la session
- **expo-image-picker** pour les uploads photos

## Lancer en local

```bash
cd mobile
npm install        # une seule fois
npx expo start     # démarre Metro Bundler + affiche le QR code
```

**Tester sur ton téléphone** :
1. Installer **Expo Go** depuis l'App Store (iOS) ou Play Store (Android).
2. Scanner le QR code affiché dans le terminal (iOS : appareil photo natif ; Android : depuis l'app Expo Go).
3. L'app se charge en ~10 sec.

> Si le QR ne marche pas (réseau d'entreprise, wifi capricieux), relance avec `npx expo start --tunnel` (la première fois Expo te demandera d'installer ngrok globalement, accepte).

## Structure

```
mobile/
  app/
    _layout.tsx              → root, gate auth + déclaration des routes Stack racines
    (auth)/
      _layout.tsx            → stack pour les écrans d'auth
      login.tsx              → connexion + inscription (mot de passe groupe : "tortue")
    (tabs)/
      _layout.tsx            → tab bar (Événements / Actu / Photos / Jeux / Plus)
      events.tsx             → liste events + détail + création/édition + vote + comments
      news.tsx               → feed actualités + détail + like + comments
      photos.tsx             → grille + viewer + upload + édition (caption/date/suppr)
      jeux.tsx               → sub-tabs Alcool/Société + votes étoiles
      plus.tsx               → menu vers les écrans secondaires
    notes.tsx                → mur de notes + réactions emoji + suppression
    annuaire.tsx             → liste contacts + édition de son profil (adresses, RIB)
    shop.tsx                 → articles + commande (tailles, qty, perso) + deadline
    sondage.tsx              → candidats par catégorie + votes (avec quota)
    profil.tsx               → infos utilisateur + déconnexion
  lib/
    supabase.ts              → client Supabase + tous les types des tables
    theme.ts                 → palette couleurs + tokens
```

## Périmètre

**Tout le site web est porté** :

| Feature web | Écran mobile | Notes |
|---|---|---|
| Auth (login + signup + reset) | `(auth)/login` | Email ou pseudo, mot de passe groupe |
| Événements | `(tabs)/events` | Création, édition, suppression (owner), vote présence, commentaires |
| Actualités | `(tabs)/news` | Like, commentaires. Le contenu HTML est strippé pour affichage texte propre. |
| Photos | `(tabs)/photos` | Upload depuis pellicule, caption (iOS), édition, suppression (owner) — upload **atomique** avec rollback |
| Jeux | `(tabs)/jeux` | Sub-tabs Alcool/Société, votes étoiles 1-5 sur jeux de société |
| Boutique | `shop` | Choix tailles + quantités + perso, deadline visible, "écrase tes commandes précédentes" |
| Sondage candidats | `sondage` | Vote par catégorie, quota `sondage_votes_max_by_cat`, deadline |
| Annuaire | `annuaire` | Lecture des contacts + édition de son propre profil (adresses multiples + RIB) |
| Notes | `notes` | Compose + feed + 8 emojis de réaction (toggle, pas de spam) |
| Profil | `profil` | Infos perso + déconnexion |

**Non porté (volontairement)** :
- Création/édition de news (rich text HTML — gros chantier sur mobile)
- Création/édition de jeux (à faire depuis le web pour l'instant)
- Création/édition d'articles boutique et candidats sondage (admin only)
- `event_food_votes` et `event_courses_votes` (sous-features events spécifiques)
- Création/édition de photos en bulk

Ces points peuvent être ajoutés en itération suivante si besoin.

## À configurer côté Supabase pour la prod

1. **Deeplink reset password** : actuellement `resetPasswordForEmail()` redirige vers le site web. Pour gérer le reset depuis l'app, configurer un schéma URL custom (`lesartistes://reset-password`) et l'ajouter dans `app.json` :
   ```json
   { "expo": { "scheme": "lesartistes" } }
   ```
2. **Confirmation email** : si l'option "Confirm email" est activée dans Supabase Auth, le lien de confirmation pointe vers l'URL configurée dans `Authentication > URL Configuration`. Ajouter le scheme custom comme redirect autorisé.

## Déploiement

Pour distribuer sans passer par les stores :
- **Expo Go** : partager une URL Expo (publication via `eas update`).
- **TestFlight (iOS) / Internal Testing (Android)** : nécessite un compte Apple Developer + Google Play Console + `eas build`.

Tant qu'on reste en Expo Go, on itère vite et on peut partager des URLs `exp://...` aux beta-testeurs.

## Notes

- **Fonts** : pour le MVP on utilise les fonts système (`Georgia` pour les titres). Pour avoir Playfair Display + DM Sans comme sur le web, ajouter `expo-font` + `useFonts(...)` dans `app/_layout.tsx`.
- **Mot de passe groupe** : hardcodé en clair dans `app/(auth)/login.tsx` comme sur le web (`'tortue'`). Voir `../AUDIT.md` pour le contexte de sécurité.
- **Upload atomique** : `photos.tsx` rollback le fichier du bucket si l'insert DB échoue — corrige le bug C6 détecté dans `../AUDIT.md`.
