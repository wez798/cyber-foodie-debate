# 系统架构设计规约 — Cyber Foodie Debate

> 系统级三大模型（6大架构图）

---

## 一、功能模型 (Functional Model)

### 1. 系统顶层用例图 (Use Case Diagram)

```mermaid
graph LR
    subgraph 参与者
        U[("👤 大学生用户")]
        LLM_API[("🤖 硅基流动 LLM API")]
        TTS_API[("🔊 微软 TTS API")]
    end

    subgraph 系统边界 [Cyber Foodie Debate 系统]
        UC1[输入饮食偏好]
        UC2[启动AI辩论赛]
        UC3[观看辩论实况]
        UC4[查看推荐结果]
        UC5[语音播报结果]
        UC6[查看历史辩论]
    end

    U --> UC1
    U --> UC2
    U --> UC3
    U --> UC4
    UC2 -.调用.-> LLM_API
    UC5 -.调用.-> TTS_API
    UC2 --> UC3
    UC2 --> UC4
```

### 2. 系统数据流图 (DFD)

```mermaid
graph LR
    A[("用户输入<br/>口味/预算/天气/忌口")] --> B[偏好校验<br/>Pydantic Schema]
    B --> C[辩论编排服务<br/>DebateService]
    C --> D[LLM API<br/>DeepSeek-V4-Flash]
    D --> E[辩论回合生成<br/>Agent A/B 轮流发言]
    E --> F[主持人判定<br/>结果聚合]
    F --> G[辩论结果<br/>JSON Response]
    G --> H[前端渲染展示]
    F -.Sprint3.-> I[TTS API<br/>edge-tts]
    I --> J[语音播报]
```

---

## 二、数据模型 (Data Model)

### 3. 系统领域类图 (Domain Class Diagram)

```mermaid
classDiagram
    class FoodPreference {
        +str 口味
        +str 预算
        +str 天气
        +str 忌口
        +str 其他要求
    }

    class AgentPersona {
        <<enumeration>>
        SICHUAN_SPICY
        CANTONESE_HEALTHY
        CUSTOM
    }

    class DebateRound {
        +int round_number
        +AgentPersona speaker
        +str content
        +str reasoning
    }

    class DebateResult {
        +AgentPersona winner
        +str recommendation
        +str dish_name
        +str restaurant_suggestion
        +float confidence
    }

    class DebateSession {
        +str session_id
        +FoodPreference preference
        +AgentPersona agent_a_persona
        +AgentPersona agent_b_persona
        +list~DebateRound~ rounds
        +DebateResult result
        +DebateStatus status
    }

    class DebateService {
        +dict sessions
        +start_debate() DebateResponse
        +_generate_argument() DebateRound
        +_judge_debate() DebateResult
    }

    class LLMService {
        +str base_url
        +str api_key
        +chat_completion() dict
        +health_check() bool
    }

    DebateSession "1" --> "*" DebateRound
    DebateSession "1" --> "0..1" DebateResult
    DebateSession "1" --> "1" FoodPreference
    DebateService --> DebateSession : manages
    DebateService --> LLMService : calls
```

### 4. 数据库实体关系图 (ER Diagram)

```mermaid
erDiagram
    DEBATE_SESSION ||--o{ DEBATE_ROUND : contains
    DEBATE_SESSION ||--o| DEBATE_RESULT : produces
    DEBATE_SESSION {
        string session_id PK
        string preference_json
        string agent_a_persona
        string agent_b_persona
        string status
        datetime created_at
        datetime completed_at
    }
    DEBATE_ROUND {
        int round_number
        string speaker
        text content
        string session_id FK
    }
    DEBATE_RESULT {
        string session_id FK
        string winner
        string dish_name
        string restaurant_suggestion
        float confidence
    }
```

---

## 三、动态/行为模型 (Dynamic Model)

### 5. 端到端核心时序图 (System Sequence Diagram)

```mermaid
sequenceDiagram
    participant U as 用户浏览器
    participant API as FastAPI Server
    participant DS as DebateService
    participant LLM as 硅基流动 LLM
    participant TTS as 微软 TTS

    U->>API: POST /api/v1/debate/start
    API->>API: Pydantic 校验 FoodPreference
    API->>DS: start_debate(request)
    DS->>DS: 创建 DebateSession

    loop 每轮辩论 (max_rounds=3)
        DS->>LLM: chat_completion(Agent A Prompt)
        LLM-->>DS: Agent A 发言内容
        DS->>LLM: chat_completion(Agent B Prompt)
        LLM-->>DS: Agent B 发言内容
    end

    DS->>LLM: chat_completion(主持人判定 Prompt)
    LLM-->>DS: 辩论结果 JSON
    DS->>DS: 解析结果 → DebateResult
    DS-->>API: DebateResponse
    API-->>U: JSON Response

    opt Sprint 3: TTS 语音播报
        U->>API: GET /api/v1/tts/synthesize
        API->>TTS: edge-tts 合成
        TTS-->>API: 音频流
        API-->>U: 音频播放
    end
```

### 6. 系统生命周期状态机图 (State Diagram)

```mermaid
stateDiagram-v2
    [*] --> PENDING : 创建会话

    PENDING --> RUNNING : 提交辩论请求

    RUNNING --> ROUND_1 : 第1轮开始
    ROUND_1 --> ROUND_2 : Agent A/B 发言完成
    ROUND_2 --> ROUND_3 : Agent A/B 发言完成
    ROUND_3 --> JUDGING : 第3轮结束

    ROUND_1 --> TIMEOUT : 超时/异常
    ROUND_2 --> TIMEOUT : 超时/异常
    ROUND_3 --> TIMEOUT : 超时/异常

    JUDGING --> COMPLETED : 主持人判定完成
    TIMEOUT --> COMPLETED : 返回部分结果

    COMPLETED --> [*]

    state RUNNING {
        [*] --> ROUND_1
        ROUND_1 --> ROUND_2
        ROUND_2 --> ROUND_3
        ROUND_3 --> JUDGING
    }
```
