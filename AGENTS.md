# TrialRun repository contract

This file is the durable handoff for every coding agent working in this repository. Read it before changing code. Keep it current whenever product scope, architecture, security boundaries, external setup, or verification status changes.

## Product in one sentence

TrialRun launches a pull request and its base commit as two disposable applications on Zerops, lets a bounded testing agent use both through real browser and API tools, posts evidence-backed findings to GitHub, and destroys the temporary infrastructure.

## The human product

The customer flow must remain understandable without infrastructure vocabulary:

1. Create a TrialRun account with email and password.
2. Choose TrialRun-managed Codex, an encrypted OpenAI API key, or connect the user's own Codex subscription in a dedicated ZCP workspace.
3. Connect GitHub and install the TrialRun GitHub App on selected repositories.
4. Let Codex study the full safe repository and review TrialRun's plain-language build/run summary.
5. Add **test-only** environment variables for a repository.
6. Enable automatic reviews or choose a pull request and click **Run review**.
7. Watch base and PR build, boot, and run side by side.
8. Inspect Codex's findings, live actions, screenshots, recordings, API responses, console output, network failures, and application logs.
9. Receive the same result as a GitHub Check and concise PR comment.
10. See positive proof that the disposable environment and secrets were removed.

Do not make users understand Zerops, agents, sandboxes, MCP, or Playwright to use the main flow.

## Product boundary

Initial supported repositories are runnable web applications or HTTP APIs with:

- build and start commands Codex can cite from repository evidence;
- a detectable listening port and health URL;
- dependencies and named environment inputs that fit TrialRun's supported Zerops policy;
- only disposable or testing credentials.

Customer `zerops.yaml` files are ordinary, untrusted repository evidence. TrialRun never requires, copies, patches, or deploys them. The deterministic compiler generates private review-only Zerops manifests from the confirmed typed plan. Do not claim that an arbitrary repository can always boot automatically. Libraries, native desktop applications, mobile-only applications, and repositories whose run contract remains ambiguous are outside the first release.

There is no product demo mode, hardcoded application, fake commit, canned verdict, or simulated review. Every review must trace back to a connected repository, two GitHub-verified immutable commit SHAs, an approved repository recipe, and recorded execution evidence. Automated tests may construct temporary repositories during the test and must delete them afterward; do not ship a fixed fixture application as a product path.

## Architecture

### Persistent Zerops control plane

- Next.js web application and API
- PostgreSQL for users, sessions, repositories, reviews, durable jobs, events, findings, and artifact metadata
- dedicated runner process for long-lived review jobs
- object storage for screenshots, videos, traces, scripts, and evidence bundles
- GitHub App webhook and Check Run integration

### Disposable execution plane per PR review

One review gets one isolated Zerops project containing the base application, PR application, required managed dependencies, and the browser/agent executor when needed. A review may run many test cases inside that project. After evidence is copied out, TrialRun deletes the whole project.

The intended Zerops topology gives base and PR separate stateful dependencies; never point both sides at the same database, cache, queue, bucket, or mutable external test account.

Infrastructure selection is agent-discovered and policy-enforced:

1. The repository analyst explores the complete safe repository through bounded read-only tree, literal-search, and exact-line tools. It decides which files matter instead of receiving a hardcoded manifest list. Credential files, generated dependencies, binaries, unsafe symlinks, and oversized content remain blocked.
2. It returns a typed infrastructure proposal with cited file evidence and confidence for every service, dependency, command, health check, migration, seed, and environment binding.
3. The runner mechanically re-reads every cited path and line. Deterministic policy then validates and clamps the proposal to supported Zerops types, resource ceilings, private networking defaults, service-count limits, safe source-root-relative paths, unique names, and isolated base/head dependencies. The model never receives Zerops credentials and never directly creates infrastructure.
4. A repository maintainer confirms the first recipe in TrialRun or with an authenticated `@trialrun confirm` GitHub command. Ambiguous or changed topology remains blocked until confirmed.
5. Confirmed recipes are versioned and reused for PRs. A topology-changing PR produces a new proposal instead of silently modifying infrastructure.

The fixed TrialRun browser executor is the only shared service inside a disposable review project. It gives an active Codex testing session live, narrow browser/API/log tools against private base and PR hostnames. It receives a one-review execution token and only the test secret values required by the approved mission. It never receives GitHub App, Zerops, session, vault, or model credentials. The executor is not a prerecorded-plan replayer: Codex observes the real running state after every action and may adapt its next action within explicit budgets and permissions.

