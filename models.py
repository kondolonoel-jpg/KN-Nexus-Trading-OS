from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator


class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=60)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)

    @field_validator("username")
    @classmethod
    def clean_username(cls, value: str) -> str:
        return value.strip()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserOut(BaseModel):
    id: str
    username: str
    email: EmailStr
    plan: str
    created_at: str


class AccountBase(BaseModel):
    account_name: str = Field(min_length=2, max_length=100)
    broker: str = Field(default="", max_length=100)
    account_type: Literal["Évaluation", "Financé", "Démo", "Réel"] = "Réel"
    account_currency: str = Field(default="USD", min_length=3, max_length=6)
    initial_capital: float = Field(ge=0)
    current_balance: float = Field(ge=0)
    leverage: str = Field(default="1:100", max_length=15)
    max_daily_drawdown_pct: float = Field(default=0, ge=0, le=100)
    max_total_drawdown_pct: float = Field(default=0, ge=0, le=100)
    is_active: bool = True


class AccountCreate(AccountBase):
    pass


class AccountUpdate(BaseModel):
    account_name: str | None = Field(default=None, min_length=2, max_length=100)
    broker: str | None = Field(default=None, max_length=100)
    account_type: Literal["Évaluation", "Financé", "Démo", "Réel"] | None = None
    account_currency: str | None = Field(default=None, min_length=3, max_length=6)
    initial_capital: float | None = Field(default=None, ge=0)
    current_balance: float | None = Field(default=None, ge=0)
    leverage: str | None = Field(default=None, max_length=15)
    max_daily_drawdown_pct: float | None = Field(default=None, ge=0, le=100)
    max_total_drawdown_pct: float | None = Field(default=None, ge=0, le=100)
    is_active: bool | None = None


class SetupCreate(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    asset_class: str = Field(default="Multi-actifs", max_length=40)
    timeframe: str = Field(default="M15", max_length=15)
    rules: list[str] = Field(default_factory=list, max_length=30)


class SetupUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=120)
    asset_class: str | None = Field(default=None, max_length=40)
    timeframe: str | None = Field(default=None, max_length=15)
    rules: list[str] | None = Field(default=None, max_length=30)


class TradeCreate(BaseModel):
    account_id: int
    setup_id: int | None = None
    setup_title_snapshot: str | None = Field(default=None, max_length=120)
    asset_category: str = Field(default="Multi-actifs", max_length=40)
    symbol: str = Field(min_length=2, max_length=25)
    direction: Literal["BUY", "SELL"]
    entry_price: float | None = None
    stop_loss: float | None = None
    take_profit: float | None = None
    lot_size: float | None = Field(default=None, ge=0)
    pnl: float = 0
    commission: float = 0
    swap: float = 0
    review_notes: str = Field(default="", max_length=4000)
    opened_at: datetime | None = None
    closed_at: datetime | None = None


class TradeUpdate(BaseModel):
    setup_id: int | None = None
    setup_title_snapshot: str | None = Field(default=None, max_length=120)
    asset_category: str | None = Field(default=None, max_length=40)
    symbol: str | None = Field(default=None, min_length=2, max_length=25)
    direction: Literal["BUY", "SELL"] | None = None
    entry_price: float | None = None
    stop_loss: float | None = None
    take_profit: float | None = None
    lot_size: float | None = Field(default=None, ge=0)
    pnl: float | None = None
    commission: float | None = None
    swap: float | None = None
    review_notes: str | None = Field(default=None, max_length=4000)
    opened_at: datetime | None = None
    closed_at: datetime | None = None


class ProfileUpdate(BaseModel):
    username: str = Field(min_length=2, max_length=60)
    email: EmailStr


class PasswordUpdate(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)
