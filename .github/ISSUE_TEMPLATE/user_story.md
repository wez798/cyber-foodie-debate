name: User Story
about: 提交新的用户故事 (User Story)
title: "[US] "
labels: ["user-story"]
body:
  - type: markdown
    attributes:
      value: |
        ## 用户故事模板 (INVEST + 3C)
        请填写以下字段以创建新的用户故事。

  - type: input
    id: story-title
    attributes:
      label: 故事标题
      description: 简洁描述该用户故事
      placeholder: "作为...我想要...以便..."
    validations:
      required: true

  - type: dropdown
    id: priority
    attributes:
      label: 优先级
      options:
        - P0 - 必须 (Must Have)
        - P1 - 应该 (Should Have)
        - P2 - 可以 (Could Have)
        - P3 - 不会 (Won't Have)
    validations:
      required: true

  - type: dropdown
    id: story-points
    attributes:
      label: Story Points (复杂度)
      options:
        - "1"
        - "2"
        - "3"
        - "5"
        - "8"
        - "13"
    validations:
      required: true

  - type: textarea
    id: acceptance-criteria
    attributes:
      label: 验收标准 (Gherkin BDD)
      description: 使用 Given-When-Then 格式
      placeholder: |
        Given <前置条件>
        When <操作>
        Then <预期结果>
    validations:
      required: true

  - type: textarea
    id: notes
    attributes:
      label: 补充说明
      description: 设计图、参考链接、技术备注等
