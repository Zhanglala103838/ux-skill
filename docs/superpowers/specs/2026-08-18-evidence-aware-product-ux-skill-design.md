# Evidence-aware Product UX Skill 设计规格

状态：待用户文件审阅  
日期：2026-08-18  
目标 Skill：`improving-product-ux`  
首个适配器：HulianUI  
仓库：`Zhanglala103838/ux-skill`

## 1. 目标

建设一个独立于任何 UI 库的 UX Skill，使 Agent 能够：

1. 在设计、审查、迁移、改进和验证数字产品时，以用户目标与使用结果为中心进行判断；
2. 区分事实、规范违规、启发式风险、产品假设和真实用户证据；
3. 根据产品场景、使用端、用户熟练度、任务频率、风险与环境调整 UX 优先级；
4. 把 UX 设计意图交给可插拔设计系统适配器实现；
5. 让 HulianUI MCP 与 Agent Skill 使用同一份版本化、机器可读的 UX 知识；
6. 通过真实项目验证后，把稳定、可确定判断的规则下沉到 MCP 或自动化检查。

Skill 的价值不是给界面打一个“UX 分数”，而是帮助团队发现用户问题、解释证据强度、提出适合情境的改进、完成实现并验证结果。

## 2. UX 定义与边界

本项目将 UX 定义为：特定用户在特定情境中，为实现特定目标，与完整产品或服务交互前、中、后产生的实际结果与感受。

可用性是使用的结果，不是界面或组件本身的属性。有效性、效率和满意度必须与指定用户、目标和使用情境一起判断。人本设计应覆盖整个产品生命周期，并通过迭代与证据持续校正。

### 2.1 包含范围

- Web、移动 Web、原生移动端、桌面端、小程序等数字产品；
- 官网、内容站、交易服务、消费者应用、Admin、数据操作台、配置工具、AI 产品、桌面工具等产品场景；
- 用户需求、产品目标、功能范围、内容、信息架构、任务流、交互、界面、视觉、无障碍、信任、隐私、性能、韧性和验证；
- 产品内外的端到端服务旅程，只要它影响用户完成目标；
- 新产品设计、已有产品审查、旧项目迁移、持续改进和验证。

### 2.2 暂不包含

- 工业产品、实体空间和人体工程学的完整设计方法；
- 纯品牌广告、传播活动或视觉艺术评价；
- 法律合规认证、安全审计或医学可用性认证；
- 用自动化工具替代真实用户研究；
- 用组件覆盖率、设计系统采用率或单一总分表示 UX 质量。

## 3. 知识来源与可信度

知识库不是书摘集合。它综合以下层级，并保留来源、版本与适用边界：

1. **规范性标准**：ISO 9241、WCAG 等。用于可明确验证的定义或要求。
2. **原始研究**：经过同行评审或由研究机构发布的方法和度量框架。
3. **成熟公共实践**：GOV.UK、USWDS、W3C WAI 等包含研究、已知限制和真实服务反馈的指导。
4. **经典专业著作**：Garrett、Norman、Krug、Colborne、Cagan 等提供概念模型与设计推理。
5. **启发式知识**：适合发现风险，但不得冒充用户证据或规范要求。

来源优先级不等于机械覆盖。规范解决“必须满足什么”，用户研究解决“用户实际发生什么”，启发式解决“哪里值得调查”，产品数据解决“影响多大与是否改善”。

每条机器规则必须声明一种类型：

- `normative`：明确标准或可验证契约；
- `research-backed`：有研究支持但仍需匹配情境；
- `institutional-pattern`：成熟实践模式，保留已知限制；
- `heuristic`：专家审查风险；
- `contextual-guidance`：场景相关建议；
- `product-hypothesis`：需要用户或生产证据验证的假设。

第三方资料只保存必要的书目信息、短摘要和链接。MIT 许可证只覆盖本仓库的原创结构、规则表达和代码，不重新许可第三方标准或书籍内容。

## 4. UX 分析模型

### 4.1 从抽象到具体的五层

使用 Garrett 五层作为定位框架，而不是瀑布流程：

