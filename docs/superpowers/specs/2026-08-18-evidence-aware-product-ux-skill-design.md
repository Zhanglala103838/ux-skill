# Evidence-aware Product UX Skill 设计规格

状态：对抗评审后修订，等待第二轮独立评审  
规格版本：0.2  
日期：2026-08-18  
目标 Skill：`improving-product-ux`  
首个适配器：HulianUI  
仓库：`Zhanglala103838/ux-skill`

## 1. 目标

建设一个独立于任何 UI 库的 UX Skill，使 Agent 能够：

1. 在设计、审查、迁移、改进和验证数字产品时，以用户目标、使用情境、完整服务和可观察结果为中心判断；
2. 明确区分产品假设、实现事实、专家判断、用户观察、生产行为和因果结论；
3. 根据具体 actor–goal–task 场景实例，而不是页面标签或组件数量，选择适用规则；
4. 把 UX 设计意图交给可插拔设计系统适配器实现；
5. 让 Agent Skill 与 HulianUI MCP 使用同一份可追溯、版本化、机器可执行的知识快照；
6. 通过无 Skill 基线、带 Skill 复测、保留案例和真实项目迭代后，再把稳定且确定的规则下沉到 MCP 或自动化门禁。

Skill 不生成单一“UX 总分”。它输出用户影响、适用情境、证据与限制、建议、验证方法和不能下出的结论。

## 2. 定义与范围

### 2.1 UX

UX 包括用户因实际使用、预期使用、拒绝使用、中途放弃以及使用后的记忆而产生的认知、情绪、身体、行为和成就反应。UX 可以在用户进入界面之前失败，例如用户因不信任、预期隐私风险或无法找到服务入口而放弃。

### 2.2 可用性

可用性是指定用户在指定情境中实现指定目标时的有效性、效率和满意度。它是使用结果，不是页面、组件或设计系统本身的属性。

### 2.3 相邻概念

- **UI quality**：界面表达与实现质量，是 UX 的输入之一；
- **accessibility**：残障用户平等使用的必要条件，与 UX 相交但不等同；
- **service experience**：跨触点、跨角色和组织流程形成的完整体验；
- **customer experience**：客户与组织关系的更宽范围体验；
- **human/social impact**：对非直接用户、群体与社会造成的影响。

### 2.4 包含范围

- Web、移动 Web、原生移动端、桌面端、小程序等数字产品；
- 公开官网、内容服务、交易服务、消费者产品、Admin、数据操作、配置工具和 AI 辅助能力；
- 用户需求、产品目标、功能范围、信息架构、任务流、内容、交互、界面、视觉、无障碍、信任、隐私、性能、韧性、服务交接和验证；
- 影响用户目标的线上、线下、人工和组织流程；
- design、audit、migrate、improve、verify 五类 Agent 请求。

### 2.5 非目标

- 工业产品、实体空间和人体工程学的完整方法；
- 纯品牌广告、传播活动或视觉艺术评价；
- 法律、安全、医学或行业合规认证；
- 用自动化代替用户研究；
- 用组件覆盖率、采用率、审美偏好或单一评分代表 UX；
- 把启发式风险或相关性数据包装成已验证因果结论。

## 3. 来源、权威与适用性

知识来源不是单一排行榜。每条规则分别记录四组属性：

### 3.1 权威状态 `authority_status`

- `law`
- `contract`
- `standard-requirement`
- `standard-recommendation`
- `organizational-policy`
- `advisory`
- `none`

标准只有在具体版本、章节、对象范围和义务来源成立时才能产生 violation。WCAG Success Criterion、Understanding、Technique 和 APG 不得被视为相同规范等级。

### 3.2 实证基础 `evidence_basis`

- `systematic-review`
- `replicated-research`
- `single-study`
- `expert-consensus`
- `practice-report`
- `heuristic`
- `unverified-hypothesis`

研究机构名称不能替代方法质量和复现证据。

### 3.3 适用范围 `applicability`

记录 jurisdiction、domain、technology、population、language、conformance scope、included conditions 和 excluded conditions。

### 3.4 来源状态 `source_status`

