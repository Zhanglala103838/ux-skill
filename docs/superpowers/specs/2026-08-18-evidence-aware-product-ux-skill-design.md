# Evidence-aware Product UX Skill 设计规格

状态：第四轮对抗评审后修订，等待第五轮残余阻塞评审  
规格版本：0.5  
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

### 3.1 不可变来源链

SourceRecord 标识发布者、canonical URI、版本/status/effective/expiry 和完整内容 digest。

SourceFragment 是唯一可被断言引用的来源单位：

~~~yaml
fragment_id: string
source_record_id: string
exact_locator: string
fragment_kind: normative | informative | empirical_result | expert_opinion | example
fragment_digest: sha256
proposition:
  subject: string
  predicate: string
  object: object
  scope: object
~~~

SourceAssertion 必须引用 fragment_id，保存 relation=defines/requires/recommends/supports/motivates/exemplifies、applicability、verification requirements、unit/aggregation of conformance、等价替代测试和 partial supersession map。

authority_status 不由作者自由填写。evaluator 派生 effective_authority：

1. normative fragment + 适用法律/标准身份 → normative；
2. 任意 fragment + 有效 PolicyAdoptionRecord 且 adoption proposition/scope 精确覆盖 → adopted_policy；
3. empirical_result → empirical；
4. expert_opinion/informative → expert_synthesis；
5. example → example_only。

PolicyAdoptionRecord 双向引用 assertion_id，并绑定 adopter identity、decision authority、artifact digest、adopted proposition/scope、effective interval、revocation 和 version。缺记录、过期、撤回或 scope 不覆盖时不能派生 adopted_policy。

### 3.2 冲突与 Finding 类型

SourceConflictResolutionTrace 保存所有 applicable assertions、jurisdiction/scope、partial supersession、effective authority、冲突 proposition、有效 override 和 unresolved set。未解决冲突只能 unknown/escalation。

non_conformance 仅用于适用规范/政策的符合性要求；violation 仅用于适用法律、强制政策或明确禁止义务允许的术语。两者要求 normative/adopted authority、结构 proposition 与 Finding Claim 精确蕴含、verification requirements 已满足、完整过程/页面范围和等价替代已检查。

APG 示例、Understanding 文档、heuristic、局部组件或自动扫描不能产生规范结论。规范性来源的身份、分类与 digest 由版本化 source registry 提供，不能由一次运行输入自报。

## 4. 分析单元、情境镜头与双轨输出

analysis_units 可覆盖进入预期、任务交互、内容信息、旅程触点、服务前后台、组织政策、社会技术生态、长期反馈和感官表达。Garrett planes、Norman action cycle、heuristics、service blueprint、accessibility、trust/ethics、behavioral metrics 都是可选 lens，不是规则主键。

CrossCuttingLensRegistry 为每个 lens 声明触发条件、所需上下文、能支持的 Claim 和不能支持的 Claim。只加载与当前 Scenario/Journey 匹配的 lens；不得把“所有问题都检查一遍”当成人本设计。

Assurance track 回答：目前有什么可评价义务、事实、风险和未知。Inquiry track 回答：目标结果是什么、有哪些竞争解释、关键取舍和未知、如何寻找反证。规则库只能覆盖已编码风险，不能取代 situated inquiry、参与式设计和生命周期迭代。



## 5. 主体、租户、授权与执行封套

### 5.1 Canonical identity 与代理链

ActorIdentity tuple 固定为 (namespace_uri, issuer_id, subject_id, kind)，所有字符串 NFC，URI 按 registry profile 规范化；只有四元组 byte-equal 才相等。kind 为 human/service/agent/organization/group/anonymous。控制关系另由 ControlPrincipalEdge 表达，不能用 ActorRef 不同推断职责分离。

ActingContext 使用有序 ActingEdge[1..n] 从 authenticated_principal 连到 effective_actor。每跳保存 from/to、basis ref、action/resource/tenant/purpose scope、[effective, expiry)、version。任何 identity 变化必须有有效 basis；链首尾、连续性、scope 收窄与 digest 均由 validator 检查。AuthorizationDecision 必须绑定 acting_chain_digest。

### 5.2 多租户与资源 join

TenantBinding relationship 为 host/acting/target/billing/data_controller/data_processor。ActionPolicyRegistry 对每个 canonical action + resource_type 固定 required_tenant_relationships 与 all/any 规则；v0.1 只允许 all。Grant.tenant_scope 必须覆盖全部 required bindings。缺失、冲突、unknown 或额外跨租户 effect 均 deny/escalate，不能选择 acting 或 target 之一。Decision 绑定完整 tenant_binding_set_digest。

