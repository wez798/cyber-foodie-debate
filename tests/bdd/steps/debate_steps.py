"""BDD step definitions for the debate feature."""

import asyncio

from behave import given, then, when

from src.backend.models import (
    AgentPersona,
    DebateRequest,
    DebateStatus,
    FoodPreference,
)


EXPECTED_DISHES = {
    "10元以下": "鸡蛋饼套餐（8元）",
    "10-20元": "番茄鸡蛋面（15元）",
    "20-30元": "菌菇鸡肉饭（25元）",
    "30元以上": "烤鸡营养套餐（36元）",
}


def run_debate(context) -> None:
    """Run one debate against the scenario's injected offline service."""
    preference = FoodPreference(**context.preference)
    request = DebateRequest(preference=preference, max_rounds=3)
    context.response = asyncio.run(context.debate_service.start_debate(request))


@given('用户设置了口味偏好为 "{taste}"')
def step_given_taste(context, taste) -> None:
    context.preference["口味"] = taste


@given('用户设置了预算为 "{budget}"')
def step_given_budget(context, budget) -> None:
    context.preference["预算"] = budget


@given('用户设置了天气为 "{weather}"')
def step_given_weather(context, weather) -> None:
    context.preference["天气"] = weather


@given('用户设置了忌口为 "{allergy}"')
def step_given_allergy(context, allergy) -> None:
    context.preference["忌口"] = allergy


@given("一场辩论已完成")
def step_given_debate_completed(context) -> None:
    context.preference = {"口味": "辣", "预算": "10-20元"}
    run_debate(context)


@when('用户点击 "开始辩论"')
def step_when_start_debate(context) -> None:
    run_debate(context)


@when("辩论开始")
def step_when_debate_starts(context) -> None:
    run_debate(context)


@when("辩论结束")
def step_when_debate_ends(context) -> None:
    run_debate(context)


@when("用户查看辩论结果")
def step_when_view_result(context) -> None:
    assert context.response is not None


@then("系统应启动一场3轮辩论")
def step_then_3_round_debate(context) -> None:
    assert context.response is not None
    assert context.response.status == DebateStatus.COMPLETED
    assert len(context.response.rounds) == 6


@then("川辣派和粤式养生派应轮流发言")
def step_then_alternating_speakers(context) -> None:
    rounds = context.response.rounds
    for index in range(0, len(rounds), 2):
        assert rounds[index].speaker == AgentPersona.SICHUAN_SPICY
        assert rounds[index + 1].speaker == AgentPersona.CANTONESE_HEALTHY


@then("最终应输出推荐菜品和获胜方")
def step_then_output_recommendation(context) -> None:
    result = context.response.result
    assert result is not None
    assert result.dish_name
    assert result.winner in {
        AgentPersona.SICHUAN_SPICY,
        AgentPersona.CANTONESE_HEALTHY,
    }


@then("结果应包含获胜方")
def step_then_result_has_winner(context) -> None:
    result = context.response.result
    assert result is not None
    assert result.winner in {
        AgentPersona.SICHUAN_SPICY,
        AgentPersona.CANTONESE_HEALTHY,
    }


@then("结果应包含推荐菜品名称")
def step_then_result_has_dish(context) -> None:
    result = context.response.result
    assert result is not None
    assert result.dish_name.strip()


@then("结果应包含0到1之间的置信度")
def step_then_result_has_confidence(context) -> None:
    result = context.response.result
    assert result is not None
    assert 0.0 <= result.confidence <= 1.0


@then("两位大厨的推荐应避开海鲜类菜品")
def step_then_avoid_seafood(context) -> None:
    result = context.response.result
    assert result is not None
    content = " ".join(
        [result.dish_name, result.recommendation]
        + [round_.content for round_ in context.response.rounds]
    )
    for keyword in ["虾", "蟹", "鱼", "贝", "海鲜"]:
        assert keyword not in content, f"推荐内容包含忌口食材: {keyword}"


@then('推荐菜品价格应在 "{budget}" 范围内')
def step_then_price_in_budget(context, budget) -> None:
    result = context.response.result
    assert result is not None
    assert result.dish_name == EXPECTED_DISHES[budget]
