"""Microsoft edge-tts synthesis with bounded, safe failure handling."""

import asyncio
from contextlib import aclosing
from pathlib import Path

import aiohttp
import edge_tts
from edge_tts.exceptions import EdgeTTSException, NoAudioReceived, SkewAdjustmentError
from tenacity import (
    AsyncRetrying,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)
from tenacity.wait import wait_base

from ..config import settings


class TTSServiceError(Exception):
    """Safe error details; never expose upstream URLs or proxy credentials."""

    def __init__(
        self, message: str, *, status_code: int = 502, retryable: bool = False
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.retryable = retryable


def _should_retry(error: BaseException) -> bool:
    return isinstance(error, TTSServiceError) and error.retryable


class TTSService:
    """微软 edge-tts 语音合成服务。"""

    def __init__(self, *, retry_wait: wait_base | None = None) -> None:
        self.voice = settings.tts_voice
        self.rate = settings.tts_rate
        self.pitch = settings.tts_pitch
        self.proxy = str(settings.tts_proxy) if settings.tts_proxy else None
        self.timeout_seconds = settings.tts_timeout_seconds
        self.retry_wait = retry_wait or wait_exponential(multiplier=1, min=1, max=2)

    async def synthesize(
        self,
        text: str,
        voice: str | None = None,
        rate: str | None = None,
        pitch: str | None = None,
    ) -> bytes:
        """Buffer complete audio; retry transient failures only before audio arrives."""
        if not text.strip():
            raise TTSServiceError("合成文本不能为空", status_code=422)
        try:
            async with asyncio.timeout(self.timeout_seconds):
                async for attempt in AsyncRetrying(
                    stop=stop_after_attempt(2),
                    wait=self.retry_wait,
                    retry=retry_if_exception(_should_retry),
                    reraise=True,
                ):
                    with attempt:
                        return await self._synthesize_once(
                            text,
                            voice or self.voice,
                            rate or self.rate,
                            pitch or self.pitch,
                        )
        except TimeoutError as error:
            raise TTSServiceError(
                "语音合成超时，请检查网络连接后重试", status_code=504
            ) from error
        raise AssertionError("TTS retry loop exited unexpectedly")

    async def _synthesize_once(
        self, text: str, voice: str, rate: str, pitch: str
    ) -> bytes:
        audio = bytearray()
        try:
            communicate = edge_tts.Communicate(
                text=text,
                voice=voice,
                rate=rate,
                pitch=pitch,
                proxy=self.proxy,
                connect_timeout=10,
                receive_timeout=20,
            )
            async with aclosing(communicate.stream()) as stream:
                async for chunk in stream:
                    if chunk["type"] == "audio":
                        audio.extend(chunk["data"])
        except aiohttp.ClientResponseError as error:
            if error.status in {401, 403}:
                raise TTSServiceError(
                    "微软语音服务拒绝连接，请确认 edge-tts 已更新、系统时间已同步；"
                    "若仍失败，请检查网络或配置 TTS_PROXY。无需填写 TTS API Key。",
                    status_code=503,
                ) from error
            raise TTSServiceError(
                "微软语音服务暂不可用，请稍后重试",
                status_code=503,
                retryable=not audio and (error.status == 429 or error.status >= 500),
            ) from error
        except (
            aiohttp.ClientConnectionError,
            aiohttp.ClientPayloadError,
            TimeoutError,
        ) as error:
            raise TTSServiceError(
                "语音服务连接中断或超时，请检查网络或 TTS_PROXY 后重试",
                status_code=503,
                retryable=not audio,
            ) from error
        except SkewAdjustmentError as error:
            raise TTSServiceError(
                "微软语音服务握手失败，请同步系统时间并检查网络或 TTS_PROXY",
                status_code=503,
            ) from error
        except NoAudioReceived as error:
            raise TTSServiceError(
                "语音服务未返回音频，请检查语音角色或稍后重试"
            ) from error
        except EdgeTTSException as error:
            raise TTSServiceError(
                "语音服务响应异常，请更新 edge-tts 或稍后重试"
            ) from error
        except ValueError as error:
            raise TTSServiceError(
                "语音角色、语速、音调或代理配置无效", status_code=422
            ) from error
        if not audio:
            raise TTSServiceError("语音服务未返回音频，请稍后重试")
        return bytes(audio)

    async def synthesize_to_file(
        self,
        text: str,
        output_path: str,
        voice: str | None = None,
        rate: str | None = None,
        pitch: str | None = None,
    ) -> str:
        """Use the same configuration and error handling for file output."""
        audio = await self.synthesize(text, voice, rate, pitch)
        await asyncio.to_thread(Path(output_path).write_bytes, audio)
        return output_path

    async def health_check(self) -> bool:
        """Healthy only after receiving non-empty audio and closing the stream."""
        try:
            return bool(await self.synthesize("测试"))
        except Exception:
            return False


tts_service = TTSService()
