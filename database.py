"""SQLite persistence and schema migrations for KN Nexus Trading OS."""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

ROOT = Path(__file__).resolve().parent
DATABASE_PATH = Path(os.getenv("DATABASE_PATH", ROOT / "data" / "kn_nexus.db"))
DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT UNIQUE NOT NULL,
    username TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'Nexus Trader',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trading_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    account_name TEXT NOT NULL,
    broker TEXT NOT NULL DEFAULT '',
    account_type TEXT NOT NULL DEFAULT 'Réel',
    account_currency TEXT NOT NULL DEFAULT 'USD',
    initial_capital REAL NOT NULL CHECK(initial_capital >= 0),
    current_balance REAL NOT NULL CHECK(current_balance >= 0),
    leverage TEXT NOT NULL DEFAULT '1:100',
    max_daily_drawdown_pct REAL NOT NULL DEFAULT 0 CHECK(max_daily_drawdown_pct >= 0),
    max_total_drawdown_pct REAL NOT NULL DEFAULT 0 CHECK(max_total_drawdown_pct >= 0),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS playbook_setups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    asset_class TEXT NOT NULL DEFAULT 'Multi-actifs',
    timeframe TEXT NOT NULL DEFAULT 'M15',
    rules_checklist TEXT NOT NULL DEFAULT '[]',
    screenshot_path TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trades_journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    setup_id INTEGER,
    setup_title_snapshot TEXT NOT NULL,
    asset_category TEXT NOT NULL DEFAULT 'Multi-actifs',
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('BUY', 'SELL')),
    entry_price REAL,
    stop_loss REAL,
    take_profit REAL,
    lot_size REAL,
    pnl REAL NOT NULL DEFAULT 0,
    commission REAL NOT NULL DEFAULT 0,
    swap REAL NOT NULL DEFAULT 0,
    review_notes TEXT NOT NULL DEFAULT '',
    ai_compliance_score REAL,
    screenshot_before TEXT,
    screenshot_after TEXT,
    opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(account_id) REFERENCES trading_accounts(id) ON DELETE CASCADE,
    FOREIGN KEY(setup_id) REFERENCES playbook_setups(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS macro_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT UNIQUE,
    event_time TEXT NOT NULL,
    country TEXT NOT NULL,
    currency TEXT NOT NULL,
    event_name TEXT NOT NULL,
    impact_level TEXT NOT NULL CHECK(impact_level IN ('LOW', 'MEDIUM', 'HIGH')),
    previous_value TEXT,
    forecast_value TEXT,
    actual_value TEXT,
    ai_summary TEXT,
    source TEXT NOT NULL DEFAULT 'DEMO',
    is_live INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS news_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT UNIQUE,
    published_at TEXT NOT NULL,
    source TEXT NOT NULL,
    headline TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    url TEXT,
    currencies TEXT NOT NULL DEFAULT '[]',
    is_live INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS market_regimes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    period TEXT NOT NULL CHECK(period IN ('daily', 'weekly')),
    label TEXT NOT NULL,
    regime TEXT NOT NULL,
    tone TEXT NOT NULL DEFAULT 'neutral',
    strength REAL NOT NULL CHECK(strength BETWEEN 0 AND 100),
    macro_reason TEXT NOT NULL,
    technical_reason TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'DEMO',
    generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(symbol, period)
);

