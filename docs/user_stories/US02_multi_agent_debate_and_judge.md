# US02 - 双Agent多轮辩论与结果判定

## 故事卡片 (Card)

**作为** 一个想看AI辩论表演的用户
**我想要** 两个不同性格的AI大厨进行多轮辩论
**以便** 在有趣的对抗中获得个性化的美食推荐

##  conversations (对话补充)
- Agent A：川辣派·老麻（豪爽火爆，无辣不欢）
- Agent B：粤式养生派·阿靓（温和儒雅，食补养生）
- 默认3轮辩论，支持1-5轮配置
- 每轮双方各发言一次，可互相反驳
- 最终由"主持人"判定获胜方

## Confirmation (验收标准 - Gherkin BDD)

```gherkin
Scenario: 标准3轮辩论
  Given 辩论已启动
  When 3轮辩论完成
  Then 应产生6条发言记录（每轮2条）
  And 每条发言应标注发言者和轮次

Scenario: 辩论结果判定
  Given 辩论已完成
  When 主持人进行判定
  Then 结果应包含获胜方
  And 结果应包含推荐菜品名称
  And 结果应包含0-1之间的置信度

Scenario: 辩论超时处理
  Given LLM API 响应超时
  When 重试3次后仍失败
  Then 系统应返回部分辩论结果
  And 状态标记为 timeout
```

---

## 故事级 6 图体系

### 图1：故事级用例/边界图

```mermaid
graph LR
    subgraph US02 边界
        A[接收辩论请求] --> B[编排多轮对话]
        B --> C[调用LLM生成发言]
        C --> D[主持人判定]
        D --> E[返回结构化结果]
    end

    REQ[("辩论请求")] --> A
    E --> RES[("辩论结果")]
    C -.-> F[硅基流动 API]
```

### 图2：故事级组件/数据流图

```mermaid
graph TB
    A[DebateService] --> B[Persona Prompt 注入]
    B --> C[LLM API 调用]
    C --> D[响应解析]
    D --> E[DebateRound 对象]
    E --> F[轮次累加器]
    F -->|未达最大轮次| B
    F -->|已达最大轮次| G[Judge Prompt]
    G --> C
    C --> H[DebateResult]
```

### 图3：故事级领域类与数据契约图

```mermaid
classDiagram
    class DebateRound {
        +int round_number 🔒 ge:1
        +AgentPersona speaker 🔒
        +str content 🔒
        +str? reasoning
    }
    class DebateResult {
        +AgentPersona winner 🔒
        +str recommendation 🔒
        +str dish_name 🔒
        +str? restaurant_suggestion
        +float confidence 🔒 ge:0 le:1
    }
    class AgentPersona {
        <<enumeration>>
        SICHUAN_SPICY
        CANTONESE_HEALTHY
        CUSTOM
    }
    DebateResult --> AgentPersona
```

### 图4：故事级数据实体关系/持久化模型

```mermaid
erDiagram
    DEBATE_SESSION ||--o{ DEBATE_ROUND : "1对多"
    DEBATE_SESSION ||--o| DEBATE_RESULT : "1对0..1"
    DEBATE_ROUND {
        int round_number
        string speaker
        text content
    }
    DEBATE_RESULT {
        string winner
        string dish_name
        float confidence
    }
```

### 图5：故事级端到端时序交互图

```mermaid
sequenceDiagram
    participant DS as DebateService
    participant PA as Persona A (川辣)
    participant PB as Persona B (粤式)
    participant LLM as LLM API
    participant J as Judge

    loop round = 1 to max_rounds
        DS->>PA: 构建 Prompt (含上下文)
        PA->>LLM: chat_completion()
        LLM-->>PA: Agent A 发言
        PA-->>DS: DebateRound A

        DS->>PB: 构建 Prompt (含A的发言)
        PB->>LLM: chat_completion()
        LLM-->>PB: Agent B 发言
        PB-->>DS: DebateRound B
    end

    DS->>J: 汇总所有回合
    J->>LLM: 判定 Prompt
    LLM-->>J: 结果 JSON
    J-->>DS: DebateResult
```

### 图6：故事级微观状态转换与活动流程图

```mermaid
stateDiagram-v2
    [*] --> INIT_PERSONAS

    INIT_PERSONAS --> ROUND_START

    state round_loop <<choice>>
    ROUND_START --> round_loop : 检查轮次
    round_loop --> GENERATE_A : 未达上限
    round_loop --> JUDGE : 已达上限

    GENERATE_A --> GENERATE_B : A发言完成
    GENERATE_B --> NEXT_ROUND : B发言完成
    NEXT_ROUND --> ROUND_START : round++

    JUDGE --> PARSE_RESULT : LLM返回
    PARSE_RESULT --> VALIDATE : JSON解析
    VALIDATE --> COMPLETE : 校验通过
    VALIDATE --> RETRY : 解析失败
    RETRY --> PARSE_RESULT : 重试(≤3次)
    RETRY --> FALLBACK : 超过重试
    FALLBACK --> COMPLETE : 默认结果

    COMPLETE --> [*]
```
