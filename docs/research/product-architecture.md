# TrialRun architecture research

Checked: 2026-08-08

This document records implementation decisions that depend on external products. It is evidence for the code, not marketing copy. Re-check a source before changing its boundary.

## Product proof

TrialRun reviews a real GitHub pull request by deploying its immutable base and head commits into one disposable Zerops project, giving one context-rich Codex session live browser/API/log control over both, calculating the verdict from recorded assertions, preserving matched evidence, and proving that the project was deleted.

The judgeable happy path is:

1. Sign in to TrialRun and install its GitHub App on one repository.
2. TrialRun resolves the pull request's base and head SHAs through GitHub.
3. A repository analyst proposes the smallest Zerops topology from bounded file evidence.
4. Deterministic policy rejects unsafe or unsupported infrastructure.
5. A maintainer confirms the first version of the recipe.
6. A PostgreSQL worker creates exactly one disposable Zerops project.
7. TrialRun uploads the private source for both SHAs with `zcli service push`.
8. After readiness, Codex starts a live observe-act-observe loop through the in-project executor and investigates both private base and head services.
9. TrialRun publishes screenshots, trace/video where safe, logs, assertions, and the first divergence to a GitHub Check.
10. TrialRun copies sanitized artifacts out and deletes the exact project it created.

No fixed application, fake SHA, canned finding, or simulated cloud event is part of the product path.

## Zerops is the execution substrate

### Verified capabilities

- A Zerops project is a group of runtime and managed services on a dedicated private network. Services address each other by hostname.
- Zerops exposes runtimes for Node.js, Bun, Deno, Python, Go, Rust, Java, .NET, PHP, Elixir, Gleam, Ruby, Nginx/static, Ubuntu, Alpine, and Docker, plus managed PostgreSQL, MariaDB, Valkey, KeyDB, Elasticsearch, Typesense, Meilisearch, Qdrant, NATS, Kafka, ClickHouse, object storage, and shared storage.
- `zcli service push` builds and deploys a local working directory. It accepts explicit project, service, setup, working-directory, and no-git options. TrialRun uses explicit IDs and paths and never relies on ambient config.
- `buildFromGit` is useful for public source. Private GitHub source is instead downloaded with a short-lived GitHub App installation token and uploaded from a temporary directory through zCLI so a credential never appears in an import document or Git URL.
- A `zcp@1` service can be a private remote workspace with bundled coding agents, Cloud IDE, project-scoped Zerops MCP access, and private service connectivity. The human signs into their own agent provider inside that workspace.
- `ZCP_API_KEY` authorizes the Zerops project surface. It is not an OpenAI/Codex credential and must not be mistaken for one.
- Zerops object storage is S3-compatible and is the persistent artifact target. PostgreSQL `single` is appropriate for disposable review state; TrialRun's persistent control database can use the deployment mode chosen for the hackathon environment.

### TrialRun topology

Persistent project:

- `web`: Next.js control plane and GitHub webhook endpoint.
- `runner`: durable job worker and the only holder of Zerops organization credentials.
- `db`: PostgreSQL for users, sessions, installations, recipes, reviews, jobs, evidence metadata, and cleanup ownership.
- `evidence`: private object storage for sanitized artifacts.

One disposable project per review:

- `base-*`: policy-generated application graph for the verified base SHA.
- `head-*`: an isolated copy of that graph for the verified head SHA.
- `executor`: fixed TrialRun browser/API executor, with no GitHub, model, session, or Zerops organization credential.

Every mutable dependency is duplicated. The executor reaches both sides over private hostnames. If a temporary public executor endpoint is unavoidable, it is protected by a single-review random token, has no reusable credentials, and is removed with the project.

### Control boundary

The repository analyst may propose infrastructure but cannot provision it. A deterministic compiler is the only component that emits Zerops import YAML. It validates service types and versions, names, counts, resources, paths, ports, health checks, environment references, and base/head isolation. Only the persistent runner calls Zerops. The model never sees the Zerops credential.

### Sources and snapshots

