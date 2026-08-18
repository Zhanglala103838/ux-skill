# Evidence-aware Product UX Skill 设计规格

状态：v0.13 第十二轮最终 schema 修订候选，等待定点复核  
规格版本：0.13  
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




## 3. 来源命题、权威与有效时点

SourceRecord 保存发布者、canonical URI、版本/status/effective/expiry 和完整内容 digest。SourceFragment 保存 exact locator、fragment_kind、fragment bytes digest 与结构 proposition。

FragmentPropositionAssessment 是 registry-build 必需工件：fragment_digest、proposition_digest、relation、assessment_method、reviewer identity/authority、reviewed_at、status=verified/rejected/unknown、reason codes。只有 verified 可进入 effective authority；rejected/unknown 固定 unresolved。运行输入不能创建或提升该工件。

EvaluationInputBundle 必填 evaluation_effective_at，并纳入 input_digest。所有 SourceRecord、Fragment、PolicyAdoption、supersession、override、revocation、Grant、research review 的有效性只按该时间求值，禁止读取 evaluator 墙钟。

effective_authority 唯一派生：

1. verified normative fragment + 适用标准/法律身份 → normative；
2. verified fragment/assertion + 有效 PolicyAdoptionRecord 精确覆盖 proposition/scope → adopted_policy；
3. verified empirical result → empirical；
4. verified informative/expert fragment → expert_synthesis；
5. verified example → example_only；
6. 其他 → unresolved。

PolicyAdoptionRecord 双向引用 assertion，并绑定 adopter、decision authority、artifact digest、adopted proposition/scope、[effective, expiry)、revocation/version。

SourceConflictResolutionTrace 保存 applicable assertions、法域/scope、partial supersession、override closure、冲突 proposition 与 unresolved set。unresolved 非空固定 escalation。non_conformance/violation 还要求 normative/adopted、proposition entailment、verification requirements、完整过程范围与等价替代全部 verified。

APG 示例、Understanding 文档、heuristic、局部组件或自动扫描不能产生规范结论。source registry 的 build/review 也进入 release provenance。

## 4. 分析单元、情境镜头与双轨输出

analysis_units 可覆盖进入预期、任务交互、内容信息、旅程触点、服务前后台、组织政策、社会技术生态、长期反馈和感官表达。Garrett planes、Norman action cycle、heuristics、service blueprint、accessibility、trust/ethics、behavioral metrics 都是可选 lens，不是规则主键。

CrossCuttingLensRegistry 为每个 lens 声明触发条件、所需上下文、能支持的 Claim 和不能支持的 Claim。只加载与当前 Scenario/Journey 匹配的 lens；不得把“所有问题都检查一遍”当成人本设计。

ScenarioFamilyRegistry-v1 additionalProperties=false，正规形固定为：

~~~json
{"registry_version":"scenario-family-v1","scenario_family_ids":["admin-internal-tool","ai-assisted-workflow","brand-marketing-website","consumer-transaction","cross-channel-service","developer-documentation","public-service-information","retail-commerce-discovery"]}
~~~

scenario_family_ids 是以完整 id 为 key 的 canonical-set，按第 12.3 节排序且恰为上述 8 项；scenario_profile_id 必须引用其中一项。registry digest 只按第 12.5 节 scenario-family-registry row 计算，固定为 b764d922bd94ceb6869cd60984261acae344cd0a5e21c1cc9970cff710e417d0；不得用自由文本“官网/Admin/原 8 类”替代。

Assurance track 回答：目前有什么可评价义务、事实、风险和未知。Inquiry track 回答：目标结果是什么、有哪些竞争解释、关键取舍和未知、如何寻找反证。规则库只能覆盖已编码风险，不能取代 situated inquiry、参与式设计和生命周期迭代。




## 5. Authority proof、ExecutionEnvelope 与原子 effect

### 5.1 身份、信任根与代理

ActorIdentity=(namespace_uri, issuer_id, subject_id, kind)，字符串 NFC，只有 tuple byte-equal 才相等。

AuthorityRootRecord 是版本化 registry trust anchor，保存 issuer、allowed grant/representation scopes、[effective,expiry)、key/version、revocation。ActingContext 是有序 ActingEdge；每跳 from/to/basis/scope/time/version。ValidActingEdge 从 trust anchor 或已验证 authority proof 递归证明，禁止自支持和环；F→block，U→escalate。

ActingContext 必须形成连续有向路径：edge[i].to 与 edge[i+1].from 必须 ActorIdentity byte-equal；首端绑定 authenticated principal 或 AuthorityRootRecord 明确表示的 subject，末端绑定 AuthorizationDecision.effective_actor。action/resource/tenant/purpose 和 evaluation_effective_at 必须落在每一跳 scope/time 的交集内。断链、错序、端点错配或已证实不覆盖固定 block；交集/证明 unknown 固定 escalation。AuthorizationDecision 绑定 acting_chain_digest、首末端和完整 proof trace。

ControlPrincipalEdge 同样带 time/scope/basis。SoD 使用在 evaluation_effective_at 的传递闭包；两个 actor 共享任一最终 control principal即 not_separated；环或闭包不完整为 unknown。风险等级只决定 ActionPolicy 是否要求 SoD；一旦 required，结果总表为 separated→continue、not_separated→block、unknown→escalation。

### 5.2 多租户 join 与 PartyInventory

ActionPolicyRegistry 为 action+resource_type 列 required tenant relationships，v0.1 全部使用 all。结果唯一：

| 情形 | 结果 |
|---|---|
| 已证实 Grant scope 不覆盖 required binding，或已证实额外跨租户 effect | block |
| binding/closure/conflict unknown | escalation |
| schema/ref 非法 | invalid_input |
| 全部精确覆盖 | continue |

Decision 绑定 canonical tenant_binding_set_digest。

PartyInventory.status 由 evaluator 从 resource/effect/party graph 闭包派生，输入不能自报。PartyEffectGraphCompletenessProof 是 authority-bearing 工件，绑定 effect/resource scope、authoritative data sources/coverage、snapshot digest/version、[effective,expiry)、closure algorithm id/version 和 verification status。只有 proof=verified、全部 refs 闭合且 closure 完成才派生 verified_complete 或 verified_no_affected_party；proof 缺失、过期、引用不闭合或不可判定固定 unknown→escalation。任何可能影响人的 effect 只有上述两种状态可 allow。

### 5.3 GrantValidity

Grant 只能由 AuthorityRootRecord 或递归有效 parent 授予。Valid(g,t,e) 要求 active、effective<=t<expiry、未撤回、epoch/version 匹配、issuer authority、action/resource/tenant/purpose scope subset、delegation/nondelegable/depth 合法，且全部 ancestor 有效。任一 F→block；任一 U→escalate。根到叶 id/version/epoch/proof digest 组成 grant_chain_digest。离线 v0.1 固定 queue_only。

### 5.4 Canonical ExecutionEnvelope

Envelope body 包含 action、payload/effect/pre/postcondition digest、resource versions、tenant set digest、authorization_purpose、acting/grant chain digest、party_inventory_digest、party_effect_graph_snapshot_digest/version、party_graph_completeness_proof_digest、time_authority_policy_digest、journey run/step、channel/audience，以及可选 research_guard_digest。

envelope_digest = SHA-256(UTF8("ux-skill:execution-envelope:v1") || UTF8(JCS(body)))，小写 64 hex；envelope_id="e_"+前32 hex。调用者提供值必须复算一致。Approval、Authorization、capability、idempotency 和 effect event 只能引用 full envelope_digest。

任何 body 变化生成新 envelope；AI 不得在批准后补默认值或二次生成 effect。evaluation_effective_at 只描述纯评价快照，不授权未来执行。

### 5.5 Approval、invalidation 与 connector

ApprovalDecision 绑定 approver context/authority、full envelope digest、time/expiry。Policy 固定 roles/quorum/SoD domain/single-use。quorum 只统计 distinct eligible approver ActorIdentity；同一主体的多条 Decision 最多一票。Policy 要求 control separation 时再按最终 control-principal 等价类去重。已证实 quorum 不足固定 block；identity/control closure unknown 固定 escalation。

TimeAuthorityPolicy 精确绑定一个 authority ActorIdentity、key/version、clock/monotonic profile 和有效区间；其 digest 进入 envelope。effect commit 必须在 commit 瞬时从该唯一 authority 读取一条经认证、nonce/sequence 未重放的 commit_effective_at，不得由调用者、其他可信 authority、缓存时间或 execution lease 回填，且 commit_effective_at>=evaluation_effective_at。该读数缺失、多值、冲突或 policy 无效固定 no effect+escalation。execution lease 只授权区间/guard snapshot，不能证明当前时间；其 expiry 也用 commit_effective_at 验证。approved→consumed 时以 commit_effective_at 重新求 Approval eligibility、ActorIdentity/control closure、required SoD、distinct quorum，并重验 Grant、capability、resource versions、party/effect graph、重新派生 PartyInventory、research guard、fencing、idempotency，与 effect commit 构成 composite guard；任一失败零副作用。历史 EvaluationInputBundle 不能直接执行 effect。

Invalidation 是单调 tombstone。任一后代路径发生 identity/control、tenant、resource/version、authorization_purpose、payload/effect、grant、party_inventory 或 party/effect graph snapshot/completeness proof、time authority policy、risk、channel/audience change，旧 Approval/Decision 永不复活，即使值改回；merge 取所有父分支有效工件交集后应用 tombstone dominance。

ExternalEffectConnector 必填 receiver_contract=receiver_id、supports_idempotency/fencing、key=envelope_digest、ack/effect-query semantics。支持 receiver-side contract 才可自动 retry。否则 response unknown 固定 effect_unknown+escalation，不重试、不宣称 atomic。发送前重验 composite guard，或消费有明确 expiry 的 execution lease。


## 6. Journey 与 authority-bearing capability

JourneyDefinition/Run 仍分离。副作用 Step 必须引用 full ExecutionEnvelope、AuthorizationDecision 和 Approval consumption。