ResourceParty 与 PartyImpact 形成闭包。PartyInventory 保存 status=verified_complete/known_incomplete/unknown、coverage_basis、exclusions。高影响场景只有 verified_complete 才可 allow；空数组必须由 verified_complete + no_affected_party assertion 解释。

### 5.3 GrantValidity

对 grant g、时间 t、ExecutionEnvelope e：

Valid(g,t,e) 当且仅当：

- status=active 且 effective_at <= t < expires_at；
- revoked_at=null 且当前 revocation_epoch/version 与 authority snapshot 相同；
- issuer 在 t 对 e 具有 grant 权限；
- e 的 action/resource/tenant/purpose 均为 g scope 子集；
- non_delegable=false 才允许 child；
- delegation_depth 未超上限；
- parent=null，或 Valid(parent,t,e) 且 child scopes 是 parent scopes 子集。

任何 ancestor 无效即全链无效。Grant chain 的 id/version/epoch 按根到叶排序进入 grant_chain_digest。离线默认 queue_only；只有 ActionPolicy 显式 offline_effect_allowed 且 risk floor 允许才可产生 effect，v0.1 不启用该例外。

### 5.4 ExecutionEnvelope

所有审批、授权和副作用只绑定同一个不可变 ExecutionEnvelope：

~~~yaml
envelope_id: string
action: string
payload_digest: sha256
effect_predicate: object
precondition_digest: sha256
postcondition_digest: sha256
resource_version_set: [object]
tenant_binding_set_digest: sha256
purpose: string
acting_chain_digest: sha256
grant_chain_digest: sha256
journey_run_id: string
step_id: string
channel: string
audience: [actor_identity]
~~~

任何字段变化产生新 envelope_id，需要重新审批和授权。AI 建议只能创建 ActionIntent；人类批准 ApprovalArtifact；effect executor 只能消费 envelope，不能重新生成默认参数或二次模型输出。

### 5.5 Approval 与原子 effect

ApprovalArtifact 包含逐笔 ApprovalDecision：approver ActingContext、AuthorizationDecision、signed envelope digest、decision、time、expiry。ApprovalPolicy 固定 eligible roles、quorum、separation_domain=authenticated_human/control_principal/organization_role、single_use。高风险中 control principal unknown 视为未分离。

状态 proposed→approved→consumed/expired/revoked。approved→consumed、GrantValidity 重验、resource versions、fencing token、idempotency record 和 effect commit 是一个 composite guard；任一失败无副作用。外部 effect 使用 transactional outbox + fencing。稳定 reason codes 区分 quorum、SoD、envelope mismatch、stale version、revoked grant、already consumed。

### 5.6 Lineage invalidation

ScenarioLineage 的 reauth/reapproval 不是输入结论，由 InvalidationMatrix 派生。以下任一 change 必须 invalidated：identity/acting edge、tenant binding、resource/version、purpose、action/payload/effect、Grant chain、risk class、channel/audience capability。合并只继承所有父分支共同且 envelope digest 完全相同的工件；否则 invalidated。事件使用 parent digests、单调 sequence 和 rollback protection。


## 6. JourneyDefinition、JourneyRun 与 capability

JourneyDefinition 定义 Step/Transition；JourneyRun 记录实际有序事件。每步引用 Scenario/ActingContext、channel、tenant/resource、purpose、action/effect class、pre/postcondition。副作用 transition 必须引用 ExecutionEnvelope 与 AuthorizationDecision。

carried state 分 data 与 authority_bearing_capability。capability 强制绑定 run_id、step_id、acting_chain_digest、session_id、channel/audience、tenant_binding_set_digest、resource/version、purpose、envelope_digest、nonce、expiry 和 replay status；复制到不同上下文即 invalid。retry、resume、recovery、channel/context delta 和 effect 前重新 checkpoint。idempotency 命中不等于授权成功。

Retry/Idempotency/Timeout/Recovery 均为 typed policy。TerminalOutcome 具有 evaluator 可求值的 postcondition、PartyImpact safety condition 和 evidence requirements。JourneyRun 保存实际 context snapshots、input/output/effect digest、Decision、Approval consumption、Evidence 和 terminal。

validator 拒绝悬空引用、不可达、无终态、无限重试、非法 state/capability carry、nonce replay、过期 Decision、context change 未重验、重复副作用和无证据 success。