记录 publisher、title、edition/version、section locator、issued_at、accessed_at、reviewed_at、stable_url、normative/informative、superseded_by 和 rights。

一条规则可以同时关联多个来源，并通过 `defines | requires | supports | motivates | exemplifies` 描述来源作用。第三方内容只保存必要书目信息、短摘要与链接；MIT 只覆盖本仓库原创表达和代码。

## 4. 分析单元与可选镜头

核心 schema 不使用 Garrett 五层作为唯一分类。每个 finding 可以关联多个 `analysis_units`：

- `anticipation-and-entry`
- `task-and-interaction`
- `content-and-information`
- `journey-and-touchpoint`
- `service-frontstage`
- `service-backstage`
- `organization-and-policy`
- `sociotechnical-ecosystem`
- `longitudinal-behavior-loop`
- `sensory-expression`

可选 `lenses` 用于解释，不作为规则主键：

- `garrett-planes`：strategy、scope、structure、skeleton、surface；
- `norman-action-cycle`：目标、执行、反馈、解释与评估；
- `usability-heuristics`；
- `service-blueprint`；
- `accessibility`；
- `trust-and-ethics`；
- `behavioral-and-metrics`。

Garrett 五层适合从抽象到具体定位数字界面问题，但不能覆盖组织政策、跨机构服务、人机共同决策和社会技术反馈回路。

所有分析单元都需考虑：无障碍、内容、信任、隐私、性能、弱网、低端设备、响应式、状态完整性、恢复、国际化、熟练度和长期效率。

## 5. 请求模式与场景实例

### 5.1 请求模式

`request_mode` 是顶层单值：

- `design`
- `audit`
- `migrate`
- `improve`
- `verify`

它描述 Agent 当前任务，不属于用户场景。

### 5.2 场景实例

分析对象使用 `scenario_instances[]`。每个实例将用户、目标、任务、权限、频率、渠道与风险绑定，避免多个数组形成错误笛卡尔积。

```yaml
scenario_id: refund-customer-review
scope: journey-step
actor:
  relationship: customer
  role: purchaser
  authority: own-order
  proficiency: occasional
  frequency: monthly
goal: understand refund status and next action
task:
  family: transact
  operation: review
  object: refund
  phase: post-submission
channel:
  shell: web
  device: mobile
  input_modes: [touch, screen-reader]
environment:
  connectivity: variable
  interruption: possible
risk:
  consequence_domains: [financial, privacy]
  operation_properties: [reversible]
  affected_scope: individual
  recovery_cost: medium
  uncertainty: low
classification:
  evidence_refs: [evidence-context-1]
  confidence: high
```

每个 finding 必须引用一个或多个 `scenario_id`。

### 5.3 正交分类轴

- `channel.shell`：web、mobile-web、native-mobile、desktop、mini-program、email、phone、paper、in-person；
- `actor.relationship`：public、customer、employee、operator、administrator、partner、affected-non-user；
- `task.family`：inform、discover、compare、transact、create、operate、configure、review、approve、recover、collaborate；
- `capability_overlays`：ai-assisted、data-dense、real-time、offline-capable、multilingual；
- `environment`：设备、输入模式、带宽、时间压力、中断、环境隐私和辅助技术；
- `risk`：后果、操作属性、影响范围、可逆性、持续时间、可检测性、恢复成本和不确定性。

`ai-assisted`、`data-dense` 和 `desktop` 是 overlay 或 channel，不与 Admin、官网等任务场景并列。

### 5.4 Profile

Profile 只是低优先级默认值，由场景实例推导，不直接驱动结论：

- `public-marketing`
- `public-content`
- `transactional-service`
- `consumer-product`
- `admin-operations`
- `data-operations`
- `configuration-tool`
- `ai-assisted-product`

路由名、仓库名、页面标题和视觉外观只能产生低置信度候选。缺少 actor、goal、task 或 consequence 时，Agent必须输出候选分支或请求必要信息，不能确定 Profile。

### 5.5 场景重算

actor、goal、task phase、authority、risk、channel 或服务责任方变化时创建新场景实例。迁移项目还需记录 `source_scenario`、`target_scenario` 和必须保持的业务状态。

## 6. 旅程与服务系统