普通 data 与 authority-bearing capability 分型。capability body 绑定 run/step、acting chain、session、channel/audience、tenant set、resource/version、authorization_purpose、envelope digest、nonce、expiry、issuer/key version，以及 capability_use=execute|recover。

capability_digest = SHA-256(UTF8("ux-skill:capability:v1") || UTF8(JCS(body)))。它必须由 AuthorityRootRecord 信任的 issuer 签名/MAC，并存在权威 ledger。每次 effect/retry/resume 前原子执行对应 capability ledger unused→consumed；不存在、签名失败、digest mismatch、expired、重复消费固定 block；ledger unavailable 固定 escalation。capability_use=execute 只允许首次发送；ACK unknown 后只能使用 fresh capability_use=recover capability 或未过期 execution lease，且 recover 仅能 query 或向已验证 idempotent receiver 重发完全相同 envelope_digest，不能生成新 effect。idempotency 命中不能替代 capability/authorization。

Retry/Timeout/Recovery/Idempotency 为 typed policy。TerminalOutcome 有可求值 postcondition、PartyInventory safety condition和证据。validator 拒绝悬空、不可达、无终态、无限重试、非法 carry、replay、context change 未重验、重复 effect 和无证据 success。


## 7. Hard solver 与 soft tie 总函数

CandidateUniverse 必须作为 EvaluationInputBundle 的显式 canonical-set<Solution> 提供；evaluator 不生成 Option 幂集。Solution 是 canonical set<Option id>。

对每个 candidate 和全部 effective hard constraints：

- 全部 T → feasible；
- 任一 E → evaluation_error；
- 无 E 且任一 F → infeasible（同时保留其余 U 到全局 trace）；
- 无 E/F 且任一 U → indeterminate；
- 其余为 feasible。

全局 reducer 固定优先级：

1. 任一 candidate 有 E → evaluation_error，不进入 soft selection；
2. 无 E 但任一 candidate 有 U → no final selection + escalation，即使另有 feasible candidate；
3. 全部 candidate determinate 且至少一个 feasible → 只把 feasible set 交 soft selection；
4. 全部 determinate 且 zero feasible → 法律/权利/高风险冲突 escalation，其他 mandatory fail block。

hard 永不按 priority 放松，只有 verified override 生效。Override DAG、requires/incompatible hypergraph 与 closure 均确定执行。绝不选择违反或 indeterminate 的 Solution；输出全部 inclusion-minimal unsat cores，稳定排序。

SoftPreference 维度为 (party/cohort, criterion)，禁止跨 party 聚合。safety/rights floor 后按 lexicographic tier，tier 内 Pareto。多个非支配 Solution 时 SelectionDecision 始终 undecided，不能选择任何 Solution。PartyInventory/authority 不完整或触及 floor→ReleaseRecommendation=escalation；否则 ReleaseRecommendation=undecided + ask_decision_owner。ResolutionTrace 固定保存 universe digest、T/F/U/E matrix、closures、cores、Pareto 和 branch reason。


## 8. ClaimAssessmentPolicy 与 sensitive use

EvidenceSearchSelectionRecord、StudyDesign/Execution、AnalysisPlan/Execution、Evidence dependency cluster、SignalClaim/ReportedExperience 均保持 v0.5 结构。

### 8.1 Check status 与 EvidenceGrade

ClaimAssessmentPolicy 是 registry 工件，列出每种 Claim 的 required_check_id、dimension、critical、evaluator invariant。每个 check 只能输出 rejected=0、unknown=1、verified_with_limit=2、verified=3。

每个 dimension score 是其 required checks 最小值；EvidenceGrade 的 validity/directness/precision/transportability 分别映射 0=insufficient、1=limited、2=adequate、3=high；overall grade 是四维最小值。selection completeness 非 verified 或未解决 contradiction 将 overall cap 为 limited。作者不能填 score/grade。

### 8.2 唯一 admissible conclusion

- normative：全部 critical check=3 → normative；否则 unresolved；
- causal：全部 critical check>=2 且 temporal/comparator/identification/estimand checks=3 → causal；否则若 temporal + measured covariation + comparator checks>=2 → associational；否则若存在可验证 observation → descriptive；否则 unresolved；
- predictive：全部 critical check>=2，且 independent validation/calibration/baseline/target population/drift checks>=2 → predictive；否则若存在 prediction+observed outcome pair → descriptive；否则 unresolved；
- reported_experience/observed_signal 不升级；
- 未命中 policy row → unresolved + POLICY_ROW_MISSING。

同一输入只能得到一个结论。ClaimAssessment 必填 assessed_predicate：relation_kind 必须等于 admissible conclusion；causal 降为 associational 时移除 intervention/counterfactual/effect estimand，降为 descriptive 时只保留 observed subject/value/context/time，predictive 降为 descriptive 时移除 future target；unresolved 时 assessed_predicate=null。所有 Finding/Recommendation 只能引用 assessed_predicate，Claim text 不能表达或恢复更强语义。

### 8.3 SensitiveInferenceUseDecision

rationale closure 标记 materially_relies_on。敏感 purpose 包括资格、定价、就业、教育、健康、保险、信贷、脆弱性定向和操纵性干预。

| 条件 | 唯一结果 |
|---|---|
| sensitive + materially relies on signal/reported/derived + applicable prohibition/mandatory fail | block |
| 同上但无适用禁止，或适用性 unknown | escalation |
| sensitive 但不 materially rely，且所有其他 hard checks pass | continue |
| non-sensitive | continue |

不能通过加入无关证据消除 materially_relies_on。reported experience 的二次用途同样检查 consent/purpose/authority。


## 9. Risk、Recommendation ceiling 与 reducer

RiskDecisionPolicy v1：mandatory fail/hard unsat 直接采用第 7 节已由风险/权利条件唯一决定的 block 或 escalation；release-critical evaluation_error/not_run/unknown→escalation；catastrophic/severe 且 likelihood/exposure unknown，或 irreversible 且关键因子 unknown→investigate_immediately。

ResidualConditionSet 是 canonical-set<Condition>，Condition 必填 predicate、owner、deadline、verification method、status=verified_executable|unknown|rejected_or_infeasible。ReleaseRecommendation 总表：

表格自上而下首个命中：

| 前提 | 唯一结果 |
|---|---|
| 任一 block rule 或 condition=rejected_or_infeasible | block |
| 任一 escalation/investigate 或 condition=unknown | escalation |
| soft selection=undecided 且前两行未命中 | undecided + ask_decision_owner |
| 全部 critical pass/not_applicable、无 tail unknown、soft selection 已决定、condition set 为空 | allow |
| 同上且 condition set 非空并全部 verified_executable | allow_with_conditions |

RecommendationAssessment 使用有序 strength：none < explore < conditional_advice < strong_advice < required。

四个独立 ceiling 都按各自表格自上而下首个命中，是互斥化后的总函数；后续行不得覆盖已命中值：

| ceiling | 条件 | 值 |
|---|---|---|
| authority | applicable prohibition | none |
| authority | authority applicability/conflict unknown | explore |
| authority | exact requires proposition 精确蕴含 action | required |
| authority | 只规定结果且存在 verified 等价实现 | conditional_advice |
| authority | 无适用 action obligation/prohibition | required（中性上界，不声称权威要求） |
| evidence | admissible conclusion=unresolved 或 overall=insufficient | none |
| evidence | overall=limited | explore |
| evidence | overall=adequate | conditional_advice |
| evidence | overall=high 且 conclusion=causal | strong_advice |
| evidence | overall=high 且 conclusion=normative，且 assessed predicate 精确蕴含 Recommendation action | required |
| evidence | overall=high 且 conclusion=normative 但不精确蕴含 action | conditional_advice |
| evidence | overall=high 且 conclusion=descriptive/associational/predictive/reported_experience/observed_signal | conditional_advice |
| risk/sensitive/hard | block | none |
| risk/sensitive/hard | escalation/investigate_immediately | explore |
| risk/sensitive/hard | clear | required |
| reversibility | irreversible 且非 exact mandatory action | conditional_advice |
| reversibility | unknown | explore |
| reversibility | reversible 或 exact mandatory action | required |

唯一 reducer：

1. hard/sensitive/authority block → strength=none，不形成行动 Recommendation；
2. escalation/investigate → strength=min(explore, authority, evidence, risk, reversibility ceilings)；
3. 其余 strength=min(authority, evidence, risk, reversibility ceilings)；
4. required 只有 authority ceiling=required 且最终 min=required；
5. strength=none 只生成 ResearchQuestion/DecisionGap。

TestProposal 永不由 strength 自动产生；必须另行通过 hard feasibility、Risk、ResearchAuthorization、stop/rollback 后才可执行。RecommendationAssessment 保存各 ceiling、最小值、policy version/reason。

ReleaseRecommendation 与 DecisionRecord 分离。Inquiry 文本不能成为任何 ceiling/rationale 输入。


## 10. EvaluationInputBundle 与输出权威

EvaluationInputBundle 必填 schema/behavior versions、evaluation_effective_at、target snapshot、CandidateUniverse、Scenario/Journey、Source registry refs、Evidence/Study/Claim、Research state、adapter evidence、policy digests；可选 InquiryDraft。其 normalized bytes 产生 input_digest。

ToolInvocationResult、RuleEvaluation、Finding、RunIssue、RunReport 分层。每条规则一条 RuleEvaluation，Finding 只表示问题。

Finding emission 精确输出：

| outcome | critical | finding | reason | RunIssue |
|---|---:|---|---|---|
| pass | any | none | NONE | none |
| not_applicable | any | none | NONE | none |
| fail | any | rule.finding_type | RULE_CHECK_FAILED | none |
| partial | false | unknown | RULE_PARTIAL | none |
| partial | true | escalation | RELEASE_CRITICAL_PARTIAL | none |
| not_run | false | unknown | RULE_NOT_RUN | none |
| not_run | true | escalation | RELEASE_CRITICAL_NOT_RUN | none |
| unknown | false | unknown | RULE_UNKNOWN | none |
| unknown | true | escalation | RELEASE_CRITICAL_UNKNOWN | none |
| evaluation_error | false | none | NONE | RULE_EVALUATION_ERROR |
| evaluation_error | true | escalation | RELEASE_CRITICAL_EVALUATION_ERROR | RULE_EVALUATION_ERROR |

