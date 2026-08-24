# Evidence-aware Product UX Skill

[English](#english) · [中文](#中文)

<a id="english"></a>

## English

An evidence-aware UX evaluation Skill for digital products. It routes a request into one of four modes, validates the supplied evidence, runs a single deterministic evaluator, and keeps assurance findings separate from unanswered questions.

> **Experimental status:** this repository is not a stable release. The release gate currently returns `no_release`; do not interpret the output as WCAG certification, proof of user success, or a total judgment of product quality.

### Modes

| Mode | Use it for |
| --- | --- |
| `guide` | Design guidance or a new experience |
| `scan` | Review, audit, or comparison of an existing experience |
| `refactor` | Migration or restructuring work |
| `verify` | Acceptance, regression, or release-readiness evidence |

Exactly one mode is allowed per evaluation. Ambiguous or incomplete inputs fail closed rather than inventing evidence.

### Requirements

- Node.js `22.22.2`
- pnpm `8.15.5`

### Setup

```sh
git clone https://github.com/Zhanglala103838/ux-skill.git
cd ux-skill
corepack enable
corepack prepare pnpm@8.15.5 --activate
pnpm install --frozen-lockfile
```

### Validate the repository

```sh
pnpm vectors:check
pnpm knowledge:check
pnpm skill:check
pnpm test
```

### Run an evaluation

Prepare an input bundle that conforms to [`schemas/core/evaluation-input.schema.json`](schemas/core/evaluation-input.schema.json), then send it to the CLI on standard input:

```sh
pnpm --silent ux:evaluate --mode scan --input - --output json < evaluation-input.json
```

Replace `scan` with `guide`, `refactor`, or `verify` as needed. Preserve the CLI exit code and release decision; `no_release`, incomplete evidence, and failed runs must not be converted into approval.

### Build the canonical artifact

```sh
pnpm artifact:pack -- knowledge/artifact-manifest.json ux-skill.tar
```

The packer creates a deterministic, manifest-closed ustar archive. It rejects undeclared paths, links, unsupported file types, unsafe path forms, and input races.

### Check release readiness

```sh
pnpm release:check
```

The command writes `release-gate-report.json` and exits non-zero while required evidence is missing. A failing release gate is an intentional safety result, not permission to weaken or bypass the gate.

### Safety and evidence boundaries

- Evaluation is analysis, not authorization for external effects.
- Missing, incomplete, unavailable, or stale evidence remains explicit.
- Assurance contains only evaluator-backed findings; inquiry remains non-authoritative.
- Public-site capture is fail-closed and limited by the repository's provenance contracts.
- The HulianUI adapter supplies component evidence only when that integration is actually in scope.

The Codex-compatible Skill entrypoint is [`SKILL.md`](SKILL.md). The evaluator, schemas, knowledge manifests, adapters, and CLI are versioned together in this repository.

### License

[MIT](LICENSE) © 2026 瑚琏

---

<a id="中文"></a>

## 中文

这是一个面向数字产品、以证据为基础的用户体验评估 Skill。它会将请求路由到四种模式之一，校验输入证据，调用唯一且确定性的评估器，并将有证据支持的结论与尚待验证的问题严格分开。

> **实验状态：** 当前仓库不是稳定发布版本，发布门禁仍返回 `no_release`。输出不能被解释为 WCAG 认证、用户成功证明，也不能作为产品整体体验好坏的总分。

### 模式

| 模式 | 适用场景 |
| --- | --- |
| `guide` | 设计指导或新体验设计 |
| `scan` | 审阅、审计或比较现有体验 |
| `refactor` | 迁移或重构工作 |
| `verify` | 验收、回归或发布就绪证据 |

每次评估只能指定一种模式。输入含糊或证据不完整时会安全失败，不会补造证据。

### 环境要求

- Node.js `22.22.2`
- pnpm `8.15.5`

### 安装

```sh
git clone https://github.com/Zhanglala103838/ux-skill.git
cd ux-skill
corepack enable
corepack prepare pnpm@8.15.5 --activate
pnpm install --frozen-lockfile
```

### 验证仓库

```sh
pnpm vectors:check
pnpm knowledge:check
pnpm skill:check
pnpm test
```

### 执行评估

先准备符合 [`schemas/core/evaluation-input.schema.json`](schemas/core/evaluation-input.schema.json) 的输入 bundle，再通过标准输入交给 CLI：

```sh
pnpm --silent ux:evaluate --mode scan --input - --output json < evaluation-input.json
```

可按需要将 `scan` 替换为 `guide`、`refactor` 或 `verify`。必须保留 CLI 退出码和发布结论，不能把 `no_release`、证据不完整或执行失败改写成批准。

### 构建规范化产物

```sh
pnpm artifact:pack -- knowledge/artifact-manifest.json ux-skill.tar
```

打包器会生成由 manifest 封闭定义、可复现的 ustar 归档，并拒绝未声明路径、链接、不支持的文件类型、不安全路径及输入竞态。

### 检查发布条件

```sh
pnpm release:check
```

当必要证据缺失时，该命令会写入 `release-gate-report.json` 并以非零状态退出。发布门禁失败是预期的安全结果，不代表可以削弱或绕过门禁。

### 安全与证据边界

- 评估属于分析，不构成执行外部操作的授权。
- 缺失、不完整、不可用或过期的证据必须保持显式。
- Assurance 只包含评估器支持的结论；Inquiry 始终保持非权威性质。
- 公共网站采集遵循 fail-closed 原则，并受仓库 provenance 契约约束。
- 只有目标确实使用 HulianUI 时，才通过对应适配器提供组件证据。

Codex 兼容的 Skill 入口位于 [`SKILL.md`](SKILL.md)。评估器、Schema、知识清单、适配器和 CLI 在同一仓库中统一版本化。

### 许可证

[MIT](LICENSE) © 2026 瑚琏
