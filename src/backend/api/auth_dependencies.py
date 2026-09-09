"""FastAPI-only authentication, origin and CSRF dependencies."""

import secrets
from urllib.parse import urlsplit

from fastapi import Depends, HTTPException, Request, status

from ..config import settings
from ..services.auth_service import (
    AuthService,
    CurrentSession,
    get_auth_service,
    secrets_match,
)


def _request_origin(request: Request) -> str | None:
    origin = request.headers.get("origin")
    if origin:
        return origin.rstrip("/")
    referer = request.headers.get("referer")
    if not referer:
        return None
    parsed = urlsplit(referer)
    if not parsed.scheme or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def require_allowed_origin(request: Request) -> None:
    """Reject browser credential mutations from untrusted or absent origins."""
    if _request_origin(request) not in settings.frontend_origins:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="请求来源不受信任",
        )


async def get_optional_user(
    request: Request,
    service: AuthService = Depends(get_auth_service),
) -> CurrentSession | None:
    token = request.cookies.get(settings.session_cookie_name)
    return await service.authenticate(token)


async def require_current_user(
    current: CurrentSession | None = Depends(get_optional_user),
) -> CurrentSession:
    if current is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="请先登录",
        )
    return current


async def require_csrf(
    request: Request,
    current: CurrentSession = Depends(require_current_user),
) -> CurrentSession:
    require_allowed_origin(request)
    header_token = request.headers.get("x-csrf-token")
    cookie_token = request.cookies.get(settings.csrf_cookie_name)
    if (
        not header_token
        or not cookie_token
        or not secrets.compare_digest(header_token, cookie_token)
        or not secrets_match(header_token, current.csrf_token_hash)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF 校验失败",
        )
    return current