FindingFingerprintV1 的 object additionalProperties=false，所有字段必填：schema_version、behavior_version、rule_id、rule_version、finding_type、emission_reason_code、canonical_target_locator、target_snapshot_digest、scenario_binding_ids、claim_key。scenario_binding_ids 是按第 12 节序列化的 canonical-set；无结构 Claim 时 claim_key 必须为 null，否则固定为 {predicate_id,population_id,context_id,time_scope_id} 且四字段必填。fingerprint_full_digest=SHA-256(UTF8("ux-skill:finding:v1")||UTF8(JCS(object)))；finding_id="f_"+前32 hex。任何额外字段、missing/null 替换或 truncated collision 均 invalid_rule。

InquiryDraft 是非权威输入。evaluator 仅输出 InquiryValidation/gaps/scaffold。ReleaseRecommendation、RiskAssessment、RecommendationAssessment、ActionIntent 和 Rule rationale schema 只能引用 authority-bearing evaluator-derived object ID；InquiryDraft text、scaffold、DesignRationale text 永远不能被引用。若 Draft 中 Claim 值得使用，必须作为独立 canonical Claim 输入并单独 Assessment，不存在例外。

各 request_mode 都输出确定 coverage gap 和 0-Finding warning；开放假设可变化，不进入 semantic projection。


## 11. AST、tool dependency 与 RunStatus

### 11.1 AST v1 完整语法

每个 node 为 tagged object，additionalProperties=false，node_id 非空 NFC string。

| op | required fields | 语义 |
|---|---|---|
| literal | value:boolean | T/F |
| exists | path | missing=F；其他含 null=T |
| eq | path,value:scalar | path scalar 与 value 同 JSON type 且相等；missing=U；类型冲突=E |
| in | path,value:scalar | path 必须 scalar array，元素与 value 同 type；missing=U；否则 E |
| compare | path,operator,value:number | operator=lt/lte/gt/gte；finite number 严格比较；missing=U；否则 E |
| all/any | children:array<node> | eager，按 child node_id bytes 求值/trace |
| not | child:node | T/F/U/E→F/T/U/E |
| builtin | invariant_id,params | registry 中纯函数/version；不存在→invalid_rule |

scalar=boolean/string/finite-number/null；对象/数组 literal、coercion、NaN/Infinity、脚本/正则均 invalid_rule。静态可知 operand/schema 错为 invalid_rule，只有符合规则但 runtime path 值类型冲突为 E。

all 优先 E>F>U>T；any E>T>U>F；empty all=T、empty any=F。路径为 registry RFC6901 pointer，不存在 registry path→invalid_rule。

Applicability 唯一算法：eager 计算 applicability/exclusion，effective=applicability AND NOT exclusion；effective E/F/U/T→evaluation_error/not_applicable/unknown/继续。T 后才评价 precondition；F/U→not_run（不同 reason），E→evaluation_error。

### 11.2 Tool dependency 全映射

规则只在全部 tool normalization 结束后启动，不支持边运行边补证据。

| tool terminal / required satisfaction | Rule execution | outcome | reason |
|---|---|---|---|
| success 或 partial + complete | completed | check 的 pass/fail/partial/unknown | CHECK_* |
| partial + incomplete | completed | not_run | REQUIRED_INPUT_PARTIAL |
| not_found + required | completed | not_run | REQUIRED_INPUT_NOT_FOUND |
| invalid_request/auth_error/timeout/server_error/incompatible_source + required | tool_failed | evaluation_error | REQUIRED_TOOL_* |
| cancelled + required | cancelled | not_run | REQUIRED_TOOL_CANCELLED |
| 任意 + not required | 不影响该 Rule | 按其他输入 | NONE |
| input/schema invalid | invalid_input | evaluation_error | INVALID_INPUT |
| rule/AST invalid | invalid_rule | evaluation_error | INVALID_RULE |

complete 由 Rule.required_input_pointers 全部存在、schema valid 且 evidence usable 派生。partial tool 中缺项不允许启动 check。

同一 Rule 有多个 required dependencies 时先保留每个 ToolInvocationResult，再按以下从上到下首个命中项求 Rule terminal；同层多个 dependency 按 dependency_id 的 UTF8(JCS(id)) unsigned byte order 记录 trace，不改变结果：

1. input/schema invalid → invalid_input/evaluation_error/INVALID_INPUT；
2. rule/AST invalid → invalid_rule/evaluation_error/INVALID_RULE；
3. required invalid_request → tool_failed/evaluation_error/REQUIRED_TOOL_INVALID_REQUEST；
4. required auth_error → tool_failed/evaluation_error/REQUIRED_TOOL_AUTH_ERROR；
5. required incompatible_source → tool_failed/evaluation_error/REQUIRED_TOOL_INCOMPATIBLE_SOURCE；
6. required timeout → tool_failed/evaluation_error/REQUIRED_TOOL_TIMEOUT；
7. required server_error → tool_failed/evaluation_error/REQUIRED_TOOL_SERVER_ERROR；
8. required cancelled → cancelled/not_run/REQUIRED_TOOL_CANCELLED；
9. required partial+incomplete → completed/not_run/REQUIRED_INPUT_PARTIAL；
10. required not_found → completed/not_run/REQUIRED_INPUT_NOT_FOUND；
11. 全部 required ready → 执行 check。

因此 cancelled 与 timeout 同时出现时唯一选择 timeout 分支。

### 11.3 RunStatus

Tool、Rule、Run terminal 后不可转换。Run reducer：invalid_input/invalid_rule→failed；release-critical evaluation_error→failed；block→completed_blocked；escalation→completed_escalated；noncritical partial/unknown/not_run→completed_with_gaps；否则 completed_clear。优先级从左到右。ReasonCodeRegistry 未注册 code 为 invalid_rule。


## 12. Canonical validation、collections、projection 与 digests

### 12.1 CanonicalRelativePath

grammar：path = segment ("/" segment)*；path 总 UTF-8 bytes 为 1..100。segment 是 NFC 的 Unicode scalar 序列，UTF-8 bytes 为 1..100；禁止 U+0000..U+001F、U+007F..U+009F、"/"、反斜线，且完整 segment 不得为 "." 或 ".."。禁止空 segment、连续/、首/、尾/，并禁止 ASCII case-insensitive 的 "%2f" 与 "%5c" 子串。输入按原 bytes 校验，不 URL-decode、不重写。workspace locator 与 ustar path 共用。

### 12.2 Normative error extraction

pipeline：parse/I-JSON→NFC→schema→collections→semantic/policy。每阶段收集全部规范错误；后阶段 prerequisites 缺失只发 SUPPRESSED_BY_STAGE。

底层 validator 原始 diagnostics 不进入语义输出。Normative codes 仅为 PARSE_ERROR、IJSON_*、UNICODE_NOT_NFC、REQUIRED_MISSING、ADDITIONAL_PROPERTY、TYPE_MISMATCH、ENUM_MISMATCH、FORMAT_INVALID、PATH_INVALID、AST_OP_REQUIRED、AST_OP_UNKNOWN、DUPLICATE_ID_CONFLICT、REF_MISSING、INVARIANT_*、SUPPRESSED_BY_STAGE。

tagged union 先读取 discriminator；缺失/未知只发 AST_OP_REQUIRED/UNKNOWN。识别后只校验对应 branch，不发 oneOf/anyOf 汇总错误。每个 property 对每个 code 最多一条。NormalizedError=(stage,code,instance_pointer,invariant_or_schema_id,params_jcs)。ErrorCollectionRegistry 固定 kind=canonical-set、key=完整 NormalizedError tuple，按 UTF8(JCS(tuple)) unsigned bytes 排序去重。

### 12.3 Collection registries

InputCollectionRegistry：所有实体 array 为 canonical-set，以 schema 声明的 *_id 为 key；events/ActingEdges/ApprovalDecisions/trace steps 为 ordered-list，必须有从 0 连续的 sequence。所有 canonical-set 都按 UTF8(JCS(key)) 的 unsigned byte lexicographic ascending 序列化，禁止使用 locale、UTF-16 host order 或完成顺序。composite key 必须是 registry 固定顺序的 JSON array。same key+same JCS 折叠；same key+different JCS→DUPLICATE_ID_CONFLICT。OutputCollectionRegistry 同用此排序与 duplicate policy。

OutputCollectionRegistry：

| collection | kind | 唯一 key / 内部顺序 |
|---|---|---|
| rule_evaluations | canonical-set | rule_id |
| findings | canonical-set | finding fingerprint 的完整 JCS |
| run_issues | canonical-set | (code,instance_pointer,dependency_id) |
| claim_assessments | canonical-set | claim_assessment_id |
| risk_assessments | canonical-set | risk_assessment_id |
| recommendation_assessments | canonical-set | recommendation_assessment_id |
| alternatives | canonical-set | alternative_id |
| solutions | canonical-set | solution_id |
| unsat_cores | canonical-set | JCS(sorted constraint_id bytes) |
| resolution_traces | canonical-set | resolution_trace_id；每个 trace 内 node 为 ordered-list/连续 sequence |
| coverage_gaps | canonical-set | coverage_gap_id |

release_recommendation 与 inquiry_validation 是 nullable singleton，不作 collection；schema 禁止多值。并行完成顺序永不进入输出。

### 12.4 Projection schema

SemanticProjection-v1 只含这些 top-level fields：schema_version、behavior_version、input_digest、evaluator_digest、run_status、rule_evaluations、findings、run_issues、claim_assessments、risk_assessments、recommendation_assessments、release_recommendation、resolution_traces、inquiry_validation、coverage_gaps、semantic_digest。