## 7. Option、HardConstraint 与唯一求解

### 7.1 三阶段

Applicability 只读取场景、旅程、环境、法域和 SourceAssertion。Hard feasibility 只对 applicable hard constraints 求解。Soft selection 只在 feasible solutions 上运行。

### 7.2 求解单位

求解变量固定为 Solution = canonical set<Option>。Option id 集合按 UTF-8 byte order 排序。HardConstraint predicate 作用于 Solution、party、resource 或 effect；hard 永不因 priority 放松，只有通过 SourceConflictResolutionTrace 验证的 override 才使 constraint ineffective。

OverrideGraph 仅 overrides 子图为 DAG；cannot_override 是拒绝 override edge 的 guard。requires_together/incompatible_with 是无向 hyperedge。算法依次计算 applicable constraints、override closure、requires closure、incompatibility、每个 candidate Solution 的 T/F/U/E。

零 feasible solution 固定为 hard_unsat：高风险/法律/权利冲突 → escalation；其他 mandatory constraint violation → block；绝不选择一个违规 Solution。输出全部 inclusion-minimal unsat cores，内部按 constraint id 排序，core 集合按 JCS bytes 排序。

### 7.3 Soft tie

SoftPreference 维度固定为 canonical (affected_party_identity_or_cohort, criterion)。禁止跨 party 隐式聚合效用。先 safety/rights floor，再按 policy 中 lexicographic tier，tier 内 Pareto dominance。

多个非支配 Solution 时：

1. 触及 rights/safety floor、PartyInventory 非 complete、存在 unknown party 或无有权 decision owner → escalation；
2. 否则 → ask_decision_owner，并输出全部 alternatives；
3. tie 状态的 ReleaseRecommendation 必须 undecided，不能 allow/allow_with_conditions。

ResolutionTrace 保存 normalized solutions、AST/constraint 结果、closures、全部 unsat cores、Pareto matrix、tie branch 和 reason codes。


## 8. Evidence、Study、Signal 与 ClaimAssessment

### 8.1 证据发现与依赖

EvidenceSearchSelectionRecord 保存 search domain、query/source frame、time、inclusion/exclusion、deduplication、deviations、raw inventory digest 和 completeness_basis。completeness_status 为 verified/attested/unknown；作者声明只能 attested，只有可重放检索与 inventory 对账才能 verified。

Evidence 保存 upstream_dataset/study refs、derived_from、participant/sample overlap 和 dependency_cluster_id。ClaimAssessment 先按 dependency cluster 聚合，不能把同一日志的 dashboard/CSV/周报当三份独立支持。

### 8.2 Study records

StudyDesign 记录预计划 sampling、assignment、time order、comparator、estimand、outcome、confounders、missingness、measurement、multiplicity/stopping 和 sensitivity plan。

StudyExecutionRecord 记录实际分配、招募、干预 fidelity、污染、attrition、measurement、时间和 raw digest。AnalysisPlan 绑定 pre_registration digest、planned estimand/outcome/analysis；AnalysisExecution 记录实际分析、deviations、effect/uncertainty 和 sensitivity results。

IdentificationAssumption 为结构对象：assumption_id、kind、status=verified/rejected/unknown、evidence refs、test/method、reason code。不能用字符串“已控制混杂”。

### 8.3 Claim families

Epistemic claim_type 仅 normative、descriptive、associational、causal、predictive、reported_experience、observed_signal。recommendation_rationale 改为 claim_role。

Claim 使用结构 predicate、population、context、time、scope。human text 只能渲染 predicate。

- causal 必须引用 StudyDesign/Execution/Analysis 与 estimand；
- predictive 必须绑定 training/validation lineage、external/independent validation、calibration、discrimination、baseline、subgroup uncertainty、deployment population/time 和 drift；
- reported_experience 绑定 reporter、elicitation、measure/verbatim ref、time/context；
- observed_signal 绑定 channel、model/version、validation population、uncertainty；不得命名为 emotion/diagnosis/vulnerability/personality/intent。

### 8.4 ClaimAssessment v1

每个必需检查返回 verified/rejected/unknown。规则固定：

