# Evidence-aware Product UX Skill 设计规格

状态：第三轮对抗评审后修订，等待第四轮聚焦评审  
规格版本：0.4  
日期：2026-08-18  
目标 Skill：`improving-product-ux`  
首个适配器：HulianUI  
仓库：`Zhanglala103838/ux-skill`


## 1. 目标

建设独立于 UI 库的 Evidence-aware Product UX Skill，使 Agent 能在 guide、scan、refactor、verify 中：

1. 以具体主体、目标、任务、资源、授权、旅程、环境和受影响方为上下文；
2. 区分规范义务、实现事实、专家判断、用户观察、生产行为、情绪自报、模型信号、关联和因果结论；
3. 同时输出两条不可互相替代的轨道：
   - Assurance track：RuleEvaluation、Finding、RiskAssessment、ReleaseRecommendation；
   - Inquiry track：UXHypothesis、ResearchQuestion、DesignRationale；
4. 让 Skill、CLI、HulianUI MCP 适配器消费同一 EvaluationInputBundle，并由同一个 evaluator 产生确定结果；
5. 用先冻结并实际失败的 RED vectors、golden bytes、private holdout 和真实项目验证后，再扩大规则或自动门禁。

零 Finding 只表示在本次边界、规则和证据下没有生成 Finding，不表示 UX 良好、合规、任务成功或用户满意。组件采用、设计系统覆盖率和单一总分都不是 UX 结果证据。


## 2. 定义、请求模式与范围

### 2.1 UX 与相邻概念

UX 包括人在实际使用、预期使用、拒绝使用、中途放弃和使用后的认知、情绪、身体、行为与成就反应。可用性是在指定情境中实现目标的有效性、效率和满意度。UI quality、accessibility、service experience、customer experience 与 human/social impact 分别是输入、必要条件或相邻结果，不得互相替代。

### 2.2 唯一请求模式

规范内部只使用四个 request_mode：

| request_mode | 用户常用别名 | 目的 |
|---|---|---|
| guide | design、规划、给指导 | 在实现前形成目标、假设、约束和验证问题 |
| scan | audit、检查、扫描 | 评价已有制品或运行态 |
| refactor | migrate、improve、重构、迁移 | 形成改造方案、取舍和验收路径 |
| verify | 验证、复测、验收 | 验证明确声明及修复结果 |

入口先把别名归一为一个 request_mode；未知或多主模式请求返回 invalid_input，不由 evaluator 猜测。

### 2.3 范围

包含 Web、移动端、桌面端、小程序、终端/API/多模态数字服务，以及官网、内容、交易、消费者产品、Admin、数据操作、配置工具、AI 辅助和跨人工服务旅程。

不提供法律、安全、医学、伦理或行业认证；不替代用户研究、专业审查或最终组织决策；不覆盖工业产品、实体空间、纯品牌艺术的完整方法。特定辖区规则只有在 SourceAssertion 适用且存在采纳/法域依据时才生效。


## 3. 来源、规范断言与采纳

### 3.1 核心对象

SourceRecord 保存 publisher、canonical_uri、title、edition/version、publication_status、effective_at、expires_at、retrieved_at、content_digest 和 fragment classification。

SourceAssertion 保存：

~~~yaml
assertion_id: string
source_record_id: string
locator: string
relation: defines | requires | recommends | supports | motivates | exemplifies
authority_status: normative | adopted_policy | empirical | expert_synthesis | practitioner
claim_scope: string
normative_scope:
  object: string
  unit_of_conformance: string | null
  aggregation_scope: string | null
  conformance_level: string | null
  technology: string | null
  jurisdiction: string | null
applicability_condition: condition_ast
verification_requirements:
  required_evidence_kinds: [string]
  observation_conditions: [string]
  complete_process_required: boolean
  equivalent_alternative_test: string
superseded_by: assertion_id | null
~~~

PolicyAdoptionRecord 保存 adopter、decision_authority、decision_artifact_digest、assertion_refs、scope、effective/expiry、revoked_at。adopted_policy 只能引用有效记录，不能用“团队平时这样做”自由文本提升权威。

### 3.2 结论门槛

normative Claim 必须逐条引用 SourceAssertion。Finding 使用：

- non_conformance：适用标准/政策的明确符合性要求未满足；
- violation：仅当适用法律、强制政策或明确禁止性义务允许该术语时使用；
- risk/heuristic/opportunity/unknown/escalation：其他情形。

产生 non_conformance/violation 必须同时验证来源身份和片段分类、适用范围、采纳或法域、验证方法、完整页面/过程范围、等价实现、更新关系及冲突裁决。APG 示例、Understanding 文档、经验方法或局部组件检测不得被提升为普遍义务。