CREATE INDEX IF NOT EXISTS idx_accounts_user ON trading_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_setups_user ON playbook_setups(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_user_time ON trades_journal(user_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_account ON trades_journal(account_id);
CREATE INDEX IF NOT EXISTS idx_macro_time ON macro_events(event_time);
CREATE INDEX IF NOT EXISTS idx_news_time ON news_items(published_at DESC);
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DATABASE_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


@contextmanager
def db_session() -> Iterator[sqlite3.Connection]:
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def initialize_database() -> None:
    with db_session() as conn:
        conn.executescript(SCHEMA)
        _seed_market_context(conn)


def _seed_market_context(conn: sqlite3.Connection) -> None:
    """Visible demo data only; external connectors can replace these rows."""
    if conn.execute("SELECT COUNT(*) FROM macro_events").fetchone()[0] == 0:
        conn.executemany(
            """INSERT INTO macro_events (event_time,country,currency,event_name,impact_level,previous_value,forecast_value,actual_value,ai_summary,source,is_live)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            [
                ("2026-10-11T12:30:00Z", "United States", "USD", "Core CPI m/m", "HIGH", "0.3%", "0.3%", None, "En attente d'une publication connectée à un fournisseur réel.", "DEMO", 0),
                ("2026-10-11T14:00:00Z", "United States", "USD", "U. Michigan Sentiment", "MEDIUM", "68.2", "68.5", None, "La surprise par rapport au consensus influencera les actifs à risque.", "DEMO", 0),
                ("2026-10-11T18:00:00Z", "United States", "USD", "FOMC Member Speech", "HIGH", None, None, None, "Évaluer le ton monétaire une fois le discours disponible.", "DEMO", 0),
            ],
        )
    if conn.execute("SELECT COUNT(*) FROM news_items").fetchone()[0] == 0:
        conn.executemany(
            "INSERT INTO news_items (published_at,source,headline,summary,currencies,is_live) VALUES (?,?,?,?,?,?)",
            [
                ("2026-10-11T09:20:00Z", "KN Nexus Demo", "Flux macro en attente de connexion API", "Configurez NEWS_API_URL et NEWS_API_KEY pour alimenter les informations publiées par un fournisseur autorisé.", '["USD"]', 0),
                ("2026-10-11T08:45:00Z", "KN Nexus Demo", "Les régimes affichent un statut de démonstration", "Les analyses deviennent live lorsque le connecteur macro et les prix sont renseignés.", '["USD","XAU"]', 0),
            ],
        )
    if conn.execute("SELECT COUNT(*) FROM market_regimes").fetchone()[0] == 0:
        rows = [
            ("DXY","daily","Dollar américain","Expansion haussière","bull",72,"Données US à venir : prime de volatilité et positionnement défensif.","Structure HH/HL ; prix au-dessus des moyennes 20 et 50 périodes."),
            ("EURUSD","daily","Euro / Dollar","Pression baissière modérée","caution",63,"Écart de dynamique Europe / États-Unis favorable au dollar dans le scénario de démonstration.","Sous la résistance intraday ; succession de sommets descendants."),
            ("GBPUSD","daily","Livre / Dollar","Range volatil","neutral",53,"Sensibilité aux données britanniques et au dollar américain.","Prix entre les bornes intraday ; attendre une clôture de cassure."),
            ("USDJPY","daily","Dollar / Yen","Expansion haussière","bull",70,"Différentiel de taux et risque d’intervention restent clés.","Sommets ascendants ; momentum acheteur confirmé au-dessus du support journalier."),
            ("XAUUSD","daily","Or spot","Tendance haussière contrôlée","bull",76,"Sensibilité aux surprises inflation et taux réels.","Prix au-dessus de la zone technique de référence ; impulsions acheteuses conservées."),
            ("NAS100","daily","Nasdaq 100","Compression neutre","neutral",48,"Attente des données US : réduction du risque directionnel.","Range intraday intact ; aucune cassure H1 confirmée."),
            ("US30","daily","Dow Jones 30","Haussier prudent","neutral",57,"Croissance et réaction aux données US guident le sentiment cyclique.","Structure positive mais proche d’une résistance journalière."),
            ("BTCUSD","daily","Bitcoin","Risque-on modéré","bull",61,"Appétit spéculatif sensible au dollar et aux rendements.","Supports préservés ; volume de confirmation attendu."),
            ("USOIL","daily","WTI / Pétrole","Range directionnel","neutral",54,"Sensibilité aux titres d’offre et de demande mondiale.","Oscillation entre support et résistance ; sortie du range attendue."),
        ]
        weekly = [(symbol, "weekly", label, regime, tone, max(45, min(85, strength + (6 if tone == "bull" else -2))), macro, technical) for symbol, _, label, regime, tone, strength, macro, technical in rows]
        conn.executemany(
            """INSERT INTO market_regimes (symbol,period,label,regime,tone,strength,macro_reason,technical_reason)
            VALUES (?,?,?,?,?,?,?,?)""", rows + weekly
        )
