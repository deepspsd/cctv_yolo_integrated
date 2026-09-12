"""
FastAPI security dependencies for JWT Bearer token authentication.
Import `get_current_user` or `require_admin` in protected route functions.
"""
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import decode_access_token
from app.database import get_db
from app.models import User

bearer_scheme = HTTPBearer(auto_error=True)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Dependency that:
    1. Extracts Bearer token from Authorization header.
    2. Validates JWT signature & expiry.
    3. Looks up user in DB and checks is_active.
    4. Rejects tokens issued before user's last logout (revocation).
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired authentication token.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = decode_access_token(credentials.credentials)
        if payload.get("type") == "refresh":
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

    # Token revocation: reject tokens issued before last logout
    if user.last_logout_at and issued_at is not None:
        token_iat = datetime.fromtimestamp(issued_at, tz=timezone.utc)
        if token_iat < user.last_logout_at.replace(tzinfo=timezone.utc):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session has been revoked. Please log in again.",
                headers={"WWW-Authenticate": "Bearer"},
            )

    return user


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Dependency that additionally requires Administrator role."""
    role_str = (getattr(current_user.role, "value", None) or str(current_user.role)).strip().upper()
    if role_str not in ["ADMINISTRATOR", "ADMIN"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access required.",
        )
    return current_user


async def authenticate_request(
    request: Request,
    token_param: str | None = None,
    db: AsyncSession = None
) -> User | None:
    """
    Authenticate request via Authorization header OR token query parameter.
    Enables native image loading in HTML <img> tags with ?token=<jwt>.
    """
    token = None
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1]
    elif token_param:
        token = token_param

    if not token:
        return None

    try:
        payload = decode_access_token(token)
        if payload.get("type") == "refresh":
            return None
        email: str = payload.get("sub")
        if not email:
            return None
        issued_at: int | None = payload.get("iat")
    except JWTError:
        return None

    if db is None:
        return None

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        return None

    if user.last_logout_at and issued_at is not None:
        token_iat = datetime.fromtimestamp(issued_at, tz=timezone.utc)
        if token_iat < user.last_logout_at.replace(tzinfo=timezone.utc):
            return None

    return user