Local development uses the same lifecycle interface with local child processes or containers. The UI must label local execution honestly; local runs are not Zerops runs.

### Durable workflow

The runner claims PostgreSQL jobs atomically with `FOR UPDATE SKIP LOCKED`. Every state transition appends a review event. Retries must be bounded. Interrupted reviews resume safely or become inconclusive. External calls never remain inside long database transactions.

The queue stores identifiers and immutable metadata, never repository archives or plaintext secrets. A claimed GitHub review resolves its installation, downloads base and head archives with a just-in-time installation client, validates both SHAs against the pull request, stages exact private workspaces, deploys the approved recipe, publishes evidence, and removes the workspaces in `finally` cleanup.

## Agent and browser model

Keep authority separate while preserving one context-rich live agent session:

- The **Codex test pilot** starts only after base and PR are running. It receives the verified head tree and base-to-head diff through narrow read-only repository search/read/diff tools, plus repository instructions, existing tests, the confirmed recipe, and a typed mission containing goals, allowed secret names, time/action/token budgets, and prohibited capabilities. It may inspect the repository holistically but the untrusted checkout is never mounted in its credential-bearing workspace. Its Codex shell, file-write, web-search, multi-agent, and dependency-install tools are disabled; only TrialRun's repository and live review MCP allowlists are enabled. It controls the real browser interactively and does not prewrite a fixed click list.
- The **executor** exposes narrow stateful tools for DOM/accessibility observation, locator counting, click/fill/select/press, screenshot/checkpoint capture, console/network inspection, approved HTTP calls, application-log reads, side switching, and deterministic reset. It does not expose arbitrary JavaScript, shell access, arbitrary URLs, filesystem browsing, GitHub credentials, Zerops control-plane credentials, or the secret vault.
- The **evidence recorder** durably records every observation, tool call, result, side, checkpoint, artifact hash, and error in order. A missing or ambiguous observation cannot be silently skipped.
- The **Codex reviewer** writes one typed terminal report with its verdict, explanation, code citations, and recorded evidence IDs. No second model or TypeScript rule engine reinterprets that review.
- The **provenance verifier** checks only facts the program can prove mechanically: mission and commit identity, real evidence IDs, valid source lines, artifact bytes and hashes, GitHub delivery, and exact teardown. It publishes Codex's verdict unchanged when those checks pass.

Produce two honest finding lanes. **Code findings** cite exact files/lines and explain a static logic, security, architecture, or maintainability risk; they remain labeled unproven unless independently verified. **Runtime findings** must connect a code hypothesis to a reproducible base-versus-head behavioral difference with ordered tool evidence. The strongest result is one Codex thread moving from holistic code understanding to live proof, not two disconnected reviews.

Use our own server-side Playwright/Chromium tool layer for reliable browser control and artifact capture. It must record actions, console messages, failed requests, screenshots, trace files, and video when enabled. Visual/computer-use models may be added later as a fallback for interfaces that cannot be located semantically; they are not required for the first reliable path.

Every interactive browser step follows this contract:

1. Observe the current DOM/accessibility state before acting. Reuse a still-current snapshot; otherwise capture a new one.
2. Build a semantic locator from observed role, accessible name, label, text, or test ID. Never invent a locator from a screenshot alone.
3. Count matches unless uniqueness is guaranteed by the current observation and executor. Exactly one element must match.
4. Act only after the uniqueness check passes. Ambiguous or missing targets produce recorded failed evidence, never a guessed click.
5. Verify the smallest relevant postcondition after the action. Capture a fresh snapshot only when the next decision needs new locator ground truth.

Screenshots and visual models supplement this semantic control path; they do not bypass it. Select-like native controls use value, label, or index APIs rather than clicking browser-native popup coordinates.

For local development, a logged-in Codex CLI may run the same live tool loop as a subprocess without TrialRun reading or copying its authentication token. On Zerops, each bring-your-own Codex customer authenticates inside a dedicated ZCP workspace. The active Codex thread in that workspace connects to one disposable review executor over a short-lived authenticated tool bridge and remains live for the review. Never place multiple customers' agent sessions in one shared home directory, and never ingest browser cookies or raw CLI session files into TrialRun.