- 任一 input/schema/provenance critical error → unresolved；
- normative：只有第 3 节 effective authority + proposition entailment + verification 全 verified 才 normative；
- causal：temporal order、comparator/identification strategy、全部 critical assumptions、planned-vs-observed alignment、missingness/attrition handling、measurement validity、sensitivity 均 verified 才 causal；任一 rejected 降为 associational 或 descriptive，任一 unknown 为 unresolved；
- predictive：独立验证、calibration、baseline、target population、drift 和 subgroup harm 均 verified 才 predictive，否则 descriptive/unresolved；
- reported/observed 不得互相升级。

EvidenceGrade dimensions 为 validity、directness、precision、transportability，各取 insufficient/limited/adequate/high；总体 grade 是关键 rationale 中最低维度。contradictory evidence 未解决时最高 limited；selection completeness 非 verified 时最高 limited；critical rejected 时 insufficient。全部结果带 policy_version/reason codes，作者不能填写。

### 8.5 SensitiveInferenceUseAssessment

DownstreamUseDecision 遍历 ActionIntent/Recommendation 的完整 rationale closure，记录 materially_relies_on，不使用“sole basis”。资格、定价、就业、教育、健康、保险、信贷、脆弱性定向和操纵性干预均为 sensitive purpose。

observed signal、reported experience 和由其推导的信息都检查 purpose、consent、authority、法域和 hard constraints。有效禁止性 SourceAssertion 命中 → block；适用性 unknown → escalation；不能通过加入无关证据绕过。


## 9. RiskAssessment、RecommendationAssessment 与决定

RiskAssessment 的七个分量使用固定 enum，并引用因子证据。RiskDecisionPolicy v1 规则：

1. catastrophic/severe + likelihood/exposure unknown，或 irreversible + 任一关键因子 unknown → risk_priority=investigate_immediately，ReleaseRecommendation 不得 allow；
2. release-critical RuleEvaluation 为 evaluation_error/not_run/unknown → escalate；
3. applicable mandatory constraint fail → block；
4. hard_unsat → 按第 7 节 block/escalate；
5. 只有全部 release-critical RuleEvaluation 为 pass/not_applicable、无 high-tail unknown、研究/授权状态有效，才允许 allow/allow_with_conditions。

Recommendation 本身是 proposed action；RecommendationAssessment 由 evaluator 派生 strength ceiling：

| 条件 | 最高 strength |
|---|---|
| 适用 requires assertion 精确蕴含 action predicate，等价替代已处理 | required |
| 关键 outcome ClaimAssessment=causal 且 grade adequate/high，风险可逆且无未决重大反证 | strong_advice |
| 关键 Claim 为 normative/descriptive/associational/predictive 且 grade adequate，或因果 grade limited | conditional_advice |
| grade limited、关键反证未决或迁移性未知 | explore |
| grade insufficient/unresolved | 不形成行动建议，只形成 ResearchQuestion |

test 不是可执行建议，改为 TestProposal。TestProposal 必须先通过 hard feasibility、RiskAssessment、ResearchAuthorization 和 stop/rollback；否则只能保留 ResearchQuestion。

required 还必须证明 SourceAssertion proposition 与 action predicate 精确匹配；若义务只规定结果而不规定实现，具体组件/模式最高 conditional_advice。RecommendationAssessment 保存最弱关键 rationale、反证、risk ceiling、derived grade/strength、policy version 和 reason codes。

ReleaseRecommendation 是 evaluator 建议，DecisionRecord 才是有权限责任人的最终决定。两者必须分别记录，Skill 不替组织拍板。


## 10. EvaluationInputBundle、Assurance 与 Inquiry

EvaluationInputBundle 是 deterministic evaluator 的唯一输入，包含 target snapshot、Scenario/Journey、Source、Evidence/Study/Claim、Research state、adapter evidence、policy versions，以及可选 InquiryDraft。

### 10.1 运行产物

ToolInvocationResult、RuleEvaluation、Finding、RunIssue、RunReport 分层。每条加载规则恰有一条 RuleEvaluation；Finding 只表示需报告的问题；RunIssue 表示系统/输入故障。

唯一 Finding emission：

| evaluation_outcome | release-critical | emission |
|---|---:|---|
| pass / not_applicable | 任意 | none |
| fail | 任意 | rule.finding_type |
| partial / not_run / unknown | false | unknown |
| partial / not_run / unknown | true | escalation |
| evaluation_error | false | RunIssue only |
| evaluation_error | true | RunIssue + escalation |

finding_type 和 emission_reason_code 进入 fingerprint preimage。

### 10.2 Inquiry 非权威综合器