## 4. 分析单元、情境镜头与双轨输出

analysis_units 可覆盖进入预期、任务交互、内容信息、旅程触点、服务前后台、组织政策、社会技术生态、长期反馈和感官表达。Garrett planes、Norman action cycle、heuristics、service blueprint、accessibility、trust/ethics、behavioral metrics 都是可选 lens，不是规则主键。

CrossCuttingLensRegistry 为每个 lens 声明触发条件、所需上下文、能支持的 Claim 和不能支持的 Claim。只加载与当前 Scenario/Journey 匹配的 lens；不得把“所有问题都检查一遍”当成人本设计。

Assurance track 回答：目前有什么可评价义务、事实、风险和未知。Inquiry track 回答：目标结果是什么、有哪些竞争解释、关键取舍和未知、如何寻找反证。规则库只能覆盖已编码风险，不能取代 situated inquiry、参与式设计和生命周期迭代。


## 5. 主体、场景、资源与授权

### 5.1 Typed references

ActorRef.kind 为 human、service、agent、organization、group、anonymous。TenantRef 与 ResourceRef 不共用 union；ResourceRef 必须包含 resource_type、tenant_binding 和 version。

TenantBinding 表达 host、acting、target、billing、data_controller、data_processor 等 relationship。ResourceParty 表达 owner、subject、controller、custodian、beneficiary。PartyImpact 可引用具体 actor、cohort 或 unknown_party，并记录 relation、impact_channel、count_interval、vulnerability、notice、consent、appeal 和 redress。

### 5.2 ActingContext

~~~yaml
acting_context_id: string
authenticated_principal: actor_ref
initiator_chain: [actor_ref]
effective_actor: actor_ref
represented_parties: [actor_ref]
representation_basis: grant_or_policy_ref | null
purpose: string
reason_or_ticket_ref: string | null
session_id: string
started_at: datetime
ended_at: datetime | null
break_glass: boolean
~~~

impersonation、AI 代理、服务账号和人类批准不能压成单个 principal。

### 5.3 AuthorityGrant 与 AuthorizationDecision

AuthorityGrant 保存 issuer、grantee、parent_grant_id、action/resource/purpose scope、tenant scope、conditions、status、effective_at、expires_at、revoked_at、revocation_epoch、version、delegation_depth、non_delegable。

AuthorizationDecision 保存：

- decision_id、checked_at、trusted_clock_source；
- grant/authority/resource/tenant version；
- canonical effect digest 与 purpose；
- online/offline mode、freshness deadline；
- allow/deny/unknown、reason codes；
- fencing token 或 atomic condition reference。

有效区间固定为 [effective_at, expires_at)。高风险离线动作只能排队，联网同步时重新授权，不能先产生副作用。副作用 transition 必须用同一事务条件或 fencing/CAS 保证 check 与 effect 原子一致。

### 5.4 ActionIntent 与 ApprovalArtifact

ActionIntent 绑定 canonical action、payload digest、resources、tenant、purpose、maker 和版本。ApprovalArtifact 绑定 intent digest、approver set、quorum、separation-of-duties predicate、批准时间、expiry、single_use 和 consumed 状态。payload、主体、租户、资源、目的或 authority 变化都使批准失效。AI 建议、人类批准、授权执行是三个状态。

### 5.5 ScenarioInstance 与 lineage

ScenarioInstance 组合 acting_context、tenant_bindings、resources、resource_parties、authority_grants、goal、task(intent/action/object/lifecycle)、primary_channel、environment、risk_context、beneficiaries 和 party_impacts。

ScenarioLineage 是不可变事件：event_id、occurred/observed_at、caused_by、from/to scenario digest、typed change set、snapshot refs、invariant evaluation refs。reauthentication/approval 为 required、not_required 或 unknown，并带 rationale。验证无环、连续 digest、顺序和分支/合并规则。

### 5.6 Facets

FacetRegistry/Definition/Assignment 是核心对象，声明值域、基数、canonical JSON Pointer、derived_from、unknown/null 和 provenance。Profile 仅产生 informational profile_candidates；不得参与适用性、严重度、优先级或发布建议。跨对象不变量由版本化 builtin invariant_id 执行，不假称基础 AST 支持任意量化。


## 6. JourneyDefinition 与 JourneyRun

JourneyDefinition 是预期状态图；JourneyRun 是一次实际运行记录。

每个 StepDefinition 必须引用 acting_context/scenario、actor、channel/touchpoint、tenant/resource set、purpose、action/effect class、pre/postconditions。TransitionDefinition 包含 context_delta、authorization_checkpoint、consent checkpoint、typed carried state、timeout、retry、cancel、recovery、escalation 和 idempotency policy。