跨端不是平台数组，而是有顺序和交接的 journey：

```yaml
journey:
  journey_id: identity-verification
  user_outcome: verification completed without duplicate submission
  steps:
    - step_id: enter-details
      scenario_ref: applicant-web-entry
      owner: product-team
    - step_id: capture-document
      scenario_ref: applicant-mobile-camera
      owner: identity-provider
    - step_id: manual-review
      scenario_ref: operator-admin-review
      owner: operations-team
  transitions:
    - from: enter-details
      to: capture-document
      handoff: qr-code
      persisted_state: application-id
      timeout: 24h
      resume_path: emailed-link
      failure_recovery: return-to-enter-details
```

对服务级 finding 还需记录：

- actors 与 affected non-users；
- channels 与 touchpoints；
- frontstage、backstage、support systems；
- policy constraints 和 ownership；
- handoffs、wait states、failure demand；
- 数据和状态由谁持有；
- 人工支持、升级和恢复路径；
- 运营指标与用户结果的关系。

高风险交易服务必须验证至少一个跨渠道或跨角色闭环，不能只验证数字页面。

## 7. 规则适用与冲突裁决

规则解析顺序固定为：

1. 已确认适用的法律、合同、标准要求和无障碍基线；
2. 人身、授权、隐私、财务、数据、服务连续性和完全排除等伤害后果；
3. 用户自主权、可拒绝性、可逆性与真实替代路径；
4. 当前 actor 的明确目标和 task；
5. 当前 journey step、system state 与责任方；
6. 熟练度、频率、输入方式、设备和环境；
7. Profile 默认值和视觉表达偏好。

规则包含：

- `priority_class`
- `conflicts_with`
- `override_conditions`
- `cannot_override`
- `resolution_strategy`

解析器必须输出 `matched_rules`、`excluded_rules` 和 `resolution_trace`。无法裁决时返回分支或 `unknown`，禁止任意合并。

成本只参与排期，不降低伤害严重度。即使只影响少数用户，完全阻断关键服务仍可为 blocker。

## 8. Claim–Evidence 模型

删除单一 E0–E6 证据阶梯。证据不能压成一个“最高等级”。

### 8.1 Claim 类型

- `implementation-state`
- `runtime-behavior`
- `task-reachability`
- `accessibility-barrier`
- `usability-problem`
- `prevalence`
- `mechanism`
- `causal-effect`
- `longitudinal-outcome`
- `affective-response`
- `ethical-harm`

### 8.2 Evidence 描述

每个 evidence item 记录：

- `modality`：artifact、runtime、expert-review、user-observation、self-report、telemetry、experiment；
- `study_design`：exploratory、descriptive、observational、controlled、quasi-experimental、longitudinal；
- `population`、sampling、inclusion/exclusion；
- `context_fidelity`；
- `instrument`、measurement quality 和 missing data；
- quantitative fields：denominator、effect size、interval、power、assignment、duration、predeclared metrics、multiple comparisons、interference；
- qualitative fields：recruitment、researcher role、prompting risk、analysis procedure、negative cases、transfer limits；
- `causal_identification`；
- `uncertainty`；
- `limitations`；
- producer、tool/version、captured_at、artifact hash 和 redaction status。

只有与 claim 类型匹配的证据组合才能支持该 claim。例如：

- DOM 和自动化只能支持部分 implementation/accessibility claim；
- scripted interaction 可以支持 task reachability，不能证明真实可用性；
- telemetry 可描述发生率，但通常不能解释机制；
- 用户观察可发现机制与问题，但样本不足时不能推断总体发生率；
- A/B 必须满足实验完整性要求，显著性不能替代效应大小、实际重要性或伦理判断；
- 长期相关改善没有反事实时不能写成设计造成的因果效果。

报告分别输出 `supported_claims`、`unsupported_claims`、`contradictory_evidence` 和 `not_evaluated`。

## 9. 发现、伤害与优先级

### 9.1 Finding 类型

- `violation`：具体义务、版本和适用范围均已确认；
- `scenario-mismatch`
- `usability-risk`
- `observed-problem`
- `optimization-hypothesis`
- `ethical-risk`
- `not-applicable`
- `upstream-gap`

