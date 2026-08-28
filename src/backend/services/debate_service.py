"""Debate orchestration service - Multi-Agent debate controller."""

import uuid
import json
from datetime import datetime
from typing import Optional

from ..models import (
    DebateSession,
    DebateRound,
    DebateResult,
    DebateRequest,
    DebateResponse,
    DebateStatus,
    AgentPersona,
    FoodPreference,
)
from ..services.llm_service import llm_service


PERSONA_PROMPTS = {
    AgentPersona.SICHUAN_SPICY: (
        "你是「川辣派」AI大厨老麻，性格豪爽火爆，坚信「无辣不欢」。"
        "你推荐菜品时总是强调麻辣鲜香、重口味刺激，认为人生苦短必须吃辣。"
        "你的语言风格：四川方言味、热情洋溢、喜欢用「巴适」「安逸」「辣得跳」等词汇。"
    ),
    AgentPersona.CANTONESE_HEALTHY: (
        "你是「粤式养生派」AI大厨阿靓，性格温和儒雅，坚信「食补养生」。"
        "你推荐菜品时总是强调清淡鲜美、营养均衡、药食同源，认为健康才是第一。"
        "你的语言风格：粤语味、温文尔雅、喜欢用「靓汤」「养生」「原汁原味」等词汇。"
    ),
}

DEBATE_SYSTEM_PROMPT = (
    "你是一个校园美食辩论赛的主持人。两个AI大厨正在为用户推荐今天吃什么。\n"
    "请根据用户的饮食偏好，让两位大厨进行辩论，最终给出推荐结论。\n"
    "辩论规则：\n"
    "1. 每位大厨轮流发言，阐述推荐菜品的理由\n"
    "2. 可以反驳对方的观点\n"
    "3. 最终由你作为主持人判定获胜方并给出推荐\n"
)


class DebateService:
    """辩论编排服务。"""

    def __init__(self):
        self.sessions: dict[str, DebateSession] = {}

    async def start_debate(self, request: DebateRequest) -> DebateResponse:
        """启动一场辩论会话。"""
        session_id = str(uuid.uuid4())[:8]
        session = DebateSession(
            session_id=session_id,
            preference=request.preference,
            agent_a_persona=request.agent_a_persona,
            agent_b_persona=request.agent_b_persona,
            status=DebateStatus.RUNNING,
        )
        self.sessions[session_id] = session

        rounds = []
        for i in range(1, request.max_rounds + 1):
            round_a = await self._generate_argument(
                session, request.agent_a_persona, request.preference, i, rounds
            )
            rounds.append(round_a)

            round_b = await self._generate_argument(
                session, request.agent_b_persona, request.preference, i, rounds
            )
            rounds.append(round_b)

        result = await self._judge_debate(session, rounds)
        session.rounds = rounds
        session.result = result
        session.status = DebateStatus.COMPLETED
        session.completed_at = datetime.now()

        return DebateResponse(
            session_id=session_id,
            status=DebateStatus.COMPLETED,
            rounds=rounds,
            result=result,
        )

    async def _generate_argument(
        self,
        session: DebateSession,
        persona: AgentPersona,
        preference: FoodPreference,
        round_num: int,
        previous_rounds: list[DebateRound],
    ) -> DebateRound:
        """生成单轮辩论发言。"""
        system_prompt = PERSONA_PROMPTS.get(persona, "你是一个美食推荐AI。")

        context = self._build_context(preference, previous_rounds, round_num)

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": context},
        ]

        try:
            response = await llm_service.chat_completion(messages, temperature=0.8)
            content = response.get("choices", [{}])[0].get("message", {}).get("content", "")
        except Exception:
            content = f"[{persona.value}] 第{round_num}轮发言生成失败，请稍后重试。"

        return DebateRound(
            round_number=round_num,
            speaker=persona,
            content=content,
        )

    async def _judge_debate(
        self, session: DebateSession, rounds: list[DebateRound]
    ) -> DebateResult:
        """判定辩论结果。"""
        judge_prompt = (
            f"以下是两位AI大厨的辩论记录：\n\n"
            f"用户偏好：{session.preference.model_dump_json()}\n\n"
        )
        for r in rounds:
            judge_prompt += f"第{r.round_number}轮 - {r.speaker.value}:\n{r.content}\n\n"

        judge_prompt += (
            "请作为主持人判定：\n"
            "1. 哪方获胜（sichuan_spicy 或 cantonese_healthy）\n"
            "2. 推荐的具体菜品名称\n"
            "3. 推荐餐厅建议（可选）\n"
            "4. 置信度（0-1）\n"
            "请严格按以下JSON格式返回：\n"
            '{"winner": "sichuan_spicy", "dish": "菜名", "restaurant": "餐厅建议", "confidence": 0.8}'
        )

        messages = [
            {"role": "system", "content": "你是美食辩论赛主持人，请公正评判。"},
            {"role": "user", "content": judge_prompt},
        ]

        try:
            response = await llm_service.chat_completion(messages, temperature=0.3)
            content = response.get("choices", [{}])[0].get("message", {}).get("content", "")
            result_data = json.loads(content)
            return DebateResult(
                winner=AgentPersona(result_data.get("winner", "sichuan_spicy")),
                recommendation=result_data.get("dish", "待定"),
                dish_name=result_data.get("dish", "待定"),
                restaurant_suggestion=result_data.get("restaurant"),
                confidence=float(result_data.get("confidence", 0.5)),
            )
        except (json.JSONDecodeError, Exception):
            return DebateResult(
                winner=AgentPersona.SICHUAN_SPICY,
                recommendation="麻辣火锅",
                dish_name="麻辣火锅",
                confidence=0.5,
            )

    def _build_context(
        self,
        preference: FoodPreference,
        previous_rounds: list[DebateRound],
        current_round: int,
    ) -> str:
        """构建辩论上下文。"""
        context = f"用户饮食偏好：\n"
        context += f"- 口味：{preference.口味}\n"
        context += f"- 预算：{preference.预算}\n"
        if preference.天气:
            context += f"- 天气：{preference.天气}\n"
        if preference.忌口:
            context += f"- 忌口：{preference.忌口}\n"

        if previous_rounds:
            context += "\n之前的辩论记录：\n"
            for r in previous_rounds:
                context += f"第{r.round_number}轮 {r.speaker.value}: {r.content[:100]}...\n"

        context += f"\n现在是第{current_round}轮，请发表你的观点并反驳对方。"
        return context

    def get_session(self, session_id: str) -> Optional[DebateSession]:
        """获取会话状态。"""
        return self.sessions.get(session_id)


debate_service = DebateService()