1. **Strategy**：用户需求、产品目标、预期结果和利益冲突；
2. **Scope**：功能与内容需求、边界、优先级和不做什么；
3. **Structure**：任务流、交互设计、信息架构和概念模型；
4. **Skeleton**：界面布局、导航、信息呈现和操作组织；
5. **Surface**：视觉、排版、色彩、声音、运动和感官表达。

各层可以并行迭代，但高层改动必须回查低层假设；表层问题不能掩盖策略或结构错误。

### 4.2 横切维度

所有层都要考虑：

- 无障碍与包容性；
- 内容清晰度与语言；
- 信任、隐私、透明度和用户自主权；
- 性能、弱网、低端设备和响应性；
- loading、empty、partial、error、offline、expired、permission denied 等系统状态；
- 可恢复性、撤销、确认和不可逆操作；
- 跨端、跨渠道和时间连续性；
- 国际化、时区、格式和文化情境；
- 用户学习、熟练度与长期效率。

## 5. 情境模型

平台不是场景。Skill 必须先构建 `context_profile`，再选择规则与优先级。

```yaml
context_profile:
  platform: [web, mobile-web, native-mobile, desktop, mini-program]
  surface:
    - marketing-site
    - content-site
    - transactional-service
    - consumer-app
    - admin-console
    - data-operations
    - configuration-tool
    - ai-product
    - desktop-shell
  audience: [public, customer, employee, operator, administrator]
  proficiency: [first-time, occasional, frequent, expert]
  task: [discover, evaluate, purchase, create, monitor, configure, review, approve, troubleshoot]
  risk: [low, financial, privacy, destructive, regulated]
  modifiers:
    - mobile
    - dashboard
    - data-dense
    - time-critical
    - interruption-prone
    - low-bandwidth
    - multilingual
    - accessibility-critical
  workflow: [design, audit, migrate, improve, verify]
```

字段允许多个值。Agent 不得仅根据路由名、仓库名或“Admin”标签推断完整情境；需要结合真实用户、任务和运行证据。

### 5.1 场景 Profile

Profile 是常见组合的默认值，不是固定模板。第一版包括：

- `public-marketing`：理解、信任、品牌、内容发现、响应式和无诱导转化；
- `public-content`：可读性、导航、搜索、信息可信度和长内容性能；
- `transactional-service`：完成率、表单错误、确认、恢复和端到端服务；
- `consumer-product`：学习成本、留存任务、个人数据、跨设备连续性；
- `admin-operations`：高频任务、密度、准确性、键盘效率、批处理和审计；
- `data-operations`：筛选、比较、异常识别、状态保持和大数据量性能；
- `configuration-tool`：依赖关系、预览、危险变更、回滚和权限；
- `ai-assisted-product`：能力边界、不确定性、纠错、用户控制和数据透明度。

### 5.2 官网与 Admin 的规则差异

官网通常优先首次理解、信任、内容层级、性能、移动端和清晰行动；Admin 通常优先高频效率、信息密度、键盘、批处理、状态持久化、权限、错误预防、恢复和审计。

这不是视觉风格配额。官网不能为了转化使用欺骗性模式；Admin 不能因为用户是内部员工而牺牲无障碍；专业工具也需要为首次配置和低频危险任务提供引导。

## 6. Skill 工作流

### 6.1 输入识别

识别当前模式：`design`、`audit`、`migrate`、`improve` 或 `verify`。

### 6.2 建立上下文

在给出结论前尽量确认：

- 用户群体和关键差异；
- 要完成的首要任务与成功结果；
- 使用频率、熟练度和环境；
- 任务风险和失败后果；
- 产品场景、平台和适用修饰条件；
- 当前基线、已有研究、数据和限制；
- 当前设计系统及版本。

信息缺失时继续完成可完成的分析，但把相关结论标记为假设，不得编造用户需求。

### 6.3 证据盘点

识别可用证据：研究记录、支持工单、产品分析、页面、原型、截图、代码、DOM、运行结果、无障碍结果、用户观察和生产趋势。

### 6.4 分层审查

先审用户结果、策略和端到端任务，再审范围、结构、交互、内容和表层。不得从“某个组件存在”直接跳到“应该使用该组件”。

每一项候选问题必须经过以下过滤：

