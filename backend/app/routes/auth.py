"""
Authentication routes:
  POST /api/auth/login     - issue JWT access token
  POST /api/auth/register  - create new operator account
  GET  /api/auth/me        - return current authenticated user profile
  POST /api/auth/logout    - revoke current session
"""
import logging
import random
import string
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError
from pydantic import BaseModel, EmailStr, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    hash_password,
    verify_password,
    needs_rehash,
    create_access_token,
    create_refresh_token,
    decode_access_token,
)
from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, UserRoleEnum

logger = logging.getLogger("auth")
router = APIRouter(prefix="/auth", tags=["Authentication"])

# ─── Seed default admin accounts on first startup ──────────────────────────

SEED_USERS = [
    {
        "name": "Sarah Jenkins",
        "email": "admin@occusafe.internal",
        "password": "Security2026!",
        "role": UserRoleEnum.ADMINISTRATOR,
        "facility": "HQ Operations & Perimeter",
        "badge_id": "CE-9014",
    },
    {
        "name": "Marcus Vance",
        "email": "operator@occusafe.internal",
        "password": "Watchdog2026!",
        "role": UserRoleEnum.SURVEILLANCE_OPERATOR,
        "facility": "Warehouse & Logistics Hub",
        "badge_id": "CE-4482",
    },
    {
        "name": "Elena Rostova",
        "email": "elena@occusafe.internal",
        "password": "Sentinel2026!",
        "role": UserRoleEnum.SECURITY_OFFICER,
        "facility": "Research Facility North",
        "badge_id": "CE-1129",
    },
]


async def seed_default_users(db: AsyncSession) -> None:
    """Insert default operator accounts if users table is empty."""
    result = await db.execute(select(User))
    existing = result.scalars().first()
    if existing:
        return

    for u in SEED_USERS:
        uid = "usr-" + "".join(random.choices(string.ascii_lowercase + string.digits, k=12))
        user = User(
            id=uid,
            name=u["name"],
            email=u["email"],
            hashed_password=hash_password(u["password"]),
            role=u["role"],
            facility=u["facility"],
            badge_id=u["badge_id"],
            is_active=True,
        )
        db.add(user)
    await db.commit()
    logger.info("Seeded %d default operator accounts.", len(SEED_USERS))


# ─── Request / Response schemas ─────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str          # accepts email in the 'username' field (OAuth2 convention)
    password: str

    @field_validator("username")
    @classmethod
    def normalise_email(cls, v: str) -> str:
        return v.strip().lower()


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"
    expires_in: int       # seconds
    user: "UserProfile"


class RefreshRequest(BaseModel):
    refresh_token: str


class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    confirm_password: str
    role: UserRoleEnum = UserRoleEnum.SURVEILLANCE_OPERATOR
    facility: str = "General"
    badge_id: str | None = None

    @field_validator("email")
    @classmethod
    def normalise(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Name must be at least 2 characters.")
        return v

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters.")
        return v

    @model_validator(mode="after")
    def passwords_match(self) -> "RegisterRequest":
        if self.password != self.confirm_password:
            raise ValueError("Passwords do not match.")
        return self


class UserProfile(BaseModel):
    id: str
    name: str
    email: str
    role: str
    facility: str
    badge_id: str | None
    last_login: str | None

    model_config = {"from_attributes": True}


def _profile(user: User) -> UserProfile:
    last = None
    if user.last_login_at:
        last = user.last_login_at.strftime("%d %b %Y, %I:%M %p")
    return UserProfile(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role.value,
        facility=user.facility,
        badge_id=user.badge_id,
        last_login=last,
    )


# ─── Routes ─────────────────────────────────────────────────────────────────

@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.username))
    user = result.scalar_one_or_none()

    # Constant-time: always run verify even on missing user to resist timing attacks
    dummy_hash = "$argon2id$v=19$m=65536,t=2,p=2$dGVzdA$dGVzdA"
    stored_hash = user.hashed_password if user else dummy_hash

    if not verify_password(body.password, stored_hash) or user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account has been deactivated. Contact your administrator.",
        )

    # Rehash if parameters have changed
    if needs_rehash(user.hashed_password):
        user.hashed_password = hash_password(body.password)

    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(user)

    expire = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    token = create_access_token(
        subject=user.email,
        role=user.role.value,
        expires_delta=expire,
    )
    refresh_tok = create_refresh_token(subject=user.email)
    logger.info("User '%s' logged in.", user.email)
    return TokenResponse(
        access_token=token,
        refresh_token=refresh_tok,
        expires_in=int(expire.total_seconds()),
        user=_profile(user),
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    uid = "usr-" + "".join(random.choices(string.ascii_lowercase + string.digits, k=12))
    badge = body.badge_id or f"CE-{random.randint(1000, 9999)}"

    user = User(
        id=uid,
        name=body.name,
        email=body.email,
        hashed_password=hash_password(body.password),
        role=body.role,
        facility=body.facility,
        badge_id=badge,
        is_active=True,
        last_login_at=datetime.now(timezone.utc),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    expire = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    token = create_access_token(
        subject=user.email,
        role=user.role.value,
        expires_delta=expire,
    )
    refresh_tok = create_refresh_token(subject=user.email)
    logger.info("New user registered: '%s' (%s).", user.email, user.role.value)
    return TokenResponse(
        access_token=token,
        refresh_token=refresh_tok,
        expires_in=int(expire.total_seconds()),
        user=_profile(user),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token_endpoint(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """
    Issue fresh short-lived access token using long-lived refresh token.
    Rotates refresh token on each use.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired refresh token.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(body.refresh_token)
        if payload.get("type") != "refresh":
            raise credentials_exception
        email: str = payload.get("sub")
        if not email:
            raise credentials_exception
        issued_at: int | None = payload.get("iat")
    except JWTError:
        raise credentials_exception

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise credentials_exception

    if user.last_logout_at and issued_at is not None:
        token_iat = datetime.fromtimestamp(issued_at, tz=timezone.utc)
        if token_iat < user.last_logout_at.replace(tzinfo=timezone.utc):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session has been revoked. Please log in again.",
                headers={"WWW-Authenticate": "Bearer"},
            )

    expire = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    new_access_token = create_access_token(
        subject=user.email,
        role=user.role.value,
        expires_delta=expire,
    )
    new_refresh_token = create_refresh_token(subject=user.email)

    return TokenResponse(
        access_token=new_access_token,
        refresh_token=new_refresh_token,
        expires_in=int(expire.total_seconds()),
        user=_profile(user),
    )


@router.get("/me", response_model=UserProfile)
async def get_me(current_user: User = Depends(get_current_user)):
    return _profile(current_user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Record logout time so any previously-issued tokens become invalid.
    The client should also delete the stored token.
    """
    current_user.last_logout_at = datetime.now(timezone.utc)
    await db.commit()
    logger.info("User '%s' logged out.", current_user.email)
