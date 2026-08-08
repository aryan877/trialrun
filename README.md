<p align="center"><img src="docs/assets/logos/trialrun.svg" width="64" height="64" alt="TrialRun" /></p>

<h1 align="center">TrialRun</h1>

<p align="center"><strong>A code review that opens the app.</strong></p>

<p align="center">
  TrialRun boots the exact base and pull request commits on Zerops, lets Codex inspect the code and drive a real Chrome session across both versions, posts the recorded difference to GitHub, then proves the temporary project was deleted.
</p>

<p align="center">
  <a href="https://trialrun.aryankumar.dev">App</a> ·
  <a href="https://github.com/apps/trialrun-by-aryan">GitHub App</a> ·
  <a href="#how-one-review-runs">Architecture</a> ·
  <a href="#run-trialrun-locally">Run locally</a>
</p>

<p align="center">
  <img src="docs/assets/logos/zerops.svg" height="30" alt="Zerops" />&nbsp;&nbsp;&nbsp;
  <img src="docs/assets/logos/github.svg" height="30" alt="GitHub" />&nbsp;&nbsp;&nbsp;
  <img src="docs/assets/logos/openai.svg" height="30" alt="OpenAI" />&nbsp;&nbsp;&nbsp;
  <img src="docs/assets/logos/playwright.svg" height="30" alt="Playwright" />&nbsp;&nbsp;&nbsp;
  <img src="docs/assets/logos/postgresql.svg" height="30" alt="PostgreSQL" />
</p>

<p align="center"><sub>Official marks identify the tools used by TrialRun. They do not imply sponsorship or endorsement. <a href="docs/assets/logos/ATTRIBUTION.md">Sources and usage notes</a>.</sub></p>

## Watch the PR fail in the running app

A normal code review can tell you that a checkout calculation changed. TrialRun shows what the change does.

For one pull request, TrialRun starts the base commit and PR commit as separate applications. Each side gets its own database or other stateful services.

One Codex session reads the repository and diff, switches between both running apps, uses Chrome interactively, and follows the failure until it can reproduce the first real difference.

The result is more than a comment:

- exact base and PR commit SHAs;
- code findings with file and line citations;
- matched screenshots and secret-safe WebM recordings;
- browser actions, assertions, console output, failed requests, and application logs;
- a deterministic `pass`, `fail`, or `inconclusive` verdict;
- a GitHub Check and concise PR comment;
- the ID of the disposable Zerops project and proof that it no longer exists.

<!-- TRIALRUN_RELEASE_PLACEHOLDER:LIVE_PROOF_START -->

> **Live proof status:** the final private proof run and customer ZCP invocation are still being completed. This README does not claim a GitHub Check, evidence URL, teardown proof, or working ZCP connection until each result has been opened and verified. The release owner will replace this block with the real links from those Zerops runs.

<!-- TRIALRUN_RELEASE_PLACEHOLDER:LIVE_PROOF_END -->

## The user flow

1. Create a TrialRun account.
2. Install the TrialRun GitHub App on selected repositories. No personal access token is needed.
3. Choose TrialRun-managed Codex or connect your Codex subscription in a dedicated Zerops Control Plane (ZCP) workspace.
4. Let Codex inspect the repository through bounded read-only tools.
5. Confirm TrialRun's plain-language summary of how the app should build and run.
6. Add test-only environment variables, then enable reviews or run one pull request manually.
7. Watch the base and PR versions build, boot, and run side by side.
8. Open the finding, play the PR recording, compare the base recording, and inspect the full evidence ledger.
9. Read the same verdict in GitHub.
10. Check the teardown record before the review is considered complete.

You do not need to understand Zerops YAML, containers, queues, or browser tooling to use that flow.

## How one review runs

![TrialRun architecture showing GitHub, the persistent Zerops control plane, the selected Codex connection, one disposable review project, evidence publication, and exact teardown](docs/assets/trialrun-architecture.svg)

The diagram is generated from [`docs/architecture/trialrun-architecture.json`](docs/architecture/trialrun-architecture.json). The build checks node and label bounds, connector collisions, stale output, computed Chromium geometry, and external SVG references.

### 1. A pull request starts a durable job

The GitHub App verifies the webhook signature and records one job in PostgreSQL. The job is pinned to the repository, pull request number, immutable base SHA, immutable PR SHA, confirmed run setup, and one exact Codex connection.

