"""LLM API service for SiliconFlow integration."""

import httpx
from typing import AsyncGenerator
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from ..config import settings


class LLMServiceError(Exception):
    """LLM服务异常。"""
    pass


class LLMService:
    """硅基流动 LLM API 封装服务。"""

    def __init__(self):
        self.base_url = settings.siliconflow_base_url
        self.api_key = settings.siliconflow_api_key
        self.model = settings.llm_model
        self.timeout = httpx.Timeout(30.0, connect=10.0)

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.ConnectError)),
        reraise=True,
    )
    async def chat_completion(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 1024,
        stream: bool = False,
    ) -> dict | AsyncGenerator:
        """调用 LLM 聊天补全接口。"""
        if not self.api_key:
            raise LLMServiceError("SILICONFLOW_API_KEY 未配置")

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            payload = {
                "model": self.model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "stream": stream,
            }
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            }

            response = await client.post(
                f"{self.base_url}/chat/completions",
                json=payload,
                headers=headers,
            )
            response.raise_for_status()

            if stream:
                return self._parse_stream(response)

            return response.json()

    async def _parse_stream(self, response: httpx.Response) -> AsyncGenerator:
        """解析 SSE 流式响应。"""
        async for line in response.aiter_lines():
            if line.startswith("data: "):
                data = line[6:]
                if data == "[DONE]":
                    break
                import json
                try:
                    chunk = json.loads(data)
                    if chunk.get("choices"):
                        yield chunk["choices"][0].get("delta", {}).get("content", "")
                except json.JSONDecodeError:
                    continue

    async def health_check(self) -> bool:
        """检查 LLM 服务可用性。"""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    json={
                        "model": self.model,
                        "messages": [{"role": "user", "content": "ping"}],
                        "max_tokens": 5,
                    },
                    headers={"Authorization": f"Bearer {self.api_key}"},
                )
                return response.status_code == 200
        except Exception:
            return False


llm_service = LLMService()
