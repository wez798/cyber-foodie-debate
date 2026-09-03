# Cyber Foodie Debate - AI校园干饭辩论赛与美食擂台

[![CI](https://github.com/wez798/cyber-foodie-debate/actions/workflows/ci.yml/badge.svg)](https://github.com/wez798/cyber-foodie-debate/actions)
[![Python 3.11](https://img.shields.io/badge/python-3.11-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> 🍔 川辣派 vs 粤式养生派 — 让两个AI大厨为你辩论今天吃什么！

## 系统架构图

```mermaid
graph TB
    subgraph 前端层
        A[用户浏览器] --> B[React + TypeScript]
        B --> C[Vite + Tailwind CSS v4 + shadcn/ui]
        B --> K[localStorage 最近对话]
    end

    subgraph 后端服务层
        C --> D[FastAPI API]
        D --> L[通用对话服务 ChatService]
        D --> E[辩论编排服务 DebateService]
        L --> F[LLM 调用服务]
        E --> F[LLM 调用服务]
        E --> G[TTS 语音服务]
    end

    subgraph 外部服务
        F --> H[硅基流动 deepseek-ai/DeepSeek-V4-Flash]
        G --> I[微软 edge-tts]
    end

    subgraph 数据层
        E --> J[内存辩论会话]
    end
```

## 快速启动

### 1. 环境准备

```bash
# 克隆仓库
git clone https://github.com/wez798/cyber-foodie-debate.git
cd cyber-foodie-debate

# 复制环境变量模板
cp .env.example .env
# 编辑 .env 填入硅基流动 API Key
```

对话功能所需的配置如下，API Key 只保存在本地 `.env`，不要提交到仓库：

```dotenv
SILICONFLOW_API_KEY=your_siliconflow_api_key_here
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_MODEL=deepseek-ai/DeepSeek-V4-Flash
```

### 2. 本地开发启动

```bash
# 安装后端依赖
pip install -r src/backend/requirements.txt

# 启动后端服务
python -m src.backend.main
```

另开终端启动前端：

```bash
cd src/frontend
pnpm install
pnpm dev
```

前端辩论接口默认访问 `http://localhost:8000/api/v1`，聊天接口默认访问
`http://localhost:8000/api`。如后端地址不同，可分别设置
`VITE_API_BASE_URL` 和 `VITE_CHAT_API_BASE_URL`。

访问 http://localhost:5173 使用前端，访问 http://localhost:8000/docs 查看 API 文档。

### 3. Docker 一键启动

```bash
docker-compose up --build
```

当前 Docker 配置尚未接入 Vite 前端构建流程。本地前端开发请使用 `pnpm dev`，Docker
适配将在后续变更中单独完成。

## 项目结构

```
cyber-foodie-debate/
├── .github/
│   ├── workflows/ci.yml         # GitHub Actions CI 流水线
│   ├── ISSUE_TEMPLATE/          # Issue 模板
│   └── PULL_REQUEST_TEMPLATE.md # PR 审查模板
├── docs/
│   ├── system_design.md         # 系统架构设计（6大架构图）
│   ├── user_stories/            # User Story 文档集
│   └── sprint{1-4}_report.md    # Sprint 迭代报告
├── src/
│   ├── backend/                 # FastAPI 后端服务
│   │   ├── api/                 # API 路由层
│   │   ├── services/            # 业务逻辑层
│   │   ├── models.py            # Pydantic 数据模型
│   │   ├── config.py            # 配置管理
│   │   └── app.py               # 应用工厂
│   └── frontend/                # React + TypeScript 独立前端应用
│       ├── src/
│       │   ├── components/ui/   # shadcn/ui 基础组件
│       │   ├── features/debate/ # 辩论页面、状态与 API 逻辑
│       │   ├── lib/sse.ts       # POST SSE 流解析器
│       │   └── types/debate.ts  # 辩论领域类型
│       ├── package.json
│       └── vite.config.ts
├── tests/
│   ├── unit/                    # 单元测试
│   └── bdd/features/            # BDD 验收测试
├── eval/                        # 评测数据集
├── .env.example                 # 环境变量模板
├── Dockerfile                   # 容器化封装
├── docker-compose.yml           # 编排启动
├── AGENTS.md                    # AI 规则注入
└── README.md                    # 本文件
```

## 核心功能

| 功能           | 描述                    | 状态        |
| -------------- | ----------------------- | ----------- |
| 饮食偏好输入   | 口味/预算/天气/忌口     | ✅ MVP      |
| 双Agent辩论    | 川辣派 vs 粤式养生派    | ✅ MVP      |
| 辩论结果判定   | 自动判定获胜方+推荐菜品 | ✅ MVP      |
| 流式响应       | POST SSE 实时辩论直播   | ✅ MVP      |
| 双页面交互     | 自由聊与辩论赛独立切换  | ✅ MVP      |
| 自由聊推荐     | 推荐能力内置且 Prompt 模式不可见 | ✅ MVP |
| 对话历史       | 浏览器 localStorage 最近会话 | ✅ MVP  |
| TTS语音播报    | 微软TTS朗读辩论结果     | ✅ MVP      |
| 后端对话持久化 | conversation_id 已预留  | 🔄 后续     |
| GitHub API集成 | 自动获取commit生成梗图  | ❌ 规划中   |

## API 文档

启动服务后访问 http://localhost:8000/docs 查看交互式 API 文档（Swagger UI）。

### 核心接口

| 方法 | 路径                            | 描述     |
| ---- | ------------------------------- | -------- |
| GET  | `/api/v1/health`              | 健康检查 |
| POST | `/api/chat`                   | 非流式对话兜底 |
| POST | `/api/chat/stream`            | POST SSE 流式对话 |
| POST | `/api/v1/debate/start`        | 启动辩论 |
| POST | `/api/v1/debate/start-stream` | 流式启动三轮辩论 |
| GET  | `/api/v1/debate/{session_id}` | 查询会话 |
| POST | `/api/v1/tts/synthesize-debate-result` | 合成辩论结果语音 |

### 对话请求

`POST /api/chat` 与 `POST /api/chat/stream` 使用相同请求体。最后一条消息必须是
`user`，客户端不能提交 `system` 角色：

```json
{
  "conversation_id": null,
  "messages": [
    {"role": "user", "content": "预算 20 元，午饭吃什么？"}
  ],
  "mode": "recommend",
  "topic": "校园午饭",
  "metadata": {"client": "web"}
}
```

`mode` 可取 `chat`、`debate_pro`、`debate_con`、`judge`、`recommend`。
这些模式属于后端扩展能力；当前前端自由聊固定使用 `chat`，推荐能力已合并其中，
正反方和主持裁决则由独立的辩论页面负责，不向用户展示 Prompt 模式切换。
流式接口依次发送 `start`、多个 `delta`、`done` SSE 事件；若响应头已发出后
上游失败，则发送 `error` 事件。当前聊天响应中的 `tts.status` 固定为
`not_requested`，仅作为下一步接入 edge-tts 的扩展点。

前端通过顶部“功能页面”选择器在 `/chat` 与 `/debate` 之间切换。AI 回复会经过
安全的 Markdown 组件渲染，不会直接显示加粗、列表等 Markdown 源标记。

聊天历史只保存在浏览器 localStorage，键为
`cyber-foodie-debate:recent-chat`，内容包含 `conversation_id`、`messages`、
`mode`、`topic` 和 `updated_at`；后端当前不保存聊天内容。

## 技术栈

- **LLM**: 硅基流动 `deepseek-ai/DeepSeek-V4-Flash`
- **后端**: Python 3.11 / FastAPI / Pydantic v2
- **前端**: React 19 / TypeScript / Vite
- **UI**: Tailwind CSS v4 / shadcn/ui / Lucide React
- **TTS**: Microsoft edge-tts
- **测试**: pytest / behave (BDD) / Vitest / Testing Library
- **CI/CD**: GitHub Actions
- **容器**: Docker / docker-compose

## 前端质量检查

在 `src/frontend` 目录执行：

```bash
pnpm test
pnpm typecheck
pnpm build
```

## 团队与贡献

| 角色          | 成员 | 职责                    |
| ------------- | ---- | ----------------------- |
| Product Owner | -    | 需求优先级、Backlog管理 |
| Scrum Master  | -    | 敏捷流程、障碍清除      |
| Developer     | -    | 全栈开发                |
| Developer     | -    | 全栈开发                |
| Developer     | -    | 全栈开发                |

## License

MIT License - 本项目为工程实训教学用途。
