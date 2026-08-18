# Evidence-aware Product UX Skill 设计规格

状态：第二轮对抗评审后修订，等待第三轮独立评审  
规格版本：0.3  
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

规则不得把“某本书这样说”直接转换成普遍义务。知识库保存来源及其中的逐条断言；权威属于断言边，而不是整本来源或整条规则。

### 3.1 SourceAssertion

~~~yaml
assertion_id: string
source_ref: string
locator: string
relation: defines | requires | recommends | supports | motivates | exemplifies
authority_status: normative | adopted-policy | empirical | expert-synthesis | practitioner
normative_scope:
  object: string
  conformance_level: string | null
  technology: string | null
  jurisdiction: string | null
  adoption_basis: string | null
claim_scope: string
applicability: condition_ast
superseded_by: assertion_id | null
~~~

同一来源可包含规范要求、解释、例子和作者观点，必须拆成不同 assertion。定位至少到章节、成功准则、条款或稳定 URL 片段。

只有同时满足以下条件，Finding 才能使用 violation 或 non_conformance：

1. 至少一个适用的 normative 或 adopted-policy assertion；
2. 来源版本、对象、符合级别、技术范围、辖区和采纳依据均已解析；
3. 已区分必须达到的结果和某种实现，并检查等价替代；
4. 目标证据满足断言要求的观察方法；
5. 没有被取代，也没有未解决的同级义务冲突。

否则只能报告 risk、heuristic、opportunity、unknown 或 escalation。多个义务相撞时，裁决只能是 resolved、infeasible、unknown 或 escalated。

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

每次运行只选一个主模式：guide、scan、refactor 或 verify。模式决定输出目的，不决定规则适用性或严重度。

### 5.1 ScenarioInstance

场景是有身份、授权、资源、目的和风险边界的实例，不是 website/admin/mobile 标签数组。

~~~yaml
scenario_id: string
principal: { actor_id: string, actor_type: human | service | agent }
represented_party: actor_ref | null
account_or_tenant: resource_ref | null
resource: { resource_id: string, owner_or_subject: actor_ref | null }
role_assignments:
  - { role: string, assignee: actor_ref, scope: resource_ref }
authority_grants:
  - grant_id: string
    grantee: actor_ref
    action_scope: [string]
    resource_scope: [resource_ref]
    source: contract | policy | consent | delegation | law | system
    delegated_by: actor_ref | null
    effective_at: datetime
    expires_at: datetime | null
beneficiaries: [actor_ref]
affected_parties: [actor_ref]
goal: string
task:
  intent: string
  action: string
  object: resource_ref
  lifecycle_phase: create | read | update | approve | revoke | delete | export | recover
channel: web | mobile | desktop | terminal | api | multimodal
environment:
  place: string
  device: string
  input_output: [string]
  connectivity: string
risk_context:
  domain: general | finance | health | safety | employment | education | legal | identity
  reversibility: reversible | costly | irreversible
  vulnerability_factors: [string]
  data_sensitivity: public | internal | personal | sensitive | highly_sensitive
~~~

principal、represented_party、resource owner/subject、beneficiary 和 affected_party 可以不同。系统分别检查谁在操作、代表谁、影响谁、谁承担后果，以及权限来自哪里。

### 5.2 Typed facets

page_family、surface、channel、audience 等只作为带类型和基数的 facet。registry 声明值域、0..1/1/0..n/1..n 基数、canonical owner、推导来源和不变量。同一事实只有一个 canonical owner，派生值必须回溯至 ScenarioInstance。

website、admin、commerce、onboarding 等 Profile 只建议待确认的 facet 和问题。未经解析的 Profile 不得激活或排除规则，不得改变严重度、优先级或发布判断，也不得替代 actor、authority、resource、journey 或 risk_context。

### 5.3 多场景绑定与演化

Finding 的 scenario_bindings 为数组，每项 relation 只能是 target、affected_party、comparator 或 evidence_context。

ScenarioLineage 记录 previous_scenario_id、change_event、before/after authority digest、before/after risk digest、preserved/invalidated invariants，以及是否需重新认证或批准。权限默认不继承；主体、资源、租户、时间、目的或风险变化都重新求值，执行前再次验证授权以防 TOCTOU。


