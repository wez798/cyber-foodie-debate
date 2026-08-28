# Contributing to Cyber Foodie Debate

感谢你对本项目的关注！欢迎通过 Issue 和 Pull Request 参与贡献。

## 开发环境搭建

```bash
# 1. 克隆仓库
git clone https://github.com/<your-org>/cyber-foodie-debate.git
cd cyber-foodie-debate

# 2. 创建开发分支
git checkout -b feature/your-feature-name

# 3. 安装依赖
pip install -r requirements.txt

# 4. 配置环境变量
cp .env.example .env
# 编辑 .env 填入硅基流动 API Key

# 5. 运行测试
pytest tests/ -v
behave tests/bdd/
```

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

## 测试要求

- 新增功能必须包含单元测试（pytest）
- 核心用户故事必须包含 BDD 验收测试（behave/Gherkin）
- 提交 PR 前确保所有测试通过：`pytest tests/ -v && behave tests/bdd/`

## 代码审查清单

提交 PR 前请确认：
- [ ] 代码遵循 Angular Commit 规范
- [ ] 无硬编码密钥/敏感信息
- [ ] 已通过本地 `ruff check` 与 `pytest`
- [ ] 已更新相关文档（README/docs）
- [ ] 至少一名组员已 Code Review