carried state 绑定 registry key、subject、tenant、resource、purpose、classification、integrity digest、source、version、freshness/expiry、consent/authority provenance。

策略必须是结构化对象：

- RetryPolicy：max_attempts、backoff、retryable reason codes、terminal behavior；
- IdempotencyPolicy：key derivation、tenant、operation/payload digest、retention；
- TimeoutPolicy：clock、start/end event、duration、on_timeout；
- RecoveryPolicy：entry condition、preserved state、reauthorization、terminal guarantee。

TerminalOutcome 除 success/safe_exit/cancelled/failed/escalated 外还必须有可求值 postcondition、受影响方安全条件和证据要求。

JourneyRun 记录有序事件、时间、实际 acting context/snapshot、input/output digest、AuthorizationDecision、Evidence links 和实际 terminal outcome。验证悬空引用、不可达、无终态、无限重试、非法携带、重复副作用、过期授权、context replay 和假 success。


## 7. 适用性、约束可行性与偏好

### 7.1 三阶段

A. Applicability：只读取 EvaluationInputBundle 中的场景、旅程定义、环境、法域和 SourceAssertion，输出 applicable/not_applicable/unknown。  
B. Hard feasibility：评价候选 Option 是否满足适用 hard constraints。  
C. Soft selection：只在 feasible options 中比较，不能覆盖 hard constraints。

### 7.2 可计算约束模型

Option 保存 option_id、decision variables、expected effects、affected parties、reversibility 和 evidence refs。HardConstraint 保存 predicate、作用 option/party/resource、source assertion、priority class 和 failure action。

关系拆分：

- OverrideGraph：有向 overrides/cannot_override；只有 overrides 子图必须是 DAG；
- CompatibilityHypergraph：无向 incompatible_with/requires_together；
- 不合法环、边组合或未知适用性返回 invalid_rule/unknown，不自行选胜者。

feasibility 输出每个 option 的 satisfied/violated/unknown constraints、unsat core 和 ConstraintResolutionTrace。法律、权利、生命安全或无唯一可行解的高风险冲突必须 escalation。

### 7.3 Soft selection

SoftPreference 保存 owner/affected party、criterion、direction、evidence、priority tier。先用 safety/rights floor，再用版本化 lexicographic tiers；同 tier 采用 Pareto dominance。没有唯一非支配解时输出 alternatives 和 undecided/ask/escalate，不得用隐藏权重任意挑选。

ResolutionTrace 是核心对象，包含规范化候选、AST 节点、关系边、闭包、unsat core、排除原因、剩余方案、tie 状态和 reason codes。


## 8. Evidence、Study 与 ClaimAssessment

### 8.1 EvidenceCollection

Evidence 不能脱离收集边界。EvidenceCollection 保存 sampling frame、recruitment/source query、response/attrition、inclusion/exclusion、transformations、raw artifact digests、collector/tool、coverage limits、ResearchProtocol/consent refs 和 inventory completeness。

单条 Evidence 保存 kind、modality、provenance record、collected_at、population、context、method、quality dimensions、target digest。provenance 与 quality 不使用不可解析的自由字符串。

### 8.2 StudyDesign

需要评价关联、预测或因果时，使用 StudyDesign：

~~~yaml
study_id: string
sampling_design: object
assignment:
  mechanism: randomized | quasi_experimental | observational | self_selected | unknown
  unit: string
temporal_design: parallel | crossover | longitudinal | historical_control | cross_sectional
comparator: object | null
intervention_fidelity: object | null
confounding_control: object | null
missingness_and_attrition: object
measurement_model: object
analysis_unit: string
estimand: string | null
effect_estimate: object | null
uncertainty: object | null
identification_assumptions: [string]
~~~

assignment 是研究证据事实，不由 Claim 作者声明强度。

### 8.3 Claim

Claim 使用结构 predicate，而不是只靠 statement：

- subject、predicate、object/outcome；
- population、context、time_window、scope_limit；
- claim_type：descriptive、normative、associational、causal、predictive、affective、recommendation_rationale；
- human_readable_statement 只能渲染 predicate，不得表达更强语义。

causal 还要求 treatment、comparator、unit、estimand 和 StudyDesign ref。AffectiveClaim 必须含 basis=self_report/observed_signal/model_inference。

self_report 保存 reporter、elicitation method、measure/verbatim reference、time/context；signal 保存 channel、model/version、validation population、uncertainty。inference_target allowlist 只允许 observed_interaction_signal；不得升级为 emotion、diagnosis、vulnerability、personality 或 intent。

### 8.4 ClaimEvidenceLink 与 ClaimAssessment

