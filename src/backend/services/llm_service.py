"""Async SiliconFlow OpenAI-compatible Chat Completions client."""

from collections.abc import AsyncIterator, Sequence
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field, ValidationError
from tenacity import AsyncRetrying, retry_if_exception, stop_after_attempt
from tenacity.wait import wait_base, wait_exponential

from ..config import settings


class LLMServiceError(Exception):
    """A safe, normalized error raised by the SiliconFlow client."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 502,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.retryable = retryable


class LLMCompletion(BaseModel):
    """Validated completion returned to application services."""

    content: str = Field(min_length=1)
    finish_reason: str = "stop"


class LLMStreamChunk(BaseModel):
    """Validated incremental completion returned to application services."""

    delta: str = ""
    finish_reason: str | None = None


class _UpstreamRequestMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=16_000)


class _UpstreamChatRequest(BaseModel):
    model: str = Field(min_length=1)
    messages: list[_UpstreamRequestMessage] = Field(min_length=1)
    temperature: float = Field(ge=0, le=2)
    max_tokens: int = Field(ge=1, le=8192)
    stream: bool


class _UpstreamMessage(BaseModel):
    content: str


class _UpstreamChoice(BaseModel):
    message: _UpstreamMessage
    finish_reason: str | None = None


class _UpstreamCompletion(BaseModel):
    choices: list[_UpstreamChoice] = Field(min_length=1)


class _UpstreamDelta(BaseModel):
    content: str | None = None


class _UpstreamStreamChoice(BaseModel):
    delta: _UpstreamDelta = Field(default_factory=_UpstreamDelta)
    finish_reason: str | None = None


class _UpstreamStreamChunk(BaseModel):
    choices: list[_UpstreamStreamChoice] = Field(default_factory=list)


def _should_retry(exception: BaseException) -> bool:
    return isinstance(exception, LLMServiceError) and exception.retryable


class LLMService:
    """硅基流动 OpenAI 兼容 API 的异步服务封装。"""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        retry_wait: wait_base | None = None,
    ) -> None:
        self.api_key = (
            settings.siliconflow_api_key if api_key is None else api_key
        ).strip()
        self.base_url = (
            settings.siliconflow_base_url if base_url is None else base_url
        ).rstrip("/")
        self.model = settings.siliconflow_model if model is None else model
        self.timeout = httpx.Timeout(30.0)
        self.transport = transport
        self.retry_wait = retry_wait or wait_exponential(
            multiplier=1,
            min=2,
            max=10,
        )

    def ensure_configured(self) -> None:
        """Fail before sending response headers when the API key is absent."""
        if not self.api_key:
            raise LLMServiceError(
                "missing_api_key",
                "服务端未配置 SILICONFLOW_API_KEY",
                status_code=503,
            )

    async def complete(
        self,
        messages: Sequence[dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> LLMCompletion:
        """Request and validate a non-streaming chat completion."""
        payload = self._payload(messages, temperature, max_tokens, stream=False)
        raw = await self._with_retry(self._post_json_once, payload)
        try:
            parsed = _UpstreamCompletion.model_validate(raw)
        except ValidationError as exc:
            raise self._invalid_response_error() from exc

        choice = parsed.choices[0]
        if not choice.message.content.strip():
            raise self._invalid_response_error()
        return LLMCompletion(
            content=choice.message.content,
            finish_reason=choice.finish_reason or "stop",
        )

    async def stream(
        self,
        messages: Sequence[dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> AsyncIterator[LLMStreamChunk]:
        """Yield validated text deltas from a real upstream HTTP stream."""
        payload = self._payload(messages, temperature, max_tokens, stream=True)
        client, response = await self._with_retry(self._open_stream_once, payload)
        try:
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].lstrip()
                if data == "[DONE]":
                    break
                if not data:
                    continue
                try:
                    parsed = _UpstreamStreamChunk.model_validate_json(data)
                except (ValidationError, ValueError) as exc:
                    raise self._invalid_response_error() from exc
                if not parsed.choices:
                    continue
                choice = parsed.choices[0]
                yield LLMStreamChunk(
                    delta=choice.delta.content or "",
                    finish_reason=choice.finish_reason,
                )
        except httpx.TimeoutException as exc:
            raise self._timeout_error() from exc
        except httpx.TransportError as exc:
            raise self._network_error() from exc
        finally:
            await response.aclose()
            await client.aclose()

    async def chat_completion(
        self,
        messages: Sequence[dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> dict[str, Any]:
        """Compatibility wrapper for the existing debate service."""
        completion = await self.complete(
            messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return {
            "choices": [
                {
                    "message": {"content": completion.content},
                    "finish_reason": completion.finish_reason,
                }
            ]
        }

    async def health_check(self) -> bool:
        """Check whether SiliconFlow accepts a minimal completion request."""
        if not self.api_key:
            return False
        try:
            await self.complete(
                [{"role": "user", "content": "只回复 pong"}],
                temperature=0,
                max_tokens=5,
            )
        except LLMServiceError:
            return False
        return True

    def _payload(
        self,
        messages: Sequence[dict[str, str]],
        temperature: float,
        max_tokens: int,
        *,
        stream: bool,
    ) -> dict[str, Any]:
        self.ensure_configured()
        try:
            request = _UpstreamChatRequest(
                model=self.model,
                messages=list(messages),
                temperature=temperature,
                max_tokens=max_tokens,
                stream=stream,
            )
        except ValidationError as exc:
            raise LLMServiceError(
                "invalid_request",
                "服务端生成了无效的模型请求",
                status_code=500,
            ) from exc
        return request.model_dump()

    async def _with_retry(self, operation: Any, payload: dict[str, Any]) -> Any:
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(3),
            wait=self.retry_wait,
            retry=retry_if_exception(_should_retry),
            reraise=True,
        ):
            with attempt:
                return await operation(payload)
        raise AssertionError("tenacity retry loop exited unexpectedly")

    async def _post_json_once(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            async with self._client() as client:
                response = await client.post(
                    "/chat/completions",
                    json=payload,
                    headers=self._headers(),
                )
        except httpx.TimeoutException as exc:
            raise self._timeout_error() from exc
        except httpx.TransportError as exc:
            raise self._network_error() from exc

        if response.is_error:
            raise self._status_error(response.status_code)
        try:
            body = response.json()
        except ValueError as exc:
            raise self._invalid_response_error() from exc
        if not isinstance(body, dict):
            raise self._invalid_response_error()
        return body

    async def _open_stream_once(
        self, payload: dict[str, Any]
    ) -> tuple[httpx.AsyncClient, httpx.Response]:
        client = self._client()
        try:
            request = client.build_request(
                "POST",
                "/chat/completions",
                json=payload,
                headers=self._headers(),
            )
            response = await client.send(request, stream=True)
            if response.is_error:
                error = self._status_error(response.status_code)
                await response.aclose()
                raise error
            return client, response
        except httpx.TimeoutException as exc:
            await client.aclose()
            raise self._timeout_error() from exc
        except httpx.TransportError as exc:
            await client.aclose()
            raise self._network_error() from exc
        except LLMServiceError:
            await client.aclose()
            raise

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self.base_url,
            timeout=self.timeout,
            transport=self.transport,
        )

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream, application/json",
        }

    @staticmethod
    def _status_error(status_code: int) -> LLMServiceError:
        if status_code == 401:
            return LLMServiceError(
                "unauthorized",
                "硅基流动 API Key 无效或无权访问该模型",
                status_code=503,
            )
        if status_code == 429:
            return LLMServiceError(
                "rate_limited",
                "硅基流动服务请求过于频繁，请稍后重试",
                status_code=429,
                retryable=True,
            )
        if status_code == 503:
            return LLMServiceError(
                "service_unavailable",
                "硅基流动服务暂不可用，请稍后重试",
                status_code=503,
                retryable=True,
            )
        if status_code == 504:
            return LLMServiceError(
                "gateway_timeout",
                "硅基流动服务响应超时，请稍后重试",
                status_code=504,
                retryable=True,
            )
        return LLMServiceError(
            "upstream_error",
            "硅基流动服务返回异常",
            status_code=502,
            retryable=status_code >= 500,
        )

    @staticmethod
    def _timeout_error() -> LLMServiceError:
        return LLMServiceError(
            "timeout",
            "硅基流动服务响应超时，请稍后重试",
            status_code=504,
            retryable=True,
        )

    @staticmethod
    def _network_error() -> LLMServiceError:
        return LLMServiceError(
            "network_error",
            "无法连接硅基流动服务，请稍后重试",
            status_code=503,
            retryable=True,
        )

    @staticmethod
    def _invalid_response_error() -> LLMServiceError:
        return LLMServiceError(
            "invalid_response",
            "硅基流动服务返回了无法解析的响应",
            status_code=502,
        )


llm_service = LLMService()