1. 在当前情境中是否适用；
2. 用户可能受到什么影响；
3. 当前证据能证明到什么程度；
4. 是否存在反例或合理例外；
5. 应修产品、内容、流程、实现还是设计系统；
6. 如何验证修复有效。

### 6.5 设计与实现

先写出设计意图和用户结果，再选择实现方式。存在设计系统适配器时，根据当前版本和场景映射到 pattern、page、block 或 component；缺少适配器时仍输出供应商中立的实现要求。

迁移不是一对一换组件。需要保留正确业务行为，重新检查任务流、内容、状态、响应式、无障碍和错误恢复。

### 6.6 验证

验证声明必须与证据等级一致。修复后重复关键任务和原始失败条件，并比较基线。没有真实用户或生产数据时，可以证明实现、运行或交互行为，但不能声称用户结果已经改善。

## 7. 证据等级

- `E0 assumption`：只有需求陈述、推测或未验证设计意图；
- `E1 artifact`：代码、文档、设计稿、DOM 或配置证据；
- `E2 runtime`：真实渲染、设备、主题、视口或性能运行证据；
- `E3 interaction`：完整任务、键盘、错误恢复和状态转换已执行；
- `E4 user-observed`：代表性用户执行任务时的直接观察；
- `E5 production-behavior`：完成率、错误率、放弃点、耗时等生产行为；
- `E6 user-outcome`：长期证据显示用户目标或服务结果改善。

证据等级不是简单的线性质量分数。E5 能说明发生了什么，但通常仍需要定性研究解释为什么；E4 的小样本观察也不能自动推断总体发生率。

## 8. 发现类型、严重度与优先级

### 8.1 发现类型

- `violation`：违反明确规范、契约或确定性规则；
- `scenario-mismatch`：设计与当前情境、任务或熟练度不匹配；
- `usability-risk`：启发式或专家审查发现的潜在问题；
- `observed-problem`：真实用户、交互或生产证据已经观察到问题；
- `optimization-opportunity`：具有基线和可验证假设的改进机会；
- `not-applicable`：规则或能力在当前场景无需求；
- `upstream-gap`：合理需求无法由当前设计系统版本正确支持。

### 8.2 严重度

- `blocker`：关键用户无法完成任务、被排除、产生严重伤害或不可接受风险；
- `major`：大量失败、显著错误、数据损失、强烈误导或高成本恢复；
- `moderate`：明显延迟、困惑、重复劳动或可恢复错误；
- `minor`：有限摩擦或表层质量问题，不阻止任务完成。

置信度与严重度分别记录。高严重度、低置信度的问题应优先调查，不能被写成已证实缺陷。优先级综合用户影响、触达范围、风险、证据置信度、修复成本和依赖关系，不生成伪精确总分。

## 9. 发现与报告契约

每个 finding 至少包含：

```json
{
  "id": "finding-id",
  "title": "用户可理解的问题标题",
  "type": "usability-risk",
  "plane": "structure",
  "cross_cutting": ["accessibility", "error-recovery"],
  "context": {},
  "user_impact": "谁在什么任务中受到什么影响",
  "evidence": [{
    "level": "E3",
    "kind": "interaction",
    "location": "页面、文件、步骤或证据地址",
    "observation": "实际观察",
    "limitations": "证据不能证明什么"
  }],
  "severity": "major",
  "confidence": "medium",
  "recommendation": {
    "intent": "需要达到的用户结果",
    "approach": "供应商中立的方案",
    "design_system_mapping": [],
    "tradeoffs": []
  },
  "verification": {
    "method": "修复后的验证方法",
    "success_criteria": []
  },
  "upstream_gap": false
}
```

报告首先说明范围、情境、证据和未验证项，然后按关键用户任务组织发现。报告不得把静态扫描、构建通过或 Guard 通过表述成“UX 已验证”。

## 10. 机器可读知识契约

`knowledge/ux-rules.json` 中每条规则至少包含：

- 稳定 `rule_id`、规则版本和状态；
- 标题、意图与 `rule_type`；
- 适用和排除条件；
- 关联场景、任务、风险和 UX 层；
- 用户影响；
- 可自动化程度：`automated | assisted | manual | user-research`；
- 所需最低证据、检查步骤、失败与通过条件；
- 合理例外、修复原则、验证方法；
- 来源 ID 和最后复核日期。

