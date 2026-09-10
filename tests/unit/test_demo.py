"""Offline delivery harness produces labelled fixtures, never external output."""

import pytest
from fastapi.testclient import TestClient

from scripts.run_demo import build_app
from src.backend.services import debate_service as debate_module
from src.backend.services.tts_service import tts_service


@pytest.mark.parametrize("tts_fail", [False, True])
def test_demo_debate_and_audio_are_explicit_fixtures(monkeypatch, tts_fail):
    # Register originals with monkeypatch before the demo installs its overrides.
    monkeypatch.setattr(debate_module, "debate_service", debate_module.debate_service)
    monkeypatch.setattr(tts_service, "synthesize", tts_service.synthesize)
    with TestClient(build_app(tts_fail=tts_fail)) as client:
        assert client.get("/api/v1/health").json()["real_services_tested"] is False
        response = client.post(
            "/api/v1/debate/start",
            json={"preference": {"口味": "清淡", "预算": "10-20元"}},
        )
        assert response.status_code == 200
        result = response.json()
        assert "非真实 AI" in result["result"]["recommendation"]
        audio = client.post(
            "/api/v1/tts/synthesize-debate-result",
            params={"session_id": result["session_id"]},
        )
        if tts_fail:
            assert audio.status_code == 500
            assert "模拟语音服务失败" in audio.json()["detail"]
        else:
            assert audio.status_code == 200
            assert audio.headers["content-type"] == "audio/wav"
            assert audio.content.startswith(b"RIFF")