### 2. Codex works out how the repository runs

TrialRun does not hand Codex a hardcoded list of `package.json`, `Dockerfile`, or framework files. Codex can walk the safe repository tree, search literal text, read exact line ranges, and inspect the diff.

Codex decides which files matter and cites them in a typed recommendation.

Normal TypeScript code then checks that recommendation:

- every command and source path points to cited repository evidence;
- the runtime and managed dependencies are supported on Zerops;
- CPU, memory, disk, service count, ports, and public access stay within fixed limits;
- every app has a readiness rule;
- base and PR data services remain separate;
- test code never receives GitHub, Zerops, session, vault, or model credentials.

If the repository is ambiguous, TrialRun blocks the run and asks for a small correction. It does not guess and spend infrastructure.

### 3. TrialRun writes the Zerops setup

Customer repositories do **not** need a `zerops.yaml`.

After the repository maintainer confirms the plain-language run summary, TrialRun compiles a fresh, review-only Zerops manifest. A customer's own Zerops files may help Codex understand the repo, but TrialRun never deploys, patches, or requires them.

### 4. The runner creates one isolated Zerops project

The runner imports one project for the review and stores its exact project ID before it deploys anything. It uploads both immutable GitHub commits through `zcli`, starts separate base and PR service graphs, and waits for process and readiness checks.

The applications and their databases stay on the project's private Zerops network. The only review control surface is a short-lived, token-protected executor for that one review.

### 5. Codex reviews the code and controls Chrome live

Codex starts after both applications are ready. It receives the verified repository tree, diff, existing tests, confirmed run setup, and a bounded mission.

It can then repeat this loop:

1. inspect code or the current browser state;
2. count a semantic locator before acting;
3. click, fill, select, press, or switch between base and PR;
4. inspect console, network, application logs, and assertions;
5. take a matched checkpoint;
6. change direction when the real app behaves differently from expected.

This is not a prerecorded click list. Codex stays active throughout the review. It can investigate the whole safe codebase and the running behavior in one thread.

### 6. Deterministic code owns the verdict

Codex can find and explain a bug, but it cannot grade its own answer. The oracle evaluates recorded assertions and matched base-versus-PR evidence:

| Verdict        | Meaning                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pass`         | The base is valid, the PR meets every required assertion, the evidence is complete, and teardown succeeds.        |
| `fail`         | The base is valid and the PR has a reproducible regression or violates a declared assertion.                      |
| `inconclusive` | The base is invalid, setup is ambiguous, evidence is missing, infrastructure fails, or teardown cannot be proved. |

Missing evidence never becomes a pass.

### 7. TrialRun deletes the project, then closes GitHub

TrialRun seals and hashes persisted artifacts with SHA-256, then uploads sanitized evidence to object storage. It deletes the exact Zerops project stored for that review and records the result before it completes the GitHub Check and PR comment.

Cleanup also runs after cancellation, timeout, failure, or a worker restart.

The cleanup sweeper reads expired review records from PostgreSQL. It does not list an account and guess which projects to delete.

## Two ways to run Codex

Each job stores one connection ID when it is created. Changing your setting later affects new jobs only; a running review never switches credentials halfway through.

| Mode                    | Where Codex runs                           | What TrialRun stores                                            | What tested code receives                            |
| ----------------------- | ------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------- |
| TrialRun-managed Codex  | Beside the persistent runner               | The selected connection ID and review thread state              | Narrow repository and browser tools for one review   |
| Your Codex subscription | Your dedicated `zcp@1` workspace on Zerops | Workspace project/service IDs, connection state, and thread IDs | The same narrow tools after live bridge verification |

For the ZCP path, you complete OpenAI's official device login inside your workspace. Your Codex credential cache stays there. TrialRun never asks you to paste, upload, copy, or expose `~/.codex/auth.json`.

Both modes use the same runner, policy checks, Chrome executor, evidence recorder, oracle, GitHub publisher, and teardown path after their connection checks pass. ZCP changes where Codex lives, not who controls infrastructure or decides the verdict.

<!-- TRIALRUN_RELEASE_PLACEHOLDER:ZCP_CONNECTION -->

> **Customer ZCP release gate:** the dedicated workspace and signed bridge exist, but a workspace review is not called connected until device login and one bounded Codex invocation pass live. The prepared PR uses managed Codex until that gate closes.

<!-- TRIALRUN_RELEASE_PLACEHOLDER:ZCP_CONNECTION_END -->

## What runs on Zerops

TrialRun uses Zerops for the product itself and for every isolated review.

| Zerops capability              | How TrialRun uses it                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Project import API             | Creates the persistent product graph and one exact disposable project per review.                                            |
| Native Node.js services        | Runs the Next.js web/API service and the independent durable runner.                                                         |
| Managed PostgreSQL             | Stores users, sessions, installations, repository setups, jobs, ordered events, findings, and teardown state.                |
| Object storage                 | Keeps sanitized screenshots, WebM recordings, traces, logs, scripts, and evidence bundles after the review project is gone.  |
| Private project networking     | Lets base apps, PR apps, isolated dependencies, and the Chrome executor communicate without making customer services public. |
| `zcli service push`            | Ships the exact private base and PR source archives without putting a GitHub token in YAML or a clone URL.                   |
| Prepare/build/deploy pipeline  | Builds the two commits, runs migrations or seeds from the confirmed setup, and starts each service with readiness checks.    |
| Process, service, and log APIs | Waits for deployments, checks readiness, and captures redacted build and runtime logs.                                       |
| ZCP `zcp@1` workspace          | Gives each bring-your-own-Codex customer a separate credential-bearing workspace.                                            |
| Project deletion API           | Removes the exact project created for the review and records the absence check.                                              |

The persistent submission architecture has four services: `web`, `runner`, `db`, and `evidence`. A disposable review adds the base and PR application graphs plus the Chrome executor. The number and type of base/PR dependencies come from the confirmed repository setup, not a hardcoded demo app.

## Evidence you can audit

Every completed review keeps an ordered ledger. A finding can point to:

- the repository, PR number, and two immutable SHAs;
- the code path and line range that led Codex to investigate;
- each browser observation, action, result, side, and checkpoint;
- matched base and PR screenshots;
- separate base and PR WebM files, when recording is safe;
- console messages, failed network requests, and redacted application logs;
- assertion inputs and normalized results;
- artifact media type, byte size, and SHA-256 hash;
- Zerops project and service IDs;
- build, ready, run, publish, and teardown timestamps;
- the GitHub Check run ID and any recorded comment-delivery error;
- final deletion status and proof.

The PR recording is the primary behavior view. The base recording sits next to it for comparison. If a run could expose test secrets, TrialRun withholds the affected recording instead of presenting unsafe video as proof.

## Security boundary

Repository code and pull requests are untrusted. TrialRun keeps authority split on purpose.

| Component       | Can do                                                                            | Cannot do                                                                                                     |
| --------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Codex           | Read the safe repo and diff; use bounded browser, API, and log tools              | Hold GitHub or Zerops admin credentials; run arbitrary shell or JavaScript; write the repo; grade the verdict |
| Runner          | Claim jobs; fetch exact commits; create/delete Zerops projects; publish to GitHub | Invent a model result or turn missing evidence into a pass                                                    |
| Chrome executor | Reach private base/PR apps; record one review                                     | Browse arbitrary URLs; access the vault; reuse a token in another review                                      |
| Oracle          | Evaluate typed assertions from recorded evidence                                  | Change code, infrastructure, or agent output                                                                  |
| Tested app      | Receive only approved test inputs                                                 | Receive TrialRun's platform credentials                                                                       |

Other protections include signed GitHub webhooks, short-lived installation tokens, Argon2id password hashes, opaque server sessions, encrypted repository test secrets, and strict ownership checks. TrialRun also redacts secrets before persistence, bounds retries, and deletes by exact project ID.

Only use disposable test credentials. A malicious application can exfiltrate any value it receives; isolation cannot make a production database, payment, cloud, or personal credential safe to test.

## Supported repositories

The first release targets runnable web applications and HTTP APIs whose build, start, port, readiness, dependencies, and named environment inputs can be proved from repository evidence.

TrialRun blocks or marks a review inconclusive when the repository is a library, native desktop app, mobile-only app, requires production credentials, or does not provide enough evidence to start safely. A topology-changing PR requires a new confirmation instead of silently creating extra services.

## Run TrialRun locally

### Prerequisites

- Node.js 22 or later
- pnpm 9.15.5 through Corepack
- Docker with Compose
- Codex CLI authentication or an OpenAI API key for real agent runs
- GitHub App credentials for repository linking and Check publication
- Zerops credentials only when testing the Zerops provider

### Start the local control plane

```bash
git clone https://github.com/aryan877/trialrun.git
cd trialrun

