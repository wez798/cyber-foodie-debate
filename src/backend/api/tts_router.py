"""TTS API routes."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from ..services.tts_service import tts_service

router = APIRouter()


class TTSRequest(BaseModel):
    """TTS 合成请求。"""
    text: str = Field(..., description="待合成文本", min_length=1, max_length=2000)
    voice: str | None = Field(None, description="语音角色，默认使用配置值")
    rate: str | None = Field(None, description="语速，如 +10%")
    pitch: str | None = Field(None, description="音调，如 +5Hz")


class TTSResponse(BaseModel):
    """TTS 合成响应。"""
    status: str
    audio_format: str = "mp3"
    message: str


@router.post("/tts/synthesize")
async def synthesize_speech(request: TTSRequest):
    """合成语音并返回音频流。"""
    try:
        audio_data = await tts_service.synthesize(
            text=request.text,
            voice=request.voice,
            rate=request.rate,
            pitch=request.pitch,
        )
        return StreamingResponse(
            iter([audio_data]),
            media_type="audio/mpeg",
            headers={"Content-Disposition": "inline; filename=speech.mp3"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS 合成失败: {str(e)}")


@router.post("/tts/synthesize-debate-result")
async def synthesize_debate_result(session_id: str):
    """根据辩论会话 ID 合成结果播报音频。"""
    from ..services.debate_service import debate_service

    session = debate_service.get_session(session_id)
    if not session or not session.result:
        raise HTTPException(status_code=404, detail="会话不存在或辩论未完成")

    result = session.result
    winner_name = "川辣派老麻" if result.winner.value == "sichuan_spicy" else "粤式养生派阿靓"
    tts_text = (
        f"辩论结束！获胜方是{winner_name}。"
        f"推荐菜品：{result.dish_name}。"
        f"置信度：{int(result.confidence * 100)}%。"
    )
    if result.restaurant_suggestion:
        tts_text += f"推荐餐厅：{result.restaurant_suggestion}。"

    try:
        audio_data = await tts_service.synthesize(text=tts_text)
        return StreamingResponse(
            iter([audio_data]),
            media_type="audio/mpeg",
            headers={"Content-Disposition": "inline; filename=debate_result.mp3"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS 合成失败: {str(e)}")
