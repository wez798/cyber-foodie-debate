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
