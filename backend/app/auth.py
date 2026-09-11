"""
JWT token creation, decoding, and Argon2id password hashing.
All secrets loaded from environment via Settings.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
from jose import JWTError, jwt

from app.config import settings

# Argon2id password hasher with OWASP-recommended parameters
_ph = PasswordHasher(
    time_cost=2,       # iterations
    memory_cost=65536, # 64 MiB
    parallelism=2,
    hash_len=32,
    salt_len=16,
)


def hash_password(plain: str) -> str:
    """Hash a password using Argon2id."""
    return _ph.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Return True if plain matches hashed; False on mismatch."""
    try:
        _ph.verify(hashed, plain)
        return True
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(hashed: str) -> bool:
    """Return True if the hash was created with older parameters."""
    return _ph.check_needs_rehash(hashed)


def create_access_token(
    subject: str,
    role: str,
    extra: Optional[dict] = None,
    expires_delta: Optional[timedelta] = None,
) -> str:
    """
    Create a signed JWT.
    `subject` is the user's email (stable unique identifier).
    `role` is included as a claim for frontend display / permission checks.
    """
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))

    payload: dict = {
        "sub": subject,          # Subject = email
        "role": role,
        "type": "access",
        "iat": now,              # Issued-at
        "exp": expire,           # Expiration
    }
    if extra:
        payload.update(extra)

    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(
    subject: str,
    extra: Optional[dict] = None,
    expires_delta: Optional[timedelta] = None,
) -> str:
    """
    Create a long-lived refresh token for silent session renewal.
    """
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta or timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS))

    payload: dict = {
        "sub": subject,
        "type": "refresh",
        "iat": now,
        "exp": expire,
    }
    if extra:
        payload.update(extra)

    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    """
    Decode and validate JWT. Raises JWTError on any failure.
    Returns the full payload dict.
    """
    return jwt.decode(
        token,
        settings.JWT_SECRET_KEY,
        algorithms=[settings.JWT_ALGORITHM],
    )