### 9.2 Finding 状态

- `pass`
- `fail`
- `unknown`
- `not-applicable`
- `not-run`
- `partial`
- `tool-failed`

工具失败单独报告，不能伪装成产品通过或失败。

### 9.3 伤害模型

记录：

- `harm_magnitude`
- `exclusion`
- `affected_population`
- `vulnerable_population`
- `affected_non_users`
- `power_asymmetry`
- `coercion_or_manipulation`
- `distributional_harm`
- `reversibility`
- `duration`
- `detectability`
- `exposure`
- `recovery_cost`

严重度为 blocker、major、moderate 或 minor；置信度另记。触达、修复成本和证据置信度参与排期，但不改变伤害本身。

转化率、留存或统计显著性不能覆盖以下红线：欺骗、强迫、报复性退出、无真实替代路径、隐私过度采集、危险默认、对脆弱群体的剥削，以及关键服务的完全排除。

## 10. Finding 与运行报告契约

顶层 report 包含：

- `run_id`、started_at、completed_at；
- target repository、commit、dirty state、scope 和 exclusions；
- request_mode、scenario instances、journey refs；
- Skill、knowledge、schema、adapter、MCP 和 UI 的版本与摘要；
- tool execution summary；
- report status：complete、partial、degraded、failed；
- redaction policy 与 artifact index。

每个 finding 至少包含：

```json
{
  "finding_id": "uxf-...",
  "fingerprint": "stable-hash",
  "rule_ref": {"rule_id": "UX-...", "version": "1.0.0"},
  "source_refs": ["SRC-WCAG-22"],
  "scenario_refs": ["refund-customer-review"],
  "analysis_units": ["task-and-interaction"],
  "lenses": [{"id": "garrett-planes", "values": ["structure"]}],
  "type": "usability-risk",
  "status": "fail",
  "claim": {
    "type": "task-reachability",
    "statement": "..."
  },
  "evidence_refs": ["ev-..."],
  "user_impact": "...",
  "harm": {},
  "severity": "major",
  "confidence": "medium",
  "recommendation": {
    "intent_id": "INTENT-RECOVERABLE-DESTRUCTIVE-ACTION",
    "user_outcome": "...",
    "vendor_neutral_approach": "...",
    "design_system_mapping": [],
    "tradeoffs": []
  },
  "verification": {
    "claim_to_test": "...",
    "method": "...",
    "success_criteria": [],
    "prohibited_claims": []
  },
  "upstream_gap": false
}
```

finding fingerprint 由 rule、scenario、目标位置和 claim 类型的规范化表示生成。Rule ID 永不复用；废止规则保留 tombstone、`deprecated_at` 和 `superseded_by`。

## 11. 可执行规则契约

规则不是自然语言字段目录。v1 条件语言采用封闭 AST：

```json
{
  "all": [
    {"path": "scenario.task.family", "op": "eq", "value": "configure"},
    {"path": "scenario.risk.operation_properties", "op": "contains", "value": "destructive"},
    {"path": "evidence.runtime.confirmation", "op": "exists"}
  ]
}
```

允许操作仅包括：`eq`、`neq`、`in`、`contains`、`exists`、`lt`、`lte`、`gt`、`gte`，并通过 `all/any/not` 组合。

每条规则包含：

- stable `rule_id`、version、status；
- intent/capability IDs；
- authority、evidence basis、applicability 和 source refs；
- applicability AST 与 exclusion AST；
- `automation_capability`：automated、assisted、manual、user-research；
- `enforcement`：blocking、advisory、informational；
- required claim–evidence combination；
- evaluator/check ID、inputs 和 outputs；
- pass/fail/unknown/not-applicable/not-run 条件；
- conflict metadata；
- repair intent 和 verification contract。

只有确定性、适用范围明确的 violation 可以 blocking。Heuristic、research-backed 和 product hypothesis 默认 advisory。写文件、创建 Issue、外部消息或不可逆操作不属于规则评估，必须是用户明确授权的独立动作。

无法确定化的规则在 v1 标记为 manual，不使用伪机器条件。

## 12. Schema 与兼容性

以下对象均有独立 JSON Schema：