开放式 Inquiry 不由 deterministic evaluator 生成。人或 LLM synthesizer 产生 InquiryDraft，记录 author/model、prompt/template digest、source refs、affected-party input、representation gaps、confidence/use limit。它作为 EvaluationInputBundle 输入；evaluator 只：

- schema/引用验证；
- 检查 epistemic 与 sensitive-use 越界；
- 生成 deterministic validation result、coverage gaps 和 scaffold；
- 不把 Inquiry 文本用于 release authority，除非其中结构 Claim 已单独通过 ClaimAssessment。

UXHypothesis 保存竞争解释、反证、falsifier；ResearchQuestion 保存 decision need、unknown、least-risk method；DesignRationale 保存 options、trade-offs、affected parties、constraint trace 和 validation path。

parity/golden 只固定 InquiryValidation、引用、gap/scaffold 和禁用结论，不固定开放式自然语言内容。相同 InquiryDraft bundle 仍必须得到相同验证结果。

### 10.3 各模式最低 Inquiry 输出

- guide/refactor：目标结果、竞争解释或 not_available reason、关键未知、替代方案、反证/验证路径；
- scan/verify：coverage gap、对 material/zero Finding 的竞争解释或 not_available、受影响方未知、所需反证和最小风险下一步。

无参与者证据时只能标 expert_hypothesis，不能声称 user need/reported experience。0 Finding 警示是 RunReport 固定字段。


## 11. Total evaluator、状态机与 identity

### 11.1 AST v1

AST 为 JSON tagged union，node_id 唯一。结果 T/F/U/E。missing：exists=F，其余 U；existing null：exists=T、eq(null,null)=T。非法规则→invalid_rule，非法输入→invalid_input，registry runtime type conflict→E。

求值 eager，按 node_id UTF-8 byte order 记录所有子节点。all：E > F > U > T；any：E > T > U > F；not 映射 T/F/U/E→F/T/U/E。empty all=T、empty any=F。

唯一 applicability 算法：

1. eager 求 applicability 和 exclusion；
2. effective = applicability AND NOT exclusion，使用上述 E 优先级；
3. effective E→evaluation_error，F→not_applicable，U→unknown，T→继续；
4. 只有 effective T 才评价 preconditions；precondition F/U→not_run，E→evaluation_error。

删除任何根据原始 applicability 单独提前映射的实现。

### 11.2 状态机

Tool：scheduled→running→success/partial/not_found/invalid_request/auth_error/timeout/server_error/cancelled。  
Rule：scheduled→running→completed/tool_failed/invalid_input/invalid_rule/cancelled；terminal 后不可转移。evaluation_outcome 由 terminal state、applicability、precondition 和 check result 唯一派生。  
Run：created→validating→normalizing→evaluating→completed/failed/cancelled。

RunStatus reducer 固定优先级：invalid_input/invalid_rule → failed；release-critical evaluation_error → failed；block → completed_blocked；escalation → completed_escalated；存在 noncritical partial/unknown/not_run → completed_with_gaps；否则 completed_clear。独立规则不因无依赖工具失败而停止。required_inputs 明确依赖。

### 11.3 Fingerprint 与 semantic digest

finding fingerprint preimage 是 JCS object，domain ux-skill:finding:v1，字段固定：schema/behavior/rule version、finding_type、emission_reason_code、canonical target locator、target digest、canonical scenario_bindings set、rule id、structured claim key。SHA-256 小写 64 hex；finding_id = "f_" + 前 32 hex。相同 truncated id/full fingerprint 冲突为 fatal。

semantic projection 使用独立 JSON Schema 白名单，只包含 versions/digests、RunStatus、RuleEvaluations、Findings、RunIssues、Risk/Recommendation assessments、Resolution traces、InquiryValidation/gaps。排除 transport audit、wall-clock run timestamps、localized message、开放 Inquiry text；业务 effective_at/expiry 和证据时间不得排除。

semantic_digest = SHA-256(UTF8("ux-skill:semantic:v1") || UTF8(JCS(projection_without_semantic_digest)))，输出小写 hex。


## 12. Schema、canonical collections 与验证 pipeline

JSON Schema 固定 2020-12 + format-assertion。所有嵌套对象 additionalProperties:false。字符串必须是 UTF-8 NFC；不做 NFKC。重复 JSON key、lone surrogate、非有限数值、未知 major 均 invalid_input。

Validation pipeline 固定：

1. parse/I-JSON；
2. NFC check；
3. schema validation；
4. collection normalization；
5. reference/graph/identity/authorization semantic validation；
6. policy evaluation。

