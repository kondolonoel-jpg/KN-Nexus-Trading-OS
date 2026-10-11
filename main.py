from __future__ import annotations

import json
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Annotated

import jwt
from dotenv import load_dotenv
from fastapi import (
    Cookie,
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from passlib.context import CryptContext

from database import DATABASE_PATH, db_session, initialize_database
from models import (
    AccountCreate,
    AccountUpdate,
    LoginRequest,
    PasswordUpdate,
    ProfileUpdate,
    RegisterRequest,
    SetupCreate,
    SetupUpdate,
    TradeCreate,
    TradeUpdate,
)
from services.market_data import fetch_json, quote_snapshot

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-change-me-before-deploying")
ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = int(os.getenv("TOKEN_EXPIRE_MINUTES", "10080"))
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
UPLOADS_DIR = Path(os.getenv("UPLOADS_DIR", ROOT / "static" / "uploads"))
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
app = FastAPI(title="KN Nexus Trading OS API", version="1.0.0")
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")


@app.on_event("startup")
def startup() -> None:
    initialize_database()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def dict_row(row: Any | None) -> dict[str, Any] | None:
    return dict(row) if row else None


def create_token(user: dict[str, Any]) -> str:
    expiry = datetime.now(timezone.utc) + timedelta(minutes=TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": str(user["id"]), "pid": user["public_id"], "exp": expiry}, SECRET_KEY, algorithm=ALGORITHM)


def set_auth_cookie(response: Response, user: dict[str, Any]) -> None:
    response.set_cookie(
        key="kn_nexus_session",
        value=create_token(user),
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )


def public_user(row: dict[str, Any]) -> dict[str, Any]:
    return {"id": row["public_id"], "username": row["username"], "email": row["email"], "plan": row["plan"], "created_at": row["created_at"]}


def get_current_user(session: Annotated[str | None, Cookie(alias="kn_nexus_session")] = None) -> dict[str, Any]:
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentification requise")
    try:
        payload = jwt.decode(session, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session invalide")
    with db_session() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utilisateur introuvable")
    return dict(row)


CurrentUser = Annotated[dict[str, Any], Depends(get_current_user)]


def owned_account(conn: Any, account_id: int, user_id: int) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM trading_accounts WHERE id = ? AND user_id = ?", (account_id, user_id)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    return dict(row)


def owned_setup(conn: Any, setup_id: int, user_id: int) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM playbook_setups WHERE id = ? AND user_id = ?", (setup_id, user_id)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Setup introuvable")
    return dict(row)


def trade_payload(row: dict[str, Any]) -> dict[str, Any]:
    payload = dict(row)
    if payload.get("rules_checklist"):
        try:
            payload["rules"] = json.loads(payload.pop("rules_checklist"))
        except json.JSONDecodeError:
            payload["rules"] = []
    return payload


def account_payload(row: dict[str, Any]) -> dict[str, Any]:
    data = dict(row)
    initial = float(data["initial_capital"])
    balance = float(data["current_balance"])
    total_dd = max(0, (initial - balance) / initial * 100) if initial else 0
    data["risk_status"] = {
        "total_drawdown_pct": round(total_dd, 2),
        "total_drawdown_remaining_pct": round(max(0, float(data["max_total_drawdown_pct"]) - total_dd), 2) if data["max_total_drawdown_pct"] else None,
    }
    data["is_active"] = bool(data["is_active"])
    return data


# --- Authentication and profile -------------------------------------------------
@app.post("/api/auth/register", status_code=201)
def register(payload: RegisterRequest, response: Response) -> dict[str, Any]:
    email = str(payload.email).lower().strip()
    with db_session() as conn:
        existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="Cette adresse e-mail est déjà utilisée")
        public_id = f"KN-{secrets.token_hex(4).upper()}"
        conn.execute(
            "INSERT INTO users (public_id,username,email,password_hash) VALUES (?,?,?,?)",
            (public_id, payload.username, email, pwd_context.hash(payload.password)),
        )
        row = dict(conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone())
    set_auth_cookie(response, row)
    return public_user(row)


@app.post("/api/auth/login")
def login(payload: LoginRequest, response: Response) -> dict[str, Any]:
    with db_session() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (str(payload.email).lower().strip(),)).fetchone()
    if not row or not pwd_context.verify(payload.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="E-mail ou mot de passe incorrect")
    user = dict(row)
    set_auth_cookie(response, user)
    return public_user(user)


@app.post("/api/auth/logout", status_code=204)
def logout(response: Response) -> Response:
    response.delete_cookie("kn_nexus_session", path="/")
    return response