ClaimEvidenceLink relation 为 supports、contradicts、inconclusive、limits，保存 directness、population/context/outcome/time match 和 rationale。

ClaimAssessment 由 evaluator 生成：

- considered evidence、excluded evidence 及 reason；
- counterevidence search status；
- internal validity、directness、precision、transportability；
- identification assumptions 与失败项；
- admissible_conclusion：normative/descriptive/associational/causal/predictive/reported_experience/observed_signal/unresolved；
- derived evidence grade 与 uncertainty。

作者不得自由填写 strong。self_selection、历史 comparator、严重 attrition、未控混杂或测量不一致不能得到 causal。只导入正证而 inventory 不完整时，Assessment 必须显示 evidence_selection_unknown。

### 8.5 下游用途门禁

仅凭 observed_signal/model_inference 不得作不利决定、资格判断、差别定价、脆弱性定向或自动干预。涉及工作、教育、健康、保险、信贷或特定辖区禁止场景时，必须经过适用 SourceAssertion 与 hard feasibility；未知时 escalation。


## 9. RiskAssessment 与 Recommendation

### 9.1 RiskAssessment

Finding 必须内嵌或引用结构化 RiskAssessment：

~~~yaml
harm_magnitude: negligible | minor | serious | severe | catastrophic | unknown
likelihood: rare | unlikely | possible | likely | almost_certain | unknown
exposure: isolated | occasional | frequent | systemic | unknown
affected_party_count: { lower: integer | null, upper: integer | null }
reversibility: reversible | costly | irreversible | unknown
detectability_before_harm: high | medium | low | unknown
evidence_confidence: low | medium | high | unknown
factor_evidence_refs: [string]
policy_version: string
aggregation_trace: [string]
~~~

版本化 decision table 生成 severity、risk_priority 和 ReleaseRecommendation。高影响/不可逆且关键因子 unknown 时不得自动 allow；evaluation_error 或必需评价 not_run 时不得宣称安全。总分不能覆盖 tail risk 或少数群体完全排除。

### 9.2 Recommendation

Recommendation 是核心对象，不是 Finding 中随手附加的文案：

- recommendation_id、action/option ref；
- intended_outcome_claims、rationale ClaimAssessment refs；
- strength：explore、test、conditional_advice、strong_advice、required；
- evidence_grade；
- reversibility、cost、possible harms、contraindications、alternatives；
- mechanism、uncertainty；
- decision_owner；
- validation_plan、success/failure metrics、stop rule、rollback；
- applicability condition。

证据天花板不变量：

1. required 只来自适用的强制规范断言；
2. 因果收益语言只来自 admissible_conclusion=causal；
3. 弱证据只能产生 explore/test；
4. 重大或不可逆后果且关键证据未知时，不得 strong_advice/required/allow；
5. Finding 的问题证据不会自动证明 Recommendation 有效。

ReleaseRecommendation 为 allow、allow_with_conditions、block、escalate、undecided，并引用 policy、RiskAssessment、RuleEvaluations、decision_owner。最终组织决定另存 DecisionRecord；Skill 不冒充最终授权人。


## 10. EvaluationInputBundle、运行结果与双轨产物

### 10.1 Canonical input

EvaluationInputBundle 是 evaluator 唯一输入：

~~~yaml
schema_version: string
request_mode: guide | scan | refactor | verify
target_snapshot: object
scenario_instances: [object]
journey_definitions: [object]
journey_runs: [object]
source_assertions: [object]
evidence_inventory: [object]
research_state: [object]
adapter_evidence: [object]
policy_context: object
versions: object
~~~

所有数组声明 ordered-list 或 canonical-set；canonical-set 在 JCS 前按稳定 key 排序去重。

### 10.2 执行对象

- ToolInvocationResult：tool identity、request/response digest、started/ended、success/partial/not_found/invalid_request/auth_error/timeout/server_error、usable evidence、limitations；
- RuleEvaluation：每条已加载规则恰有一条，保存 execution_state、applicability、preconditions、evaluation_outcome、reason codes、trace；
- Finding：只表示需要报告的问题，不为 pass 发 Finding；
- RunIssue：输入、规则、知识、工具、适配器或运行故障；
- RunReport：边界、精确版本/digest、全部 RuleEvaluations、Findings、RunIssues、Inquiry artifacts 和聚合结果。

固定 Finding emission：

| RuleEvaluation | Finding |
|---|---|
| pass、not_applicable | 不发 |
| fail | 按 rule finding_type 发 |
| partial、unknown、not_run 且 release-critical | unknown 或 escalation |
| evaluation_error 且影响边界 | RunIssue；release-critical 时另发 escalation |

### 10.3 Finding