不 fail-fast；收集本阶段全部错误，但后阶段因 prerequisite 缺失只发一个 SUPPRESSED_BY_STAGE reason。NormalizedError tuple 为 (stage, code, instance_pointer, schema_or_invariant_id, params_jcs)，按该 tuple UTF-8/JCS byte order 排序。

CollectionRegistry 对 EvaluationInputBundle 每个数组声明 collection_kind、key_pointer 和 duplicate policy。v0.1 所有实体集合均 canonical-set，以其 id 字段为 key；journey events、acting edges、approval decisions、trace nodes 为 ordered-list 并带 sequence。相同 key + 相同 JCS 折叠；相同 key + 不同 JCS → DUPLICATE_ID_CONFLICT。canonical-set 按 key UTF-8 bytes 排序。

input_digest = SHA-256(UTF8("ux-skill:input:v1") || UTF8(JCS(normalized bundle without input_digest)))。

核心 schema 清单除 v0.4 对象外，新增 SourceFragment/ConflictTrace、ControlPrincipalEdge、ActingEdge、PartyInventory、ActionPolicy、ExecutionEnvelope、ApprovalDecision/Policy、InvalidationMatrix、StudyExecutionRecord、AnalysisPlan/Execution、EvidenceSearchSelectionRecord、IdentificationAssumption、SignalClaim、SensitiveInferenceUseAssessment、RecommendationAssessment、ResearchAuthorizationDecision、ParticipantConsent/Assent/RepresentativeConsent/Withdrawal、InquiryDraft/Validation 和 CrossCuttingLensRegistry。


## 13. HulianUI adapter normalization profile

HulianUI 仅提供 evidence/candidate mapping。Adapter 分两份产物：

- CanonicalAdapterEvidence：进入 EvaluationInputBundle；
- TransportAuditSidecar：保存 local/MCP transport、absolute path、request/response、时间和 server instance，不进入 parity projection。

CanonicalCapabilityIdentity = (provider_namespace, tool_name, contract_version, input_schema_digest, output_schema_digest)。local fixture 与 MCP 若此 tuple 不同就不是同一能力，不能比较 parity。

字段归一固定：

- missing 保持 missing，显式 null 保持 null；
- entity/result 集合按 CollectionRegistry；
- 时间只保留证据业务时间，transport time 进入 sidecar；
- target locator 使用 workspace-relative POSIX path：UTF-8 NFC、/ separator、禁止 absolute、.、..；解析 realpath 后必须在显式 project_root 内，symlink 越界拒绝；case 保留；
- project_root 自身不进入 canonical bundle，以 workspace_id + target snapshot digest 代替；
- status 映射 success→usable declared evidence，partial→逐项 usable/missing，not_found→absence_unknown，invalid_request/auth_error/timeout/server_error→Tool terminal + RunIssue。

每种 HulianUI tool contract 在 adapter registry 中固定 input/output field mapping、allowed evidence kind、required args、partial semantics、prohibited Claims。依赖缺项的 Rule not_run/partial，独立 Rule 可继续。

Adapter parity 固定同一 captured logical response 的 local/MCP CanonicalAdapterEvidence byte-equal；transport sidecar 预期不同。Evaluator parity 固定相同 normalized bundle 的 semantic projection byte-equal。


## 14. Canonical ustar v1 离线制品

v0.5 取消 gzip，发布未压缩 .tar，消除 DEFLATE 差异。Reference format id 为 ux-ustar-v1。

输入只允许 regular file，不写目录项。路径为 relative UTF-8 NFC POSIX path，禁止空、absolute、.、..、反斜线、control char，且编码后 <=100 bytes；不使用 prefix/long-name/PAX/link/xattr。

每个 512-byte ustar header 固定：

- name[100]：UTF-8 bytes + NUL padding；
- mode[8]：ASCII 0000644 + NUL；
- uid[8]、gid[8]：ASCII 0000000 + NUL；
- size[12]：11 位 ASCII octal + NUL；
- mtime[12]：ASCII 00000000000 + NUL；
- checksum[8]：计算时全为空格；结果为 6 位 octal + NUL + space，按 unsigned byte sum；
- typeflag=ASCII 0；
- linkname 全 NUL；
- magic=ustar + NUL，version=00；
- uname/gname/devmajor/devminor/prefix/padding 全 NUL。

