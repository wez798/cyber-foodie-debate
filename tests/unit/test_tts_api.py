"""TTS HTTP errors preserve safe details and never leak upstream URLs."""

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from src.backend.app import create_app
from src.backend.models import AgentPersona, DebateResult, DebateSession, FoodPreference
from src.backend.services.debate_service import debate_service
from src.backend.services.tts_service import TTSServiceError, tts_service


@pytest.mark.parametrize("debate", [False, True])
@pytest.mark.parametrize("safe", [False, True])
def test_failure_is_safe_for_both_audio_routes(monkeypatch, debate, safe):
    session = DebateSession(
        session_id="test-tts",
        preference=FoodPreference(口味="清淡", 预算="20元"),
        result=DebateResult(
            winner=AgentPersona.CANTONESE_HEALTHY,
            recommendation="清淡",
            dish_name="鸡蛋面",
            confidence=0.8,
        ),
    )
    monkeypatch.setattr(debate_service, "get_session", lambda _: session)
    error = (
        TTSServiceError("请检查 TTS_PROXY", status_code=503)
        if safe
        else RuntimeError("wss://example.invalid/?token=secret")
    )
    monkeypatch.setattr(tts_service, "synthesize", AsyncMock(side_effect=error))
    client = TestClient(create_app())
    response = (
        client.post("/api/v1/tts/synthesize-debate-result?session_id=test-tts")
        if debate
        else client.post("/api/v1/tts/synthesize", json={"text": "测试"})
    )
    assert response.status_code == (503 if safe else 500)
    assert response.json()["detail"] == (
        "请检查 TTS_PROXY" if safe else "语音合成服务异常，请稍后重试"
    )
    assert "token" not in response.text


def test_success_returns_mp3(monkeypatch):
    monkeypatch.setattr(tts_service, "synthesize", AsyncMock(return_value=b"ID3-audio"))
    response = TestClient(create_app()).post(
        "/api/v1/tts/synthesize", json={"text": "测试"}
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.content == b"ID3-audio"