corepack enable
corepack prepare pnpm@9.15.5 --activate
pnpm install --frozen-lockfile

cp .env.example .env
# Fill CSRF_SECRET_BASE64 and VAULT_KEY_BASE64 with separate values:
openssl rand -base64 32
openssl rand -base64 32

docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The source repository is private during the hackathon. Cloning requires explicit repository access.

Open [http://localhost:3000](http://localhost:3000). The local provider uses isolated local workspaces and processes; the UI labels those runs as local. A local run is never presented as Zerops proof.

To stop the development database:

```bash
docker compose stop postgres
```

### Run the verification suite

```bash
pnpm check
pnpm exec tsx scripts/verify-architecture.ts
pnpm exec tsx scripts/verify-architecture-browser.ts
pnpm exec tsx scripts/verify-readme-assets.ts
```

Use the release check only after the real PR links replace every marked placeholder:

```bash
pnpm exec tsx scripts/verify-readme-assets.ts --release
```

## Repository map

```text
apps/
  web/                      Next.js product, API, GitHub webhook, evidence UI
  runner/                   durable jobs, Codex orchestration, GitHub publication
  cloud-executor/           token-protected executor entrypoint for one review
  codex-workspace-bridge/   signed bridge for a customer's ZCP Codex workspace
packages/
  agent-runtime/            shared typed Codex analysis and live-review runtime
  db/                       PostgreSQL schema, migrations, queue, ownership queries
  domain/                   validated plans, policy, findings, and evidence types
  executor/                 local/Zerops lifecycle, Chrome tools, artifacts, oracle
  github/                   GitHub App tokens, webhooks, archives, Checks, comments
docs/
  architecture/             typed diagram source
  assets/                   generated architecture and official technology marks
  submission/               final proof fields and judge walkthrough
ops/                        Zerops executor and ZCP service bundles
```

`zerops-project-import.yaml` defines TrialRun's persistent Zerops services. Root `zerops.yaml` ships the runner and fixed executor; `ops/web-artifact.zerops.yaml` ships the verified Linux web artifact. None is copied into customer repositories. Per-review manifests are generated from each repository's confirmed, policy-checked run setup.

## Judge access and live proof

The source and proof repositories remain private until access is granted to the judging team. Do not commit a judge password.

<!-- TRIALRUN_RELEASE_PLACEHOLDER:JUDGE_ACCESS -->

| Item                   | Release value                                                                     |
| ---------------------- | --------------------------------------------------------------------------------- |
| Source repository      | Pending judge access confirmation                                                 |
| Live Zerops deployment | `https://trialrun.aryankumar.dev` (`/api/health` verified ready on 9 August 2026) |
| Prepared proof PR      | Pending final private PR run                                                      |
| GitHub Check           | Pending final private PR run                                                      |
| TrialRun evidence page | Pending final private PR run                                                      |
| Teardown proof         | Pending final private PR run                                                      |
| Customer ZCP proof     | Pending device login and one bounded live Codex invocation                        |
| Judge email            | Share privately; do not commit                                                    |
| Judge password         | Share through the submission's private credential channel                         |

<!-- TRIALRUN_RELEASE_PLACEHOLDER:JUDGE_ACCESS_END -->

The exact fields and 90-second walkthrough live in [`docs/submission/README.md`](docs/submission/README.md). Replace its placeholders only with URLs and credentials that were opened and tested.

## Limitations

- Browser recordings are evidence, not the verdict. Typed assertions and matched base/PR behavior decide the result.
- Visual pixel distance can support a finding but cannot fail a review by itself.
- A base app that cannot boot or pass its own required assertions makes the review inconclusive.
- Native desktop, mobile-only, and ambiguous repositories are outside the first release.
- TrialRun does not accept production credentials.
- The live Zerops/GitHub proof links in this draft remain intentionally unfilled until the final private run completes.

## Technology mark attribution

TrialRun is an independent project. Zerops, GitHub, OpenAI, Playwright, and PostgreSQL marks belong to their respective owners. See the pinned source, license, and brand-guidance links in [`docs/assets/logos/ATTRIBUTION.md`](docs/assets/logos/ATTRIBUTION.md).