Finding 保存 deterministic finding_id/fingerprint、rule/version、target locator/digest、scenario bindings、claim assessments、evidence relations、source assertions、RiskAssessment、Recommendation refs、severity/priority、ResolutionTrace ref 和 evaluator/input digest。

fingerprint preimage 使用 domain separator ux-skill:finding:v1，并包含 schema/behavior/rule version、canonical target locator、target digest、scenario digest、rule id 和结构化 claim key。所有 set 字段排序去重；message 不进入 fingerprint。finding_id 从 fingerprint 派生。

### 10.4 Inquiry track

UXHypothesis 保存 competing_explanations、supporting/contradicting evidence、scope、falsifier 和 status。ResearchQuestion 保存 decision need、unknown、answerability、least risky method。DesignRationale 保存目标结果、options、trade-offs、affected parties、constraint trace、selected/undecided 和 validation path。

guide/refactor 至少输出目标结果、一个竞争解释或明确说明为何没有、关键未知、替代方案与验证/反证路径。RunReport 必须含 coverage_and_gaps，并显示“0 Finding 不等于 UX 良好”。


## 11. Total evaluator 语义

### 11.1 AST v1

AST 使用 JSON tagged union，每个节点有 node_id、op 和固定字段。路径来自版本化 RFC 6901 registry。literal 类型域为 boolean/string/finite number/null；禁止 NaN、Infinity、对象/数组比较、coercion、脚本、正则和动态遍历。

允许 literal、exists、eq、in（typed literal 是否属于 path 指向的 scalar array）、compare、all、any、not、builtin_invariant。builtin_invariant 只能引用已注册纯函数及版本。

### 11.2 T/F/U/E

节点结果为 true、false、unknown、error。missing 除 exists 外为 U；null 存在，eq(null,null)=T；静态规则形状/类型错为 invalid_rule；输入不符合 schema 为 invalid_input；运行值类型与 registry 冲突为 E。

求值固定 eager，以稳定 node_id 顺序访问全部节点并记录 trace；不因短路隐藏 E。聚合优先级：

- all：任一 E→E；否则任一 F→F；否则任一 U→U；否则 T；
- any：任一 E→E；否则任一 T→T；否则任一 U→U；否则 F；
- not：T/F/U/E 分别为 F/T/U/E；
- empty all=T，empty any=F。

effective_applicability = applicability AND NOT exclusion。applicability F→not_applicable；U→unknown；E→evaluation_error。precondition F/U→not_run（reason 不同）；E→evaluation_error。

### 11.3 状态机与聚合

Tool、Rule、Run 分别有状态机和稳定 reason code registry。execution_state 为 scheduled/running/completed/tool_failed/invalid_input/invalid_rule/cancelled；evaluation_outcome 为 pass/fail/partial/not_run/not_applicable/unknown/evaluation_error。

Run aggregate 优先级：invalid_input/invalid_rule > release-critical evaluation_error > release-critical fail/block > escalation > partial/unknown/not_run > completed。非依赖工具失败不阻止独立规则完成；依赖关系由 Rule.required_inputs 声明。任何 required dependency 失败不能聚合为 pass。

### 11.4 确定输出

共享 evaluator 是唯一权威：Skill wrapper、CLI、CI 和 MCP 只生产/传递 EvaluationInputBundle。semantic parity projection 排除本地化 message 和时间等非语义字段，其余 Finding、RuleEvaluation、trace、risk、recommendation 和 digest 必须 byte-equal。


## 12. Schema、语义验证与版本

JSON Schema dialect 固定 2020-12，启用 format-assertion vocabulary。每个嵌套对象显式 additionalProperties:false；禁止重复 JSON key、非 I-JSON 数值和未规范 Unicode 输入。

核心 schema 至少包括：

- ActorRef、TenantRef/Binding、ResourceRef/Party、PartyImpact、ActingContext；
- AuthorityGrant、AuthorizationDecision、ActionIntent、ApprovalArtifact；
- ScenarioInstance/Lineage、FacetRegistry/Definition/Assignment；
- JourneyDefinition/Run 及 typed policies；
- SourceRecord/Assertion、PolicyAdoptionRecord；
- Evidence/Collection、StudyDesign、Claim、ClaimEvidenceLink/Assessment；
- Option、HardConstraint、SoftPreference、ResolutionTrace；
- RiskAssessment、Recommendation、ReleaseRecommendation、DecisionRecord；
- ResearchProtocol/Activity/EthicsReviewDecision；
- EvaluationInputBundle、ToolInvocationResult、RuleEvaluation、Finding、RunIssue/Report；
- UXHypothesis、ResearchQuestion、DesignRationale；
- Rule、AdapterHandshake、ArtifactManifest、CompatibilityMatrix。