- context/scenario；
- journey/service；
- source；
- rule；
- evidence；
- report/finding；
- manifest；
- adapter；
- eval case/result。

使用固定 JSON Schema draft。核心对象默认拒绝未知字段；扩展只能进入带命名空间的 `extensions`。消费者通过 manifest 协商 minor 版本后才能忽略未知扩展，拼写错误不得静默通过。

语义版本规则：

- Patch：不改变判断的措辞、来源链接或错误修复；
- Minor：向后兼容的规则、Profile、可选字段或扩展；
- Major：改变规则意义、必填字段、裁决、enforcement 或兼容性。

## 13. HulianUI 适配器

核心 UX 定义不依赖 HulianUI。Skill 判断用户问题和设计意图；MCP 判断组件存在性、版本和 Hulian 硬规则；adapter 只做语义与能力转换。

适配器包含：

- `adapter_version`
- `knowledge_range`
- `hulian_mcp_range`
- `hulian_ui_range`
- supported tools 与 tool schema digests；
- core `intent_id/capability_id` 到 Hulian capability 的映射；
- core scenario 到 Hulian surface/modifier/workflow 的 conversion table；
- lossless、degraded 和 unmappable 状态；
- fallback 和 prohibited mappings。

调用前执行 capability/tool-schema 协商。不能把核心枚举直接传给 MCP。推荐组件必须位于实际安装版本边界内。

适配器可指导调用 `inspect_project`、`recommend_ui`、`get_component_doc`、`get_conventions`、`validate_hulian_usage` 等能力，但必须保留它们各自的证据边界。

发现上游缺口时记录最小复现、scenario、user impact、intent、期望 API、版本、证据与验证要求。不得强迫使用不适合场景的组件，不得以组件数量衡量 UX，不得用消费端 CSS/行为补丁长期隐藏上游缺口。

## 14. 知识制品与离线状态

v1 选择 GitHub Release 作为知识制品：

- `ux-knowledge-<version>.tgz`
- `ux-knowledge-<version>.manifest.json`
- `SHA256SUMS`

制品使用排序后的路径、规范化 JSON、固定时间戳和 SHA-256，manifest 记录 build commit、schema versions、文件路径、字节数与摘要。manifest 不包含自身摘要。

HulianUI MCP 在构建时固定精确版本并内嵌快照；运行时不静默联网更新。启动时校验 schema、adapter 和摘要。

运行状态：

- `ready`
- `degraded`
- `incompatible`
- `corrupt`
- `unavailable`

规范性或自动化判断在知识无效时 fail closed，不得报告 pass。供应商中立的启发式分析可以 degraded，但必须列出未执行项。若存在校验通过的 last-known-good，可显式回退并报告其版本；不得静默 fallback。

## 15. Skill 渐进披露

`SKILL.md` frontmatter 只包含：

- `name: improving-product-ux`
- description 以 `Use when...` 开始，只描述设计、审查、迁移、改进或验证数字产品体验的触发情境，不摘要流程。

路由契约：

| request_mode | 必读 |
|---|---|
| design | UX foundations、context、service、ethics |
| audit | context、claim–evidence、finding/report |
| migrate | context、journey、implementation、目标 adapter |
| improve | 原 finding/evidence、implementation、目标 adapter |
| verify | claim–evidence、verification、目标 adapter |

当存在 HulianUI 或用户要求 HulianUI 时完整读取 adapter；否则不得加载 HulianUI 细节污染核心判断。

触发 eval 包含正例、负例、相邻 Skill 冲突、描述截短、隐式调用和显式调用。Skill 必须能在没有 MCP 时独立输出供应商中立结果。

## 16. 仓库结构

```text
ux-skill/
├── SKILL.md
├── agents/openai.yaml
├── references/
│   ├── ux-foundations.md
│   ├── context-and-service.md
│   ├── research-and-evidence.md
│   ├── ethics-and-harm.md
│   ├── findings-and-reporting.md
│   └── implementation-guidance.md
├── knowledge/
│   ├── manifest.json
│   ├── ux-rules.json
│   ├── sources.json
│   └── rule-history.json
├── schemas/
├── adapters/hulianui/
│   ├── adapter.md
│   └── adapter.json
├── evals/
│   ├── cases.json
│   ├── holdout-manifest.json
│   └── rubric.md
├── scripts/
│   ├── validate-knowledge.mjs
│   ├── build-artifact.mjs
│   └── run-evals.mjs
└── LICENSE
```

