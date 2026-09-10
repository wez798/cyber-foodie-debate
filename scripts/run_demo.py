"""Run an offline demo with disposable data; never use configured databases or APIs."""

import argparse
import asyncio
import io
import json
import math
import os
from pathlib import Path
import struct
import subprocess
import sys
from tempfile import TemporaryDirectory
import wave


def build_app(*, tts_fail: bool = False):
    """Called only after main has installed isolated environment settings."""
    from src.backend.app import create_app
    from src.backend.services.chat_service import ChatService, get_chat_service
    from src.backend.services import debate_service as debate_module
    from src.backend.services.debate_service import DebateService, get_debate_service
    from src.backend.services.llm_service import LLMCompletion, LLMStreamChunk
    from src.backend.services.tts_service import tts_service

    class DemoLLM:
        def ensure_configured(self):
            pass

        async def complete(self, messages, **kwargs):
            del kwargs
            await asyncio.sleep(0.15)
            if "公正主持人" in messages[0]["content"]:
                return LLMCompletion(
                    content=json.dumps(
                        {
                            "winner": "cantonese_healthy",
                            "recommendation": "离线演示固定样例，非真实 AI 推荐。",
                            "dish_name": "演示餐品",
                            "restaurant": "测试食堂",
                            "confidence": 0.5,
                        },
                        ensure_ascii=False,
                    )
                )
            return LLMCompletion(content="离线演示观点：请结合预算与忌口选择午饭。")

        async def stream(self, messages, **kwargs):
            del messages, kwargs
            for part in [
                "【离线演示，非真实 AI】",
                "这是固定测试回复。",
                "可以继续聊天或演示历史恢复。",
            ]:
                await asyncio.sleep(0.3)
                yield LLMStreamChunk(delta=part)
            yield LLMStreamChunk(finish_reason="stop")

    async def fake_tts(**kwargs):
        del kwargs
        if tts_fail:
            raise RuntimeError("离线演示：模拟语音服务失败")
        output = io.BytesIO()
        with wave.open(output, "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(16000)
            audio.writeframes(
                b"".join(
                    struct.pack(
                        "<h", int(2000 * math.sin(2 * math.pi * 440 * i / 16000))
                    )
                    for i in range(8000)
                )
            )
        return output.getvalue()

    llm = DemoLLM()
    chat = ChatService(llm)
    debate = DebateService(llm=llm)
    # The existing TTS result route reads the same in-memory debate instance.
    debate_module.debate_service = debate
    tts_service.synthesize = fake_tts
    app = create_app()
    app.dependency_overrides[get_chat_service] = lambda: chat
    app.dependency_overrides[get_debate_service] = lambda: debate

    @app.middleware("http")
    async def label_demo(request, call_next):
        # External health probes must stay offline as well.
        if request.url.path == "/api/v1/health":
            from fastapi.responses import JSONResponse

            return JSONResponse(
                {"status": "offline-demo", "real_services_tested": False}
            )
        response = await call_next(request)
        response.headers["X-Offline-Demo"] = "true"
        if request.url.path.startswith("/api/v1/tts/") and response.status_code == 200:
            response.headers["content-type"] = "audio/wav"
        return response

    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--frontend-origin", default="http://localhost:5173")
    parser.add_argument("--tts-fail", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    with TemporaryDirectory(prefix="cyber-foodie-demo-") as directory:
        os.environ.update(
            DATABASE_URL=f"sqlite+aiosqlite:///{Path(directory).as_posix()}/demo.db",
            SILICONFLOW_API_KEY="",
            FRONTEND_ORIGINS=json.dumps([args.frontend_origin]),
            SESSION_COOKIE_NAME="cfd_demo_session",
            CSRF_COOKIE_NAME="cfd_demo_csrf",
            SESSION_COOKIE_SECURE="false",
        )
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"], cwd=root, check=True
        )
        import uvicorn

        print(
            "OFFLINE DEMO: fixed replies; audio is a test tone, NOT synthesized speech."
        )
        print("Data is disposable and is removed when this process exits.")
        uvicorn.run(build_app(tts_fail=args.tts_fail), host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
