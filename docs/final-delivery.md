# 最终交付报告

验收日期：2026-09-10。结论：满足本地离线启动、核心功能演示和自动化回归可复现的工程实践交付标准；不宣称生产部署或真实 AI/TTS 已验收。新业务功能已冻结。

## 目标与范围

面向校园饮食选择，提供游客自由聊天、账号云端聊天、主动导入本地历史、历史分页与归档/恢复/删除，以及三轮大厨辩论、裁决和结果音频播放。页头统一提供功能与账户入口，支持桌面和手机宽度。

不包含修改密码、Session 管理页面、邮件验证、密码找回、OAuth、管理员后台、Redis、辩论持久化或新的业务模块。

## 技术结构

React 19 + TypeScript strict + Vite + Tailwind/shadcn；FastAPI API → Service → Repository → SQLAlchemy 数据库。Pydantic 与前端运行时 Schema 校验接口；POST SSE 承载流式输出。生产数据目标为 PostgreSQL，Alembic head 为 `20260908_0002`。账号使用不透明 Session Cookie、CSRF 与 Origin 校验，owner 由服务端确定。

游客数据仅在浏览器；主动导入在服务端检查预期账号并保持幂等，独立核对最多 50 条原始消息后才尝试清理相同本地快照。聊天最近页与更早消息分别加载；辩论仍为进程内存数据。

## 最后一轮改动

- 修正 Compose 迁移启动命令为 `python -m alembic`。运行镜像只复制 Python site-packages，没有复制 CLI 脚本，旧的裸 `alembic` 命令存在启动阻断。未改变迁移内容或表结构。
- 增加 `scripts/run_demo.py`：仅在回环地址运行，自动使用临时 SQLite 和现有迁移，固定 LLM 回复及 WAV 测试音；退出清理自建临时库。提供 `--tts-fail` 模拟错误，不接入真实外部服务，不进入生产镜像。
- 更新 README、CONTRIBUTING 和系统设计，补充本报告及 [演示指南](demo-guide.md)。没有改动用户的规则、审计文档或打包指南。

## 实际验收

| 项目 | 实际结果 |
| --- | --- |
| `ruff check src tests scripts` | 通过 |
| `ruff format --check src tests scripts` | 45 文件通过 |
| `mypy src --ignore-missing-imports` | 24 个源文件通过 |
| `pytest tests/unit -v` | 75 通过，含演示固定结果与音频成功/失败测试 |
| `pytest tests/integration -v` | 22 通过，专用一次性 SQLite |
| `behave tests/bdd` | 2 features、10 scenarios、42 steps 通过 |
| `pnpm test` | 18 个文件、117 测试通过 |
| `pnpm typecheck`、`pnpm build` | 通过 |
| `alembic upgrade head`、`alembic check` | 一次性 SQLite 通过，无待生成迁移 |
| 第一阶段数据升级保留 | 集成测试通过；不代表 PostgreSQL 实测 |
| 普通后端启动入口 | `python -m src.backend.main` 实际启动，隔离已迁移 SQLite；live/ready/docs 均 200 |
| 前端五类深链接 | Vite 下 `/chat`、`/chat/:id`、`/debate`、`/login`、`/register` 返回 SPA；Nginx 配置仅静态核对 |
| 离线真实 HTTP 链路 | A/B 注册、登录状态、导入 50 条后追加 4 条、50/4 分页、重放同 ID、核对原 50 条、归档/恢复/软删除、退出通过 |
| 数据隔离 | B 读取/归档/删除 A 会话均 404；Cookie B 携带预期 A 导入为 409；退出后访问为 401 |

以上测试只使用 fake/mock LLM/TTS 和可销毁测试库，没有调用真实 SiliconFlow、edge-tts，也没有清理用户数据库。依赖使用本机现有安装；核对了根目录与后端 requirements、pnpm 锁文件及安装命令，没有在空白机器重新下载全套依赖。

前一轮同一最终前端已完成隔离浏览器 375 px/1280 px 主操作、游客导入、归档恢复、详情刷新、云端续聊、辩论裁决、语音失败、退出核验；本轮继续核验离线演示启动与浏览器行为，自动化套件覆盖取消、迟到响应、分页/SSE 和导入竞态。

本轮内置浏览器实际展示了标记为“非真实 AI”的游客回复、测试账号登录和导入入口；长会话先显示 50 条，主动加载后为 54 条，详情页刷新重新只读最近 50 条。离线辩论显示六条发言与固定裁决，WAV 测试音播放器 `readyState=4`、`duration=0.5`、`currentTime=0.5`、`ended=true`、无媒体错误。这证明测试音频可解码播放，不代表真实语音服务实测。

## 未验证项与已知限制

- `docker version` 和 `docker compose version` 原始错误为：`The term 'docker' is not recognized as a name of a cmdlet, function, script file, or executable program.` 因此未执行容器构建、启动或 Nginx 运行时验收。
- 未找到 `psql`/`pg_isready`，localhost:5432 连接未成功。没有 PostgreSQL 并发或部署迁移实测，SQLite 结果不能替代。
- 本机 Python 3.12.13、Node.js 24.14.1、pnpm 11.19.0；项目目标 Python 3.11 未在本机实测。真实移动设备、HTTPS 生产 Cookie、真实 LLM 与语音质量未验收；真实服务仍需单独授权。
- readiness 只检查数据库连通性，不证明迁移完整或 LLM/TTS 可用。生产启动需先迁移、配置来源和 HTTPS Secure Cookie。
- 归档筛选可能需要多次主动加载；游客历史受浏览器存储限制。辩论刷新/重启不恢复，多后端进程不共享辩论会话。离线脚本每次重启会失去演示账号和历史。
- 集成 fixture 原有建表/清表及默认文件清理行为尚未重构；必须遵守 CONTRIBUTING 中的专用测试库检查。

## 后续只保留必要事项

1. 在具备 Docker/PostgreSQL 的交付机器上按 README 完成部署、备份与深链接刷新验收。
2. 获授权后验收真实模型和语音；补充真实手机演示素材。
3. 由用户决定推送、PR Review、合并或发布。本轮仅本地提交，不打标签或对外发布。此前 PR #21 不包含未推送的新提交。