## 6. 旅程与服务系统

Journey 是可验证的有向状态图，而不是页面列表。

~~~yaml
journey_id: string
entry_steps: [step_id]
terminal_outcomes:
  - { outcome_id: string, kind: success | safe_exit | cancelled | failed | escalated }
steps:
  - step_id: string
    preconditions: [condition_ast]
    postconditions: [condition_ast]
transitions:
  - transition_id: string
    from: step_id
    to: step_id | outcome_id
    trigger: string
    guard: condition_ast
    carried_state:
      - { name: string, type: string, source_step: step_id, classification: string, version: string }
    authority_context: [grant_id]
    consent_context: [string]
    idempotency_key: string | null
    timeout_ms: integer | null
    retry_policy: string | null
    cancel_path: transition_id | null
    recovery_path: transition_id | null
    escalation_path: transition_id | null
~~~

验证器拒绝：不存在的引用、入口不可达步骤、没有可达 terminal 的路径、歧义 transition、缺失的取消/超时/重试/恢复语义、跨主体/租户/资源/目的非法携带权限或同意、不可逆重试无幂等保护，以及失败后只剩死路、循环或假成功。端内、跨端与人工服务触点统一入图。


## 7. 规则适用与冲突裁决

裁决固定分三阶段：

1. Applicability：只根据 ScenarioInstance、Journey、运行上下文、辖区和 SourceAssertion 计算 applicable、not_applicable 或 unknown。不得读取测试成功、截图存在或样本量等证据状态。
2. Hard-constraint feasibility：对已适用硬约束建立无环关系图，边为 overrides、cannot_override、requires_together、incompatible_with；结果为 feasible、infeasible、unknown 或 escalated。法律、生命安全、重大经济后果、弱势群体权利或组织权限冲突必须升级给有权限的人。
3. Soft preference：只在可行集合内按任务成功、伤害降低、可逆性、组织约束和用户偏好选择建议。品牌、视觉和组件便利性不得覆盖硬约束。

每次输出 resolution_trace：候选断言、适用结果、图边、排除原因、剩余方案、未决信息和升级责任人。缺少 trace 的结论不能进入发布判断。证据不足不能伪装成不适用。


## 8. Claim–Evidence 模型

### 8.1 Claim

共同字段为 claim_id、claim_type、subject、population、context、outcome、time_window、statement、scope_limit。claim_type 为 descriptive、normative、causal、predictive、affective 或 recommendation_rationale。

因果 Claim 还声明 treatment、comparator、unit、estimand、assignment_mechanism、interference_assumption；不能识别 comparator 或 estimand 时降级为描述性关联。Affective Claim 区分 reported_experience 和 inferred_signal，不得把点击、停留、面部、语音或情绪分类直接当作用户感受、诊断、脆弱性或意图。

### 8.2 Evidence 与关系

Evidence 保存 evidence_id、kind、provenance、collected_at、population、context、method、quality_limits、target_digest。kind 可为 code、screenshot、runtime、accessibility_tree、user_report、analytics、experiment、policy、expert_review。

ClaimEvidenceLink 独立保存 claim_id、evidence_id、relation、strength、rationale。relation 为 supports、contradicts、inconclusive 或 limits。系统必须显示反证，不得只选支持项。

### 8.3 兼容性与前置条件

知识库维护 claim_type × evidence_kind 兼容矩阵。例如：代码存在不能证明用户成功；截图不能证明键盘顺序、动态播报或恢复；自动工具无报错不等于 WCAG 合规；可用性观察不能独证长期业务/健康结果；组件合规不等于旅程有效。

evaluation_preconditions 与 applicability 分开。缺少所需证据时只能是 not_run、partial 或 unknown，不能是 not_applicable 或 pass。


## 9. 发现、伤害与优先级

Finding 类型为 violation、non_conformance、risk、heuristic、opportunity、unknown、escalation。规则评价的 pass、fail、partial、not_run、not_applicable、unknown、evaluation_error 是另一维度，不能互换。

