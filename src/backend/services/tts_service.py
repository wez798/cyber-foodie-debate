"""Microsoft edge-tts speech synthesis service."""

import io
import edge_tts
from typing import Optional
from ..config import settings


class TTSServiceError(Exception):
    """TTS服务异常。"""

    pass


class TTSService:
    """微软 edge-tts 语音合成服务。"""

    def __init__(self):
        self.voice = settings.tts_voice
        self.rate = settings.tts_rate
        self.pitch = settings.tts_pitch

    async def synthesize(
        self,
        text: str,
        voice: Optional[str] = None,
        rate: Optional[str] = None,
        pitch: Optional[str] = None,
    ) -> bytes:
        """合成语音并返回音频字节流。"""
        if not text.strip():
            raise TTSServiceError("合成文本不能为空")

        communicate = edge_tts.Communicate(
            text=text,
            voice=voice or self.voice,
            rate=rate or self.rate,
            pitch=pitch or self.pitch,
        )

        audio_buffer = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_buffer.write(chunk["data"])

        return audio_buffer.getvalue()

    async def synthesize_to_file(
        self,
        text: str,
        output_path: str,
        voice: Optional[str] = None,
        rate: Optional[str] = None,
        pitch: Optional[str] = None,
    ) -> str:
        """合成语音并保存到文件。"""
        communicate = edge_tts.Communicate(
            text=text,
            voice=voice or self.voice,
            rate=rate or self.rate,
            pitch=pitch or self.pitch,
        )
        await communicate.save(output_path)
        return output_path

    async def health_check(self) -> bool:
        """检查 TTS 服务可用性。"""
        try:
            communicate = edge_tts.Communicate(text="测试", voice=self.voice)
            async for _ in communicate.stream():
                return True
            return False
        except Exception:
            return False


tts_service = TTSService()