不添加会进入 Skill 上下文的重复 README 或长 CHANGELOG。规则变更写入机器可读 `rule-history.json`；发布级兼容变化写入 GitHub Release notes。

## 17. 失败、安全与研究伦理

- 缺少 actor、goal、task 或 context：返回候选分支或 unknown，不编造用户需求；
- 缺少运行环境或鉴权：列出 not-run，不声称登录后体验已验证；
- 自动工具冲突：保留原始证据并要求人工复核；
- adapter/MCP 缺失：供应商中立分析降级运行；
- 不可逆、隐私、财务、授权、医疗或安全任务：提高验证要求并检查恢复、审计和人工升级；
- 研究材料：最小化采集、知情同意、可撤回、无报复、脱敏和访问控制；
- 研究活动如果构成人类参与研究，遵守适用机构、伦理与法律要求；
- 公开报告和 Issue 不包含敏感用户、研究或凭据数据；
- 本 Skill 不提供合规认证。

## 18. Eval 与开发机验证

### 18.1 RED 基线

在 Skill 实现前，用独立 Agent 运行压力场景，记录没有 Skill 时的原始输出和具体失败：伪证据、错误 Profile、组件先行、总分、静态扫描冒充 UX、无场景强结论等。

### 18.2 GREEN 与 REFACTOR

使用 Skill 重跑相同场景，修复已观察失败；随后用未见 holdout 和组合压力测试寻找新漏洞。测试 Agent 只获得 Skill 与原始任务，不获得预期答案或缺陷诊断。

### 18.3 Case 契约

每个 case 包含：

- input artifact、scope 和允许信息；
- gold scenario instances 与分类依据；
- expected matched/excluded rules；
- conflict resolution assertions；
- required claims、allowed claims 和 prohibited claims；
- expected degradation 和 tool failure；
- structural assertions；
- high-risk unsafe recommendations that must never appear。

记录模型、版本、设置、Skill commit、knowledge digest、重复次数与原始输出。

### 18.4 必测对抗案例

- 30 列高密表格：专家 Admin 与首次移动官网；
- 即时自动保存：消费者笔记与全局权限配置；
- 无限滚动：内容发现与审批审计；
- Chat-only：低风险 AI 创作与金融/医疗；
- hover-only 操作：桌面专家与移动客户；
- 同一订单页的客户、客服与管理员三个 scenario instances；
- `/admin/billing` 客户自助付费标签陷阱；
- Web → 手机 → 邮件 → 人工审核的跨渠道 KYC；
- AI 生成 → 主管审批 → 管理员发布配置的场景迁移；
- 少数读屏用户被完全阻断与多数用户轻微延迟的严重度比较；
- 埋点缺失、样本污染、统计显著但效应无实际意义；
- 转化提高但存在欺骗、强迫或退出报复；
- 快照损坏、schema major 不兼容、adapter 缺失、MCP 部分工具失败；
- 旧项目迁移与已使用 HulianUI 的项目改进；
- 真正 upstream gap 与消费端误用的区分。

### 18.5 阻断门槛

experimental 发布必须全部满足：

- schema、摘要、ID、source 和引用完整性：100%；
- canonical case 的 scenario binding、规则适用和 conflict trace 结构断言：100%；
- prohibited claims：0；
- high-risk unsafe recommendation：0；
- tool-failed/not-run 被误报为 pass：0；
- heuristic 被提升为 blocking violation：0；
- 触发正负例与 adapter 兼容的确定性测试：100%；
- 至少 5 次独立 Agent 重跑，所有硬门槛均通过；
- 至少一个公开场景和一个 Admin 场景完成真实项目纵向验证。

stable 发布另需：

