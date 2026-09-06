"""Email/password authentication using revocable opaque cookies."""

from fastapi import APIRouter, Depends, HTTPException, Response

from ..config import settings
from ..models import AuthResponse, UserLoginRequest, UserRegisterRequest, UserResponse
from ..services.auth_service import (
    AuthService,
    AuthServiceError,
    CurrentSession,
    IssuedSession,
    get_auth_service,
)
from .auth_dependencies import (
    get_optional_user,
    require_allowed_origin,
    require_csrf,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_auth_cookies(response: Response, issued: IssuedSession) -> None:
    max_age = settings.session_ttl_seconds
    response.set_cookie(
        settings.session_cookie_name,
        issued.session_token,
        max_age=max_age,
        expires=issued.expires_at,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        settings.csrf_cookie_name,
        issued.csrf_token,
        max_age=max_age,
        expires=issued.expires_at,
        httponly=False,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(
        settings.session_cookie_name,
        path="/",
        secure=settings.session_cookie_secure,
        httponly=True,
        samesite="lax",
    )
    response.delete_cookie(
        settings.csrf_cookie_name,
        path="/",
        secure=settings.session_cookie_secure,
        httponly=False,
        samesite="lax",
    )


def _auth_error(error: AuthServiceError) -> HTTPException:
    return HTTPException(
        status_code=error.status_code,
        detail={"code": error.code, "message": error.message},
    )


@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(
    request: UserRegisterRequest,
    response: Response,
    _: None = Depends(require_allowed_origin),
    service: AuthService = Depends(get_auth_service),
) -> AuthResponse:
    try:
        issued = await service.register(request)
    except AuthServiceError as error:
        raise _auth_error(error) from error
    _set_auth_cookies(response, issued)
    return AuthResponse(user=issued.user)


@router.post("/login", response_model=AuthResponse)
async def login(
    request: UserLoginRequest,
    response: Response,
    _: None = Depends(require_allowed_origin),
    service: AuthService = Depends(get_auth_service),
) -> AuthResponse:
    try:
        issued = await service.login(request)
    except AuthServiceError as error:
        raise _auth_error(error) from error
    _set_auth_cookies(response, issued)
    return AuthResponse(user=issued.user)


@router.post("/logout", status_code=204)
async def logout(
    response: Response,
    current: CurrentSession = Depends(require_csrf),
    service: AuthService = Depends(get_auth_service),
) -> None:
    await service.logout(current)
    _clear_auth_cookies(response)


@router.get("/me", response_model=UserResponse)
async def me(
    current: CurrentSession | None = Depends(get_optional_user),
) -> UserResponse:
    if current is None:
        raise HTTPException(status_code=401, detail="请先登录")
    return current.user
