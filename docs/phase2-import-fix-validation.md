# 第二阶段导入修复验证（2026-09-09）

## 修复范围

- P1：导入及原始核对要求 `expected_user_id`，在服务端认证、Origin、CSRF 校验后与实际身份比对；不一致 `409 auth_identity_changed`，不调用写入服务。owner 仅来自认证。
- 前端跨标签页只传递随机认证 revision；立即取消旧导入、分页、SSE，恢复 `/auth/me`。内存中的 Cookie/revision 检查覆盖同步延迟，Web Lock 内再次检查身份与完整快照。已处理的旧响应不会重复刷新新账号。
- P2：新增 `POST /conversations/{id}/import/verify`，使用相同确认请求体，比较原始请求 ID、不可变指纹及序号 1–N 的原始内容，最多读取 50 条。聊天展示独立读取最近 50 条，追加、改名不影响核对。
- 未修改数据库实体、已发布迁移、导入限制、原子事务、幂等冲突、软删除、认证/CSRF/Origin 规则。

## 自动验证

已检查 fixture 和外部服务替身：集成测试显式使用新建、可销毁的专用 SQLite 文件；LLM 使用 fake/MockTransport，BDD 数据库位于 TemporaryDirectory，不调用真实 SiliconFlow 或 edge-tts。未使用 `.env` 中的数据库进行测试或清表。

| 检查 | 结果 |
| --- | --- |
| `ruff check src tests scripts` | 通过 |
| `ruff format --check src tests scripts` | 通过，43 个文件 |
| `mypy src --ignore-missing-imports` | 通过，24 个源文件 |
| `pytest tests/unit -v` | 73 通过 |
| `pytest tests/integration -v` | 22 通过（SQLite） |
| `behave tests/bdd` | 2 features、10 scenarios、42 steps 通过 |
| `pnpm test` | 104 通过（含用户已有页头测试） |
| `pnpm typecheck`、`pnpm build` | 通过 |
| 单独导出暂存版本验证 | 97 个前端测试、typecheck、build；后端全部检查通过，不依赖用户未暂存文件 |
| 一次性数据库 `alembic upgrade head`、`alembic check` | 通过（SQLite） |
| 第一阶段 `20260906_0001` 带数据升级到 head | 集成迁移测试通过，用户、会话和消息保留 |

新增回归覆盖实际 Cookie 切换而不 rerender userId、预检后 POST 前切换、提交/核对/清理锁期间切换、迟到响应、跨标签页退出响应、50 条快照追加 2/206 条后重放、改名、损坏核对、存储失败、另一标签页更新完整快照及分页取消。既有分页与 SSE 两种完成顺序、登录恢复和内存同步测试继续通过。

## Chrome 实际共享 Cookie 验收

使用两个 Chrome 标签页、独立端口、专用 Cookie 名称、一次性 SQLite 数据库及 fake LLM。临时控制台仅用于注入确定性故障和显示请求证据，不进入提交。

1. A 页保持账号 A，并延迟其身份事件；B 页退出 A 后注册登录 B。A 页点击导入，服务端返回 `409 auth_identity_changed`，随后恢复显示 B；A/B 均无新增会话，本地 50 条保留。
2. B 确认导入 50 条，服务端提交后主动丢弃客户端响应；追加 3 轮 fake SSE（6 条）并改名，再重试原快照。同一会话 ID、总共 56 条、无重复消息。最近页只读 7–56，核对接口只读 1–50，成功清理本地副本。
3. 继续 SSE 时点击加载更早消息，历史 1–6 与增量回复并存，完成后显示 58 条；直接刷新 `/chat/:id` 后仅显示最近 50 条（9–58），保留加载更早入口。
4. 一个标签页退出后另一个及时退出，两个游客视图均未恢复旧本地消息；重新登录 B 后两页恢复正确账号和云端历史。现有页头注册、登录、恢复、退出均正常。

## 环境限制与提交边界

- 本机无可用 PostgreSQL/Docker CLI，localhost:5432 未能连接；未执行 PostgreSQL 并发、迁移或 Docker 容器验收。SQLite 结果不能替代这些验证。
- 可用虚拟环境为 Python 3.12.13；未验证项目目标 Python 3.11。Node.js 24.14.1，使用已缓存的 pnpm 11.19.0，未安装大型环境或变更依赖。
- 现有 fixture 的 `drop_all` 风险属于第一阶段，本次不改动 fixture；每次运行均显式指定本次专用测试库。
- 因身份前置条件、核对接口及清理前的检查共享同一导入契约，两项修复作为一个提交交付；用户后续已授权推送当前功能分支，不重写已有提交。
- 保留用户已有 `AGENTS.md`、`App.tsx`、AppHeader 及相关测试、审计与教程文件；这些文件不进入本次暂存或提交。