文件按 path UTF-8 bytes 升序；内容原字节写入并以 NUL 补齐至 512；末尾恰好两个全零 block，不追加其他 block。拒绝 size 超 11 位 octal。reference packer 直接按此算法写 bytes，不调用系统 tar。

internal manifest 不含 artifact digest。knowledge/manifest digest 使用 JCS/domain-separated SHA-256。artifact_digest = SHA-256(UTF8("ux-skill:artifact:v1") || raw tar bytes)，小写 hex；Release 的 artifact.sha256 独立保存该值。

ART-ONEFILE-001 在 normative vector 中冻结完整 base64 archive、长度和 digest。两个干净环境必须 byte-equal 且匹配该固定值；不是只验证能解包。

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



## 17. Research authorization、consent 与停止

ResearchProtocol、ResearchActivity、EthicsReviewDecision 和 ResearchAuthorizationDecision 分离。

ResearchAuthorizationDecision 是 operational gate，必须引用：

- 当前 protocol id/version/digest；
- 有权限 EthicsReviewDecision，或适用制度授权主体作出的 exempt/waiver decision；
- organization recruitment/data/channel AuthorizationDecision；
- purpose/data scope、participants/cohort、effective/expiry 和 conditions。

无有效 ResearchAuthorizationDecision 默认 blocked，不能因为“低风险”自行进入 approved。状态唯一转换：

proposed → blocked/approved；approved → active 仅当 authorization、operational authority、required consent artifacts 全有效；active → stopped/completed；revocation、expiry、protocol digest change、distress/adverse event、withdrawal applicable condition 触发 stopped。stopped/completed 不可回到 active。

ParticipantConsent/Assent/RepresentativeConsent 绑定 participant identity、protocol digest、information version、elicitation/comprehension method、signed/recorded artifact、time、scope、withdrawal channel。没有 consent 时只有有效 waiver 才能 active。WithdrawalArtifact 立即阻止后续收集/干预，并触发按 protocol/policy 决定保留、删除或不可撤回已聚合数据。

涉及脆弱性、创伤、危机、欺骗、不可逆干预或高敏数据必须有独立适格审核和 stop/referral。Agent 不自行判定 exempt/waiver，也不把 eCFR、EU AI Act 等特定制度当全球默认义务；它们只有通过第 3 节适用性才约束。


## 18. Normative RED/golden 与 holdout

### 18.1 Vector contract

每个 vector 固定 behavior_version、input_jcs/input_digest、expected normalized errors、Tool results、RuleEvaluations、Findings/RunIssues、RunStatus、semantic projection/digest、trace digest；artifact vector另有 raw bytes/base64/length/artifact digest。同一 behavior version 内不可修改；行为变化创建新 vector id，旧 vector永久保留。

最低唯一预期：

| vector | 唯一预期 |
|---|---|
| AST-APP-FE-001 | applicability F + exclusion E → evaluation_error |
| FIND-INC-001 | release-critical unknown → escalation；noncritical → unknown |
| BUNDLE-DUP-001 | 同 id 不同 JCS → DUPLICATE_ID_CONFLICT |
| STATE-DEP-TIMEOUT-001 | 依赖 rule evaluation_error+escalation，独立 rule pass，run failed |
| ACT-IMPERSONATE-001 | 任一 ActingEdge basis missing → deny/escalation |
| TENANT-JOIN-001 | required target/controller scope 任一缺失 → deny |
| GRANT-PARENT-REVOKED-001 | ancestor revoked → deny |
| ENVELOPE-H1-H2-001 | approval/authorization/effect digest 不同 → no effect + escalation |
| APPROVAL-RACE-001 | 两 worker 仅一笔 atomic consume/effect |
| CAP-REPLAY-001 | channel/session/nonce 变化 → reject |
| PARTY-UNKNOWN-001 | high impact + inventory unknown → escalation |
| HARD-UNSAT-001 | zero feasible → no selection + all minimal cores + block/escalate |
| SOFT-TIE-001 | tie → undecided + ask/escalate table |
| CLAIM-FAKE-RCT-001 | claimed randomized but execution mismatch → unresolved |
| EVIDENCE-DUP-001 | same dependency cluster 不增加 grade |
| SIGNAL-MATERIAL-001 | sensitive action materially relies on signal → block/escalate |
| REC-WEAK-001 | insufficient grade → ResearchQuestion only |
| RESEARCH-NO-AUTH-001 | complete low-risk protocol but no authorization → blocked |
| PROJ-VOLATILE-001 | transport time/message excluded；business expiry retained |
| VALID-UNICODE-001 | NFC 通过，非 NFC → UNICODE_NOT_NFC |
| ADAPTER-TRANSPORT-001 | canonical evidence equal，audit sidecar different |
| ART-ONEFILE-001 | exact raw ustar bytes/length/digest |