每个字段引用专用 projection schema；不是从 RunReport 随意删字段。AST child trace 只通过 resolution_traces projection 进入。transport sidecar、wall-clock run timestamps、localized messages、Inquiry text 不在 schema；业务 effective/expiry、证据时间在其对象 projection 中保留。Projection schema 自身 digest 固定在 manifest。

### 12.5 DigestRegistry

| name/domain | preimage |
|---|---|
| input / ux-skill:input:v1 | JCS(normalized bundle without input_digest) |
| input-member / ux-skill:input-member:v1 | JCS(normalized bundle collection member 或 singleton value)；intervention allowlist digest 只使用本 row |
| evaluator / ux-skill:evaluator:v1 | JCS({behavior_version,evaluator_files,schema_manifest_digest,knowledge_manifest_digest,policy_manifest_digest})；evaluator_files 是按 CanonicalRelativePath key 排序的 {path,file_digest} set |
| finding / ux-skill:finding:v1 | JCS(FindingFingerprintV1 object) |
| trace / ux-skill:trace:v1 | JCS(trace projection without trace_digest) |
| semantic / ux-skill:semantic:v1 | JCS(semantic projection without semantic_digest) |
| semantic-member / ux-skill:semantic-member:v1 | JCS(projected collection member 或 singleton value)；SemanticDelta before/after digest 只使用本 row |
| knowledge / ux-skill:knowledge:v1 | JCS(canonical-set<{path,file_digest}>)；仅这两个必填字段、additionalProperties=false，key=CanonicalRelativePath path，按 §12.3 排序/重复策略 |
| manifest / ux-skill:manifest:v1 | JCS(internal manifest without digest fields) |
| scenario-family-registry / ux-skill:scenario-family-registry:v1 | JCS(ScenarioFamilyRegistry-v1 without registry_digest；当前正规形不内嵌 digest) |
| snapshot-closure / ux-skill:snapshot-closure:v1 | JCS(SnapshotClosureManifest without manifest_digest) |
| rotation-selection / ux-skill:rotation-selection:v1 | JCS(RotationSelectionManifest without manifest_digest) |
| artifact / ux-skill:artifact:v1 | raw canonical ustar bytes |

计算统一为 SHA-256(UTF8(domain)||preimage bytes)，小写 64 hex。SemanticProjection.evaluator_digest 必须等于 evaluator row 的结果；运行时二进制路径、编译时间和 host metadata 不进入 preimage。missing 字段按 schema 缺失，不转 null。finding_id/effect/capability id 使用已定义 full digest 派生；truncation collision fatal。


## 13. HulianUI adapter v1 固定 row

首个 contract 只使用 get_component_doc 精确获取 AlertDialog；“破坏性操作为何需要确认”由 UX rule 决定，MCP 只证明实现候选存在及其文档字段。

AdapterContract JCS：

~~~json
{"adapter_contract_id":"hulianui.get-component-doc.alert-dialog.v1","component_identity":{"category":"feedback","name":"AlertDialog","slug":"alert-dialog"},"evidence_scope":["component-identity","import","exports","props","events","slots"],"npm_integrity":"sha512-8jmvIG9yU7hGJ17n4TLChWlWQ0XXCMxr5ZJiMXiwe53Tib9yBQBZOdlTrRseoAcArlPgZVNiEnfhz6CXRtE8xg==","prohibited_claims":["ux-outcome","wcag-conformance","user-success","complete-destructive-flow"],"provider_namespace":"https://hulianui.com/mcp","repository_commit":"c2a76dabf5801f275ddf4aca16b9e63ce2d4d372","request":{"format":"json","name":"alert-dialog","sections":["props","events","slots"]},"server_package":"@hulianui/mcp","server_version":"0.10.0","source_artifact":{"path":"apps/www/public/llms-props.json","sha256":"729bace87b8ba5639971263d23ef6d729b803acbb4559868366e109af56168b5","version":"0.52.0"},"tool_name":"get_component_doc"}
~~~

adapter_contract_digest（JCS SHA-256）固定为 f297ea75545ceefa627a4d977d528ec7e48be736f6e9015c07cda2444e0deb8c。

来源固定：hulianui/hulian commit c2a76dabf5801f275ddf4aca16b9e63ce2d4d372；@hulianui/mcp 0.10.0；UI artifact 0.52.0；llms-props SHA-256 729bace87b8ba5639971263d23ef6d729b803acbb4559868366e109af56168b5。

MCP 没有 outputSchema，adapter 必须用自有 hulian-component-doc-v1 schema 验证 structuredContent。状态 classifier 按下列顺序首个命中，后序分支必须排除前序：

1. structuredContent 可解析但 source artifact version/digest 不匹配 pinned row → incompatible_source + tool_failed；
2. isError=false、schema valid、恰一 component、slug/name/category 与 source 匹配，且 (missing 非空 OR versionSkew!=null OR stale=true OR fallbacks 非空) → partial；
3. isError=false、schema valid、恰一 component、slug/name/category 与 source 匹配，且 missing 不存在或空、versionSkew=null、stale=false 或缺失、fallbacks 空 → success；
4. isError=true、无 structuredContent、首个 text 以“没有名为”开头 → not_found；
5. 其他 isError/schema/identity failure → server_error/tool_failed。

CanonicalAdapterEvidence 只保留 component identity、import、exports、props、events、slots、source artifact identity。exports 是 canonical-set<string>，key=字符串值；props/events/slots 各自是 canonical-set，key=(owner,name,kind)，均按第 12.3 节排序/去重，且不跨 props/slots 合并。字段 required 缺失保持 unknown，不能推断 optional。Transport text、origin、TTL、request time 进入 audit sidecar。

该 evidence 只支持 implementation_candidate Claim；禁止推出 UX outcome、WCAG conformance、user success 或完整 destructive flow。local captured fixture 与 MCP response 经上述映射必须 byte-equal；fixture 及 adapter schema bytes/digest 进入 ADAPTER-HULIAN-ALERT-001。

## 14. Canonical ustar v1

发布未压缩 .tar。输入路径必须满足 CanonicalRelativePath 且 UTF-8 bytes<=100；只允许 regular file，不写目录项，不用 prefix/long-name/PAX/link/xattr。

每个 512-byte header：name=NFC path+NUL padding；mode=ASCII 0000644+NUL；uid/gid=0000000+NUL；size=11位octal+NUL；mtime=00000000000+NUL；checksum 计算时8空格，写6位octal+NUL+space；typeflag ASCII 0；magic ustar+NUL；version 00；其余 linkname/uname/gname/dev/prefix/pad 全 NUL。checksum 用 unsigned bytes。

文件按 path UTF-8 bytes 升序，原 content 后 NUL padding 至512；结尾恰好2个零 block。size 超限拒绝。reference packer 逐字节实现本算法，不调用 system tar。

internal manifest 不含 artifact digest；artifact.sha256 sidecar 独立。ART-ONEFILE-001 固定完整 base64、byte length 和 DigestRegistry artifact digest；两干净环境必须逐字节匹配。

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




## 17. Research guard 与状态

ResearchAuthorizationDecision 必须引用当前 protocol digest、有效 EthicsReview/exempt/waiver authority、organization recruitment/data/channel AuthorizationDecision、purpose/data/participant scope 和有效区间。缺失默认 blocked。

Participant Consent/Assent/RepresentativeConsent 逐主体绑定 protocol/information digest、理解方法、scope/time/withdrawal channel。

evaluator 必须为每个 participant 派生 ParticipantPermissionRequirement：participant_id、requirement=consent|assent_and_representative|representative_only|waiver、applicable SourceAssertion ids、EthicsReviewDecision id、protocol digest、derivation_status=verified|rejected|unknown。requirement 只能由适用政策、有效 EthicsReviewDecision 和当前 protocol/population 共同派生，protocol 作者不能自报。derivation 缺失、冲突、rejected/unknown，或 requirement 对应 artifact 不完整/过期，固定 blocked。waiver 只有有权主体的有效 waiver decision 才是 verified。

ResearchActivity 状态：proposed→blocked/approved；approved→active 仅当 authorization、operational authority、全部 ParticipantPermissionRequirement=verified 且所需 permission artifacts 全有效；active→stopped/completed。revocation、expiry、protocol change、distress/adverse event、applicable withdrawal 触发 monotonic stopped。

所有研究收集/干预的 ExecutionEnvelope 必填 research_guard_digest，覆盖 activity/protocol、ResearchAuthorization、Ethics/waiver、operational Authorization、participant consent set、withdrawal epoch 和 stop epoch。effect composite guard 在 commit 时原子重验这些 version/status；任一变化零副作用并返回 RESEARCH_GUARD_STALE/BLOCKED。外部研究 effect 的 commit 定义为 receiver-side state transition，不是本地 outbox commit；receiver 必须在同一原子操作中向 authoritative guard ledger 验证 research_guard_digest 与 withdrawal/stop fencing epoch。receiver 不支持该契约、ledger unreachable 或 epoch mismatch 固定 no effect+escalation。

Withdrawal 立即阻止后续收集/干预，并按 protocol/policy形成已收集数据的 retention/deletion DecisionRecord。Agent 不自行判 exempt/waiver，不把特定法域制度当全球默认义务。

## 18. Normative RED/golden、holdout 与真实回归

### 18.1 Vector contract

每个 vector 固定 behavior_version、input_jcs/input_digest、expected normalized errors、Tool results、RuleEvaluations、Findings/RunIssues、RunStatus、semantic projection/digest、trace digest；artifact vector 另有 raw bytes/base64/length/artifact digest。同一 behavior version 内不可修改；行为变化创建新 vector id，旧 vector 永久保留。

最低唯一预期：

