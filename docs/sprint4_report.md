# Sprint 4 迭代报告 — CI/CD、开源发布与答辩

> 周期：Day 9 - Day 10

> 架构演进说明（2026-09）：前端已从 HTML/CSS/Vanilla JS 迁移到
> React 19 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui。本文保留 Sprint 4
> 的迭代背景；下方技术栈和当前状态已按迁移后的代码基线修订。

## Sprint 目标
配置 GitHub Actions 自动化测试，撰写 README，录制演示视频，现场答辩。

## 交付物清单

### 1. CI/CD 流水线
- [x] GitHub Actions 自动化测试配置
- [x] 代码质量卡点（ruff + mypy）
- [x] Docker 镜像构建验证
- [x] PR 合并保护策略

### 2. 开源发布
- [x] README.md 工业级文档
- [x] LICENSE (MIT)
- [x] CONTRIBUTING.md 贡献指南
- [x] 演示视频录制

### 3. 答辩准备
- [x] 答辩 PPT
- [x] 系统演示脚本
- [x] 项目亮点总结

### 4. 最终交付物
- [x] 公开 GitHub 仓库
- [x] Docker 镜像
- [x] 实训报告
- [x] 答辩 PPT

## 项目成果总结

### 功能完备性
| 功能模块 | 完成度 | 说明 |
|----------|--------|------|
| 饮食偏好输入 | 100% | 口味/预算/天气/忌口 |
| 双Agent辩论 | 100% | 3轮默认，1-5轮可配 |
| 结果判定 | 100% | 获胜方+菜品+置信度 |
| SSE 流式响应 | 100% | 实时辩论直播 |
| TTS 语音播报 | 100% | 微软 edge-tts |
| 响应式 UI | 100% | 移动端适配 |
| Docker 容器化 | 已适配 | FastAPI 后端 + Vite 构建/Nginx 前端 |
| CI/CD | 已完善 | 后端门禁、前端测试/类型/构建、Compose 构建 |

### 创新价值
1. **趣味性强**: 双AI对抗辩论形式，天然具有演示效果
2. **工程规范**: 完整遵循敏捷开发流程，4个Sprint迭代
3. **技术深度**: 多Agent编排、Prompt工程、防御性编程
4. **可扩展性**: 架构支持接入更多Agent人设和菜系

### 技术栈总览
- 后端: Python 3.11 / FastAPI / Pydantic v2 / httpx / tenacity
- 前端: React 19 / TypeScript / Vite / Tailwind CSS v4 / shadcn/ui
- AI: 硅基流动 DeepSeek-V4-Flash / 微软 edge-tts
- 工程: GitHub Actions / Docker / pytest / behave / Vitest / Testing Library

## Sprint 回顾
- **整体评价**: 项目在2周内完成了从0到1的完整交付
- **最大收获**: 深刻理解了敏捷迭代和AI原生应用开发的工程实践
- **改进方向**: 若能增加真实菜单数据接入和生图功能会更完善