schema validation 后运行版本化 semantic validators，检查唯一 ID、引用、图可达性、授权链、approval digest、cardinality、invariants 和状态转换，并输出稳定排序的 error codes。

所有顶层对象携带 schema_version。manifest 另列 knowledge_behavior、evaluator、rule、adapter、artifact_format、skill 版本和精确 producer/consumer rows。未知 major fail closed，禁止静默降级。任何改变匹配、ClaimAssessment、风险、建议或 Finding 身份的变更提升行为版本并完整 recertify。


## 13. HulianUI adapter normalization

HulianUI 是第一个证据/实现映射适配器，不是 UX 结论权威。

AdapterHandshake 记录 server/tool 精确版本、input/output schema digest、data source mode、snapshot/freshness、project root、adapter/evaluator/knowledge digest。project_root 必须显式规范化并与 target_snapshot 相同，禁止 cwd fallback。

Adapter 只做：

1. 将 local registry、captured fixture 或 MCP 响应规范化为 EvaluationInputBundle.adapter_evidence；
2. 保存每个 ToolInvocationResult；
3. 将组件/模式文档标为 implementation candidate，并声明可支持/不可支持的 Claim。

状态映射固定：

- success：仅声明的 evidence 可用；
- partial：逐项标 usable/missing，依赖缺项的规则 not_run/partial；
- not_found：不能作为不存在或不需要的证据；
- invalid_request/auth_error/timeout/server_error：tool_failed/RunIssue；
- 多工具结果按 required_inputs 分别传播，不全局吞并。

Parity 分两层：相同 captured response 经 local/MCP normalization 得到 byte-equal bundle；相同 bundle 经 Skill/CLI/MCP 入口得到 byte-equal semantic projection。MCP 增加证据时先比较规范化后的同一 bundle，不能要求不同输入产生相同 Finding。


## 14. 可复现离线制品

知识发布为不可变 GitHub Release asset，运行时不联网。JSON 使用 RFC 8785 JCS；数组的 set/list 语义在 schema 中预先定义。

三个 domain-separated digest：

- knowledge_digest = SHA-256("ux-skill:knowledge:v1" || JCS(knowledge payload index))；
- manifest_digest = SHA-256("ux-skill:manifest:v1" || JCS(internal manifest without digest fields))；
- artifact_digest = SHA-256("ux-skill:artifact:v1" || final archive bytes)。

内部 manifest 永不包含 artifact_digest，避免自引用。Release 保存与归档内字节相同的 manifest，以及独立 artifact.sha256；SHA sidecar 不声称与内部 manifest 相同。

Reference packer 固定实现和 runtime/library 版本。ustar 规则固定路径规范化、拒绝长路径/链接、是否含目录项、排序、mode、uid/gid、name、mtime、numeric encoding、padding 和 EOF blocks；gzip 固定 header bytes、FLG/XFL/OS、无 filename/comment/extra、mtime=0、level 9 和具体 DEFLATE 实现。

发布一个 golden artifact 及固定预期 SHA。两套干净容器必须既 byte-equal 又匹配 golden SHA。非法路径、symlink、重复 key、非 I-JSON 或不兼容 major 均 fail closed。tag/asset 不覆盖；撤回发布新版本并声明 supersedes/revokes。


## 15. Skill 渐进披露

Skill 名称暂定 improving-product-ux。description 只写触发条件：数字产品的设计、UX 审查、迁移、重构、验证、官网/Admin/跨端服务和 HulianUI；负边界包括纯品牌艺术、实体空间完整人因、法律/医学认证。agents/openai.yaml 明确 allow_implicit_invocation:true。

SKILL.md 保持短小，只完成：

1. 将用户表达归一为四种 request_mode；
2. 采集或声明 EvaluationInputBundle 缺口；
3. 按固定 manifest 加载 references；
4. 调共享 evaluator；
5. 把 Assurance 与 Inquiry 两轨输出给用户；
6. 对写文件、Issue、消息、部署等外部动作另行取得授权。

| 模式 | 必读 reference |
|---|---|
| guide | context-model、journey-authority、claim-study、inquiry-design、ethics |
| scan | context-model、journey-authority、rules-runtime、claim-study、risk-reporting、ethics |
| refactor | 上述全部 + implementation-mapping；检测到 HulianUI 才加载 hulianui adapter |
| verify | context-model、journey-authority、rules-runtime、claim-study、risk-reporting、ethics |

每个路由项在 manifest 中使用精确路径、digest、加载顺序和依赖闭包。无 MCP 仍能运行供应商中立核心。


## 16. 计划仓库结构