TrialRun exposes explicit model-connection modes rather than a generic token box: a TrialRun-managed API credential, an encrypted user API key, or a dedicated user ZCP workspace in which the user completes Codex device login. Never read, copy, persist, export, log, or back up `~/.codex/auth.json`. For a workspace connection, store only provider/type, Zerops project and service identifiers, connection state, active thread/session identifiers, timestamps, and revocation state. The persistent control plane starts a live Codex review thread through a narrow authenticated bridge; tested code never receives the model credential, and repository code is streamed through bounded read-only tools rather than placed or executed in the credential-bearing workspace.

Use one context-rich Codex reviewer that retains the PR/repository context and live browser state, with bounded helper investigations only when useful. Do not create a disconnected tester that lacks context or reduce the agent to a prerecorded plan. Codex owns the semantic review and verdict. The persistent runner owns infrastructure, credentials, proof integrity, publication, and teardown; Codex cannot control those surfaces.

## Authentication and GitHub

- TrialRun account authentication starts with email/password and opaque server-side sessions.
- Hash passwords with Argon2id. Never store or log plaintext passwords.
- Cookies are HttpOnly, Secure in production, SameSite=Lax, rotated after authentication, and protected against CSRF on mutations.
- GitHub is linked after account creation through OAuth/GitHub App installation.
- Prefer installation tokens generated just in time. Do not store long-lived GitHub personal access tokens.
- GitHub App permissions must be minimal: repository metadata and contents read; pull requests, checks, and issues/comments write only where required.
- Verify GitHub webhook HMAC signatures before parsing or enqueueing work.
- Every repository, secret, review, artifact, and job query must enforce ownership or installation membership.
- Subscribe to pull request, installation, repository, check-run, and issue-comment webhooks needed by the product. A comment command is accepted only from a user whose current repository permission satisfies the command (`write` for run/explain/cancel and `maintain` or `admin` for recipe confirmation/change).
- Supported commands are deliberately small: `@trialrun analyze`, `@trialrun confirm`, `@trialrun run`, `@trialrun explain`, and `@trialrun cancel`. Parse exact commands; never execute arbitrary comment text as a prompt or shell instruction.

## Secret and untrusted-code rules

Repository code and pull requests are untrusted.

- Accept only test credentials. The UI and docs must explicitly reject production database, payment, cloud, or personal credentials.
- Encrypt stored repository secrets with AES-256-GCM using a versioned server key; keep name, IV, ciphertext, and auth tag separate.
- Decrypt secrets only while preparing an execution environment. Do not place secret values in prompts, event payloads, screenshots, URLs, command arguments, or logs.
- GitHub App keys, session keys, model credentials, and Zerops tokens stay in the persistent control plane and are never injected into tested code.
- Redact known secret values from stdout, stderr, browser console, HTTP headers, and artifacts before persistence.
- Short-lived generated fixtures are preferred over customer-supplied secrets.
- A tested application can intentionally exfiltrate any secret it receives. Isolation reduces blast radius but cannot make production secrets safe; documentation must state this plainly.

## Review verdict contract

- Codex returns **pass**, **fail**, or **inconclusive** from its full code and runtime investigation.
- A reproduced claim must cite evidence IDs recorded by this exact review. A code-only concern stays visibly unproven.
- The runner may stop publication or mark the workflow inconclusive when provenance, infrastructure, artifact integrity, GitHub delivery, or teardown fails. It must never turn one valid Codex verdict into another by interpreting assertions itself.

Never convert missing evidence into a pass. Never call a local fixture run a live Zerops result.

## Evidence contract

Each completed review must preserve:

- repository, PR number, immutable base SHA, and immutable head SHA;
- the typed live mission plus the exact ordered action/observation ledger;
- environment provider and disposable project/service identifiers;
- timestamps for build, ready, execution, artifact capture, and teardown;
- base and PR screenshots captured at Codex-chosen checkpoints;
- browser console and failed network requests;
- normalized assertion results and first behavioral divergence;
- relevant application/build logs with secrets redacted;
- artifact SHA-256 hashes;
- final teardown status;
- GitHub Check/comment delivery status.

Artifacts must show what happened. A prose-only agent claim is not evidence.

## Zerops lifecycle contract

The real provider uses current official Zerops APIs and schemas only:

1. Import one temporary project from generated YAML through `POST /client/{clientId}/project/import`.
2. Create two policy-generated copies of the approved application graph (`base*` and `head*`) plus one fixed TrialRun executor. Base and head receive separate managed dependencies and private hostnames.
3. Download public or private source through the GitHub App at exact SHAs and upload it with `zcli push`; never embed a GitHub token in a URL, YAML, command argument, or persisted file. Generate a fresh TrialRun-owned `zerops.yaml` for each approved application plan and bind each side only to its own dependency names. Never deploy or modify a customer manifest.
4. Wait for returned processes and readiness. Application services remain private unless the approved recipe explicitly requires public access; the temporary executor may expose a token-protected control endpoint for the persistent runner.
5. Start the bounded live Codex session after readiness; let it observe and drive the in-project browser tools interactively while streaming every action, observation, and checkpoint as durable events.
6. Copy sanitized evidence to persistent object storage.
7. Delete the exact project through `DELETE /project/{projectId}`.
8. Wait for deletion and record proof. Cleanup also runs after cancellation, failure, timeout, or worker restart.

Do not delete projects whose ID was not created and persisted by the same review. A cleanup sweeper may only target TrialRun-tagged projects with a matching review record and expired lease.

The cleanup sweeper reconciles the database, not guessed cloud names: it selects nonterminal Zerops reviews with a persisted provider project ID, an expired review/job lease or overdue teardown, and no completed teardown proof. It locks the review, verifies the exact project ID and TrialRun ownership marker, retries deletion with bounded attempts, and records either proof or an honest cleanup failure. It never lists and mass-deletes an organization.

## Technical rules

- TypeScript is strict; do not add `any`, unchecked casts, or unvalidated external JSON.
- Zod validates every environment variable, webhook, external API response, form, and agent-produced plan.
- PostgreSQL queries are parameterized. Index foreign keys and hot ownership/status/time access paths.
- Use cursor pagination for growing review/event lists.
- Keep code KISS and DRY. Prefer a typed interface with a local and Zerops implementation over provider conditionals spread across the codebase.
- Prefer exact dependency versions and a committed lockfile.
- Use `apply_patch` for hand edits. Preserve unrelated user changes.
- No destructive filesystem or cloud action may use an unresolved variable, broad path, or guessed project ID.

## UI direction

The interface uses the owned specification in `docs/research/trialrun-design-system.md`. Its measured references inform geometry only, never TrialRun branding. Implement the system with Tailwind CSS v4 semantic variables and selectively installed shadcn/ui primitives:

- explicit max widths, column grid, gutters, header height, spacing scale, type scale, line heights, border widths, radii, shadows, and colors;
- crisp high-contrast surfaces with restrained decoration;
- real loading, empty, error, running, complete, and teardown states;
- side-by-side base/PR evidence as the memorable center of the product;
- responsive behavior verified at exact desktop, tablet, and mobile widths;
- no generic purple gradients, oversized marketing cards, fake terminal noise, or unmeasured one-off spacing.
- configure `components.json`, `@/*` aliases, RSC mode, CSS variables, and `cn()` before adding shadcn components;
- preserve Radix/shadcn accessibility, labels, ARIA state, keyboard behavior, and visible focus indicators;
- make skeletons match loaded geometry to prevent layout shift, and make empty states explain the next action.

Visual verification must combine screenshots with computed DOM measurements: bounding boxes, overflow, computed fonts, colors, borders, radii, spacing, focus states, and contrast. Do not approve a page by visual impression alone.

## Documentation sources

Use primary/current documentation and save any implementation-critical conclusions under `docs/research/` with URL and check date:

- Zerops docs, REST SDK/OpenAPI, zCLI, recipes, and ZCP
- GitHub Apps, OAuth, Checks, webhooks, and Octokit
- Next.js
- PostgreSQL and Drizzle
- Playwright
- selected object-storage/S3 client
- Codex/ZCP authentication only from official OpenAI and Zerops sources

Greptile TREX is competitive research, not a specification. TrialRun must remain differentiated by immutable base-vs-PR execution, one context-rich live Codex reviewer, Zerops-native disposable environments, mechanically verified proof, and teardown evidence.

The durable evidence and decision record is `docs/research/product-architecture.md`. The current work ledger is `docs/TASKS.md`. Zerops documentation, Go SDK, zCLI, and recipe snapshots live under `/Users/aryankumar/zerops-rank1-research`; record exact commits in the research document whenever refreshed.

During development, bounded DeepSeek V4 Flash workers may be run through the local OpenCode orchestration skill for architecture, security, code-quality, and UI audits. Task packets live under `.data/tasks/`, omit credentials and unrelated files, prohibit browsing/destructive actions unless explicitly required, and default to read-only. Codex remains the lead: inspect every report and diff, verify claims against primary sources/code/tests, and never merge an agent suggestion by authority alone. These audit artifacts are development-only and may be removed before submission.

