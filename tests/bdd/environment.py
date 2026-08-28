"""Behave environment setup for BDD tests."""


def before_all(context):
    """全局前置：初始化测试上下文。"""
    context.preference = {}
    context.response = None
    context.error = None
    context.error_status = None


def before_scenario(context, scenario):
    """每个 Scenario 前置：重置状态。"""
    context.preference = {}
    context.response = None
    context.error = None
    context.error_status = None


def after_scenario(context, scenario):
    """每个 Scenario 后置：清理会话数据。"""
    from src.backend.services.debate_service import debate_service
    debate_service.sessions.clear()