~~~text
ux-skill/
├── SKILL.md
├── agents/openai.yaml
├── references/
│   ├── context-model.md
│   ├── journey-authority.md
│   ├── claim-study.md
│   ├── inquiry-design.md
│   ├── rules-runtime.md
│   ├── risk-reporting.md
│   ├── ethics.md
│   └── implementation-mapping.md
├── schemas/
│   ├── core/
│   ├── evaluator/
│   └── adapters/
├── knowledge/
│   ├── manifest.json
│   ├── sources.json
│   ├── assertions.json
│   ├── rules.json
│   ├── registries.json
│   └── decision-policies.json
├── evaluator/
├── adapters/hulianui/
├── evals/
│   ├── red/
│   ├── golden/
│   ├── parity/
│   ├── artifact/
│   ├── public-cases/
│   └── holdout-commitments.json
├── scripts/
└── LICENSE
~~~

不添加会重复进入 Skill 上下文的 README/quick reference/长 changelog。详细 schema、来源和适配器契约只存在一处，由 SKILL.md 渐进加载。


## 17. Research authorization 与安全失败

### 17.1 核心研究对象

ResearchProtocol 结构化保存研究/质量改进分类、decision need、为何需要人类、最小数据、风险概率/程度、脆弱性、招募权力关系、补偿、同意理解、撤回与非报复、隐私/保留/访问、distress/adverse-event stop、支持转介、deception/debrief、适用政策。

ResearchActivity 保存 protocol id/version/digest、实际招募/收集/干预、时间、负责人、数据用途和状态。

EthicsReviewDecision 保存 reviewer identity/authority、独立性与利益冲突、适用 SourceAssertions、protocol digest、approve/conditional/reject、conditions、scope、effective/expiry、revoked_at。

research_action_state 为 proposed、blocked、approved、active、stopped、completed。它与 RuleEvaluation outcome 分离。

### 17.2 Stop gate

以下任一条件成立即 blocked：

- 必填保护信息 unknown/missing；
- review decision 不匹配当前 protocol digest、范围、期限或已撤回；
- 涉及未成年人、脆弱性、创伤、危机、胁迫权力、欺骗、不可逆干预、高敏数据而缺有权限独立审核；
- distress/adverse event stop 被触发；
- consent/waiver/exempt 判定没有适用制度授权。

Evidence、Recommendation、RunReport 必须引用 protocol/activity/review。Agent 不自行宣告伦理豁免，不将某一法域制度推广为全球义务。

### 17.3 Fail honestly

输入、规则、知识、工具、适配器或证据错误进入 RunIssue 和状态机；不得输出空结果假装无问题，不得把 not_run/unknown/evaluation_error 算 pass，也不得用组件合规、自动扫描或专家直觉声称完整 UX 成功。


## 18. RED、golden vectors 与发布验证

### 18.1 RED 先于实现

实现前冻结 suite、runner、rubric、input 和 expected digest，并在无 Skill/无 evaluator 基线中观察预声明失败。GREEN 只能通过实现关闭失败，不得改 expected、runner 或 rubric。每次行为变更重新 RED→GREEN→recertify。

### 18.2 必需 golden vector families

每个 vector 固定输入 JCS、预期状态、Finding/Inquiry semantic projection、trace、reason code 和 digest：

| Family | 必含反例与唯一预期 |
|---|---|
| AST | missing/null/type error、F AND E、T OR E、empty all/any、exclusion U、precondition U |
| actors/tenants | anonymous 官网、provider impersonation、跨租户资源、未知受影响 cohort |
| authority | expires_at 边界、撤权 race、离线同步、fencing 失败 |
| approval | maker 自批、quorum 不足、批准 H1 执行 H2、AI 建议到执行 |
| journey | 跨端 token replay、无限 retry、取消/恢复、假 success |
| claims | self-selection 伪因果、历史 comparator、attrition、情绪信号越权 |
| recommendation | 弱证据要求强上线、不可逆 unknown、规范 required |
| constraints | incompatible、requires+together 冲突、override chain/cycle、soft tie |
| states | pass + missing evidence + failed dependent tool + independent rule |
| adapter | success/partial/not_found/auth/timeout/server_error normalization |
| fingerprint | set 重排、message 变化、target bytes 变化 |
| artifact | golden archive/header、long path、symlink、重复 key、非 I-JSON |
| research | protocol 改动后旧批准、waiver 无权限、distress stop |

至少 32 个 canonical cases，以上 family 不得用数量相同但语义更弱的普通案例替代。每个公开案例 5 次 fresh-context 运行；运行 Agent 不看到 gold 或作者讨论。

### 18.3 Parity 与确定性

