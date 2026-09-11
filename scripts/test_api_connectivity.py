"""Explicit connectivity checks for SiliconFlow and Microsoft edge-tts.

Run this module manually. It is deliberately excluded from pytest collection
because it consumes real external services and requires local credentials.
"""

import argparse
import asyncio

import httpx

from src.backend.config import settings
from src.backend.services.tts_service import TTSServiceError, tts_service

__test__ = False


async def check_llm_api() -> bool:
    """Check the configured SiliconFlow chat-completions endpoint."""
    print("🔍 测试硅基流动 LLM API...")
    if not settings.siliconflow_api_key:
        print("❌ 失败: 未找到 SILICONFLOW_API_KEY 环境变量")
        return False

    try:
        async with httpx.AsyncClient(
            base_url=settings.siliconflow_base_url.rstrip("/"),
            timeout=10.0,
        ) as client:
            response = await client.post(
                "/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.siliconflow_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.siliconflow_model,
                    "messages": [{"role": "user", "content": "只回复 pong"}],
                    "max_tokens": 5,
                    "temperature": 0,
                },
            )
        if response.is_success:
            print(f"✅ LLM API 连通成功（模型：{settings.siliconflow_model}）")
            return True
        print(f"❌ LLM API 失败: HTTP {response.status_code}")
    except (httpx.HTTPError, ValueError) as error:
        print(f"❌ LLM API 连接异常: {type(error).__name__}")
    return False


async def check_tts_api() -> bool:
    """Check the configured TTS path with fixed text, without calling an LLM."""
    print("🔍 测试微软 edge-tts...")
    try:
        audio = await tts_service.synthesize("测试")
        if audio:
            print(f"✅ TTS 服务连通成功（收到 {len(audio)} 字节音频）")
            return True
    except TTSServiceError as error:
        print(f"❌ TTS 服务连接失败: {error}")
    except Exception as error:
        print(f"❌ TTS 服务连接异常: {type(error).__name__}")
    return False


async def main(service: str = "all") -> bool:
    """Run all explicit external checks and return their combined result."""
    print("=" * 40)
    print("Cyber Foodie Debate - API 连通性测试")
    print("=" * 40)

    llm_ok = await check_llm_api() if service in {"all", "llm"} else True
    tts_ok = await check_tts_api() if service in {"all", "tts"} else True

    print("\n" + "=" * 40)
    if llm_ok and tts_ok:
        print("🎉 所选服务连通测试通过！")
        return True
    print("⚠️ 部分 API 未通过，请检查本地配置或网络。")
    return False


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service", choices=("all", "llm", "tts"), default="all")
    args = parser.parse_args()
    raise SystemExit(0 if asyncio.run(main(args.service)) else 1)