- [Infrastructure for Coding Agents](https://docs.zerops.io/features/coding-agents)
- [Hosted ZCP workspace](https://docs.zerops.io/zcp/setup/hosted-workspace)
- [ZCP tokens and project access](https://docs.zerops.io/zcp/security/tokens-and-project-access)
- [Zerops API](https://docs.zerops.io/references/api)
- [zCLI commands](https://docs.zerops.io/references/zcli/commands)
- [Internal access](https://docs.zerops.io/references/networking/internal-access)
- [PostgreSQL](https://docs.zerops.io/postgresql/overview)
- [Object storage](https://docs.zerops.io/object-storage/overview)
- Local docs snapshot: `/Users/aryankumar/zerops-rank1-research/docs`, commit `d65d249459263589bab3163e41c347d9ae6814b1`.
- Local Go SDK snapshot: `/Users/aryankumar/zerops-rank1-research/zerops-go`, commit `2ffcf823bc5f72317c01ca6f49a0e34510c103a4`.
- Local zCLI snapshot: `/Users/aryankumar/zerops-rank1-research/zcli`, commit `397a8ccbf0fe8e3c77b0a0ca4f1c43fc16f2d9f6`.
- Local recipes snapshot: `/Users/aryankumar/zerops-rank1-research/zerops/recipes`.

Live contract note, checked 8 August 2026: the documentation and JSON schema describe numeric `failureTimeout` and `retryPeriod` readiness values, but the live deployment validation path rejected those values while unmarshalling them as `time.Duration`. Both properties are optional, so TrialRun omits them and retains the required HTTP readiness probe instead of sending an undocumented representation.

## Codex connection model

### What the official interface supports

Codex CLI supports ChatGPT subscription sign-in, API-key sign-in, device-code sign-in for headless systems, and enterprise access tokens for trusted private automation. OpenAI describes the cached login as password-grade material and recommends API keys for automation. The Codex SDK runs server-side Node workflows and can preserve thread state.

### Product modes

TrialRun exposes three explicit connection modes, never a vague “paste your Codex token” field:

1. **TrialRun managed** — the control plane uses its own API credential and accounts usage to the repository. This is the simplest default for the hackathon proof.
2. **Bring an API key** — a user supplies an OpenAI API key. TrialRun encrypts it with versioned AES-256-GCM, never displays it again, decrypts it only for the user's bounded planning job, and supports rotation/revocation.
3. **Use my Codex subscription (Zerops workspace)** — TrialRun creates or associates one dedicated ZCP workspace for that user. The user completes Codex device login inside the workspace. A small authenticated bridge starts and resumes a live Codex review thread there; that thread drives the disposable executor's tools throughout the run. The credential cache never leaves the workspace and TrialRun stores only the Zerops project/service identifiers, thread/session identifiers, connection state, timestamps, and revocation state.

There is no shared multi-user home directory. TrialRun never reads, copies, downloads, parses, logs, or backs up `~/.codex/auth.json`. A subscription workspace and a disposable application review project are distinct: the former contains user-owned agent state; the latter contains untrusted repository code and is destroyed after one review.

The first complete local and Zerops review may use the managed mode. The workspace mode is not called complete until device login, bridge invocation, revocation, and deletion are exercised against a dedicated live ZCP service.

### Agent responsibilities

- The repository analyst proposes a topology from bounded repository evidence.
- One context-rich Codex test pilot receives the verified head tree plus base-to-head diff through bounded read-only repository MCP tools and retains the repository, current DOM, prior actions, and discovered behavior while it investigates live. It may search and reason across the full codebase, but the untrusted checkout is never mounted or executed in its credential-bearing workspace. Shell, file-write, web-search, multi-agent, and dependency-install tools are disabled for the review thread.
- Its initial typed mission contains goals, budgets, allowed secret names, and capabilities. It is not a fixed sequence of browser steps.
- Narrow stateful tools let it observe DOM/accessibility state, count semantic locators, act, inspect console/network/application logs, switch/reset sides, and capture checkpoints. Arbitrary JavaScript, shell, filesystem, infrastructure, and unrestricted URL access remain unavailable.
- The evidence recorder persists the full causal action/observation trail.
- The deterministic oracle compares reproducible assertions and computes the verdict.
- The explainer turns that evidence into a concise Check summary but cannot alter the verdict.

This avoids a disconnected test agent with no review context without granting Codex infrastructure control or self-grading authority. It can reason and browse live; the runner provisions/deletes and the oracle grades.

TrialRun publishes two visibly different lanes. A **code-risk** finding needs exact repository citations and an explanation but is not called reproduced. A **runtime regression** must link that hypothesis to ordered live actions, matched base/head checkpoints or assertions, and the first behavioral divergence. Codex can say which code is sound or risky across the repository, then spend its live budget proving the highest-value concerns.

### Official sources

- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Codex SDK](https://developers.openai.com/codex/sdk/)
- [Zerops hosted workspace](https://docs.zerops.io/zcp/setup/hosted-workspace)

## GitHub trust and delivery

A GitHub App is required because TrialRun needs installation-scoped repository access, pull-request metadata, Check Runs, webhook delivery, and PR comments without storing personal access tokens.

- Contents and metadata: read.
- Pull requests: read, plus only the update access required by the chosen Check/comment flow.
- Checks: write.
- Issues: write for exact bot commands on pull-request conversations.
- Webhook events: installation, installation repositories, pull request, push when needed for recipe staleness, and issue comment.

Webhook HMAC is verified over the raw request body before JSON parsing. Delivery IDs are idempotency keys. A just-in-time installation client resolves the current PR, verifies both 40-character SHAs, downloads archives, and is discarded. Commands are exact and permission-gated: `analyze`, `confirm`, `run`, `explain`, and `cancel`. Repository text and comments are untrusted data, never shell or system instructions.

Primary implementation references:

- [GitHub App authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app)
- [Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [REST Checks API](https://docs.github.com/en/rest/checks/runs)
- [Octokit App](https://github.com/octokit/app.js)

## Repository recipe contract

The evidence collector reads only allowlisted, bounded files and never follows symlinks outside the checkout. It may inspect root/workspace package manifests and lockfiles, `zerops.yaml`, `trialrun.yaml`, Docker/Compose manifests, language dependency manifests, ORM configuration, and example environment-variable names. It never reads `.env` values, credential stores, Git history outside the two verified commits, or arbitrary large files.

The analyst output contains:

- application services with runtime, setup, source root, start/readiness information;
- managed dependencies and their purpose;
- named environment bindings from one service's exported property to another service;
- migrations/seeds that are safe for disposable data;
- exactly one primary test target;
- a file/line or JSON-path citation and confidence for every inferred field;
- unresolved questions that block confirmation.

Policy limits the topology to supported types, a small service cap, non-HA disposable dependencies, private networking, bounded CPU/RAM/disk, safe relative paths, no arbitrary public port, and a readiness rule for every application service. The confirmed recipe is immutable and versioned. A material manifest/topology change proposes a successor and blocks automatic review until a maintainer confirms it.

## Queue, cancellation, and cleanup

PostgreSQL is sufficient for the hackathon. Four simultaneous submissions create four review rows and four jobs. Runners atomically claim jobs with `FOR UPDATE SKIP LOCKED`; a configured concurrency cap controls Zerops spend. Each claimed review has a renewable lease and bounded retries. External calls happen outside long transactions.

Cancellation sets intent durably, interrupts the live Codex/tool session, preserves available evidence, enters teardown, and returns an honest cancelled/inconclusive state. Cleanup runs in `finally` and also through an orphan reaper. The reaper operates only on exact provider project IDs previously persisted for a TrialRun review, verifies its ownership marker under a row lock, retries boundedly, and records proof or failure. It never discovers targets by loose name matching or mass deletion.

## Competitive lesson: Greptile TREX

Greptile describes TREX as an execution layer that reads a PR and repository, starts needed services, uses browser/API testing, and publishes logs, screenshots, traces, scripts, and video. Its architecture write-up reports that a separate context-poor test agent was noisy, while one giant agent was overloaded; its preferred shape is a context-rich orchestrator delegating bounded execution questions.

TrialRun applies that lesson but does not clone TREX. Its hard differentiation is:

- immutable base-versus-head execution of the same journey;
- a maintainer-confirmed, policy-compiled Zerops service graph;
- isolated managed dependencies for each side;
- a deterministic oracle rather than model self-grading;
- explicit teardown evidence as part of the verdict;
- an optional user-owned Codex subscription inside a dedicated Zerops workspace.

Sources:

- [TREX product page](https://www.greptile.com/trex)
- [TREX introduction](https://www.greptile.com/blog/trex)
- [TREX code-execution architecture](https://www.greptile.com/blog/trex-code-execution)

## Non-decisions

- E2B is not in the architecture. Zerops provides the disposable project, private network, runtimes, and managed dependencies we need to prove.
- Trigger.dev is not in the architecture. The existing PostgreSQL lease queue is smaller, observable, and sufficient for the expected concurrency.
- Supabase Auth is not required. TrialRun owns a small email/password session system on PostgreSQL; adding another control plane would not improve the hackathon proof.
- Codex controls the browser live through semantic Playwright-grade tools. Semantic observation, uniqueness checks, and postconditions are the default; visual/computer-use is an explicit fallback for interfaces that cannot be understood semantically, with the same recording and budget rules.