| vector | 唯一预期 |
|---|---|
| AST-APP-FE-001 | applicability=F、exclusion=E，RuleEvaluation=evaluation_error，RunStatus=failed |
| AST-OBJECT-EQ-001 | object 参与 eq，normalized error=TYPE_MISMATCH，rule 不执行 |
| FIND-INC-001 | release-critical unknown 发射 escalation/RELEASE_CRITICAL_UNKNOWN；noncritical unknown 发射 unknown/RULE_UNKNOWN |
| EMISSION-REASON-001 | 每个 Finding 仅使用第 10 节表中唯一 reason_code；不匹配即 FINDING_REASON_INVALID |
| BUNDLE-DUP-001 | 同 id 不同 JCS → DUPLICATE_ID_CONFLICT |
| ERROR-UNION-001 | 同时触发 required/type/semantic 三类错误，仅输出规范化集合并按 ErrorCollectionRegistry 排序 |
| OUTPUT-ORDER-001 | 输入排列与工具完成顺序改变，所有输出 collection JCS 与 digest 不变 |
| STATE-DEP-TIMEOUT-001 | 依赖 rule=evaluation_error+escalation，独立 rule=pass，RunStatus=failed |
| TOOL-PARTIAL-001 | partial tool result 映射为第 11 节唯一 terminal state；依赖规则按表映射，不由 adapter 自选 |
| TOOL-MULTI-CANCEL-TIMEOUT-001 | 同一 rule 的 required dependencies 同时 cancelled+timeout → tool_failed/evaluation_error/REQUIRED_TOOL_TIMEOUT |
| ACT-IMPERSONATE-001 | ActingEdge basis 已证实不存在 → block |
| ACT-BASIS-U-001 | ActingEdge basis validity unknown → escalation |
| ACT-DISJOINT-001 | 两条各自有效但端点不连续的 ActingEdge → block |
| AUTH-ROOT-001 | 自签或已证实未在 AuthorityRootRegistry 的根 → AUTHORITY_ROOT_UNTRUSTED + block |
| CONTROL-CLOSURE-001 | shared final control principal → not_separated + block |
| SOD-UNKNOWN-001 | required SoD 的 control closure 断边/环/不完整 → escalation，不按风险改变 |
| TENANT-JOIN-001 | required target/controller scope 已证实任一不覆盖 → block |
| TENANT-UNKNOWN-001 | 任一 required tenant binding/closure/conflict unknown → escalation，不按 impact 分叉 |
| GRANT-PARENT-REVOKED-001 | ancestor revoked → block |
| LINEAGE-TOMBSTONE-001 | invalidation tombstone 后旧 lineage 即使重放 valid grant 也不得复活 |
| ENVELOPE-H1-H2-001 | approval/authorization/effect digest 不同 → no effect + escalation |
| ENVELOPE-DIGEST-001 | 固定 body 的 ExecutionEnvelope id 必须等于第 5 节公式 golden digest |
| APPROVAL-RACE-001 | 两 worker 仅一笔 atomic consume/effect |
| APPROVAL-DUP-VOTE-001 | 同一 approver 的两条 Decision 在 quorum=2 时只计一票 → block |
| SOD-COMMIT-CHANGE-001 | evaluation 时 separated、commit 前 control closure 变为 shared principal → commit 重算 not_separated + no effect/block |
| PARTY-COMMIT-CHANGE-001 | commit 前 party/effect graph 新增 affected party → 旧 inventory invalidated，重新派生 incomplete/unknown + no effect/escalation |
| PARTY-COMPLETENESS-PROOF-001 | finite graph snapshot 无 verified completeness proof → PartyInventory=unknown + escalation |
| EFFECT-ACK-LOST-001 | receiver 已执行但 ack 丢失；fresh recover capability 对同 envelope_digest 查询/重发不重复 effect；无法证明则 unknown_effect + escalation |
| EFFECT-LEASE-NOT-TIME-001 | lease=[10:00,10:20) 不能提供 current time；commit 必须读取 policy-selected time authority，读不到 → no effect/escalation |
| EFFECT-TIME-AUTH-CONFLICT-001 | 两个可信 time readings 但不符合 envelope time_authority_policy 唯一选择 → no effect/escalation |
| RESEARCH-RECEIVER-WITHDRAW-001 | outbox 后 withdrawal epoch 增加；receiver 原子 fence 拒绝旧 research_guard → no external intervention |
| CAP-REPLAY-001 | channel/session/nonce 变化 → block |
| CAP-FORGE-001 | payload 可解析但签名/MAC 错误或 ledger 不存在 → block |
| CAP-USE-PURPOSE-001 | authorization_purpose=account_deletion 与 capability_use=execute/recover 分字段进入 digest，不发生同名冲突 |
| PARTY-UNKNOWN-001 | high impact + inventory unknown → escalation |
| PARTY-MEDIUM-UNKNOWN-001 | medium human effect + derived PartyInventory 不完整 → escalation |
| HARD-UNSAT-001 | 非法律/权利/高风险的 mandatory fail 导致 zero feasible → no selection + 全部 minimal unsat cores + block |
| HARD-UNSAT-RIGHTS-001 | 法律、权利或高风险冲突导致 zero feasible → no selection + 全部 minimal unsat cores + escalation |
| HARD-U-001 | 任一 hard constraint=U → candidate 不进入 feasible set + escalation |
| HARD-FU-MIXED-001 | zero feasible 且 candidate 集合含 F 与 U、无 E → 全局 U 分支 + escalation |
| HARD-FEASIBLE-U-001 | 至少一个 feasible 且另一个 candidate=U → no final selection + escalation |
| SOFT-TIE-001 | PartyInventory/authority 完整且未触及 floor 的 Pareto tie → SelectionDecision=undecided + ReleaseRecommendation=undecided + ask_decision_owner |
| SOFT-TIE-AUTH-U-001 | PartyInventory/authority 不完整的 Pareto tie → SelectionDecision=undecided + ReleaseRecommendation=escalation |
| SOURCE-PROP-001 | Fragment proposition 没有 verified FragmentPropositionAssessment → 不得形成有效 Adoption/authority |
| TIME-EFFECTIVE-001 | 同一 evaluation_effective_at 驱动纯评价中的 source/adoption/grant/consent/capability；混用 wall clock → TIME_BASIS_MISMATCH |
| EFFECT-TIME-EXPIRY-001 | evaluation 10:00、授权 10:05 过期、trusted commit_effective_at=10:10 → no effect + block |
| CLAIM-FAKE-RCT-001 | claimed randomized 但 execution mismatch → ClaimAssessment.status=unresolved |
| CLAIM-DOWNGRADE-001 | causal/predictive claim 未满足对应门槛 → 按第 8 节唯一降级，不保留原强度 |
| GRADE-POLICY-001 | 固定 assessments 只得到一个 EvidenceGrade；禁止 associational/descriptive 二选一文本 |
| EVIDENCE-DUP-001 | same dependency cluster 不增加 grade |
| SIGNAL-MATERIAL-PROHIBITED-001 | sensitive+material reliance+verified applicable prohibition/mandatory fail → block/completed_blocked |
| SIGNAL-MATERIAL-NO-PROHIBITION-001 | sensitive+material reliance 且 prohibition verified false 或 applicability unknown → escalation/completed_escalated |
| SIGNAL-DEFAULT-001 | signal 缺少 registry row 时采用第 8 节默认矩阵，不能 adapter 自定义 |
| REC-WEAK-001 | insufficient grade → ResearchQuestion only |
| REC-HIGH-PREDICTIVE-001 | high predictive、authority neutral、risk clear、reversible → conditional_advice |
| REC-HIGH-CAUSAL-001 | high causal、authority neutral、risk clear、reversible → strong_advice |
| REC-HIGH-NORMATIVE-001 | high normative+assessed predicate 精确蕴含 exact requires action、risk clear、reversible → required |
| REC-HIGH-NORMATIVE-NONENTAIL-001 | high normative 但不精确蕴含 action、其余 clear → conditional_advice |
| REC-REDUCER-001 | 多个 ceiling 同时命中时只取 strength ordering 的 min；hard block 产生 no recommendation |
| REC-UNRESOLVED-LIMITED-001 | conclusion=unresolved+overall=limited → evidence 表首行 none |
| REC-REVERSIBILITY-U-MANDATORY-001 | reversibility=unknown+exact mandatory action → reversibility 表首个命中 explore |
| RELEASE-NO-CONDITION-001 | 所有 gate clear 且 ResidualConditionSet 空 → allow |
| RELEASE-VERIFIED-CONDITION-001 | 所有 gate clear 且非空 conditions 全 verified_executable → allow_with_conditions |
| RELEASE-SOFT-TIE-001 | gates clear 但 soft selection=undecided → undecided+ask_decision_owner |
| HOLDOUT-MISSING-001 | current generation holdout missing/failed/exhausted/contaminated → no_release |
| RESEARCH-NO-AUTH-001 | complete low-risk protocol but no authorization → blocked |
| RESEARCH-MINOR-ASSENT-001 | requirement=assent_and_representative、仅 representative consent valid、无 waiver → blocked |
| RESEARCH-WITHDRAW-RACE-001 | withdrawal 与 effect 并发；research_guard_digest 原子复验失败 → no effect |
| INQUIRY-NO-AUTH-001 | InquiryDraft 文本无论措辞多肯定都不能进入 Finding、Recommendation、authorization 或 release gate |
| PROJ-VOLATILE-001 | transport time/message excluded；business expiry retained |
| PROJECTION-TRACE-001 | SemanticProjection 缺 registry 指定的 trace 关系 → PROJECTION_TRACE_INCOMPLETE |
| FINDING-FINGERPRINT-001 | 第 10 节固定 object 的 JCS/full digest/finding_id 与 golden 完全一致 |
| SET-UTF8-ORDER-001 | keys U+E000 与 U+10000 按 UTF8(JCS(key)) unsigned bytes 排序，host UTF-16 order 不得进入输出 |
| EVALUATOR-DIGEST-001 | 固定 evaluator logical files/manifests 只得到第 12 节 evaluator_digest golden |
| VALID-UNICODE-001 | NFC 通过，非 NFC → UNICODE_NOT_NFC |
| PATH-DOUBLE-SLASH-001 | double slash、dot segment、反斜杠或 percent-encoded separator → PATH_INVALID |
| ADAPTER-TRANSPORT-001 | canonical evidence equal，audit sidecar different |
| ADAPTER-HULIAN-ALERT-001 | 固定 HulianUI JCS row digest=f297ea75545ceefa627a4d977d528ec7e48be736f6e9015c07cda2444e0deb8c；request/result 只形成 component/import/exports/props/events/slots evidence，不形成 prohibited claims |
| ADAPTER-EXPORTS-ORDER-001 | provider exports 逆序输入 → canonical-set<string> 排序/去重后的唯一 bytes |
| ADAPTER-MISMATCH-PARTIAL-001 | artifact mismatch+stale=true 同时存在 → first-match incompatible_source/tool_failed |
| ADAPTER-STALE-FALSE-001 | source match+stale=false+其他完整 → success，不因字段存在判 partial |
| SEMANTIC-MEMBER-DIGEST-001 | 固定 projected member 的 before/after digest 只用 semantic-member domain golden |
| REGRESSION-DELTA-DERIVED-001 | 移除一个 Finding 时 run_status/input_digest/semantic_digest 按第 18.5 derived closure 复算，oracle 不报未声明差异 |
| REGRESSION-BUNDLE-DRIFT-001 | 未在 bundle_delta_allowlist 的 adapter evidence 变化 → REGRESSION_UNEXPLAINED，不能被 input_digest derived closure 吞掉 |
| REGRESSION-NEGCONTROL-001 | negative control 缺失 → gate=missing/not_increase；超阈值 → gate=failed、identification rejected、decision_required |
| REGRESSION-NEGCONTROL-ABS-001 | observed_delta=-0.1、transform=absolute、upper=0.05 inclusive → gate=failed |
| RW-BRAND-NOT-AUTHORITY-001 | 仅给出“Apple 是知名品牌/设计标杆”，没有 case evidence → 不生成 SourceAssertion、ClaimAssessment 提升、正向 Finding 或 Recommendation |
| RW-SNAPSHOT-DRIFT-001 | SnapshotClosureManifest 任一 captured response header/body/observation bytes digest 不符，或 replay 出现未登记 network event → target_unavailable+RunIssue+no_release；不得改读 live page、沿用旧结论或把漂移判作 UX 回归 |
| RW-SNAPSHOT-HEADERS-001 | 固定 HTML/script bodies；capture header 含 CSP script-src 'none'；replay 必须从 header CAS 恢复同一 CanonicalResponseHeaders，遗漏/改写 CSP → target_unavailable+no_release，不能产生第二个 DOM/Finding |
| RW-REPLAY-PROFILE-001 | 同一 Apple step 的 desktop keyboard/no-preference、desktop keyboard/reduce、mobile touch/no-preference 三个 exact replay_profile_id 不可由 ordinal 或执行顺序互换；缺失/错引 → REF_MISSING 或 INVARIANT_REPLAY_PROFILE_COVERAGE |
| RW-SNAPSHOT-SCHEMA-CLOSED-001 | redirect hop 或 observation item 加 note 属性 → 唯一 normalized error=ADDITIONAL_PROPERTY；CanonicalResponseHeaders={} → 唯一 normalized error=REQUIRED_MISSING(/headers)；未知/缺失字段不得进入 closure digest |
| RW-BLACKBOX-EFFECT-001 | task_script 试图登录、加入购物车、提交表单、调用真实 API 或进入 checkout → prohibited_effect+no effect+completed_blocked |
| RW-ROTATION-SELECT-001 | exact ids 按 UTF8(JCS(id)) 排序为 [RW-DOCS-STRIPE-001,RW-WEBSITE-IKEA-001]；generation_sequence=0/1 唯一选择 STRIPE/IKEA，输入次序不改变选择 |
| RW-ROTATION-DIGEST-001 | generation_commitment=64 个 0、generation_id=gen-000、sequence=0、portfolio=real-world-portfolio-v1 的第 18.3 节正规形 preimage 唯一产生 manifest_digest=e01f97c0db9a39b9bd3f61c187ce9892a962a953328eb3cdac67658974a3bfcd |
| RW-ROTATION-SKIP-001 | current generation 未运行预提交 selected_case_id、运行非所选 case 或所选目标 unavailable → HoldoutReleaseGate=no_release，不得临时替换 |
| RW-CROSS-SITE-RANK-001 | Apple/IKEA/Stripe 的异构任务 measure 不可聚合为跨站总分、排行榜或“谁的 UX 最好”；只允许 within-case baseline/candidate delta |
| SCENARIO-FAMILY-REGISTRY-001 | 第 4 节 exact 8 ids 的 JCS preimage 唯一产生 registry digest=b764d922bd94ceb6869cd60984261acae344cd0a5e21c1cc9970cff710e417d0；缺失、额外或自由文本 alias 均 invalid |
| KNOWLEDGE-ONEFILE-001 | preimage=[{"file_digest":"0000000000000000000000000000000000000000000000000000000000000000","path":"a"}]；knowledge digest=d9262071a41bf6991251f5cf572e8ba14d73b3ef7cc023b15887899c1d9b9c9a |
| DELTA-REPLACE-NORMAL-001 | 同 locator d0→d1 只编码一个 replace；remove+add 非正规输入 |
| ART-ONEFILE-001 | exact uncompressed ustar raw bytes/base64/length/digest |