## Verification gates

Before calling a milestone complete:

- typecheck, lint, unit tests, integration tests, and production build pass;
- migrations apply from an empty PostgreSQL database;
- authentication, authorization, CSRF, webhook signature, encryption, and redaction tests pass;
- a real local integration test creates a temporary Git repository with two commits, analyzes it, validates and confirms its recipe, checks out both immutable SHAs, boots them, drives Chromium, captures artifacts, finds the introduced regression, and tears down the repository and both applications;
- cancellation and forced runner interruption still lead to cleanup or an honest inconclusive result;
- repeated runs do not leak processes, ports, database rows outside retention rules, or plaintext secrets;
- desktop and mobile interfaces have no unexpected overflow and meet keyboard/focus requirements;
- Zerops YAML validates against the live schema before deployment;
- live mode is not declared complete until a real temporary Zerops project has been created, tested, and deleted.

## Hackathon qualification gates

The WeMakeDevs Zerops Challenge entry must be a working live Zerops deployment, not a local recording. The persistent deployment must visibly use at least the separate web, runner, PostgreSQL, and object-storage services. Judges must have reliable read access to the submitted source repository. Before filing the form, re-check the live rules and create `docs/SUBMISSION.md` only from verified URLs and evidence. The recorded form requirements and judge proof are in `docs/research/challenge-requirements.md`.

## Immediate live-delivery handoff — 8 August 2026

This section is the current operational truth. Update it after every external setup or live proof.

### Confidentiality and public identity

- Keep the TrialRun source repository and every proof repository private until Aryan explicitly authorizes hackathon submission access. Never flip repository visibility as an implementation convenience.
- The production hostname is `trialrun.aryankumar.dev`. The Cloudflare API token is stored only in the mode-600 ignored file `.data/secrets/cloudflare.env`; never print, copy into documentation, commit, or inject it into tested applications.
- The Cloudflare token has been verified against the active `aryankumar.dev` zone. Do not guess zone identifiers or mutate unrelated DNS records. Resolve the exact existing/target record before any create/update/delete.
- The Zerops integration token remains in macOS Keychain service `ai.trialrun.zerops.integration`, account `trialrun`. Never export it into tracked files.
- The verified active Zerops client is `ZgSxpwpcTNK52gMLBrlhQA` (`aryan877`, ADMIN). The client ID is not a secret, but every mutation must still use this exact persisted target and the isolated zCLI configuration required by the TrialRun Zerops skill.

### GitHub identity and live state

- The intended GitHub App is **TrialRun by Aryan**, App ID `4526353`, slug `trialrun-by-aryan`, public page `https://github.com/apps/trialrun-by-aryan`.
- Verified repository permissions are Checks write, Contents read, Issues write, Metadata read, and Pull requests read. Verified subscribed repository events are `pull_request` and `issue_comment`; GitHub supplies installation lifecycle deliveries automatically rather than as selectable repository events. The live webhook URL is `https://trialrun.aryankumar.dev/api/github/webhook`, its secret is configured, and SSL verification is enabled. The installation and selected private repository are linked in the live product. Real private reviews have published both Check Runs and a bot PR comment; the release gate is now one final non-inconclusive review containing the complete browser/API proof.
- The webhook secret and GitHub App client secret are stored in macOS Keychain under the `ai.trialrun.github.webhook-secret` and `ai.trialrun.github.client-secret` services with account `trialrun`. The valid RSA App private key is stored only at ignored mode-600 path `.data/secrets/github-app-private-key.pem`. Never print, commit, copy into tested code, or place any of these values in prompts.
- GitHub App installation `152212731` is active, unsuspended, owned by `aryan877`, uses selected-repository access, and is scoped only to the private repository `aryan877/trialrun-proof`. Minting a repository-scoped installation token has been live-verified. The private source repository is `aryan877/trialrun`; both repositories remain private until Aryan explicitly authorizes judge access or submission.
- The original one-time callback code was never reused or persisted. The live TrialRun account now owns the selected-repository installation and shows `aryan877/trialrun-proof`; all future installation changes must still use a fresh signed state.
- Product authentication has exactly one path: TrialRun email/password. After login, the user installs the one GitHub App on selected repositories. The same GitHub App's built-in OAuth authorization is used transiently only to prove that the signed-in TrialRun user can access the returned installation; delete the temporary GitHub user token immediately. This is not a second product login and not a separate OAuth App. Do not accept an unverified installation ID and never substitute a personal access token.
- Keep the proof repository private. A real success gate is one private PR receiving a TrialRun Check and comment from the App after a live Zerops review, with artifacts and teardown proof visible only to its authorized owner/judges.

