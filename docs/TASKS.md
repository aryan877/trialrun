# TrialRun delivery ledger

This is the execution ledger. A checked box means code and its stated verification exist. “Implemented” is not “live-proven.” Live Zerops and GitHub gates remain unchecked until exercised against the real services.

## 0. Remove the false product path

- [x] Delete the fixed demo application files.
- [x] Remove every `demo` source enum, command, planner branch, fixture path, seed, test assumption, fake SHA, and canned result.
- [x] Make tests create and delete temporary real Git repositories with two commits.

## 1. Typed repository recipe

- [x] Add Zod schemas for repository evidence, application services, dependencies, bindings, citations, proposal, policy result, and confirmed recipe.
- [x] Implement full safe-repository tree/search/read discovery with path, size, depth, generated-directory, credential-file, and symlink controls; remove the hardcoded manifest list.
- [x] Implement deterministic policy with service/resource/network/path/readiness limits.
- [x] Compile an approved recipe into isolated base/head Zerops import data and fresh TrialRun-owned deployment manifests; never require or deploy customer `zerops.yaml`.
- [x] Unit-test accepted, rejected, ambiguous, and topology-changing proposals.

## 2. Persistence

- [x] Add immutable versioned repository recipes and confirmation audit fields.
- [x] Add agent connections without any CLI auth-cache storage.
- [x] Add review recipe version, cleanup ownership marker, deletion attempts, and proof fields.
- [x] Add encrypted repository secrets with key versioning and redaction utilities.
- [x] Generate and apply migrations from a clean PostgreSQL database.
- [x] Add ownership and hot-path indexes and integration tests.

## 3. Authentication and GitHub App

- [x] Email/password registration, Argon2id hashing, opaque server sessions, CSRF protection, rotation, logout, and authorization tests.
- [x] GitHub App configuration schema and signed state/installation association.
- [x] Raw-body webhook HMAC verification and delivery idempotency.
- [x] Pull-request SHA resolution and private archive download through a just-in-time installation client.
- [x] Exact permission-gated `analyze`, `confirm`, `run`, `explain`, and `cancel` commands.
- [x] Check Run creation/update with bounded annotations and evidence links.
- [x] Create the real GitHub App with minimal permissions/events, real credentials, and an active installation restricted to the private proof repository.
- [x] Link the installation through a production signed TrialRun session and display its selected private repository.
- [ ] Record live webhook, Check, and comment proof from the first disposable review.

## 4. Codex connection

- [x] Managed server-side Codex test pilot with a resumable live tool loop plus time/token/action limits.
- [x] Encrypted BYOK provider with replacement/revocation and boundary tests that never return the stored value.
- [x] Dedicated ZCP workspace connection record and signed bridge protocol for bounded analysis and live review threads.
- [x] Device-code sign-in UI that stores only an encrypted, expiring challenge and never handles or copies the Codex auth cache.
- [x] Give Codex read-only repo/diff context and stateful browser/API/log tools without shell, arbitrary JavaScript/URLs, filesystem, or infrastructure credentials.
- [ ] Live-prove invoke, revoke, and delete for one dedicated workspace.

## 5. Execution

- [x] Replace fixture-bound local provider with a recipe-driven local container lifecycle for the bounded local topology.
- [x] Stage exact base/head Git SHAs into separate workspaces.
- [x] Build a foundational paired semantic Chromium executor against both sides.
- [x] Capture matched screenshots, assertions, console, failed requests, logs, hashes, and first divergence, plus secret-safe base/PR WebM recordings with paired finding UI. Real live-review evidence remains a separate gate.
- [x] Replace fixed-plan replay in the product path with a stateful live Codex observe/act/observe tool session; keep the typed object only as mission, capability, secret-name, and budget policy.
- [x] Persist every live tool observation/action/result and support side switch, deterministic reset, and matched checkpoints. A visual-model fallback is intentionally deferred.
- [ ] Test cancellation, timeout, process crash, redaction, and cleanup.

## 6. Zerops provider

- [x] Validate generated import YAML against the pinned current Zerops schema; live schema acceptance remains a separate gate.
- [x] Implement creation of a disposable project with duplicated base/head dependency graphs and fixed executor; live proof remains open.
- [x] Implement private base/head source upload with explicit-ID `zcli service push`; live proof remains open.
- [x] Implement build/process/readiness waits and build/application log collection; live proof remains open.
- [x] Implement a token-protected, one-review stateful browser-tool bridge with no reusable credentials or arbitrary automation surface.
- [ ] Copy sanitized artifacts to persistent Zerops object storage.
- [x] Implement exact-project deletion and persisted deletion proof; add the final ownership re-read and live-prove it before closing this gate operationally.
- [x] Implement and test the DB-driven orphan reaper.
- [ ] Live-prove create, deploy, execute, publish evidence, and delete on Zerops.

## 7. Web product

- [x] Owned TrialRun landing/sign-in experience using the current public design system and original brand artwork.
- [x] Real email/password signup/login/logout; live first-run GitHub App installation remains open.
- [x] GitHub installation and repository selection.
- [x] Repository evidence and topology proposal confirmation/change flow.
- [x] Test-secret management and managed/API-key/ZCP Codex connection settings.
- [x] Review list, live event timeline, side-by-side base/head evidence, finding detail, and teardown proof.
- [ ] Honest loading, empty, error, blocked, running, complete, inconclusive, cancelled, and cleanup-failed states.
- [x] No fake review rows, fake logs, decorative status dots, fake terminal output, or copied fal.ai branding.

## 8. Verification and submission

- [x] Exact dependency pins and clean lockfile.
- [x] Lint, strict typecheck, all package suites (170 tests in the latest complete run), and production build pass locally.
- [x] Temporary two-commit local repository finds an introduced behavioral regression and proves both containers and temporary workspaces are removed without persisting visual/DOM evidence in secret-safe mode.
- [x] Desktop/tablet/mobile screenshot and computed geometry/overflow/focus checks at 1440, 1024, 768, and 390 CSS pixels; browser-verified SVG geometry and accessibility checks pass.
- [x] Bounded DeepSeek/OpenCode architecture, security, code-quality, and UI audits run; identified P0/P1 findings are still being remediated and re-verified.
- [x] Render a secret-safe ignored persistent Zerops import from Keychain and generated deployment state; validate both the import and deployment manifest against the current live Zerops schemas.
- [x] Production-standalone local smoke test proves database-backed readiness, owned public assets, real seeded judge authentication, and the authenticated dashboard.
- [ ] Publish the judge-facing README with verified TrialRun UI/evidence screenshots, an overlap-checked SVG architecture diagram, locally stored official technology marks with source/attribution, threat model, setup guide, judge credentials, and 90-second demo path. The draft, verified diagram, marks, and attribution exist; real PR/Check/WebM/teardown links intentionally remain release blockers.
- [ ] Live GitHub PR receives a Check backed by a live Zerops run and teardown proof.
- [x] Persistent live Zerops project exposes the working product and contains separate web, runner, PostgreSQL, and object-storage services.
- [ ] Judges can read the submitted repository and open the exact repository URL in the form.
- [ ] Create `docs/SUBMISSION.md` from verified facts: title, description, repository, live URL, architecture, prepared PR, Check/evidence, teardown, limitations, and walkthrough.
- [ ] Re-read the live challenge rules immediately before filing and complete every required form field.
