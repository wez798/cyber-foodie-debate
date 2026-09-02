# AGENTS.md - 团队 AI 规则注入与架构约束规范

## 项目概述

**Cyber Foodie Debate** - AI校园干饭辩论赛与美食擂台
基于敏捷方法的AI原生应用开发实践工程实训项目

## 技术栈约束

- **后端**: Python 3.11 + FastAPI + Pydantic v2
- **前端**: 原生 HTML/CSS/JS（MVP阶段）
- **LLM**: 硅基流动 DeepSeek-V4-Flash
- **TTS**: 微软 edge-tts（Sprint 3 接入）
- **测试**: pytest + behave (BDD)
- **容器**: Docker + docker-compose

## 协作范式

- 开发前先确认需求目标、影响范围和是否需要提交/推送。
- 修改代码前先检查 `git status`，阅读相关代码、测试和文档。
- 保持小步修改：一次只处理一个清晰的问题。
- 不做无关重构、无关格式化或大范围文件改动。
- 不主动执行 `commit`、`push`、`reset`、`merge` 等 Git 操作，除非用户明确要求。
- 不覆盖或删除用户已有改动；发现工作区有无关改动时保留并避开。
- 涉及远程仓库、CI、Docker、依赖规范等共享配置变更时，必须先获得确认。

## 代码规范

- 遵循 PEP 8，使用 ruff 自动格式化
- 所有 API 接口使用 Pydantic Schema 强校验
- 异步代码使用 async/await，禁止混用同步阻塞调用
- 异常处理使用 tenacity 指数退避重试
- 敏感信息（API Key）严禁硬编码，必须从 .env 读取

## 架构约束

- 后端采用分层架构：api -> services -> models
- 服务层禁止直接访问 HTTP 层，必须通过依赖注入
- 所有外部 API 调用必须封装在 services/ 目录
- 数据模型统一在 models.py 中定义

## Git 规范

- 分支模型：main（保护） <- develop <- feature/*
- Commit 信息：Angular 语义化规范
  - `feat: 新增辩论超时控制`
  - `fix: 修复LLM响应解析异常`
  - `test: 增加US01的BDD验收测试`
  - `docs: 更新Sprint 2报告`
- PR 必须至少一名组员 Review + CI 绿灯方可合并

## Prompt 工程规范

- 所有 LLM Prompt 必须使用 RTCO 结构化模板
- 系统 Prompt 必须包含角色设定 + 输出格式约束
- 禁止在 Prompt 中泄露 API Key 或内部架构信息
- 所有 LLM 输出必须经过 Pydantic Schema 校验后返回

## 安全防线

- 输入校验：所有用户输入经 Pydantic 校验
- 超时控制：LLM 调用设置 30s 超时 + 指数退避重试
- 频控：遵守硅基流动 API 频率限制
- Prompt 注入防护：系统 Prompt 与用户输入严格隔离