### Current product and design state

- The public landing page and `/login` were rebuilt on 8 August. Public pages are light, sentence-case, image-led, use Instrument Sans plus Phosphor icons, and use the owned asset `apps/web/public/brand/trialrun-evidence-field-v1.jpg`. The authenticated dashboard intentionally remains dark.
- The current landing was rendered and measured at 1440×1000, 1024×1000, 768×1000, and 390×844. It has no horizontal overflow, its desktop hero fits the viewport, keyboard focus remains visible, and web lint, strict typecheck, tests, and production build pass. Re-run the same checks after material UI edits.
- A judge account must be a real seeded email/password database user, not a hardcoded bypass. Generate its password at deployment time, store it outside Git, and disclose it only in the private judge handoff/submission.
- Local development currently uses PostgreSQL at `127.0.0.1:55432` and the Next.js dev server at `http://localhost:3000`. The production control plane and disposable-review lifecycle are both live-proven in parts; local checks still do not substitute for the final combined browser/API release run.
- The production import is rendered from tracked `zerops-project-import.yaml` by `pnpm live:render-import`. The rendered `.data/live/zerops-project-import.yaml`, generated judge credential state, Cloudflare token, GitHub credentials, and Zerops token are ignored mode-600 files or Keychain items and must never be committed or printed.
- The tracked persistent topology, runner setup, native Ubuntu/Node Chromium executor, and dedicated web-artifact setup validate against the current live Zerops schemas. The disposable executor uses `ubuntu/nodejs@24` plus the exact Playwright headless-shell/FFmpeg install; do not restore the slower Docker-VM executor.
- The persistent runner intentionally uses `MANAGED_CODEX_HOME=/home/zerops/.codex`. Its official device login is active and has completed real live review threads. Preserve that exact home during source hotpatches and never populate it by reading or copying a local Codex credential cache.
- The deployed Codex binary is the relocatable package entry point at `/var/www/.deploy/runner/node_modules/.pnpm/node_modules/@openai/codex/bin/codex.js`; the nested SDK `.bin` shim is not relocatable after `pnpm deploy` and must not be restored. The current runner filesystem has no proven persistence across replacement, so finish the final runner deployment before asking Aryan to authenticate and treat a later rebuild as requiring reconnection.
- The last complete repository-wide gate before the current API work was green after the source-stamped release helper: lint, strict typecheck, package suites, production build, Linux artifact verification, and every migration applied to a brand-new PostgreSQL database. The new API slice has separate green typecheck/lint/full executor, agent-runtime, runner, and real-Chromium integration coverage; rerun the repository-wide gate before release.

### Persistent production truth

- The persistent Zerops project `RpepTuuvSLGAZ8exBf6vog` contains separate active web, runner, PostgreSQL, and object-storage services. `https://trialrun.aryankumar.dev/api/health` returns `ready`, and the live landing, authenticated dashboard, connected private GitHub repository, recipe UI, evidence UI, and Codex connection settings render from this control plane.
- The Next.js web application is built as a source-stamped Linux/amd64 standalone artifact. Release it with `pnpm web:artifact:linux` followed by `pnpm web:artifact:deploy`; deployment rejects a missing or stale source stamp, waits for Zerops's deploy process, and finishes only after the database-backed health route passes. Use Zerops `service deploy` for this prebuilt artifact; `service push` incorrectly asks Zerops to rebuild it and was the cause of the previous restart loop. The canonical web setup is `ops/web-artifact.zerops.yaml`; root `zerops.yaml` deliberately contains only the runner and fixed executor setups. The repeat release `trialrun-web-source-stamped-20260809` completed successfully, and the exact web service is active afterward.
- The runner is active and processing durable jobs with the pinned managed Codex connection. Repository analysis, private exact-SHA staging, disposable Zerops provisioning, live Codex/Chrome control, evidence persistence, GitHub Check/comment publication, and exact teardown have all executed on the private proof PR. Preserve the active managed Codex home while shipping source changes.
- The abandoned `trialrun-codex-spike` project was explicitly deleted after confirming that it contained only the expired development ZCP service. Zerops now lists only the persistent `trialrun` project. The temporary hackathon-server Zerops login is logged out, its VPN interface is down, and its WireGuard configuration was removed; recreate a short-lived connection only when a private-network diagnostic genuinely requires it.

