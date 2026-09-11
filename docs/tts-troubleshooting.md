# TTS 403 排查与配置

项目使用 `edge-tts` 访问微软 Edge 在线语音服务，无需用户提供 API Key。
`TrustedClientToken` 是库管理的协议参数，不要复制报错中的 token 到 `.env`。

本次检查发现两份依赖文件与本地虚拟环境均为 `edge-tts==6.1.12`，
报错 URL 也与上游记录的旧版 403 一致。已升级并固定为 `7.2.8`，
由新版库处理握手参数和服务端时间偏差，不手工拼接微软 WebSocket 地址。
参考：[旧版 403 问题](https://github.com/rany2/edge-tts/issues/270)、
[7.2.8 发布版](https://pypi.org/project/edge-tts/7.2.8/)。

## 默认配置

在仓库根目录 `.env` 中保留以下配置即可，通常不需要额外设置：

```dotenv
TTS_VOICE=zh-CN-XiaoxiaoNeural
TTS_RATE=+0%
TTS_PITCH=+0Hz
TTS_PROXY=
TTS_TIMEOUT_SECONDS=30
```

其他开发机需在自己的虚拟环境更新依赖；本次工作区的 `.venv` 已升级：

```powershell
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

如果后端正在运行，需要重启才能加载新版库与 `.env`。本次修复不会自动启动服务。

## 升级后仍然失败

1. 确认运行后端的解释器正确：`.venv\Scripts\python.exe -m pip show edge-tts` 应显示 `7.2.8`。
2. 在 Windows 日期和时间设置中启用自动设置时间并执行同步。
3. 检查后端网络是否允许访问 `speech.platform.bing.com` 的 HTTPS/WebSocket。
4. 只有实际需要且已配置可用代理时，再填写 `TTS_PROXY`。例如本机代理的 HTTP
   端口确为 7890 时可填写 `http://127.0.0.1:7890`，不要照抄不存在的端口。
   这里只支持 HTTP/HTTPS 代理地址，不支持 `socks5://`。代理凭据仅保存在服务端 `.env`。
   容器中的 `127.0.0.1` 指向容器自身，应填写容器能够访问的代理地址。

不配置 `TTS_PROXY` 时，新版库还可能读取进程的标准代理环境变量；如代理已停用，
也应检查是否遗留 `HTTPS_PROXY` / `WS_PROXY` / `WSS_PROXY`。

完成上述检查后，如果仍为 403，应继续排查网络出口或微软端限制，不能靠盲目重试保证恢复。

## 仅检查 TTS

以下命令会把固定文本“测试”发送给微软并检查非空音频，不访问数据库、不启动应用、
不调用硅基流动，不发送用户辩论内容，也不留下音频文件：

```powershell
.venv\Scripts\python.exe -m scripts.test_api_connectivity --service tts
```

该命令是手动真实服务检查，不属于默认测试。默认不传 `--service` 时仍检查 LLM 与 TTS，
排查语音时请明确使用 `--service tts`。

本次验证：升级后，受限执行环境首次连接失败；在正常网络权限下执行同一诊断入口，
固定文本“测试”成功返回 8064 字节音频。未调用 LLM、未修改实际 `.env`，
未启动前后端。另有 18 项 TTS 与离线演示回归测试通过，类型检查与依赖一致性检查通过。

## 修复后的行为

- 整次合成默认最多 30 秒，包含等待和重试；只对尚未收到音频的网络临时故障、429 和 5xx
  最多尝试两次。业务层不会重试 403，也不会在收到部分音频后重新合成。
- 空音频或中途失败不会返回成功 MP3；健康检查必须获得真实非空音频。
- API 保留 `{"detail":"可读错误信息"}` 错误结构，禁止返回上游完整 URL、token 或代理密码。
  403 等上游拒绝连接映射为 503，整次超时为 504，空音频/协议异常为 502，
  输入或语音参数无效为 422，未知内部异常为 500。
- 语音失败不会改变已完成的辩论结果；用户可以保留文本结果并稍后重试播报。