实现前先运行无 evaluator/无 Skill baseline，保存失败的 machine-readable 输出；GREEN 不得改 vector、expected 或 oracle。错误信息文字不参与 oracle，error code、JSON Pointer、collection order 和 digest 参与。

### 18.2 Holdout

custodian 使用私有 secret 对 canonical case bytes 计算 HMAC-SHA-256；repo 只存 commitment、strata 和 generation id。每个 preregistered artifact digest 对每一 generation 只允许一次查询。返回仅含 overall gate pass/fail 和预注册 aggregate metrics，不返回 case/stratum id、错误文本或新指标。

第二次查询固定 QUERY_BUDGET_EXHAUSTED。任何 case-level access、secret 泄漏或基于结果调整都污染 generation；下一 artifact 必须使用新 generation。behavior version 改变必换 generation。

### 18.3 RealWorldRegressionCase

RealWorldRegressionCase 必须含：

- case_id、scenario_profile_id、request_mode；
- target_kind=black_box_site|pinned_repository|hulianui_contract；
- canonical locator、immutable ref 或 snapshot_closure_digest；black_box_site 必须是 snapshot_closure_digest，其他两类不得伪装成 snapshot；
- task_script、entry_state、seed_state、actor/party inventory、allowed_effects、prohibited_effects；
- EvidenceCapability 声明：page/content、runtime、code、component-contract、research 中哪些可用；
- baseline_bundle_digest、intervention_manifest_digest、candidate_bundle_digest；
- preregistered hypotheses、至少一个 disconfirming/negative-control intervention、success/guardrail measures、SemanticDelta-v1 和 forbidden claims；
- replay_oracle=semantic-delta-v1、environment digest、outbound-effect sink、cleanup contract。

black_box_site 必须提供 SnapshotClosureManifest，不能只固定首页。SnapshotClosureManifest additionalProperties=false，必填 closure_version=snapshot-closure-v1、entry_url、task_script_digest、capture_environment_digest、captured_at、authenticated=false、replay_profiles、network_records、observation_records、outbound_effect_ledger_digest、completeness_status=complete|incomplete、manifest_digest。manifest_digest 只用第 12.5 节 snapshot-closure row。

ReplayProfile additionalProperties=false，所有字段必填：replay_profile_id、viewport_width_css_px、viewport_height_css_px、device_scale_factor、input_modality=keyboard|pointer|touch、prefers_reduced_motion=reduce|no-preference、prefers_contrast=no-preference|more|less|custom、color_scheme=light|dark、locale、timezone、assistive_technology_id、browser_engine_digest。replay_profiles 是以 replay_profile_id 为 key 的 canonical-set。task_script 的每个 step 必填 step_id 与 required_replay_profile_ids canonical-set；每个 id 必须引用 manifest profile。Apple case v0.1 固定三项：apple-desktop-keyboard-standard=(1440,900,2,keyboard,no-preference)、apple-desktop-keyboard-reduced=(1440,900,2,keyboard,reduce)、apple-mobile-touch-standard=(390,844,3,touch,no-preference)；三者其余字段固定为 zh-CN、Asia/Shanghai、no-preference contrast、light、assistive_technology_id=none 及同一 pinned browser_engine_digest。

CanonicalResponseHeaders additionalProperties=false，headers 是唯一字段且必填，值为 ordered-list（允许空 list，但不得缺失）；每个 header item additionalProperties=false，必填从 0 连续的 sequence、name_lower_ascii、value_bytes_base64。重复 header 保留捕获顺序，名称转 ASCII lowercase，值不转码；artifact bytes=UTF8(JCS(CanonicalResponseHeaders))，header_digest=SHA-256(artifact bytes)，content_addressed_header_artifact_locator 必须取回完全相同 bytes。访问/许可策略可使 header artifact 非公开，但 evaluator 必须获授权取回；无法取回或校验即 target_unavailable。replay 必须按 captured status 与全部 header items 恢复，不能忽略 CSP、Location、Content-Language、Set-Cookie 等会改变行为的字段。

network_records 是 canonical-set，key=[replay_profile_id,sequence]，每个 profile 内 sequence 从 0 连续。每个 network item additionalProperties=false，必填 replay_profile_id、sequence、task_step_id、request_method=GET|HEAD、request_url、redirect_chain、final_url、network_kind=document|script|style|image|font|xhr|fetch|other、disposition=captured|blocked_by_policy、response_status|null、header_digest|null、content_addressed_header_artifact_locator|null、raw_body_digest|null、content_addressed_body_artifact_locator|null。captured 的 status/header/body/digest/两个 locator 均非 null 且两个 locator 取回 bytes 必须匹配 digest；blocked_by_policy 的上述五项必须全为 null。redirect_chain 是 ordered-list，每个 hop additionalProperties=false，必填连续 sequence、status、url、location、header_digest、content_addressed_header_artifact_locator，并按同一 CanonicalResponseHeaders 规则取回和恢复。任何非 GET/HEAD 请求、SSE/WebSocket、未登记 request/redirect/response、取不回 header/body bytes、digest mismatch 或浏览器读取 live network 都使 completeness_status=incomplete。