### Live execution truth

- The product path now runs one live Codex thread with read-only repository tools and stateful browser tools; it no longer replays a fixed test plan. It records a typed mission, thread/events/usage, exact code citations, browser ledger, assertions, checkpoints, logs, and teardown.
- DeepSeek/OpenCode audit found a false-pass weakness in assertion pairing, report-text secret persistence, browser-session time starting before provisioning, secret-bearing screenshots, late-abort GitHub divergence, and missing immediate teardown ownership revalidation. These findings have been remediated with targeted tests; the complete local gate now passes. Continue using bounded re-audits before the live judge proof.
- Codex now owns the semantic verdict in its typed terminal report. The runner verifies that cited evidence IDs and source lines exist, checks artifact bytes and hashes, publishes the verdict unchanged, and proves cleanup. The removed fixed-plan executor and deterministic oracle must not be restored.
- The disposable lifecycle is live-proven in parts: exact private SHAs and isolated PostgreSQL-backed apps reached ACTIVE, Codex read the repository and drove real Chrome, PNGs and genuine Playwright WebMs were byte/hash verified in object storage, GitHub Check/comment publication ran, and exact project deletion was followed by typed `projectNotFound` absence proof. The remaining release gate is one fresh review on the Codex-owned verdict path that combines repository, browser, and API evidence.
- The persistent control plane must itself be deployed on Zerops with separate web, runner, PostgreSQL, and object-storage services. A generic SSH host may assist staging but cannot replace this challenge requirement.

### Final no-shortcuts gate

Do not stop at a polished landing page. Completion requires all of the following verified facts: private GitHub App auth/install, private repo/PR ingestion, policy-confirmed per-repository topology, real disposable Zerops provision, live Codex code+browser/API investigation, a provenance-verified Codex verdict, persisted artifacts, GitHub Check/comment, exact teardown proof, persistent Zerops deployment, `trialrun.aryankumar.dev` DNS/TLS, real judge login, and a submission document containing only URLs that were opened and tested.

### Overnight submission contract — 9 August 2026

- Treat the dedicated customer ZCP workspace as a first-class connection mode, never a cosmetic or “beta” card. Mark it connected only after device login and one real bounded Codex invocation succeed. Use official `codex login --device-auth`; never read, copy, upload, or otherwise reuse a local Codex auth cache.
- Keep managed Codex available for the first full proof. Every analysis/review job snapshots one exact `agentConnectionId`, so changing the account setting affects only future jobs and a job never switches credentials midway.
- Finish one private proof pull request end to end: exact GitHub SHAs, TrialRun-generated Zerops topology, isolated base/head services and dependencies, live Codex code review plus adaptive Chrome/API control, a Codex-authored verdict with verified citations, screenshots and secret-safe base/PR WebM recordings, persistent artifacts, GitHub Check/comment, exact project deletion, and absence proof.
- The final agent surface must test backend behavior too. The bounded API request/assertion tools let Codex call the real private base/head services, reuse browser-session cookies or explicitly named test secrets, and compare authenticated endpoint behavior. Lock every request to the two fixed review origins, redact and cap responses, and persist request facts. Codex decides what those facts mean.
- The finding page must make the PR recording the primary behavior proof and show the matching base recording for comparison. Store each recording once by hash; findings point to time ranges rather than duplicating or re-encoding video.
- The judge README and submission must use only real captured proof. Include the verified JSON-generated architecture SVG, official locally stored technology marks with source/attribution, live product and GitHub links, the real PR/Check/evidence/teardown path, threat boundaries, and a short repeatable walkthrough. Never publish TrialRun credentials.
- Improve the landing page copy and product visuals only with claims demonstrated by the real run. Explain in one view that Codex understands the code, Zerops boots both commits, Chrome proves behavior, GitHub receives evidence, and the temporary project is deleted.
- Before handoff, run full lint, strict typecheck, tests, production build, clean-database migrations, responsive/computed-geometry checks, security and artifact checks, then bounded DeepSeek/OpenCode code-quality and security passes. Remove unused files, empty directories, temporary audit packets, personal references, and stale claims only after preserving required private live evidence.
- Keep both source and proof repositories private until Aryan explicitly authorizes judge access or submission visibility.