实现前先运行无 evaluator/无 Skill baseline，记录这些预期失败；GREEN 不得改 vector。

### 18.2 Holdout

custodian 使用私有 secret 对 canonical case bytes 计算 HMAC-SHA-256；repo 只存 commitment、strata 和 generation id。每个 preregistered artifact digest 对每一 generation 只允许一次查询。返回仅含 overall gate pass/fail 和预注册的 aggregate metrics，不返回 case/stratum id、错误文本或新指标。

第二次查询固定 QUERY_BUDGET_EXHAUSTED。任何 case-level access、secret 泄漏或基于结果调整都污染 generation；下一 artifact 必须使用新 generation。behavior version 改变必换 generation。

### 18.3 发布门槛

Canonical 至少覆盖第 18.1 所有 vectors 和原 8 个产品场景族；每例 5 次 fresh-context。Skill/CLI/MCP semantic parity 100%，adapter canonical evidence parity 100%，prohibited claims/recommendations 0，release-critical failure 误 pass 0，golden bytes 全匹配。

稳定阶段再要求独立专家/用户代表按 strata 盲评 relevance、contextual fit、alternatives、harm、uncertainty，以及三个真实项目（至少一个非 HulianUI）。只报告观察结果、样本边界和残余风险，不宣称永不漏报。


## 19. v0.1 试验验收

必须同时满足：

1. 第 12 节所有核心对象有 schema、canonical collection 和 semantic validator；
2. SourceFragment→Assertion→Adoption→Conflict trace 唯一；
3. ActingEdge、tenant join、递归 GrantValidity、ExecutionEnvelope、原子 Approval/effect、lineage invalidation 唯一；
4. Journey capability 防 replay，PartyInventory 完整性和 hard/soft 求解唯一；
5. Study execution/analysis、Evidence dependency、ClaimAssessment、SensitiveUse、RecommendationAssessment 唯一；
6. Research 默认 blocked、授权/consent/withdrawal 状态机可执行；
7. Inquiry 是非权威 draft，deterministic evaluator 只校验，不将开放文本纳入 release authority/parity；
8. applicability、Finding emission、Tool/Rule/Run state 和 RunStatus reducer 无多解；
9. NFC、collections、errors、input/finding/semantic digest、projection 均有 golden；
10. HulianUI canonical evidence 与 transport sidecar 分离；
11. ART-ONEFILE-001 匹配 canonical ustar bytes；
12. 第 18 节 RED/golden/holdout/真实项目门槛通过；
13. Profile、组件库、自动扫描和 0 Finding 不冒充 UX 成功；
14. 本机资料目录无项目写入；
15. 用户批准最终规格后才写 implementation plan。


## 20. 当前阶段与下一关口

当前仍只做设计。

1. 提交 v0.5 到 design/v0；
2. 自检所有 MUST/唯一表是否存在对应 schema/vector，消除“固定但未给值”；
3. 第五轮使用全新上下文，只允许评审残余核心歧义，不重复建议已冻结内容；
4. 只有 GO，或 CONDITIONAL GO 且无 core schema/semantic blocker，才交用户最终审阅；
5. 用户明确批准后才调用 writing-plans；
6. 首纵切仍限制为一个高风险 Admin 审批场景、一条 advisory rule、一组 Claim/Recommendation Assessment、共享 evaluator、一个 HulianUI candidate mapping、Assurance+Inquiry validation 和 ART-ONEFILE-001；
7. 首纵切不修改 HulianUI MCP、不扩第二场景、不宣称 stable。

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
- eCFR 45 CFR 46.109, IRB review: https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-A/part-46/subpart-A/section-46.109
- eCFR 45 CFR 46.116, informed consent: https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-A/part-46/subpart-A/section-46.116
- Regulation (EU) 2024/1689 official text: https://eur-lex.europa.eu/eli/reg/2024/1689/oj
- RFC 8785 JSON Canonicalization Scheme: https://www.rfc-editor.org/rfc/rfc8785.html

经典著作只作为综合知识输入，不复制受版权保护正文。首批包括 Jesse James Garrett、Don Norman、Steve Krug、Giles Colborne、Marty Cagan 及本地提供的产品设计资料。
