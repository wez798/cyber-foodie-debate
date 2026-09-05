"""Explicit connectivity checks for SiliconFlow and Microsoft edge-tts.

Run this module manually. It is deliberately excluded from pytest collection
because it consumes real external services and requires local credentials.
"""

import asyncio
from pathlib import Path
from tempfile import TemporaryDirectory

import edge_tts
import httpx

from src.backend.config import settings

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
    """Check edge-tts with an automatically cleaned temporary file."""
    print("🔍 测试微软 edge-tts...")
    try:
        with TemporaryDirectory(prefix="cyber-foodie-tts-") as temp_dir:
            output_path = Path(temp_dir) / "connectivity.mp3"
            communicate = edge_tts.Communicate("测试", settings.tts_voice)
            await communicate.save(str(output_path))
            if output_path.is_file() and output_path.stat().st_size > 0:
                print("✅ TTS 服务连通成功")
                return True
    except Exception as error:
        print(f"❌ TTS 服务连接异常: {type(error).__name__}")
    return False


async def main() -> bool:
    """Run all explicit external checks and return their combined result."""
    print("=" * 40)
    print("Cyber Foodie Debate - API 连通性测试")
    print("=" * 40)

    llm_ok = await check_llm_api()
    tts_ok = await check_tts_api()

    print("\n" + "=" * 40)
    if llm_ok and tts_ok:
        print("🎉 所有 API 连通测试通过！")
        return True
    print("⚠️ 部分 API 未通过，请检查本地配置或网络。")
    return False


if __name__ == "__main__":
    raise SystemExit(0 if asyncio.run(main()) else 1)