风险分解保存 harm_magnitude、likelihood、exposure、affected_party_count、reversibility、detectability_before_harm、evidence_confidence。unknown 不得自动折算为低风险。

分别输出：

- severity：问题影响强度；
- risk_priority：结合可能性、暴露、人数、可逆性和置信度的排序；
- release_decision：allow、allow_with_conditions、block、escalate 或 undecided。

禁止用总分掩盖高伤害尾部风险。


## 10. Finding 与运行报告契约

RunReport 记录 run_id、request_mode、started_at、evaluator_version/digest、knowledge_digest、adapter_digest、input_digest、带 content_digest/dirty/included_artifacts 的 targets、excluded_targets、environment_facts 和 findings。

Finding 最小契约：

~~~yaml
finding_id: string
fingerprint: sha256
type: violation | non_conformance | risk | heuristic | opportunity | unknown | escalation
rule_id: string
rule_version: string
evaluation_outcome: pass | fail | partial | not_run | not_applicable | unknown | evaluation_error
scenario_bindings:
  - { scenario_id: string, relation: target | affected_party | comparator | evidence_context }
target_locator: string
target_digest: sha256
claim_refs: [claim_id]
evidence_links: [claim_evidence_link_id]
source_links: [assertion_id]
severity: string
risk_priority: string
release_decision: string
message: string
recommendation:
  action: string
  rationale_claims: [claim_id]
  evidence_links: [claim_evidence_link_id]
  applicability: condition_ast
  contraindications: [string]
  alternatives: [string]
  mechanism: string
  uncertainty: string
trace:
  evaluator_digest: sha256
  input_digest: sha256
  applicability_nodes: [node_id]
  resolution_nodes: [string]
  evaluation_nodes: [node_id]
tags: [string]
~~~

fingerprint 由 canonical target locator、target digest、rule id/version、scenario binding 和 claim key 生成；只改文案不能隐藏或制造问题。上游缺口使用 type 或 tag，不维护重复布尔字段。


## 11. 可执行规则契约

### 11.1 条件 AST

condition_ast_version 首版为 1。路径只能引用版本化 registry 中的 RFC 6901 JSON Pointer；每个节点有 node_id。

允许 literal、exists(path)、eq(path, typed_literal)、in(path, typed_literal_array)、compare(path, lt/lte/gt/gte, typed_literal)、all(children)、any(children)、not(child)。禁止脚本、正则执行、动态遍历、隐式转换和任意代码。eq(1, "1") 是 type_error。

### 11.2 missing、null 与三值逻辑

- missing：路径不存在，除 exists 外返回 unknown；
- null：路径存在且值为 null；exists 返回 true；
- type_error：返回 evaluation_error；
- all 空集合为 true，any 空集合为 false；
- not 只能有一个 child。

Kleene 逻辑：T AND U=U，F AND U=F，T OR U=T，F OR U=U，U AND U=U，U OR U=U；not(T)=F、not(F)=T、not(U)=U。

### 11.3 条件分槽

每条规则分别保存 applicability_condition、exclusion_condition、evaluation_preconditions。证据缺失只能影响 evaluation_preconditions，不能改写 applicability。

### 11.4 状态与结果

execution_state 为 scheduled、running、completed、tool_failed、invalid_input、invalid_rule、cancelled。evaluation_outcome 为 pass、fail、partial、not_run、not_applicable、unknown、evaluation_error。

completed 可产生 pass/fail/partial/unknown；前置证据缺失产生 not_run；阶段 A 为 false 产生 not_applicable；tool_failed/invalid_* 产生 evaluation_error；cancelled 产生 not_run。tool_failed、unknown 和 not_run 永远不能聚合成 pass。

### 11.5 单一 evaluator

Skill CLI、未来 MCP 和 CI 必须调用同一 evaluator 核心模块，禁止重写规则语义。仓库保存 parity vectors；同一输入在各入口的 Finding JSON、trace 与 digest 必须一致。


## 12. Schema 与兼容性

所有核心对象提供 JSON Schema 2020-12：ScenarioInstance、ScenarioLineage、Journey、SourceAssertion、Claim、Evidence、ClaimEvidenceLink、Rule、Finding、RunReport、AdapterHandshake、ArtifactManifest。

