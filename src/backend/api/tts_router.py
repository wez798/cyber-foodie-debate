"""TTS API routes."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from ..models import TTSRequest
from ..services.tts_service import TTSServiceError, tts_service

router = APIRouter()


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
    except TTSServiceError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(
            status_code=500, detail="语音合成服务异常，请稍后重试"
        ) from error


@router.post("/tts/synthesize-debate-result")
async def synthesize_debate_result(session_id: str):
    """根据辩论会话 ID 合成结果播报音频。"""
    from ..services.debate_service import debate_service

    session = debate_service.get_session(session_id)
    if not session or not session.result:
        raise HTTPException(status_code=404, detail="会话不存在或辩论未完成")

    result = session.result
    winner_name = (
        "川辣派老麻" if result.winner.value == "sichuan_spicy" else "粤式养生派阿靓"
    )
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
    except TTSServiceError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(
            status_code=500, detail="语音合成服务异常，请稍后重试"
        ) from error
