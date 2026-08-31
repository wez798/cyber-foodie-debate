"""
API 连通性测试脚本 (Sprint 1 交付物)
用于验证硅基流动 API 和 TTS 服务是否连通。
"""
import asyncio
import os
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

async def test_llm_api():
    """测试 LLM API 连通性"""
    print("🔍 测试硅基流动 LLM API...")
    api_key = os.getenv("SILICONFLOW_API_KEY")
    if not api_key:
        print("❌ 失败: 未找到 SILICONFLOW_API_KEY 环境变量")
        return False
    
    try:
        import httpx
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                "https://api.siliconflow.cn/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": "deepseek-ai/DeepSeek-V3",
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 5
                }
            )
            if response.status_code == 200:
                print("✅ LLM API 连通成功")
                return True
            else:
                print(f"❌ LLM API 失败: {response.status_code}")
                return False
    except Exception as e:
        print(f"❌ LLM API 异常: {e}")
        return False

async def test_tts_api():
    """测试 TTS 服务连通性 (edge-tts)"""
    print("🔍 测试微软 edge-tts...")
    try:
        import edge_tts
        communicate = edge_tts.Communicate("测试", "zh-CN-XiaoxiaoNeural")
        # 尝试合成一小段
        await communicate.save("test_tts.mp3")
        if os.path.exists("test_tts.mp3"):
            os.remove("test_tts.mp3")
            print("✅ TTS 服务连通成功")
            return True
        return False
    except Exception as e:
        print(f"❌ TTS 服务异常: {e}")
        return False

async def main():
    print("="*40)
    print("Cyber Foodie Debate - API 连通性测试")
    print("="*40)
    
    llm_ok = await test_llm_api()
    tts_ok = await test_tts_api()
    
    print("\n" + "="*40)
    if llm_ok and tts_ok:
        print("🎉 所有 API 连通测试通过！可以开始 Sprint 1 开发。")
    else:
        print("⚠️ 部分 API 未通过，请检查 .env 配置或网络。")

if __name__ == "__main__":
    asyncio.run(main())