`knowledge/manifest.json` 提供 schema 版本、知识版本、文件摘要和适配器兼容信息。未知字段应被消费者忽略；缺少必填字段必须拒绝加载。

规则更新采用语义版本：

- Patch：措辞、来源链接或不改变判断的修正；
- Minor：新增向后兼容规则、Profile 或字段；
- Major：改变含义、严重度模型、必填字段或兼容性。

## 11. HulianUI 适配器

HulianUI 只是实现适配器，不拥有 UX 核心定义。

适配器职责：

1. 识别安装版本、框架、Provider、token 和项目约束；
2. 将设计意图映射到当前版本可用的 HulianUI page、block、pattern 和 component；
3. 调用或指导调用 `inspect_project`、`recommend_ui`、`get_component_doc`、`get_conventions`、`validate_hulian_usage` 等 MCP 能力；
4. 区分安装事实、静态硬规则、采用机会、运行验证和用户结果；
5. 发现能力缺口时记录最小复现、场景、用户影响、期望 API、证据和验证要求；
6. 避免在消费项目中用 CSS 或行为补丁长期隐藏设计系统缺口。

适配器不得强制使用不适合场景的组件或动效、推荐当前版本不存在的组件、将组件数量作为质量指标、把 MCP 或 Guard 结果升级成 UX 结论，或在没有证据时要求上游新增组件。

若 MCP 不可用，Skill 继续给出供应商中立建议，并把 HulianUI 映射标记为未执行。

## 12. MCP 消费方式

第一版不要求 MCP 运行时访问互联网。推荐流程：

1. UX 仓库发布带版本与摘要的知识快照；
2. HulianUI MCP 在开发时固定到明确版本；
3. 构建或发布时校验 schema 与摘要；
4. MCP 输出携带 UX 知识版本和 HulianUI 版本；
5. 知识升级通过显式依赖更新完成，不静默漂移。

后续可选择 npm 包或 GitHub Release 作为分发形式，但在开发机验证前不预先增加发布基础设施。

## 13. 仓库结构

```text
ux-skill/
├── SKILL.md
├── agents/openai.yaml
├── references/
│   ├── ux-foundations.md
│   ├── research-and-evaluation.md
│   ├── evidence-and-reporting.md
│   └── implementation-guidance.md
├── knowledge/
│   ├── manifest.json
│   ├── ux-rules.json
│   └── sources.json
├── schemas/
│   ├── ux-rule.schema.json
│   └── ux-report.schema.json
├── adapters/hulianui/
│   ├── adapter.md
│   └── adapter.json
├── evals/
│   ├── cases.json
│   └── rubric.md
├── scripts/validate-knowledge.mjs
└── LICENSE
```

`SKILL.md` 保持简洁，只包含触发条件、核心流程、证据纪律和按需加载指引。详细知识放在 references；MCP 使用 knowledge、schemas 和 adapters；开发机使用 evals 与验证脚本。

不添加 README、快速指南或变更日志等与 Skill 执行无关的重复文档。

## 14. 错误处理与安全边界

- 缺少用户、目标或情境：明确缺失项，将策略结论降级为 E0；
- 缺少运行环境或鉴权：只报告已验证层级，不声称登录后体验已检查；
- 自动工具结果冲突：保留原始证据，要求人工复核；
- 标准与场景建议冲突：规范性要求优先，记录场景权衡；
- 设计系统版本过旧：按已安装版本给出方案，并单独说明升级选择；
- 不可逆、隐私、财务或权限操作：提高风险等级，要求确认、恢复、审计和更强验证；
- 涉及法律或行业认证：提示专业审查，不提供合规认证；
- 用户数据和研究材料：最小化采集，避免把敏感信息写入公开报告或 GitHub Issue。

## 15. 验证策略

### 15.1 结构验证

- SKILL frontmatter、命名和目录校验；
- JSON Schema 校验；
- rule ID、source ID、版本和引用完整性；
- manifest 摘要与兼容性校验；
- 不允许占位符、未知必填值和断开的内部引用。

### 15.2 认识论验证

