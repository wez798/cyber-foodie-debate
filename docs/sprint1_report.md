# Sprint 1 迭代报告 — 需求定义与 MVP 骨架

> 周期：Day 3 - Day 4

## Sprint 目标
完成核心需求拆解与系统骨架搭建，输出可运行的 API 连通测试 Demo。

## 交付物清单

### 1. GitHub Projects 看板任务拆解
- [x] US01: 用户提交饮食偏好并启动辩论 (8 SP)
- [x] US02: 双Agent多轮辩论与结果判定 (13 SP)
- [x] 系统架构设计与技术选型 (5 SP)
- [x] 后端 FastAPI 骨架搭建 (3 SP)
- [x] 前端静态页面骨架 (3 SP)
- [x] .env 配置与 API 连通测试 (2 SP)

### 2. 系统架构图
- 已完成 `docs/system_design.md`，包含三大模型6大架构图
- 用例图、数据流图、类图、ER图、时序图、状态机图

### 3. API 连通测试 Demo
- 硅基流动 DeepSeek-V4-Flash API 调通
- 基础 chat_completion 接口验证通过
- Pydantic Schema 校验层搭建完成

### 4. 仓库拓扑
- 完整 GitHub 仓库结构已建立
- CI/CD 流水线配置（GitHub Actions）
- Issue/PR 模板配置完成
- AGENTS.md 团队规则注入完成

## 技术决策记录

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 后端框架 | FastAPI | 异步原生、Pydantic 集成、自动文档 |
| 前端方案 | 原生 HTML/JS | MVP 阶段降低复杂度 |
| 数据存储 | JSON/内存 | Sprint 1-2 无需持久化 |
| LLM 模型 | DeepSeek-V4-Flash | 免费额度、中文能力强 |

## 风险与障碍
- 硅基流动 API 频率限制需关注（Sprint 2 加入重试机制）
- 前端流式响应需 Sprint 3 实现 SSE

## Sprint 回顾
- **做得好**: 架构设计完整，6大架构图一次到位
- **待改进**: 前端与后端联调需提前规划接口契约
- **下 Sprint 重点**: 核心辩论逻辑实现 + 多轮对话管理
