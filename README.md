# KN Nexus Trading OS

Station de travail multi-actifs : comptes, calcul de risque, playbook personnel, journal, captures, statistiques PnL, contexte macro et régimes de marché.

## Démarrer localement

```bash
cd kn-nexus-frontend
cp .env.example .env
python -m pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Ouvrir ensuite `http://localhost:8000`.

## Sécurité et persistance

- Authentification API : bcrypt + cookie JWT `HttpOnly`.
- Données isolées par utilisateur pour les comptes, setups et trades.
- SQLite en mode WAL.
- Upload JPEG / PNG / WebP validé, limité à 8 Mo et rattaché à un trade.
- Pour Render, monter un disque persistant et régler `DATABASE_PATH=/var/data/kn_nexus.db`, `UPLOADS_DIR=/var/data/uploads` et `COOKIE_SECURE=true`.

## Pages frontend

- `landing.html` — présentation
- `register.html`, `login.html`, `profile.html` — identité et sécurité
- `dashboard.html` — cockpit
- `accounts.html` — comptes et limites prop firm
- `calculator.html` — risque multi-actifs
- `playbook.html` — setups créés par le trader
- `journal.html` — trades, captures, PnL cumulé et performance par setup
- `macro_news.html` — calendrier, news et régimes de marché

## Principaux endpoints API

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET|POST /api/accounts`, `PATCH|DELETE /api/accounts/{id}`
- `GET|POST /api/setups`, `PATCH|DELETE /api/setups/{id}`
- `GET|POST /api/trades`, `PATCH|DELETE /api/trades/{id}`
- `POST /api/trades/{id}/screenshots?kind=before|after`
- `GET /api/analytics/journal`
- `GET /api/macro/events`, `/api/macro/news`, `/api/macro/regimes`
- `GET /api/market/status`, `GET /api/health`

## Données de marché live

Sans fournisseur de données sous licence configuré, les événements, news et régimes sont explicitement marqués `DEMO` : aucune donnée de démonstration n’est présentée comme une cotation réelle.

Renseigner les variables facultatives de `.env` avec les endpoints et clés du fournisseur choisi. Le fichier `services/market_data.py` est le point d’extension prévu pour mapper le format du fournisseur autorisé.

## GitHub et Render

Le projet est prêt à être versionné dans Git. Les fichiers sensibles, la base locale et les captures sont exclus par `.gitignore`. Le Blueprint Render est dans `render.yaml` et le guide complet est dans [DEPLOYMENT.md](DEPLOYMENT.md).

```bash
make install
make check
make run
```
