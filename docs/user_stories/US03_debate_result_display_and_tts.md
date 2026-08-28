# US03 - 辩论结果展示与语音播报 (Sprint 3)

## 故事卡片 (Card)

**作为** 一个想看辩论结果的用户
**我想要** 以可视化的方式查看辩论过程和最终推荐
**以便** 获得有趣且实用的美食决策参考

##  conversations (对话补充)
- 辩论过程实时展示（Sprint 3: SSE 流式）
- 结果卡片展示：获胜方 + 推荐菜品 + 置信度
- TTS 语音播报辩论结果（Sprint 3）
- 支持结果分享/导出

## Confirmation (验收标准 - Gherkin BDD)

```gherkin
Scenario: 辩论结果可视化展示
  Given 一场辩论已完成
  When 用户查看结果页面
  Then 应展示双方辩论内容
  And 应高亮显示获胜方
  And 应展示推荐菜品和置信度

Scenario: TTS语音播报结果
  Given 辩论已完成且TTS服务可用
  When 用户点击 "语音播报"
  Then 系统应播放辩论结果摘要
  And 语音应使用微软 edge-tts 中文语音

Scenario: 结果置信度展示
  Given 辩论结果置信度为 0.85
  When 展示结果
  Then 置信度应显示为 "85%"
```

---

## 故事级 6 图体系

### 图1：故事级用例/边界图

```mermaid
graph LR
    subgraph US03 边界
        A[接收辩论结果] --> B[渲染辩论过程]
        B --> C[展示结果卡片]
        C --> D[可选TTS播报]
    end

    DR[("DebateResult")] --> A
    D --> U[("用户")]
    D -.-> E[edge-tts API]
```

### 图2：故事级组件/数据流图

```mermaid
graph LR
    A[DebateResponse] --> B[前端渲染引擎]
    B --> C[辩论过程展示区]
    B --> D[结果卡片组件]
    D --> E[TTS 合成请求]
    E --> F[音频播放组件]
```

### 图3：故事级领域类与数据契约图

```mermaid
classDiagram
    class DebateResponse {
        +str session_id
        +DebateStatus status
        +list~DebateRound~ rounds
        +DebateResult? result
    }
    class TTSRequest {
        +str text
        +str voice
        +str rate
        +str pitch
    }
    class TTSResponse {
        +bytes audio_data
        +str format
    }
    TTSRequest --> TTSResponse
```

### 图4：故事级数据实体关系/持久化模型

```mermaid
erDiagram
    SESSION_RESULT {
        string session_id PK
        string winner
        string dish_name
        float confidence
        string tts_audio_url
    }
```

### 图5：故事级端到端时序交互图

```mermaid
sequenceDiagram
    participant U as 用户
    participant FE as 前端
    participant API as API
    participant TTS as TTS Service

    U->>FE: 查看辩论结果
    FE->>API: GET /debate/{id}
    API-->>FE: DebateResponse
    FE->>FE: 渲染辩论过程+结果卡片

    U->>FE: 点击 "语音播报"
    FE->>API: POST /tts/synthesize
    API->>TTS: edge-tts 合成
    TTS-->>API: 音频流
    API-->>FE: 音频数据
    FE->>FE: 播放音频
```

### 图6：故事级微观状态转换与活动流程图

```mermaid
stateDiagram-v2
    [*] --> 加载结果
    加载结果 --> 渲染辩论过程 : 数据就绪
    渲染辩论过程 --> 展示结果卡片 : 渲染完成
    展示结果卡片 --> 等待用户操作 : 展示完毕

    等待用户操作 --> TTS合成 : 点击播报
    等待用户操作 --> 分享结果 : 点击分享
    等待用户操作 --> [*] : 离开页面

    TTS合成 --> 音频播放 : 合成成功
    TTS合成 --> 错误提示 : 合成失败
    音频播放 --> [*]
```
