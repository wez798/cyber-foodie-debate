# Contributing to Cyber Foodie Debate

感谢你对本项目的关注！欢迎通过 Issue 和 Pull Request 参与贡献。

## 开发环境搭建

本项目需要 Python 3.11、Node.js 22.13+（或 24+）和 pnpm。

```bash
# 1. 克隆仓库
git clone https://github.com/wez798/cyber-foodie-debate.git
cd cyber-foodie-debate

# 2. 创建开发分支
git checkout -b feature/your-feature-name

# 3. 安装后端依赖
pip install -r requirements.txt

# 4. 配置环境变量
cp .env.example .env
# 编辑 .env 填入硅基流动 API Key

# 5. 安装前端依赖
cd src/frontend
pnpm install --frozen-lockfile
```

本地开发时，在仓库根目录启动后端：

```bash
python -m src.backend.main
```

另开终端启动 Vite 前端：

```bash
cd src/frontend
pnpm dev
```

默认访问 `http://localhost:5173`。后端地址不是 `http://localhost:8000` 时，
请在 `src/frontend/.env.local` 中配置 `VITE_API_BASE_URL` 和
`VITE_CHAT_API_BASE_URL`，不要把密钥写入任何 `VITE_*` 变量。

也可以在仓库根目录启动完整容器环境：

```bash
docker compose up --build
```

容器前端位于 `http://localhost:3000`，并通过 Nginx 的 `/api/` 代理访问后端。

## 分支模型

本项目采用 Git Flow 简化分支模型：

```
main（保护分支）
  └── develop（集成分支）
        └── feature/*（功能分支）
```

- `main`：生产环境代码，禁止直接推送
- `develop`：日常开发集成分支
- `feature/*`：新功能开发分支，完成后通过 PR 合并到 `develop`

## Commit 规范

采用 Angular 语义化提交规范：

```
<type>: <subject>

<body>
```

Type 类型：
- `feat`: 新功能
- `fix`: 缺陷修复
- `docs`: 文档变更
- `style`: 代码格式（不影响功能）
- `refactor`: 重构
- `test`: 测试相关
- `chore`: 构建/工具链变更

示例：
```
feat: 新增辩论超时控制
fix: 修复LLM响应解析异常
test: 增加US01的BDD验收测试
docs: 更新Sprint 2报告
```

## Pull Request 流程

1. 从 `develop` 创建功能分支 `feature/xxx`
2. 在功能分支上开发并提交（遵循 Commit 规范）
3. 推送分支到远程仓库
4. 创建 PR 到 `develop` 分支
5. 至少一名组员 Code Review 批准
6. GitHub Actions CI 绿灯通过
7. 合并到 `develop`

## 代码规范

- 遵循 PEP 8，使用 `ruff` 自动格式化
- 异步代码使用 `async/await`，禁止混用同步阻塞调用
- 所有 API 接口使用 Pydantic Schema 强校验
- 敏感信息（API Key）严禁硬编码，必须从 `.env` 读取
- 外部 API 调用使用 `tenacity` 指数退避重试
- TypeScript 保持 strict 模式，业务模块放在 `src/frontend/src/features/`
- 优先复用 `src/frontend/src/components/ui/` 中的 shadcn/ui 组件
- 浏览器端 API 契约变更必须同步更新 TypeScript 类型与测试

## 测试要求

- 后端新增功能必须包含单元测试（pytest）
- 前端新增功能必须包含 Vitest/Testing Library 测试
- 核心用户故事必须包含 BDD 验收测试（behave/Gherkin）
- 流式交互至少覆盖正常完成、错误事件、取消和响应提前结束

提交 PR 前分别执行：

```bash
# 仓库根目录
ruff check src tests scripts
ruff format --check src tests scripts
mypy src --ignore-missing-imports
pytest tests/unit -v
behave tests/bdd

# src/frontend
pnpm test
pnpm typecheck
pnpm build
```

BDD 和连通性测试必须隔离或显式标记真实外部服务调用，默认测试不得消耗真实 API 配额。
需要验证真实外部服务时，单独执行 `python scripts/test_api_connectivity.py`；任一服务
连通失败时脚本会返回非零退出码。

## 代码审查清单

提交 PR 前请确认：
- [ ] 代码遵循 Angular Commit 规范
- [ ] 无硬编码密钥/敏感信息
- [ ] 后端 lint、类型检查、单元测试和 BDD 均通过
- [ ] 前端测试、类型检查和生产构建均通过
- [ ] 前后端 API 类型、SSE 事件和错误处理保持一致
- [ ] 若修改前端路由或构建方式，已同步验证生产静态部署
- [ ] 已更新相关文档（README/docs）
- [ ] 至少一名组员已 Code Review
