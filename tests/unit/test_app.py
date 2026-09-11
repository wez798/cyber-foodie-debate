"""Application-level tests for lightweight container liveness."""

from fastapi.testclient import TestClient

from src.backend.app import create_app


def test_root_endpoint_is_available_without_external_health_checks() -> None:
    response = TestClient(create_app()).get("/")

    assert response.status_code == 200
    assert response.json() == {
        "message": "Cyber Foodie Debate API",
        "version": "0.1.0",
        "docs": "/docs",
    }


def test_liveness_is_lightweight_and_unknown_cors_origin_is_rejected() -> None:
    client = TestClient(create_app())

    assert client.get("/health/live").json() == {"status": "ok"}
    preflight = client.options(
        "/api/v1/auth/login",
        headers={
            "Origin": "https://attacker.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert "access-control-allow-origin" not in preflight.headers
