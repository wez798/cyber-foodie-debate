"""Offline Behave environment for deterministic debate acceptance tests."""

import json

from src.backend.services.llm_service import LLMCompletion
from src.backend.services.debate_service import DebateService


class FakeDebateLLM:
    """Return deterministic arguments and judgments without external I/O."""

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> LLMCompletion:
        del temperature, max_tokens
        prompt = messages[-1]["content"]
        if "公正主持人" not in messages[0]["content"]:
            content = "推荐时已遵守用户预算与忌口，并给出适合校园就餐的理由。"
            return LLMCompletion(content=content)

        dish = "番茄鸡蛋面（15元）"
        if "10元以下" in prompt:
            dish = "鸡蛋饼套餐（8元）"
        elif "20-30元" in prompt:
            dish = "菌菇鸡肉饭（25元）"
        elif "30元以上" in prompt:
            dish = "烤鸡营养套餐（36元）"
        if "海鲜过敏" in prompt:
            dish = "番茄鸡蛋面（15元）"

        content = json.dumps(
            {
                "winner": "cantonese_healthy",
                "recommendation": f"推荐{dish}，符合当前预算和饮食偏好。",
                "dish_name": dish,
                "restaurant": "校园二食堂",
                "confidence": 0.86,
            },
            ensure_ascii=False,
        )
        return LLMCompletion(content=content)


def before_scenario(context, scenario) -> None:
    """Give every scenario isolated state and an offline LLM."""
    del scenario
    context.preference = {}
    context.response = None
    context.debate_service = DebateService(llm=FakeDebateLLM())


def after_scenario(context, scenario) -> None:
    """Clear in-memory sessions after every scenario."""
    del scenario
    context.debate_service.sessions.clear()