observation_records 是 canonical-set；每个 item additionalProperties=false，所有字段必填，key=[replay_profile_id,task_step_id,evidence_kind,ordinal]；evidence_kind=screenshot|dom_snapshot|accessibility_tree|interaction_trace|performance_trace|content_extract，每项固定 replay_profile_id、task_step_id、evidence_kind、ordinal、artifact_digest、content_addressed_artifact_locator。每个 task step 与每个 required_replay_profile_id 的预注册所需 observation 必须存在，否则 INVARIANT_REPLAY_PROFILE_COVERAGE。replay 只从 closure 返回 captured header/body bytes或重现 blocked_by_policy，不执行 live network；任何 miss 固定 target_unavailable+RunIssue+no_release。这样冻结的是固定 task/seed/profile 实际触达的页面、子资源、重定向和动态响应闭包，不是所有潜在分支，也不声称第三方站点永久不变。

pinned_repository 固定 owner/repo、commit、license、build/run recipe digest、seed digest；branch 名只能作说明，不能作 ref。

每个 case 另含 portfolio_role=fixed_anchor|rotation_candidate、scenario_stratum 和 comparison_policy=within_case_only。fixed_anchor 用于同一任务的纵向可比性；rotation_candidate 用于检测对固定案例的过拟合。品牌声誉、获奖、流行度、视觉风格相似度和第三方“最佳网站”名单都不是 EvidenceArtifact，也不得提高 EvidenceGrade、Finding 严重度或 Recommendation strength。不同 case 的任务、主体与 measure 不同，禁止跨站总分、排行榜和“谁的 UX 最好”结论。

RotationSelectionManifest additionalProperties=false，必填 portfolio_version、generation_id、generation_sequence、generation_commitment、sorted_candidate_case_ids、selected_case_id、manifest_digest。manifest_digest 只按第 12.5 节 rotation-selection row 计算。candidate ids 来自该 portfolio_version registry，按 UTF8(JCS(id)) unsigned bytes 排序，N>0，selected index=generation_sequence mod N；selected_case_id 必须等于该项。generation_sequence 是 holdout custodian 在 generation_commitment 中预先绑定的单调递增整数；generation commitment 必须先于 candidate artifact digest 注册，custodian 在 overall gate 中复验 commitment、sequence、pool 和选择。验证失败或同 generation 变化一律 no_release。所选目标 unavailable、未运行或改跑其他 case 同样 no_release；不得临时替换。pool 变化创建新 portfolio_version，旧 manifest 保留。

RW-ROTATION-DIGEST-001 的 JCS preimage 固定为：

~~~json
{"generation_commitment":"0000000000000000000000000000000000000000000000000000000000000000","generation_id":"gen-000","generation_sequence":0,"portfolio_version":"real-world-portfolio-v1","selected_case_id":"RW-DOCS-STRIPE-001","sorted_candidate_case_ids":["RW-DOCS-STRIPE-001","RW-WEBSITE-IKEA-001"]}
~~~

证据边界是硬约束：

| 可用证据 | 可以支持 | 不能支持 |
|---|---|---|
| 公开页面 snapshot closure | 闭包中当时可观察的内容、结构、入口和已捕获只读交互行为 | 闭包外页面/网络、源码事实、完整生产旅程、真实用户结果、WCAG conformant |
| 固定仓库源码 | 该 commit 的实现结构和静态路径 | 已部署行为、用户成功、生产数据 |
| 隔离运行态 | 固定环境内观测到的任务行为 | 其他部署、长期结果、代表性人群效果 |
| HulianUI component contract | 第 13 节固定 scope | 产品旅程完成、可访问性合规、UX outcome |
| preregistered research | 对应 StudyExecution/Analysis/Assessment 支持的 claim | 超出样本、方法和时间边界的结论 |

intervention hypothesis 永远不是 evidence。black_box_site 默认 read-only，不提交表单、不创建账号、不采集敏感信息；pinned_repository 只在隔离环境修改派生副本，第三方 upstream 不写入。

### 18.4 首批真实目标注册表

以下 ref 是 v0.1 的发现基线；正式运行仍要生成完整 RegressionCase、可取回 SnapshotClosureManifest 与环境 digest。2026-08-18 的 curl 摘要只证明当次公开响应，不是正式可复放 snapshot_artifact。任务均从匿名、无个人数据 seed 开始。

| case_id / 场景 / role | 固定目标 | 无副作用任务 | 预注册 UX 假设 | 证据与回归边界 |
|---|---|---|---|---|
| RW-WEBSITE-GOVUK-001 / 公共服务官网 / fixed_anchor / public-service-information | https://www.gov.uk/register-to-vote；captured_at=2026-08-18T04:49:40Z；HTML SHA-256=411fa11837c5ba87f7aed35903ca7fa5d0a47048709930448466394d69393a3c | 判断用途、资格分支、所需材料、预计耗时、线上入口与纸质/求助替代；不进入提交 | 信息架构可能帮助用户在开始前形成正确预期；是否对不同资格人群同样成立必须转 Inquiry | black-box page/content only；不得声称完整登记旅程、代码事实或用户成功 |
| RW-WEBSITE-APPLE-001 / 品牌与产品决策官网 / fixed_anchor / brand-marketing-website | https://www.apple.com.cn/；discovery capture_started_at=2026-08-18T06:03:22Z；HTTP 200；HTML SHA-256=f853dfb57dd9305aa5656f604e91f96974b152a3d2fa88dc3ed763eaec07ecfb | 从首页找到 iPhone 产品族，说明至少两个可观察的选择因素，找到比较、购买与支持路径；以 apple-desktop-keyboard-standard、apple-desktop-keyboard-reduced、apple-mobile-touch-standard 三个 exact replay_profile_id 复放；停在 checkout/login/form 前 | 渐进叙事、导航和产品比较入口可能帮助形成购买选择；动效、信息密度和路径命名也可能造成理解或操作成本，必须由任务证据判定 | black-box page/content+read-only runtime；Apple 声誉不是证据；不得声称真实购买成功、总体满意、源码事实或 WCAG conformant |
| RW-ADMIN-APPSMITH-001 / Admin 与内部工具 / fixed_anchor / admin-internal-tool | appsmithorg/appsmith@03266b555b5451e91614840ec5b2577538bd8e6e，Apache-2.0 | 在固定 seed 的隔离实例创建内部 CRUD 页面、连接 sample datasource、配置表格与表单、预览并恢复一次输入错误；禁用外发连接 | 数据绑定与编辑/预览上下文切换可能影响可发现性、错误恢复和效率 | code+isolated runtime；初次 baseline 不改 upstream；候选干预只在派生副本 |
| RW-TRANSACTION-CAL-001 / 消费者交易流程 / fixed_anchor / consumer-transaction | calcom/cal.diy@176037d0afbe572f870a3c702985e7cd83fe6c0c，MIT | 在固定时区/日历 seed 选择 30 分钟时段、识别时区、处理时段冲突并取消；邮件/日历写入只到 fake sink | 时区可见性和冲突恢复可能降低误订与回退成本；需任务证据验证 | code+isolated runtime；零真实邀请、零真实日历/支付 effect |
| RW-HULIAN-DELETE-001 / HulianUI 迁移目标 / fixed_anchor / admin-internal-tool | 第 13 节 adapter_contract_id=hulianui.get-component-doc.alert-dialog.v1；row digest=f297ea75545ceefa627a4d977d528ec7e48be736f6e9015c07cda2444e0deb8c | 把一个高风险 Admin 删除审批场景映射为 AlertDialog candidate，保留标题、说明、确认/取消、busy/error/retry、keyboard/focus requirements | 组件 contract 只能证明候选能力，完整安全体验取决于产品流、状态与运行验证 | component contract + 后续隔离 harness；不得用组件存在推导 flow complete 或 WCAG conformant |
| RW-WEBSITE-IKEA-001 / 零售商品发现 / rotation_candidate / retail-commerce-discovery | https://www.ikea.cn/cn/zh/；discovery capture_started_at=2026-08-18T06:03:22Z；HTTP 200；HTML SHA-256=fb9bcdb69f2c7f90bb5db9b03bee0507e50b17c2ec8752fe593989bbd31428d8 | 在固定“中国/北京、匿名、拒绝定位”seed 下查找宽度不超过 120cm、价格不超过 ¥1500 的书桌，比较两个候选并识别配送/库存信息；不登录、不加购、不结算 | 搜索、筛选、比较和履约信息可能支持约束型选择；库存地域依赖和过滤反馈也可能增加不确定性 | black-box page/content+read-only runtime；价格/库存仅属于快照时点；不得推断实际可配送或购买成功 |
| RW-DOCS-STRIPE-001 / 开发者文档 / rotation_candidate / developer-documentation | https://docs.stripe.com/；discovery capture_started_at=2026-08-18T06:03:22Z；HTTP 200；HTML SHA-256=19c3a909d2be6d6336a73679b6370a15aa8b2b1d33ef1f7ad08b603b9d9e45b7 | 从文档首页定位服务端支付集成路径、前置条件、失败/恢复说明和对应 API reference；不登录、不创建 key、不调用 API | 信息气味、概念分层和示例到 reference 的路径可能降低实现成本；是否能完成真实集成必须由独立隔离任务验证 | black-box page/content+read-only runtime；动态 HTML 漂移即新 snapshot；不得声称 API 可用、实现正确或开发者成功 |