用故意不完整的输入测试 Skill 是否把假设写成事实、把启发式写成已验证问题、把自动扫描写成无障碍或 UX 合规、把态度当行为、把 A/B 结果当根因、生成伪精确总分，或在没有场景时机械推荐组件。

### 15.3 场景验证

相同界面问题分别放入官网、内容站、交易服务、Admin、数据操作台和配置工具，验证适用性、严重度和建议是否合理变化。

测试至少包含：

- 官网首次访问与移动端转化；
- Admin 高频键盘与批处理；
- 数据密集列表和状态保持；
- 危险配置与恢复；
- 长内容阅读；
- 低带宽和低端设备；
- 键盘、读屏、缩放和 reduced motion；
- loading、empty、partial、error、offline；
- 旧项目迁移；
- 已使用 HulianUI 的项目改进；
- HulianUI 缺口与非缺口的区分。

### 15.4 真实项目验证

开发机按以下闭环执行：

1. 选择至少一个官网或公开页面项目；
2. 选择至少一个 Admin 或数据操作项目；
3. 记录 Skill 介入前的 Agent 输出和错误；
4. 使用 Skill 完成审查或迁移任务；
5. 执行代码、运行时、交互、无障碍和场景验证；
6. 记录误报、漏报、错误组件推荐和未覆盖状态；
7. 修订 Skill 和知识规则；
8. 再次运行相同任务及新的保留任务；
9. 达到验收标准后才标记稳定版本；
10. 再向 HulianUI 提交 MCP 集成 Issue。

## 16. 首版验收标准

- 清楚区分 UX、可用性、UI、无障碍和设计系统采用；
- 官网与 Admin 对相同设计选择产生合理不同的优先级；
- 缺少证据时主动降低结论强度；
- 所有 finding 包含用户影响、证据限制和验证方法；
- 不生成单一 UX 总分；
- 不把静态扫描或组件采用率当作用户结果；
- 能在没有 HulianUI 时独立工作；
- 能在 HulianUI 项目中给出版本与场景感知的映射；
- 能识别真正的上游缺口而不是鼓励消费端补丁；
- 至少通过一个公开场景和一个 Admin 场景的开发机真实验证；
- 验证记录能够支持后续 MCP Issue 的范围和验收条件。

## 17. 实施与发布顺序

1. 本规格在 `design/v0` 分支接受用户审阅；
2. 审阅通过后编写远程实施计划；
3. 在独立实现分支创建 Skill、知识库、schema、适配器和 eval；
4. 通过基础验证后合入默认分支，标记 `experimental`；
5. 开发机拉取并进行真实项目验证与迭代；
6. 验证达标后发布首个稳定版本；
7. 使用验证证据向 HulianUI 提交 MCP 集成 Issue；
8. MCP 采用固定知识版本并验证兼容性。

## 18. 初始权威来源

- ISO 9241-11:2018: https://www.iso.org/standard/63500.html
- ISO 9241-210:2019: https://www.iso.org/standard/77520.html
- W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/
- W3C WAI-ARIA APG: https://www.w3.org/WAI/ARIA/apg/
- W3C Cognitive Accessibility: https://www.w3.org/WAI/cognitive/
- W3C Accessibility Evaluation Tools: https://www.w3.org/WAI/test-evaluate/tools/selecting/
- W3C Privacy Principles: https://www.w3.org/TR/privacy-principles/
- Google HEART: https://research.google/pubs/measuring-the-user-experience-on-a-large-scale-user-centered-metrics-for-web-applications/
- GOV.UK Service Standard: https://www.gov.uk/service-manual/service-standard
- GOV.UK Design System research: https://design-system.service.gov.uk/community/develop-a-component-or-pattern/
- USWDS Design Principles: https://designsystem.digital.gov/design-principles/
- USWDS Maturity Model: https://designsystem.digital.gov/maturity-model/
- Nielsen Norman Group heuristics: https://www.nngroup.com/articles/ten-usability-heuristics/
- Nielsen Norman Group research methods: https://www.nngroup.com/articles/which-ux-research-methods/

经典著作仅作为综合知识输入，不复制受版权保护的正文。首批包括 Jesse James Garrett、Don Norman、Steve Krug、Giles Colborne、Marty Cagan 及本地提供的产品设计资料。