- 同一 captured response 的 local/MCP adapter bundle byte-equal；
- 同一 bundle 的 Skill/CLI/MCP semantic projection 100% byte-equal；
- set 数组随机重排 100 次保持 digest；
- 两个干净容器构建匹配固定 golden artifact SHA；
- 两个符合 profile 的 JSON validator 输出相同 normalized error codes。

### 18.4 Private holdout

至少 16 个分层盲例由独立 custodian 管理。公开仓库仅存 keyed commitment/HMAC 和 strata，不存低熵题面普通 hash。候选 artifact digest 先登记；每候选有严格 query budget，只返回最少聚合结果。case-level 暴露、重复查询或任何基于结果的调整都会污染并轮换该集。行为版本变化使用新盲例，不能反复消耗同一 holdout。

### 18.5 试验与稳定门槛

试验发布要求：全部 RED 关闭、schema/semantic validation 100%、prohibited claims/recommendations 0、release-critical tool failure 误 pass 0、全部 parity/golden bytes 通过。

稳定发布另需独立专家按 strata 盲评 relevance、contextual fit、alternatives、harm、uncertainty、precision/recall/escalation/severity agreement；固定 high-risk 集观察漏报为 0，并报告样本边界和残余风险；至少三个真实项目，其中一个非 HulianUI。稳定不是永久认证，行为变化立即撤销并重评。


## 19. v0.1 试验发布验收

必须同时满足：

1. 第 12 节全部核心对象已有 schema、版本和语义 validator；
2. 四种 request_mode 与用户别名有唯一映射；
3. Profile、组件库和 adapter 不参与 UX 结论权威；
4. acting/representation chain、多租户资源、Grant lifecycle、AuthorizationDecision、approval payload 和 PartyImpact 可执行；
5. JourneyDefinition/Run、typed policies、terminal evidence 和权限 checkpoint 可验证；
6. Option/constraint/override/compatibility/soft tie 有唯一 ResolutionTrace；
7. StudyDesign/ClaimAssessment 能降级伪因果，Affective downstream gate 可执行；
8. RiskAssessment、Recommendation evidence ceiling、ReleaseRecommendation/DecisionRecord 分离；
9. ResearchProtocol/Activity/ReviewDecision stop gate 可执行；
10. Tool/Rule/Run 状态和 Finding emission 表唯一；
11. AST 对所有合法输入为 total function，对非法输入有稳定错误；
12. fingerprint、semantic projection、adapter bundle 和 artifact 有 golden bytes；
13. Assurance 与 Inquiry 两轨都有结构化产物，0 Finding 不冒充 UX 成功；
14. RED、holdout、parity、真实项目达到第 18 节门槛；
15. 本机资料目录无项目写入；
16. 用户明确批准最终规格后才写 implementation plan。


## 20. 当前阶段与下一关口

当前仍是设计，不是实现。

1. 提交 v0.4 到 design/v0；
2. 自检 placeholder、模式别名、对象引用、状态词表和章节矛盾；
3. 第四轮采用全新上下文的聚焦评审，只审三类闭环：
   - Claim/Study/Recommendation/Research 与 Inquiry track；
   - Actor/Tenant/Authority/Approval/Journey/Constraint；
   - AST/State/Fingerprint/Adapter/Artifact/Golden/Holdout；
4. 评审只有 GO，或 CONDITIONAL GO 且无核心 schema/语义阻塞，才交用户做最终规格审阅；
5. 用户批准后才调用 writing-plans；
6. 首个实施纵切仍只选一个高风险 Admin 审批场景、一条 advisory 规则、一组 ClaimAssessment、一个共享 evaluator、一个 HulianUI candidate mapping、一个 Finding/Inquiry 输出和一个 golden artifact；
7. 不在首纵切扩展第二个场景族、稳定发布或修改 HulianUI MCP。

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
- W3C APG Introduction (informative status): https://www.w3.org/WAI/ARIA/apg/about/introduction/
- W3C WCAG 2.2 Conformance Requirements: https://www.w3.org/TR/WCAG22/#conformance
- OHRP 45 CFR 46 guidance: https://www.hhs.gov/ohrp/regulations-and-policy/guidance/faq/45-cfr-46/index.html
- Regulation (EU) 2024/1689 official text: https://eur-lex.europa.eu/eli/reg/2024/1689/oj
- RFC 8785 JSON Canonicalization Scheme: https://www.rfc-editor.org/rfc/rfc8785.html
- RFC 1952 GZIP File Format: https://www.rfc-editor.org/rfc/rfc1952.html

经典著作只作为综合知识输入，不复制受版权保护正文。首批包括 Jesse James Garrett、Don Norman、Steve Krug、Giles Colborne、Marty Cagan 及本地提供的产品设计资料。