默认 additionalProperties: false。扩展只能放入 extensions，并使用反向域名命名空间。

版本轴独立：schema_version、knowledge_behavior_version、evaluator_version、rule_version、adapter_version、artifact_format_version、skill_version。兼容矩阵明确 producer/consumer 范围。任何改变适用性、裁决、结果聚合、严重度、建议或 Finding 身份的修复，即使名为 bugfix，也必须提升行为版本并完整重新认证。


## 13. HulianUI 适配器

HulianUI 是首个适配器，不是 UX 真理来源。无 HulianUI 时核心 Skill 仍离线运行；MCP 只增加证据与实现映射。

AdapterHandshake 精确记录 server_identity、每个 tool 的 name/version/input_schema_digest/output_schema_digest、data_source_mode、snapshot_id、freshness、project_root、adapter_version 和 adapter_digest。

要求：

1. project_root 显式提供并规范化，禁止回退当前目录；
2. Eval 使用固定 local_registry 或 captured_fixture，不依赖漂移远端；
3. 逐工具解析 success、partial、not_found、invalid_request、server_error；
4. MCP 失败保留 execution_state=tool_failed，不能生成“未发现问题”；
5. 组件建议附适用条件、替代方案及仍需验证的旅程结果；
6. Skill、CLI、MCP 对 parity vectors 的结构、Finding 集合和 trace 100% 一致。


## 14. 知识制品与离线状态

发布单位是 GitHub Release 中不可变的离线制品，运行时无需联网。

JSON 使用 RFC 8785 JCS。分别计算 knowledge_digest（规则/断言/registry）、manifest_digest（去除自身 digest 字段的 manifest）和 artifact_digest（最终压缩字节），三者不得混用。

首版固定 ustar + gzip：

- 文件按 UTF-8 路径字节排序；
- 文件 mode 0644，目录 0755；
- uid/gid 为 0，uname/gname 为空，mtime 为 0；
- 禁止 symlink、hardlink、PAX header 和扩展属性；
- gzip mtime 0、OS byte 255、level 9；
- 打包器及版本进入 toolchain lock。

归档内 manifest 与 Release sidecar manifest 字节一致。两次全新干净环境构建必须得到相同 artifact_digest。tag 与 asset 不覆盖；撤回通过带 supersedes/revokes 的新版本表达。


## 15. Skill 渐进披露

SKILL.md 只承担路由、边界和最短流程。description 写正向触发与负向边界，并声明 allow_implicit_invocation: true。

| 模式 | 必读 |
|---|---|
| guide | context-model、service-journey、claim-evidence、ethics-harm、reporting |
| scan | context-model、service-journey、rules-runtime、claim-evidence、ethics-harm、reporting |
| refactor | context-model、service-journey、rules-runtime、claim-evidence、ethics-harm、hulianui-adapter、reporting |
| verify | context-model、service-journey、rules-runtime、claim-evidence、ethics-harm、reporting |

所有模式读取 context-model 与 service-journey；给出严重度、发布判断或面向人的建议时读取 ethics-harm。MCP 是可选能力，不是启动条件。

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

输入、规则、适配器、工具或证据错误必须在运行状态和 Finding 中可见。不得用空结果掩盖失败、把没执行写成通过、把 unknown 降为低风险、虚构证据，或把组件合规/自动检查/专家直觉冒充完整 UX 结果。

### 17.1 ResearchProtocol

涉及用户研究、实验、遥测、访谈、可用性测试或行为干预时，先记录：

- research_type、decision_need、why_humans_are_needed、minimum_data_required；
- risk_probability、risk_magnitude、vulnerability_factors；
- recruitment_and_power_relation、compensation；
- consent_process、withdrawal_and_non_retaliation；
- privacy_retention_and_access；
- distress_stop_rule、crisis_or_support_referral；
- deception（none/proposed）与 debrief_plan；
- reviewer_role、approval_status、jurisdiction_and_policy。