fixed_anchor 不是“金标准”，也不预写正负 Finding。portfolio_version=real-world-portfolio-v1 的 rotation candidate exact ids 为 RW-DOCS-STRIPE-001、RW-WEBSITE-IKEA-001；按 UTF8(JCS(id)) 排序也恰为此顺序，由 RotationSelectionManifest 每 generation 唯一选择一例。若任一目标更新，旧 case/ref 保留，新建 case version；不得移动 ref 或替换 snapshot 后继续沿用 baseline。

### 18.5 Baseline → intervention → verify

每个真实 case 按同一顺序执行：

1. **Baseline**：冻结 bundle、环境、工具结果与制品；运行 scan；保存 Assurance、Inquiry、semantic projection、截图/trace sidecar。
2. **Hypothesis**：从 assessed Claims 和 Inquiry 选择一个可证伪假设，预注册 intended delta、guardrail、stop rule 和至少一个 NegativeControlGateSpec。
3. **Intervention**：仅对允许修改的派生副本记录 changeset digest 与 canonical bundle_delta_allowlist；black-box 目标只可制作独立原型，不伪称修改原站。
4. **Verify**：同 behavior_version、同任务、同 seed、同 actor/party inventory 和等价环境复测主 intervention，并执行每个预注册 negative control；结果全部作为 Evidence/StudyExecution/AnalysisExecution 进入 candidate bundle 和 ClaimAssessment。
5. **Compare**：先校验 normalized bundle diff，再输出 semantic projection diff、task measure diff、negative-control diff、visual/runtime evidence diff、新增/消失 Finding 及证据链。
6. **Decision**：只有所有 negative control 已执行且均在预注册 threshold 内、主 measure 达标、无新 release-critical Finding、guardrail 未退化且 effect ledger 干净时，RecommendationAssessment 才可提高。negative control 缺失时 gate=missing、recommendation_delta=not_increase；超阈值时 gate=failed、identification_check=rejected、recommendation_delta=not_increase、intervention_disposition=decision_required。retain/revise/rollback 仅作为 DecisionOwner 的 canonical alternatives，evaluator 不自选。

CanonicalDeltaOperationV1 additionalProperties=false。locator 是 tagged union：set_member={collection_name,key_jcs}；singleton={field_name}，field_name 只能来自 registry，禁止 array index/任意 JSON Pointer。operation-set 的唯一 key=JCS(locator)，每个 locator 恰一项。正规形唯一：before only→remove(before_digest)；after only→add(after_digest)；两侧存在且 digest 不同→replace(before_digest,after_digest)；digest 相同→无 operation。SemanticDelta-v1 与 intervention manifest.bundle_delta_allowlist 都只允许此 canonical-set normal form；actual 与 preregistered operations 按 canonical bytes 精确比较。semantic member digest 用 semantic-member row，bundle member digest 用 input-member row。

NegativeControlGateSpec additionalProperties=false，必填 control_id、metric_id、transform=signed|absolute、unit、scale_id、lower_bound|null、upper_bound|null、lower_inclusive、upper_inclusive；至少一个 bound 非 null，双 bound 时 lower<=upper。observed_delta 先按相同 unit/scale 归一，再应用 transform；结果逐 bound 用对应 inclusive flag 比较，全部满足才 gate=passed，否则 failed。任何 unit/scale/值/边界 invalid 或 unknown 固定 gate=unknown，recommendation 不提高并 escalation。

oracle 首先按 InputCollectionRegistry 对 baseline/candidate normalized bundle 作 (collection,key_jcs) diff；每项必须被 intervention manifest.bundle_delta_allowlist 精确覆盖，member digest 只用 input-member row，否则 REGRESSION_UNEXPLAINED。通过后才比较 SemanticProjection 非派生字段并计算唯一 derived closure：input_digest 由 candidate bundle 复算；run_status 由 candidate RuleEvaluation/Finding/RunIssue/decision 复算；所有对象内在 id/digest 随其 owner entry 一起变化；semantic_digest 从比较中排除后按 candidate projection 复算。behavior_version 与 evaluator_digest 必须 byte-equal。除 operations 与该 derived closure 外的变化固定 REGRESSION_UNEXPLAINED。

同一 frozen evidence 重放 5 次必须 semantic digest 100% 相同。before/after digest 不要求相等，但差异必须通过 semantic-delta-v1；工具不可用、目标无法构建或外部服务漂移时输出 RunIssue，不把缺证据解释为体验无问题。

### 18.6 发布门槛

Canonical 至少覆盖第 18.1 所有 vectors，并覆盖 ScenarioFamilyRegistry-v1 digest=b764d922bd94ceb6869cd60984261acae344cd0a5e21c1cc9970cff710e417d0 的 exact 8 ids；每例 5 次 fresh-context。Skill/CLI/MCP semantic parity 100%，adapter canonical evidence parity 100%，prohibited claims/recommendations 0，release-critical failure 误 pass 0，golden bytes 全匹配。

HoldoutReleaseGate 只有 current behavior generation 的 overall_gate=pass 才通过；missing、failed、QUERY_BUDGET_EXHAUSTED、contaminated 或非当前 generation 一律 no_release。真实回归必须完成 fixed anchors 中的 HulianUI、Apple、GOV.UK 和至少一个非 HulianUI pinned repository，并完成 RotationSelectionManifest 为当前 generation 选中的一个 rotation_candidate；每例均有 baseline 与 verify。任一必需目标 unavailable 时记录 RunIssue 并 no_release，不得换站、换 live bytes 或用第三方品牌声誉替代证据。稳定阶段再要求独立专家/用户代表按 strata 盲评 relevance、contextual fit、alternatives、harm、uncertainty。只报告 within-case 观察结果、样本边界和残余风险，不宣称永不漏报，不输出跨站总分或排行榜。


## 19. v0.1 试验验收

必须同时满足：

1. 第 12 节所有核心对象有 schema、canonical collection 和 semantic validator；
2. FragmentPropositionAssessment、SourceFragment→Assertion→Adoption→Conflict trace 与统一 evaluation_effective_at 唯一；
3. AuthorityRoot、ActingContext、双时点 control/SoD、tenant、Grant、PartyEffectGraphCompletenessProof、time-authority-policy-bound ExecutionEnvelope、distinct quorum、receiver-side research fence、原子 effect 与 invalidation 唯一；
4. Journey capability 的 authorization_purpose/capability_use、签名/ledger/防 replay，evaluator-derived PartyInventory 和 E>U>determinate hard/soft CandidateUniverse 求解唯一；
5. Study execution/analysis、Evidence dependency、closed ClaimAssessmentPolicy、SensitiveUse 默认矩阵和穷尽 Recommendation ceiling/reducer 可执行；
6. Research 默认 blocked，ParticipantPermissionRequirement、authorization/consent/assent/representative/waiver/withdrawal 与 research_guard_digest 在 effect guard 中原子复验；
7. InquiryDraft 永久非权威；只有独立、canonical、assessed Claim ID 可进入 Finding、Recommendation、authorization 和 release gate；
8. AST types/operators、applicability/exclusion、多 tool dependency reducer、Finding emission/fingerprint 与 RunStatus reducer 无多解；
9. NFC、CanonicalRelativePath、normative errors、UTF8(JCS(key)) collection order、semantic projection/trace、evaluator/finding DigestRegistry 均有 golden；
10. HulianUI 首行固定 contract、request、artifact digest、exports/props/events/slots normalization 和 prohibited claims；canonical evidence 与 transport sidecar 分离；
11. ART-ONEFILE-001 匹配 canonical uncompressed ustar bytes；
12. 第 18 节全部 RED/golden/holdout 门槛通过，CanonicalDeltaOperationV1、bundle allowlist、derived closure、negative-control/DecisionOwner/rotation gate 唯一，真实回归达到 18.6 最低组合并生成可复放 evidence；
13. Profile、组件库、自动扫描、第三方品牌、跨站总分与 0 Finding 均不冒充 UX 成功；
14. 本机资料目录无项目写入；
15. 用户批准最终规格后才写 implementation plan。


## 20. 当前阶段与下一关口

当前仍只做设计。

1. 提交 v0.13 真实站点回归扩展到 design/v0；
2. 自检所有 MUST/唯一表与 100 个 vectors；
3. 第十一轮已完成：release/holdout 与 adapter 评审 GO；综合评审的 SelectionDecision/ReleaseRecommendation 命名冲突已闭合；
4. 第十二轮复核依次发现 snapshot closure、scenario-family/rotation identity、header replay、profile identity 与 nested-schema required blocker；本候选已补闭合 schema、header CAS、exact ReplayProfile/registry/digest 和对应 golden vectors，等待最终定点重验；
5. 只有 GO，或 CONDITIONAL GO 且无 core schema/semantic blocker，才交用户审阅并进入 implementation plan；
6. 首纵切仍限制为一个高风险 Admin 审批场景、一条 advisory rule、一组 Claim/Recommendation Assessment、共享 evaluator、一个 HulianUI candidate mapping、Assurance+Inquiry validation、ART-ONEFILE-001 和第 18.4 真实回归 harness 契约；
7. 首纵切不修改 HulianUI MCP、不写第三方 upstream、不扩第二个实现 adapter、不宣称 stable。


## 21. 初始权威来源与回归目标

权威来源：

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

首批回归目标（不是 UX 权威来源）：

- GOV.UK Register to vote: https://www.gov.uk/register-to-vote
- Apple 中国官网: https://www.apple.com.cn/
- Appsmith pinned repository: https://github.com/appsmithorg/appsmith/tree/03266b555b5451e91614840ec5b2577538bd8e6e
- Cal.com/cal.diy pinned repository: https://github.com/calcom/cal.diy/tree/176037d0afbe572f870a3c702985e7cd83fe6c0c
- HulianUI pinned contract：见第 13 节。
- IKEA 中国官网（rotation）: https://www.ikea.cn/cn/zh/
- Stripe Docs（rotation）: https://docs.stripe.com/

经典著作只作为综合知识输入，不复制受版权保护正文。首批包括 Jesse James Garrett、Don Norman、Steve Krug、Giles Colborne、Marty Cagan 及本地提供的产品设计资料。
