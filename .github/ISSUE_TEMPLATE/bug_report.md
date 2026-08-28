name: Bug Report
about: 报告系统缺陷或异常行为
title: "[BUG] "
labels: ["bug"]
body:
  - type: markdown
    attributes:
      value: |
        ## Bug 报告模板
        请提供尽可能详细的信息以帮助定位问题。

  - type: input
    id: description
    attributes:
      label: Bug 描述
      description: 简洁描述问题现象
    validations:
      required: true

  - type: textarea
    id: reproduction
    attributes:
      label: 复现步骤
      placeholder: |
        1. 进入 '...'
        2. 点击 '...'
        3. 输入 '...'
        4. 观察到错误
    validations:
      required: true

  - type: textarea
    id: expected
    attributes:
      label: 预期行为
      description: 描述你期望的正确行为
    validations:
      required: true

  - type: textarea
    id: actual
    attributes:
      label: 实际行为
      description: 描述实际发生的行为（含截图/日志）
    validations:
      required: true

  - type: dropdown
    id: severity
    attributes:
      label: 严重程度
      options:
        - Critical - 系统崩溃/数据丢失
        - High - 核心功能不可用
        - Medium - 功能异常但有绕过方案
        - Low - UI/体验问题
    validations:
      required: true

  - type: input
    id: environment
    attributes:
      label: 环境信息
      description: OS / Browser / Python版本等
      placeholder: "Windows 11 / Chrome 120 / Python 3.11"