- 覆盖所有主要 task family、混合场景、场景迁移、服务、伦理、无障碍和 AI 的分层案例集；
- 未见 holdout 全部通过硬门槛；
- 至少两名独立 UX/HCI 评审者盲评关键 finding，分歧有记录和裁决；
- finding-level 误报/漏报、严重度一致性和证据校准公开记录；
- 高风险规则不存在已知危险漏报；
- 至少三个不同类型真实项目，其中包含一个跨渠道或跨角色服务；
- 所有失败证据、起始 SHA、dirty state、日志、重放和恢复记录可复核。

不以总体平均值掩盖任何高风险硬门槛。

## 19. 首版验收标准

- UX、可用性、UI、无障碍、服务体验和社会影响边界明确；
- 官网、Admin 和混合页面按 scenario instance 而不是路由标签分类；
- 相同设计在不同任务、权限、风险下产生可解释的不同结论；
- matched/excluded rules 与 conflict resolution 可追踪；
- claim 与 evidence 类型匹配，不使用伪线性等级；
- normative 判断可追溯到具体版本、章节、范围和义务来源；
- Garrett 只作为可选 lens；
- finding 可追溯到 rule、source、knowledge digest 和原始 evidence；
- 不生成总分，不把静态扫描、Guard 或组件采用率写成用户结果；
- 自动化与 enforcement 分离；
- Skill 无 HulianUI 时可独立工作；
- HulianUI adapter 版本感知、能力协商且不越权解释 UX；
- 离线、损坏、缺失和部分失败不会静默通过；
- RED、GREEN、holdout 与真实项目证据完整；
- 验证达标后才向 HulianUI 提交 MCP 集成 Issue。

## 20. 实施与发布顺序

1. 本修订规格在 `design/v0` 接受第二轮独立对抗评审；
2. 处理阻断问题并由用户审阅最终规格；
3. 审阅通过后编写远程实施计划；
4. 先实现最小纵向切片：一个 scenario、一个确定性规则、一个 claim–evidence 链、一个 Hulian mapping、一个离线制品和一个完整 finding；
5. 纵向切片通过 RED/GREEN 与契约测试后扩展知识；
6. 合入默认分支并标记 experimental；
7. 开发机拉取，完成真实项目验证与迭代；
8. 达到 stable 门槛后发布稳定制品；
9. 用验证证据向 HulianUI 提交 MCP 集成 Issue。

## 21. 初始权威来源

- ISO 9241-11:2018: https://www.iso.org/standard/63500.html
- ISO 9241-210:2019: https://www.iso.org/standard/77520.html
- Jesse James Garrett, The Elements of User Experience: https://www.jjg.net/elements/
- W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/
- W3C WAI-ARIA APG: https://www.w3.org/WAI/ARIA/apg/
- W3C Cognitive Accessibility: https://www.w3.org/WAI/cognitive/
- W3C Accessibility Evaluation Tools: https://www.w3.org/WAI/test-evaluate/tools/selecting/
- W3C Privacy Principles: https://www.w3.org/TR/privacy-principles/
- Google HEART: https://research.google/pubs/measuring-the-user-experience-on-a-large-scale-user-centered-metrics-for-web-applications/
- GOV.UK Service Standard: https://www.gov.uk/service-manual/service-standard
- GOV.UK Joined-up Service: https://www.gov.uk/service-manual/service-standard/point-3-join-up-across-channels
- GOV.UK Design System Research: https://design-system.service.gov.uk/community/develop-a-component-or-pattern/
- USWDS Design Principles: https://designsystem.digital.gov/design-principles/
- USWDS Maturity Model: https://designsystem.digital.gov/maturity-model/
- Nielsen Norman Group Usability Heuristics: https://www.nngroup.com/articles/ten-usability-heuristics/
- Nielsen Norman Group Research Methods: https://www.nngroup.com/articles/which-ux-research-methods/
- ASA Statement on p-values: https://www.amstat.org/asa/files/pdfs/P-ValueStatement.pdf
- Belmont Report: https://www.hhs.gov/ohrp/regulations-and-policy/belmont-report/read-the-belmont-report/index.html

经典著作只作为综合知识输入，不复制受版权保护正文。首批包括 Jesse James Garrett、Don Norman、Steve Krug、Giles Colborne、Marty Cagan 及本地提供的产品设计资料。
