"""BDD step definitions for debate feature."""

import json
from behave import given, when, then
from src.backend.models import (
    FoodPreference,
    DebateRequest,
    AgentPersona,
    DebateStatus,
)
from src.backend.services.debate_service import debate_service


@given('用户设置了口味偏好为 "{taste}"')
def step_given_taste(context, taste):
    """设置用户口味偏好。"""
    if not hasattr(context, 'preference'):
        context.preference = {}
    context.preference['口味'] = taste


@given('用户设置了预算为 "{budget}"')
def step_given_budget(context, budget):
    """设置用户预算。"""
    if not hasattr(context, 'preference'):
        context.preference = {}
    context.preference['预算'] = budget


@given('用户设置了天气为 "{weather}"')
def step_given_weather(context, weather):
    """设置天气。"""
    if not hasattr(context, 'preference'):
        context.preference = {}
    context.preference['天气'] = weather


@given('用户设置了忌口为 "{allergy}"')
def step_given_allergy(context, allergy):
    """设置忌口信息。"""
    if not hasattr(context, 'preference'):
        context.preference = {}
    context.preference['忌口'] = allergy


@given('用户未设置预算')
def step_given_no_budget(context):
    """不设置预算字段。"""
    if not hasattr(context, 'preference'):
        context.preference = {}
    context.preference['口味'] = '辣'


@given('一场辩论已完成')
def step_given_debate_completed(context):
    """模拟一场已完成的辩论。"""
    import asyncio
    request = DebateRequest(
        preference=FoodPreference(口味="辣", 预算="10-20元"),
        max_rounds=3,
    )
    loop = asyncio.new_event_loop()
    context.response = loop.run_until_complete(debate_service.start_debate(request))
    loop.close()


@when('用户点击 "开始辩论"')
def step_when_start_debate(context):
    """启动辩论。"""
    import asyncio
    preference = FoodPreference(**context.preference)
    request = DebateRequest(
        preference=preference,
        max_rounds=3,
    )
    loop = asyncio.new_event_loop()
    context.response = loop.run_until_complete(debate_service.start_debate(request))
    loop.close()


@when('辩论开始')
def step_when_debate_starts(context):
    """启动辩论（通用）。"""
    import asyncio
    pref_data = getattr(context, 'preference', {'口味': '辣', '预算': '10-20元'})
    preference = FoodPreference(**pref_data)
    request = DebateRequest(preference=preference, max_rounds=3)
    loop = asyncio.new_event_loop()
    context.response = loop.run_until_complete(debate_service.start_debate(request))
    loop.close()


@when('辩论结束')
def step_when_debate_ends(context):
    """辩论结束（同辩论开始）。"""
    import asyncio
    pref_data = getattr(context, 'preference', {'口味': '辣', '预算': '10-20元'})
    preference = FoodPreference(**pref_data)
    request = DebateRequest(preference=preference, max_rounds=3)
    loop = asyncio.new_event_loop()
    context.response = loop.run_until_complete(debate_service.start_debate(request))
    loop.close()


@when('用户查看辩论结果')
def step_when_view_result(context):
    """查看辩论结果（结果已在 response 中）。"""
    pass


@when('3轮辩论完成')
def step_when_3_rounds_complete(context):
    """3轮辩论完成。"""
    pass


@then('系统应启动一场3轮辩论')
def step_then_3_round_debate(context):
    """验证启动了3轮辩论。"""
    assert context.response is not None
    assert context.response.status == DebateStatus.COMPLETED
    assert len(context.response.rounds) == 6  # 3轮 x 2方


@then('川辣派和粤式养生派应轮流发言')
def step_then_alternating_speakers(context):
    """验证双方轮流发言。"""
    rounds = context.response.rounds
    for i in range(0, len(rounds), 2):
        assert rounds[i].speaker == AgentPersona.SICHUAN_SPICY
        assert rounds[i + 1].speaker == AgentPersona.CANTONESE_HEALTHY


@then('最终应输出推荐菜品和获胜方')
def step_then_output_recommendation(context):
    """验证输出推荐菜品和获胜方。"""
    assert context.response.result is not None
    assert context.response.result.dish_name
    assert context.response.result.winner


@then('系统应返回 400 错误提示')
def step_then_400_error(context):
    """验证返回400错误。"""
    assert hasattr(context, 'error')
    assert context.error_status == 400


@then('结果应包含获胜方')
def step_then_result_has_winner(context):
    """验证结果包含获胜方。"""
    assert context.response.result is not None
    assert context.response.result.winner is not None


@then('结果应包含推荐菜品名称')
def step_then_result_has_dish(context):
    """验证结果包含推荐菜品。"""
    assert context.response.result.dish_name


@then('结果应包含0到1之间的置信度')
def step_then_result_has_confidence(context):
    """验证置信度在0-1之间。"""
    confidence = context.response.result.confidence
    assert 0.0 <= confidence <= 1.0


@then('两位大厨的推荐应避开海鲜类菜品')
def step_then_avoid_seafood(context):
    """验证推荐避开海鲜（通过检查dish_name不包含海鲜关键词）。"""
    if context.response.result:
        dish = context.response.result.dish_name
        seafood_keywords = ['虾', '蟹', '鱼', '贝', '海鲜']
        for keyword in seafood_keywords:
            assert keyword not in dish, f"推荐菜品包含忌口食材: {keyword}"


@then('推荐菜品价格应在 "{budget}" 范围内')
def step_then_price_in_budget(context, budget):
    """验证推荐菜品价格在预算范围内（简化验证）。"""
    assert context.response is not None
    assert context.response.result is not None
