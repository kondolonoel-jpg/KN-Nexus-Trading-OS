# Déploiement GitHub → Render

## 1. Préparer le dépôt GitHub

1. Créez un dépôt privé, par exemple `kn-nexus-trading-os`.
2. Dans ce dossier local :

```bash
git remote add origin https://github.com/VOTRE_COMPTE/kn-nexus-trading-os.git
git branch -M main
git push -u origin main
```

Ne poussez jamais `.env`, la base SQLite locale ou les captures dans Git. Le fichier `.gitignore` les exclut déjà.

## 2. Déployer via Render

1. Dans Render, choisissez **New → Blueprint**.
2. Connectez votre compte GitHub puis sélectionnez le dépôt.
3. Render détecte `render.yaml` à la racine.
4. Vérifiez le Web Service `kn-nexus-trading-os`.
5. Vérifiez que le disque persistant `kn-nexus-persistent-data` est monté sur `/var/data`.
6. Créez le service. Les futurs `git push` vers `main` déclenchent un déploiement automatique.

Le health check est :

```text
/api/health
```

## 3. Variables d'environnement

Render crée `SECRET_KEY` automatiquement grâce au Blueprint. Pour activer les flux live, ajoutez dans **Environment** les clés du fournisseur de données sous licence :

```text
MARKET_DATA_API_URL=
MARKET_DATA_API_KEY=
ECONOMIC_CALENDAR_API_URL=
ECONOMIC_CALENDAR_API_KEY=
NEWS_API_URL=
NEWS_API_KEY=
AI_PROVIDER_API_KEY=
```

Sans ces valeurs, l’interface et l’API restent fonctionnelles avec des données clairement marquées `DEMO`.

## 4. Points importants pour SQLite

- Gardez **une seule instance** du Web Service avec SQLite.
- Le disque persistant est indispensable : sans lui, comptes, journal et images seront perdus au prochain déploiement.
- Les sauvegardes régulières du disque restent recommandées.
- Si le produit passe à plusieurs instances ou à un trafic élevé, migrez vers PostgreSQL et un stockage objet d’images.
