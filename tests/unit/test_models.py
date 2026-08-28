"""Unit tests for Pydantic models."""

import pytest
from src.backend.models import (
    FoodPreference,
    DebateRound,
    DebateResult,
    DebateSession,
    DebateRequest,
    DebateResponse,
    DebateStatus,
    AgentPersona,
    HealthCheck,
)


class TestFoodPreference:
    def test_create_valid_preference(self):
        pref = FoodPreference(口味="辣", 预算="10-20元")
        assert pref.口味 == "辣"
        assert pref.预算 == "10-20元"
        assert pref.天气 is None
        assert pref.忌口 is None

    def test_create_full_preference(self):
        pref = FoodPreference(
            口味="清淡",
            预算="20-30元",
            天气="雨天",
            忌口="不吃香菜",
            其他要求="要热的",
        )
        assert pref.天气 == "雨天"
        assert pref.忌口 == "不吃香菜"


class TestDebateRound:
    def test_create_round(self):
        r = DebateRound(
            round_number=1,
            speaker=AgentPersona.SICHUAN_SPICY,
            content="麻辣火锅巴适得很！",
        )
        assert r.round_number == 1
        assert r.speaker == AgentPersona.SICHUAN_SPICY


class TestDebateResult:
    def test_create_result(self):
        result = DebateResult(
            winner=AgentPersona.SICHUAN_SPICY,
            recommendation="麻辣火锅",
            dish_name="麻辣火锅",
            confidence=0.85,
        )
        assert result.winner == AgentPersona.SICHUAN_SPICY
        assert result.confidence == 0.85

    def test_result_with_restaurant(self):
        result = DebateResult(
            winner=AgentPersona.CANTONESE_HEALTHY,
            recommendation="清蒸鲈鱼",
            dish_name="清蒸鲈鱼",
            restaurant_suggestion="学校二食堂",
            confidence=0.9,
        )
        assert result.restaurant_suggestion == "学校二食堂"


class TestDebateRequest:
    def test_default_personas(self):
        req = DebateRequest(
            preference=FoodPreference(口味="辣", 预算="10-20元"),
        )
        assert req.agent_a_persona == AgentPersona.SICHUAN_SPICY
        assert req.agent_b_persona == AgentPersona.CANTONESE_HEALTHY
        assert req.max_rounds == 3

    def test_custom_personas(self):
        req = DebateRequest(
            preference=FoodPreference(口味="清淡", 预算="20-30元"),
            agent_a_persona=AgentPersona.CUSTOM,
            agent_b_persona=AgentPersona.CUSTOM,
            max_rounds=5,
        )
        assert req.max_rounds == 5


class TestHealthCheck:
    def test_default_health(self):
        h = HealthCheck()
        assert h.status == "ok"
        assert h.version == "0.1.0"
        assert h.llm_available is False