@app.get("/api/auth/me")
def me(user: CurrentUser) -> dict[str, Any]:
    return public_user(user)


@app.patch("/api/auth/profile")
def update_profile(payload: ProfileUpdate, user: CurrentUser) -> dict[str, Any]:
    email = str(payload.email).lower().strip()
    with db_session() as conn:
        duplicate = conn.execute("SELECT id FROM users WHERE email = ? AND id != ?", (email, user["id"])).fetchone()
        if duplicate:
            raise HTTPException(status_code=409, detail="Cette adresse e-mail est déjà utilisée")
        conn.execute("UPDATE users SET username = ?, email = ?, updated_at = ? WHERE id = ?", (payload.username, email, utc_now(), user["id"]))
        row = dict(conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone())
    return public_user(row)


@app.patch("/api/auth/password", status_code=204)
def update_password(payload: PasswordUpdate, user: CurrentUser) -> Response:
    if not pwd_context.verify(payload.current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Mot de passe actuel incorrect")
    with db_session() as conn:
        conn.execute("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", (pwd_context.hash(payload.new_password), utc_now(), user["id"]))
    return Response(status_code=204)


# --- Accounts ------------------------------------------------------------------
@app.get("/api/accounts")
def list_accounts(user: CurrentUser) -> list[dict[str, Any]]:
    with db_session() as conn:
        rows = conn.execute("SELECT * FROM trading_accounts WHERE user_id = ? ORDER BY is_active DESC, created_at DESC", (user["id"],)).fetchall()
    return [account_payload(dict(row)) for row in rows]


@app.post("/api/accounts", status_code=201)
def create_account(payload: AccountCreate, user: CurrentUser) -> dict[str, Any]:
    values = payload.model_dump()
    with db_session() as conn:
        cursor = conn.execute(
            """INSERT INTO trading_accounts (user_id,account_name,broker,account_type,account_currency,initial_capital,current_balance,leverage,max_daily_drawdown_pct,max_total_drawdown_pct,is_active)
            VALUES (:user_id,:account_name,:broker,:account_type,:account_currency,:initial_capital,:current_balance,:leverage,:max_daily_drawdown_pct,:max_total_drawdown_pct,:is_active)""",
            {**values, "user_id": user["id"], "is_active": int(values["is_active"])},
        )
        row = dict(conn.execute("SELECT * FROM trading_accounts WHERE id = ?", (cursor.lastrowid,)).fetchone())
    return account_payload(row)


@app.patch("/api/accounts/{account_id}")
def update_account(account_id: int, payload: AccountUpdate, user: CurrentUser) -> dict[str, Any]:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Aucune modification fournie")
    if "is_active" in updates:
        updates["is_active"] = int(updates["is_active"])
    updates["updated_at"] = utc_now()
    with db_session() as conn:
        owned_account(conn, account_id, user["id"])
        columns = ", ".join(f"{column} = :{column}" for column in updates)
        conn.execute(f"UPDATE trading_accounts SET {columns} WHERE id = :id", {**updates, "id": account_id})
        row = dict(conn.execute("SELECT * FROM trading_accounts WHERE id = ?", (account_id,)).fetchone())
    return account_payload(row)


@app.delete("/api/accounts/{account_id}", status_code=204)
def delete_account(account_id: int, user: CurrentUser) -> Response:
    with db_session() as conn:
        owned_account(conn, account_id, user["id"])
        conn.execute("DELETE FROM trading_accounts WHERE id = ?", (account_id,))
    return Response(status_code=204)


# --- Playbook ------------------------------------------------------------------
@app.get("/api/setups")
def list_setups(user: CurrentUser) -> list[dict[str, Any]]:
    with db_session() as conn:
        rows = conn.execute("SELECT * FROM playbook_setups WHERE user_id = ? ORDER BY created_at DESC", (user["id"],)).fetchall()
    return [trade_payload(dict(row)) for row in rows]


@app.post("/api/setups", status_code=201)
def create_setup(payload: SetupCreate, user: CurrentUser) -> dict[str, Any]:
    with db_session() as conn:
        cursor = conn.execute(
            "INSERT INTO playbook_setups (user_id,title,asset_class,timeframe,rules_checklist) VALUES (?,?,?,?,?)",
            (user["id"], payload.title, payload.asset_class, payload.timeframe, json.dumps(payload.rules)),
        )
        row = dict(conn.execute("SELECT * FROM playbook_setups WHERE id = ?", (cursor.lastrowid,)).fetchone())
    return trade_payload(row)


@app.patch("/api/setups/{setup_id}")
def update_setup(setup_id: int, payload: SetupUpdate, user: CurrentUser) -> dict[str, Any]:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Aucune modification fournie")
    if "rules" in updates:
        updates["rules_checklist"] = json.dumps(updates.pop("rules"))
    updates["updated_at"] = utc_now()
    with db_session() as conn:
        owned_setup(conn, setup_id, user["id"])
        columns = ", ".join(f"{column} = :{column}" for column in updates)
        conn.execute(f"UPDATE playbook_setups SET {columns} WHERE id = :id", {**updates, "id": setup_id})
        row = dict(conn.execute("SELECT * FROM playbook_setups WHERE id = ?", (setup_id,)).fetchone())
    return trade_payload(row)


@app.delete("/api/setups/{setup_id}", status_code=204)
def delete_setup(setup_id: int, user: CurrentUser) -> Response:
    with db_session() as conn:
        owned_setup(conn, setup_id, user["id"])
        conn.execute("DELETE FROM playbook_setups WHERE id = ?", (setup_id,))
    return Response(status_code=204)


# --- Journal and screenshots ---------------------------------------------------
def validate_trade_context(conn: Any, payload: TradeCreate | TradeUpdate, user: dict[str, Any], existing: dict[str, Any] | None = None) -> tuple[dict[str, Any], dict[str, Any] | None]:
    account_id = getattr(payload, "account_id", None) or (existing["account_id"] if existing else None)
    account = owned_account(conn, int(account_id), user["id"])
    setup_id = getattr(payload, "setup_id", None)
    if setup_id is None and existing:
        setup_id = existing.get("setup_id")
    setup = owned_setup(conn, int(setup_id), user["id"]) if setup_id else None
    return account, setup


@app.get("/api/trades")
def list_trades(user: CurrentUser, account_id: int | None = None, setup_id: int | None = None) -> list[dict[str, Any]]:
    where = ["t.user_id = ?"]
    params: list[Any] = [user["id"]]
    if account_id:
        where.append("t.account_id = ?")
        params.append(account_id)
    if setup_id:
        where.append("t.setup_id = ?")
        params.append(setup_id)
    with db_session() as conn:
        rows = conn.execute(
            f"""SELECT t.*, a.account_name, s.title AS setup_title
            FROM trades_journal t JOIN trading_accounts a ON a.id=t.account_id
            LEFT JOIN playbook_setups s ON s.id=t.setup_id
            WHERE {' AND '.join(where)} ORDER BY t.opened_at DESC""", params
        ).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/trades", status_code=201)
def create_trade(payload: TradeCreate, user: CurrentUser) -> dict[str, Any]:
    with db_session() as conn:
        account, setup = validate_trade_context(conn, payload, user)
        setup_title = setup["title"] if setup else (payload.setup_title_snapshot or "Trade manuel")
        cursor = conn.execute(
            """INSERT INTO trades_journal (user_id,account_id,setup_id,setup_title_snapshot,asset_category,symbol,direction,entry_price,stop_loss,take_profit,lot_size,pnl,commission,swap,review_notes,opened_at,closed_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (user["id"], account["id"], setup["id"] if setup else None, setup_title, payload.asset_category, payload.symbol.upper(), payload.direction,
             payload.entry_price, payload.stop_loss, payload.take_profit, payload.lot_size, payload.pnl, payload.commission, payload.swap,
             payload.review_notes, iso(payload.opened_at) or utc_now(), iso(payload.closed_at)),
        )
        row = dict(conn.execute("SELECT t.*, a.account_name FROM trades_journal t JOIN trading_accounts a ON a.id=t.account_id WHERE t.id = ?", (cursor.lastrowid,)).fetchone())
    return row


@app.patch("/api/trades/{trade_id}")
def update_trade(trade_id: int, payload: TradeUpdate, user: CurrentUser) -> dict[str, Any]:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Aucune modification fournie")
    for date_field in ("opened_at", "closed_at"):
        if date_field in updates:
            updates[date_field] = iso(updates[date_field])
    if "symbol" in updates:
        updates["symbol"] = updates["symbol"].upper()
    updates["updated_at"] = utc_now()
    with db_session() as conn:
        old = conn.execute("SELECT * FROM trades_journal WHERE id = ? AND user_id = ?", (trade_id, user["id"])).fetchone()
        if not old:
            raise HTTPException(status_code=404, detail="Trade introuvable")
        old_data = dict(old)
        if "setup_id" in updates and updates["setup_id"]:
            setup = owned_setup(conn, int(updates["setup_id"]), user["id"])
            updates["setup_title_snapshot"] = setup["title"]
        columns = ", ".join(f"{column} = :{column}" for column in updates)
        conn.execute(f"UPDATE trades_journal SET {columns} WHERE id = :id", {**updates, "id": trade_id})
        row = dict(conn.execute("SELECT t.*, a.account_name FROM trades_journal t JOIN trading_accounts a ON a.id=t.account_id WHERE t.id = ?", (trade_id,)).fetchone())
    return row


@app.delete("/api/trades/{trade_id}", status_code=204)
def delete_trade(trade_id: int, user: CurrentUser) -> Response:
    with db_session() as conn:
        result = conn.execute("DELETE FROM trades_journal WHERE id = ? AND user_id = ?", (trade_id, user["id"]))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Trade introuvable")
    return Response(status_code=204)


ALLOWED_IMAGES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def valid_magic(content: bytes, content_type: str) -> bool:
    if content_type == "image/jpeg": return content.startswith(b"\xff\xd8\xff")
    if content_type == "image/png": return content.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/webp": return content[:4] == b"RIFF" and content[8:12] == b"WEBP"
    return False


@app.post("/api/trades/{trade_id}/screenshots")
async def upload_screenshot(trade_id: int, user: CurrentUser, kind: Annotated[str, Query(pattern="^(before|after)$")], file: UploadFile = File(...)) -> dict[str, str]:
    if file.content_type not in ALLOWED_IMAGES:
        raise HTTPException(status_code=415, detail="Formats autorisés : JPEG, PNG et WebP")
    content = await file.read(8 * 1024 * 1024 + 1)
    if len(content) > 8 * 1024 * 1024 or not valid_magic(content, file.content_type):
        raise HTTPException(status_code=400, detail="Image invalide ou supérieure à 8 Mo")
    user_dir = UPLOADS_DIR / str(user["id"])
    user_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ALLOWED_IMAGES[file.content_type]}"
    (user_dir / filename).write_bytes(content)
    relative = f"/uploads/{user['id']}/{filename}"
    field = "screenshot_before" if kind == "before" else "screenshot_after"
    with db_session() as conn:
        trade = conn.execute("SELECT id FROM trades_journal WHERE id = ? AND user_id = ?", (trade_id, user["id"])).fetchone()
        if not trade:
            raise HTTPException(status_code=404, detail="Trade introuvable")
        conn.execute(f"UPDATE trades_journal SET {field} = ?, updated_at = ? WHERE id = ?", (relative, utc_now(), trade_id))
    return {"path": relative, "kind": kind}


# --- Analytics -----------------------------------------------------------------
@app.get("/api/analytics/journal")
def journal_analytics(user: CurrentUser, account_id: int | None = None) -> dict[str, Any]:
    where = "WHERE user_id = ?" + (" AND account_id = ?" if account_id else "")
    params: tuple[Any, ...] = (user["id"], account_id) if account_id else (user["id"],)
    with db_session() as conn:
        rows = [dict(row) for row in conn.execute(f"SELECT * FROM trades_journal {where} ORDER BY opened_at ASC", params).fetchall()]
    net = [float(row["pnl"] or 0) - float(row["commission"] or 0) + float(row["swap"] or 0) for row in rows]
    wins = [value for value in net if value > 0]
    losses = [value for value in net if value < 0]
    gross_profit, gross_loss = sum(wins), abs(sum(losses))
    cumulative, curve, peak, max_drawdown = 0.0, [], 0.0, 0.0
    per_setup: dict[str, dict[str, Any]] = {}
    for row, result in zip(rows, net):
        cumulative += result
        peak = max(peak, cumulative)
        max_drawdown = max(max_drawdown, peak - cumulative)
        curve.append({"time": row["opened_at"], "pnl": round(result, 2), "cumulative_pnl": round(cumulative, 2), "trade_id": row["id"]})
        key = str(row["setup_id"] or row["setup_title_snapshot"])
        summary = per_setup.setdefault(key, {"setup_id": row["setup_id"], "title": row["setup_title_snapshot"], "trades": 0, "wins": 0, "losses": 0, "pnl": 0.0, "rr_sum": 0.0})
        summary["trades"] += 1; summary["pnl"] += result
        if result > 0: summary["wins"] += 1
        elif result < 0: summary["losses"] += 1
        if row["entry_price"] is not None and row["stop_loss"] is not None and row["take_profit"] is not None:
            risk = abs(float(row["entry_price"]) - float(row["stop_loss"]))
            reward = abs(float(row["take_profit"]) - float(row["entry_price"]))
            summary["rr_sum"] += reward / risk if risk else 0
    setup_stats = []
    for item in per_setup.values():
        item["win_rate"] = round(item["wins"] / item["trades"] * 100, 2) if item["trades"] else 0
        item["average_rr"] = round(item["rr_sum"] / item["trades"], 2) if item["trades"] else 0
        item["pnl"] = round(item["pnl"], 2)
        setup_stats.append(item)
    return {
        "summary": {
            "trades": len(rows), "wins": len(wins), "losses": len(losses), "net_pnl": round(sum(net), 2),
            "win_rate": round(len(wins) / len(rows) * 100, 2) if rows else 0,
            "profit_factor": round(gross_profit / gross_loss, 2) if gross_loss else (None if not gross_profit else float("inf")),
            "expectancy": round(sum(net) / len(rows), 2) if rows else 0,
            "average_win": round(gross_profit / len(wins), 2) if wins else 0,
            "average_loss": round(sum(losses) / len(losses), 2) if losses else 0,
            "max_drawdown": round(max_drawdown, 2),
        },
        "pnl_curve": curve,
        "setup_performance": sorted(setup_stats, key=lambda item: item["pnl"], reverse=True),
    }


# --- Market context -------------------------------------------------------------
@app.get("/api/market/status")
def market_status() -> dict[str, Any]:
    return quote_snapshot()


@app.get("/api/macro/events")
def macro_events(impact: str | None = None, currency: str | None = None) -> list[dict[str, Any]]:
    filters, params = [], []
    if impact: filters.append("impact_level = ?"); params.append(impact.upper())
    if currency: filters.append("currency = ?"); params.append(currency.upper())
    where = f"WHERE {' AND '.join(filters)}" if filters else ""
    with db_session() as conn:
        rows = conn.execute(f"SELECT * FROM macro_events {where} ORDER BY event_time ASC", params).fetchall()
    return [dict(row) for row in rows]


@app.get("/api/macro/news")
def macro_news() -> list[dict[str, Any]]:
    with db_session() as conn:
        rows = conn.execute("SELECT * FROM news_items ORDER BY published_at DESC LIMIT 50").fetchall()
    return [dict(row) for row in rows]


@app.get("/api/macro/regimes")
def macro_regimes(period: str = Query("daily", pattern="^(daily|weekly)$"), symbol: str | None = None) -> list[dict[str, Any]]:
    with db_session() as conn:
        if symbol:
            rows = conn.execute("SELECT * FROM market_regimes WHERE period = ? AND symbol = ? ORDER BY symbol", (period, symbol.upper())).fetchall()
        else:
            rows = conn.execute("SELECT * FROM market_regimes WHERE period = ? ORDER BY symbol", (period,)).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/macro/refresh")
def refresh_macro(user: CurrentUser) -> dict[str, Any]:
    """Trigger point for an approved/licensed provider; no unlicensed scraping."""
    events = fetch_json("ECONOMIC_CALENDAR_API_URL", "ECONOMIC_CALENDAR_API_KEY")
    news = fetch_json("NEWS_API_URL", "NEWS_API_KEY")
    return {
        "accepted": bool(events is not None or news is not None),
        "events_received": len(events or []),
        "news_received": len(news or []),
        "message": "Provider payload received; map its fields in services/market_data.py before enabling persistence." if (events is not None or news is not None) else "No licensed provider endpoint is configured. Demo context remains clearly labelled.",
    }


@app.websocket("/ws/macro")
async def macro_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            await websocket.send_json({"type": "heartbeat", "at": utc_now(), "source": "DEMO"})
            import asyncio
            await asyncio.sleep(25)
    except WebSocketDisconnect:
        return


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "database": str(DATABASE_PATH)}


# --- SPA-like template delivery -------------------------------------------------
PAGES = {"landing", "login", "register", "dashboard", "accounts", "calculator", "playbook", "journal", "macro_news", "profile"}


@app.get("/", include_in_schema=False)
def landing() -> FileResponse:
    return FileResponse(ROOT / "templates" / "landing.html")


@app.get("/{page}.html", include_in_schema=False)
def template_page(page: str) -> FileResponse:
    if page not in PAGES:
        raise HTTPException(status_code=404, detail="Page introuvable")
    return FileResponse(ROOT / "templates" / f"{page}.html")


@app.get("/{page}", include_in_schema=False)
def readable_page(page: str) -> RedirectResponse:
    if page not in PAGES:
        raise HTTPException(status_code=404, detail="Page introuvable")
    return RedirectResponse(url=f"/{page}.html", status_code=307)