### Final clean-proof presentation contract — 9 August 2026

- Do not use the development-noisy proof PR as the submission centerpiece. After the release code is fixed, create one fresh private proof PR with a clean conversation and run it once through the real product path.
- Before that run, remove only old failed/inconclusive proof-review rows, jobs, findings, artifact metadata, and their corresponding development artifacts. Preserve the user account, sessions needed for the operator, GitHub App installation, selected `trialrun-proof` repository, confirmed recipe, encrypted repository settings, and authenticated managed Codex home. Resolve exact row/object IDs before deletion; never broad-delete by guessed name.
- The fresh GitHub result must stand on its own: one concise bot Check and PR comment with Codex's verdict, exact behavioral change, code citations, base/PR screenshots, genuine optimized WebM proof, hashes, and teardown outcome. GitHub remains the review surface; TrialRun's persistent Zerops dashboard stores the complete duplicate evidence trail.
- Product automation must not depend on a human uploading attachments. Persist each compact recording once in Zerops object storage and expose only a review-scoped, read-only proof player/link suitable for the bot comment. A GitHub-native attachment may be an optional future enhancement, never the required path.
- Never publish, prefill, document, or commit a judge/demo email or password. Remove the runtime public credential-card path from login/landing/README. Aryan keeps the private demo login out of the repository and enters it himself while recording.
- The final landing, README, submission copy, and small architecture diagram must be rewritten from the successful run: sharp one-screen explanation, no AI filler, no giant unreadable SVG, no dark-mode-invisible marks, no fake proof, and no stale failed-run claims. Show that Codex understands the code and dynamically tests both the real UI and relevant authenticated APIs; Zerops boots both immutable commits and stores evidence; GitHub receives the result; the exact temporary project is deleted.
- Before submission, remove development-only task ledgers, DeepSeek packets/reports, stale screenshots, temporary evidence, personal machine paths/references, empty folders, dead code, and unused assets after retaining the minimum private evidence needed for the verified judge story.

## Current implementation status

- Product decision and architecture: locked.
- Reference design measurement and owned token direction: complete.
- New pnpm/Turbo domain, database, executor, and runner scaffold: complete.
- Previous hardcoded demo path: fully removed from runtime code and test fixtures. The executor integration test now creates and deletes a temporary two-commit Git repository.
- Secret-bearing browser runs: privacy-safe mode implemented; trace, video, screenshots, and persisted DOM snapshots are disabled.
- Durable queue: atomic claims, unique runner identities, heartbeats, timeouts, bounded lease recovery, and PostgreSQL integration tests implemented.
- Web control plane, email/password authentication, dashboard, review evidence/artifact route, connection settings, and the rebuilt public/login UI: implemented and deployed on the persistent Zerops project. The live health route and authenticated judge flow are verified.
- GitHub App client/webhook code: implemented and tested; real credentials, minimal permissions/events, active selected-repository installation, private repository token scope, live account association, and repository display are verified. Webhook delivery, Check, and comment remain pending until the first review.
- Typed proposal, deterministic policy, compiled base/head topology, immutable recipe versions, maintainer confirmation persistence, bounded repository discovery, and agent analysis are implemented, tested, and exercised against the private proof repository.
- Real repository local execution: exact SHA staging, recipe-driven Docker boot, live Chromium/API execution, evidence/privacy policy, and verified teardown integration tests.
- Live Codex execution: repository view/MCP, stateful browser/API MCP, agent mission/report persistence, provenance verification, secret-safe WebM recording, artifact delivery, and review UI are implemented and tested. Real Chrome control is proven; authenticated API requests are locally proven with real Chromium and still need the final production run on the Codex-owned verdict path.
- Real Zerops execution: generated import/schema checks, private zCLI source delivery, token-protected native Chromium executor, explicit subdomain enablement, evidence retrieval, and DB-owned orphan cleanup are implemented and exercised. The exact create/deploy/test/publish/delete lifecycle has run on the private PR; the final clean browser-plus-API verdict is still pending.
- Dedicated customer Codex workspace: ZCP import, pinned bridge, official device-code flow, encrypted short-lived challenge, signed runner calls, bounded analysis/review invocation, logout, exact ownership validation, deletion, and 404 proof are implemented and locally tested. Do not label a workspace connected until its first live invocation succeeds; live ZCP proof remains pending.

Update this section as work lands. Do not erase limitations to make the project appear further along.
