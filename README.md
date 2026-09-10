# Cyber Foodie Debate - AI校园干饭辩论赛与美食擂台

[![CI](https://github.com/wez798/cyber-foodie-debate/actions/workflows/ci.yml/badge.svg)](https://github.com/wez798/cyber-foodie-debate/actions)
[![Python 3.11](https://img.shields.io/badge/python-3.11-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> 🍔 川辣派 vs 粤式养生派 — 让两个AI大厨为你辩论今天吃什么！

面向校园“今天吃什么”的工程实践作品：可以与干饭搭子自由聊天，也可以让两位大厨围绕饮食偏好辩论并给出推荐。本项目已完成功能冻结，不以生产级账号平台为目标。

演示顺序见 [演示指南](docs/demo-guide.md)，实际验收结果与未验证项见 [最终交付报告](docs/final-delivery.md)。真实 AI 与语音需要外部网络；无授权或断网时可使用下述明确标注的离线演示。

## 系统架构图

```mermaid
graph TB
    subgraph 前端层
        A[用户浏览器] --> B[React + TypeScript]
        B --> C[Vite + Tailwind CSS v4 + shadcn/ui]
        B --> K[游客 localStorage]
    end

    subgraph 后端服务层
        C --> D[FastAPI API]
        D --> L[通用对话服务 ChatService]
        D --> M[认证与云端会话服务]
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
        M --> N[(PostgreSQL<br/>用户 / Session / 会话 / 消息)]
    end
```

## 快速启动

### 1. 环境准备

- Python 3.11
- Node.js 22.13+（或 24+）
- pnpm（项目锁定 11.19.0）
- PostgreSQL 17（真实云端数据运行环境；离线演示不需要）

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
SILICONFLOW_MAX_REQUESTS_PER_MINUTE=60
SILICONFLOW_MAX_CONCURRENCY=4
```

### 2. 本地开发启动

```bash
# 建议先创建并激活虚拟环境
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# PowerShell: .venv/Scripts/Activate.ps1

# 安装运行及测试依赖
python -m pip install -r requirements.txt

# 先在 PostgreSQL 中创建专用角色与数据库（见下文），再迁移
python -m alembic upgrade head
python -m alembic check

# 启动后端服务
python -m src.backend.main
```

本地 PostgreSQL 需先安装并启动。以下管理命令仅用于新建开发库，已有数据库请勿重复创建或清理：

```bash
createuser -h localhost -U postgres --pwprompt cyber_foodie
createdb -h localhost -U postgres --owner=cyber_foodie cyber_foodie
```

将该角色密码填入 `.env` 的 `DATABASE_URL`；URL 中的特殊字符必须正确编码。`POSTGRES_*` 用于 Compose 的数据库初始化，不能替代本地 PostgreSQL 安装；Compose 的 db 服务默认不向主机暴露 5432 端口。

另开终端启动前端：

```bash
cd src/frontend
pnpm install --frozen-lockfile
pnpm dev
```

前端辩论接口默认访问 `http://localhost:8000/api/v1`，聊天接口默认访问
`http://localhost:8000/api`。如后端地址不同，可分别设置
`VITE_API_BASE_URL` 和 `VITE_CHAT_API_BASE_URL`。未覆盖时，开发前端会使用当前页面的
协议与主机名连接其 `8000` 端口，避免 `localhost` 与 `127.0.0.1` 混用导致 Cookie
失效。建议在
`src/frontend/.env.local` 中保存本地前端配置；任何 `VITE_*` 变量都会进入浏览器包，
不得放入 API Key 或其他敏感信息。

访问 http://localhost:5173 使用前端，访问 http://localhost:8000/docs 查看 API 文档。

### 离线演示（不调用真实外部服务）

安装上述依赖后，在根目录运行 `python scripts/run_demo.py`。脚本新建临时 SQLite 并执行真实迁移，监听 `127.0.0.1:8000`；退出即删除本次演示数据，不连接 `.env` 中的数据库。固定回复明确标注“非真实 AI”，音频只是一段测试提示音，不是语音合成。

前端须使用专用 CSRF Cookie 名。在另一个 PowerShell 终端执行：

```powershell
cd src/frontend
$env:VITE_API_BASE_URL="http://localhost:8000/api/v1"
$env:VITE_CHAT_API_BASE_URL="http://localhost:8000/api"
$env:VITE_CSRF_COOKIE_NAME="cfd_demo_csrf"
pnpm dev
```

Bash 使用 `VITE_API_BASE_URL=http://localhost:8000/api/v1 VITE_CHAT_API_BASE_URL=http://localhost:8000/api VITE_CSRF_COOKIE_NAME=cfd_demo_csrf pnpm dev`。打开 `http://localhost:5173`。用隔离浏览器和测试账号；重启后需重新注册。`--tts-fail` 可演示语音服务失败；`--port` 与 `--frontend-origin` 支持独立端口。切回正常后端时恢复前端三个变量，Cookie 名须与后端配置一致。

### 3. Docker Compose 一键启动

```bash
docker compose up --build -d
docker compose ps
docker compose logs backend
```

Compose 要求先在 `.env` 中设置 `POSTGRES_PASSWORD`。生产 HTTPS 部署还必须设置
`SESSION_COOKIE_SECURE=true`，并把 `FRONTEND_ORIGINS` 改为实际前端来源的 JSON 数组；
这两个值会由 Compose 原样传给后端，不需要修改编排文件。

访问 http://localhost:3000 使用前端，访问 http://localhost:8000/docs 查看 API 文档。
前端镜像通过 pnpm 构建 Vite 产物，并由 Nginx 托管；`/chat`、`/chat/:id`、`/debate`、`/login`、`/register` 配置了 SPA 刷新回退，`/api/` 由 Nginx 反向代理到 FastAPI。后端容器检查 `/health/ready` 的数据库连接，
不会周期性调用 LLM 或 TTS。Nginx 对认证入口和其余 API 分别实施按 IP 限流；若前面
还有反向代理，应同时配置可信真实客户端 IP 传递规则。

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
│   │   ├── repositories/        # SQLAlchemy 数据访问层
│   │   ├── services/            # 业务逻辑层
│   │   ├── db_models.py         # SQLAlchemy 持久化实体
│   │   ├── models.py            # Pydantic 数据模型
│   │   ├── config.py            # 配置管理
│   │   └── app.py               # 应用工厂
│   └── frontend/                # React + TypeScript 独立前端应用
│       ├── src/
│       │   ├── components/ui/   # shadcn/ui 基础组件
│       │   ├── features/chat/   # 自由聊页面、状态、本地存储与 API
│       │   ├── features/debate/ # 辩论页面、状态与 API 逻辑
│       │   ├── lib/sse.ts       # POST SSE 流解析器
│       │   └── types/           # 聊天与辩论领域类型
│       ├── Dockerfile            # Vite 构建 + Nginx 运行镜像
│       ├── nginx.conf            # SPA 回退与 /api/ 反向代理
│       ├── package.json
│       └── vite.config.ts
├── tests/
│   ├── unit/                    # 单元测试
│   ├── integration/             # 认证与数据库集成测试
│   └── bdd/features/            # BDD 验收测试
├── alembic/                     # 数据库迁移
├── eval/                        # 评测数据集
├── .env.example                 # 环境变量模板
├── Dockerfile                   # FastAPI 后端镜像
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
| 对话历史       | 游客本地保存；登录用户云端分页持久化 | ✅ MVP  |
| TTS语音播报    | 微软TTS朗读辩论结果     | ✅ MVP      |
| 后端对话持久化 | PostgreSQL + Alembic，支持中断终态与幂等重放 | ✅ MVP |
| 账号与历史管理 | 注册/登录/退出、显式导入、归档/恢复/删除 | ✅ 已实现 |

## API 文档

启动服务后访问 http://localhost:8000/docs 查看交互式 API 文档（Swagger UI）。

### 核心接口

| 方法 | 路径                            | 描述     |
| ---- | ------------------------------- | -------- |
| GET | `/health/live`、`/health/ready` | 存活、数据库就绪；不调用外部服务 |
| GET  | `/api/v1/health` | 主动探测真实 LLM/TTS，会产生外部请求 |
| POST | `/api/chat`                   | 非流式对话兜底 |
| POST | `/api/chat/stream`            | POST SSE 流式对话 |
| POST | `/api/v1/auth/register`       | 注册并创建安全会话 |
| POST | `/api/v1/auth/login`          | 登录并创建安全会话 |
| POST | `/api/v1/auth/logout`         | 撤销当前会话 |
| GET  | `/api/v1/auth/me`             | 获取当前用户 |
| GET/POST | `/api/v1/conversations` | 分页查询/创建云端会话 |
| POST | `/api/v1/conversations/import` | 用户确认后幂等导入游客完整问答 |
| POST | `/api/v1/conversations/{id}/import/verify` | 有界核对原始导入快照 |
| GET/PATCH/DELETE | `/api/v1/conversations/{id}` | 查询、更新或软删除会话 |
| GET  | `/api/v1/conversations/{id}/messages` | 分页查询持久化消息 |
| POST | `/api/v1/conversations/{id}/messages/stream` | 持久化 POST SSE 对话 |
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
`not_requested`；语音仅用于辩论结果，聊天语音不在交付范围。

辩论流依次发送 `session_start`、多个 `round`、`result`；只有有效裁决才会发送
`result`。上游失败或整体超时时发送结构化 `error`，客户端不得把它显示为完成。
后端通过环境变量限制 SiliconFlow 每分钟请求数与进程内并发数。

前端通过顶部“功能页面”选择器在 `/chat` 与 `/debate` 之间切换。AI 回复会经过
安全的 Markdown 组件渲染，不会直接显示加粗、列表等 Markdown 源标记。

游客聊天历史只保存在浏览器 localStorage，键为
`cyber-foodie-debate:recent-chat`。登录后，前端改用受认证与 CSRF 保护的云端接口，
消息写入 PostgreSQL，打开会话时仅加载最近 50 条消息；点击顶部“加载更早消息”才请求上一页。
失败保留已显示内容，可重试当前页，会话列表继续支持“加载更多”。密码使用 Argon2id；浏览器
只持有 HttpOnly 不透明会话 Cookie 和可读的 CSRF Cookie，数据库仅保存令牌哈希。

## 本地历史导入

登录后，本地历史旁会显示消息数量、纯文本摘要和“保存当前本地会话”。只有主动点击才会上传，
超出限制会说明原因，不截断。可“暂不保存”继续云端聊天，也可取消正在进行的保存。
导入 ID 由当前用户与完整本地快照的 SHA-256 确定，网络失败或刷新后未变化的快照复用同一 ID，
无需另存认证信息。需要 HTTPS 或 localhost 的 Web Crypto 支持。

成功响应经运行时校验，再读取云端会话与有界消息页，核对导入的角色、正文、顺序、来源和状态，
打开云端会话并刷新列表。全部确认后，仅在本地快照仍相同时清理副本；清理同步更新游客内存。
所有本地写入与清理共用 Web Locks 跨标签页锁；浏览器不支持锁、内容已变化、读取失败或取消，
均保留本地数据。核对独立读取原始最多 50 条消息，追加大量消息或改名后仍可安全重试。
账号切换、登出或卸载会取消请求，旧响应不会导航或清理。密码和认证 Token 不存 localStorage。

### API 契约

`POST /api/v1/conversations/import` 使用登录 Cookie、允许的 Origin 和 CSRF 保护，
返回 `200 ConversationResponse`。请求必须包含 `expected_user_id`（确认时的账号 UUID）；
服务端写入前与认证账号比对，不一致返回 `409 auth_identity_changed`，不执行导入。
此字段只是前置条件，不能指定 owner，也不参与内容指纹。其余字段为 `import_request_id`（1–64 字符，
`[A-Za-z0-9][A-Za-z0-9._:-]*`）、可空 `topic`（去除首尾空白后最多 200 字符）和
`messages`（1–50 条，仅 `role` 与 `content`）。消息只能为 user/assistant，必须有
user，可结束于 assistant；每条正文 1–8000 字符且不能纯空白，正文原样保存，
正文与规范化 topic 合计最多 64000 Unicode 字符。未知字段返回 422。

同一用户相同 ID 和内容返回原会话；不同内容返回 `409 import_conflict`，
原会话软删除后返回 `409 import_deleted`，不恢复或重复创建。不同用户的 ID 独立。
导入为 chat，消息标记 `client_import/complete`，按请求顺序编号；全过程不调用 LLM/TTS。
导入后使用同一请求体调用 `POST /api/v1/conversations/{id}/import/verify`，权限校验与导入相同。
该接口比较原始 ID、不可变内容指纹及序号 1–N 的全部原始消息，N 最多 50；只执行一次有界读取，
返回 `{conversation_id, import_request_id, items}`，items 最多 50 条。原始记录不匹配为
`409 import_conflict`，消息核对失败为 `409 import_verification_failed`，无权限或软删除为 404。
追加消息或改名后仍可重放并核对；聊天视图单独读取最近一页，由用户主动加载更早消息。
账号变化、读取/核对失败或本地副本变化时保留本地内容，并要求重新确认账号后保存。
最终迁移 head 为 `20260908_0002`。部署前在已确认的目标数据库执行 `python -m alembic upgrade head`，
随后执行 `python -m alembic check`；升级已有数据前自行备份，禁止通过清库解决迁移问题。本阶段不含 OAuth、邮件验证、密码找回或辩论持久化。

## 数据与运行限制

- 游客完整聊天仅在当前浏览器保存；登录不会自动上传。开启新游客对话需确认清除，本地存储受浏览器容量与隐私设置影响。
- 云端会话按认证用户隔离；“已归档”入口可恢复会话，删除为软删除且 UI 不提供撤销。归档筛选逐页进行，不自动扫描全部历史。
- 辩论会话只在后端进程内存中，页面刷新不恢复辩论结果；重启后原结果语音不可合成，不支持多进程共享辩论状态。
- 真实 LLM 需要有效 `SILICONFLOW_API_KEY`、网络和额度；edge-tts 不需要本项目 API Key，但需要网络可达。语音失败不影响已有文字结果。本轮未获真实服务调用授权。
- 未实现修改密码、邮件验证、密码找回、OAuth、Session 管理页面、管理员后台或辩论持久化。
- `/health/live` 仅表示进程存活；`/health/ready` 仅表示数据库可连接，不代表已迁移或真实 AI 可用。先完成迁移再启动。不要把 `/api/v1/health` 用作默认离线检查。

## 技术栈

- **LLM**: 硅基流动 `deepseek-ai/DeepSeek-V4-Flash`
- **后端**: Python 3.11 / FastAPI / Pydantic v2
- **前端**: React 19 / TypeScript / Vite
- **UI**: Tailwind CSS v4 / shadcn/ui / Lucide React
- **TTS**: Microsoft edge-tts
- **测试**: pytest / behave (BDD) / Vitest / Testing Library
- **CI/CD**: GitHub Actions
- **容器**: Docker / Docker Compose

更完整的前后端分层、数据流、状态机和 SSE 时序见
[`docs/system_design.md`](docs/system_design.md)。

## 前端质量检查

在 `src/frontend` 目录执行：

```bash
pnpm test
pnpm typecheck
pnpm build
```

后端质量检查与完整贡献流程见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

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