若涉及未成年人、认知/经济脆弱性、创伤、医疗或心理危机、胁迫权力关系、欺骗、不可逆干预或高度敏感数据，默认 evaluation_outcome=not_run 且 type=escalation，直到有权限的独立审核批准。Skill 不扮演伦理委员会、法律顾问或临床专业人员。


## 18. Eval 与开发机验证

### 18.1 RED/GREEN

实现前冻结 RED suite，记录输入、预期、实际、失败原因、case digest 和时间。GREEN 逐项关闭原失败，不得删除、弱化或改写预期制造通过。

Canonical suite 至少 32 例：官网、后台、交易/审批、上手/登录、内容/搜索、跨端接续、错误恢复、辅助技术 8 个场景族各 4 例；至少 12 例覆盖高风险、弱势主体、权限变化、研究伦理或不可逆后果。

Private holdout 至少 16 例。公开仓库只存 id 与 digest，题面和 gold 隔离在开发机受控位置。任何因查看 holdout 而改变规则、提示、evaluator 或适配器的用例立即退役并补新盲例。

每例固定 case_id/digest、ScenarioInstance、Journey、inputs，以及 expected execution_state、evaluation_outcomes、finding_contracts、prohibited_claims、prohibited_recommendations、escalation_required、rationale、strata。

### 18.2 新鲜上下文与门槛

每个公开用例至少 5 次 fresh-context 运行，不携带作者对话、失败解释或 gold，只给发布制品、固定入口和输入。

实验门槛：

- schema、Finding 集合、trace、digest 跨 Skill/CLI/MCP 100% parity；
- 结构有效率 100%；
- prohibited claims/recommendations 为 0；
- tool failure 误判 pass 为 0；
- RED 全关闭；
- 两次干净构建 artifact bytes 一致。

稳定阶段还要求：独立专家盲评并按场景/风险 strata 报 precision、recall、unknown、escalation 和严重度一致性；当前观察到的 high-risk 集合 0 漏报且明确样本边界与残余风险；三个真实项目（至少一个非 HulianUI）验证。任何行为改变触发完整 recertification。


## 19. 首版验收标准

v0.1 可试验发布必须同时满足：

1. 场景区分主体、代表、资源权属、受益/受影响方和带范围/时效的授权；
2. Profile 不参与适用性、严重度或发布裁决；
3. Journey 校验引用、可达性、终点、状态携带、幂等、取消、超时、重试、恢复与权限再验证；
4. applicability、hard feasibility、soft preference 分阶段可追溯；
5. SourceAssertion 的权威、范围、采纳和更新位于断言边；
6. Claim、Evidence、supports/contradicts/inconclusive/limits 及反证可机器验证；
7. 缺证据、工具失败、不适用、未知和评价错误不互相伪装；
8. Finding、建议、target/input/evaluator digest 与 fingerprint 可复现；
9. Skill、CLI、MCP 共享 evaluator 并通过 parity；
10. 离线 Release 制品字节可复现，manifest 与 sidecar 一致；
11. ResearchProtocol 在高风险情形停止并升级；
12. RED/GREEN、private holdout、防泄漏、fresh-context、recertification 有证据；
13. Canonical、holdout 和三个真实项目达到第 18 节门槛；
14. 本机资料目录未写入项目文件；
15. 用户批准最终设计后才进入实施计划。


## 20. 实施与发布顺序

当前只做设计，不实现。

1. 提交 v0.3 到 design/v0；
2. 第三轮全新上下文对抗评审分别检查：认识论/证据/伦理；场景/授权/旅程/冲突；AST/状态/evaluator/适配器/制品/Eval；
3. 只有 GO，或 CONDITIONAL GO 且无核心 schema/语义阻塞，才交用户最终审阅；
4. 用户明确批准后，使用 writing-plans 形成远端实施计划；
5. 首个最小纵切仅含一个高风险后台配置/审批场景、一条确定性 advisory 规则、一个结构化 Claim 与正反证、共享 evaluator、一项 HulianUI 映射、一个离线制品和完整 Finding；
6. 同时覆盖路径缺失、null、类型错、MCP partial/tool_failed、权限过期、场景变化、研究 stop gate、重复构建；
7. 纵切通过 RED、parity、artifact、fresh-context 门槛后再扩展。

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
