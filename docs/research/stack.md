# Implementation contracts

Checked: 2026-08-08

This file records the externally verified contracts that constrain TrialRun. It is
not a substitute for the linked primary documentation.

## GitHub App

Primary sources:

- <https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app>
- <https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url>
- <https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries>
- <https://docs.github.com/en/rest/checks/runs>

Decisions:

- Use a GitHub App, not a personal access token. Create short-lived installation
  tokens just in time and request only repository metadata/read, contents/read,
  pull requests/read, checks/write, and issues/write if PR comments are enabled.
- Treat `installation_id` on the setup URL as untrusted. Link it only after a
  user access token proves that the signed-in GitHub user can access the
  installation.
- Verify `X-Hub-Signature-256` against the untouched request bytes using
  HMAC-SHA256 and a constant-time comparison before parsing JSON.
- Deduplicate deliveries by `X-GitHub-Delivery`.
- Checks API output annotations are limited to 50 per request. TrialRun's first
  release produces a compact check summary and links rich runtime evidence back
  to the review page.

## Playwright evidence executor

Primary sources:

- <https://playwright.dev/docs/api/class-browsercontext>
- <https://playwright.dev/docs/api/class-video>
- <https://playwright.dev/docs/trace-viewer>
- <https://playwright.dev/docs/test-snapshots>

Decisions:

- One isolated browser context per side of a review. Never reuse storage state
  between repositories, reviews, or base/PR applications.
- Record console events, page errors, HTTP responses with status >= 400, true
  transport failures, screenshots, video, and a Playwright trace.
- HTTP 4xx/5xx responses are response events, not `requestfailed` events; capture
  both channels explicitly.
- Fix viewport, locale, timezone, reduced motion, color scheme, and browser
  version to make matched comparisons reproducible.
- The deterministic oracle evaluates typed assertions. Screenshot pixel distance
  can be supporting evidence, but rendering variance never becomes the only oracle.

## Next.js and PostgreSQL

Primary sources:

- <https://nextjs.org/docs/app/api-reference/functions/cookies>
- <https://orm.drizzle.team/docs/get-started-postgresql>
- <https://orm.drizzle.team/docs/transactions>
- <https://orm.drizzle.team/docs/migrations>

Decisions:

- Use async `cookies()` in Next.js 16. Set or delete cookies only in server actions
  or route handlers before streaming begins.
- Keep opaque sessions server-side and derive synchronizer CSRF tokens from the
  session token plus a separate secret.
- Infer TypeScript row/insert types from Drizzle schema. This replaces the user's
  proposed Supabase type generator without moving the core database away from
  Zerops managed PostgreSQL.
- Generate and commit SQL migrations. Do not use schema push in production.
- Claim durable jobs in a short transaction with `FOR UPDATE SKIP LOCKED`, then
  perform external work after commit.

## Codex planner adapter

Primary sources:

- <https://developers.openai.com/codex/cli/reference>
- <https://developers.openai.com/codex/auth>

Locally verified CLI: `codex-cli 0.147.0`; `codex login status` reported ChatGPT
authentication without exposing credentials.

Decisions:

- The local adapter invokes `codex exec` with `--ephemeral`, `--sandbox read-only`,
  `--ignore-user-config`, and `--output-schema` in an isolated checkout. The CLI
  confirms authentication through its own credential store; TrialRun never reads
  that store.
- Official docs support ChatGPT subscription or API-key authentication for local
  clients. Headless environments can use device-code authentication when enabled.
- Hosted bring-your-own-Codex is one isolated workspace/home per customer. The user
  completes the login flow there. TrialRun must never ask users to paste
  `auth.json`, browser cookies, or raw refresh/access tokens into the web UI.
- Codex produces only a bounded typed plan. TrialRun's executor performs actions
  and the deterministic oracle owns the verdict.

## Zerops execution provider

Primary local corpus:

- `/Users/aryankumar/zerops-rank1-research/docs`
- `/Users/aryankumar/zerops-rank1-research/zerops-go`
- `/Users/aryankumar/zerops-rank1-research/zcli`
- `/Users/aryankumar/zerops-rank1-research/zerops/recipes`

Verified endpoints:

- project import: `POST /api/rest/public/client/{clientId}/project/import`
- process read: `GET /api/rest/public/process/{processId}`
- service read: `GET /api/rest/public/service-stack/{serviceStackId}`
- project deletion: `DELETE /api/rest/public/project/{projectId}`

The import response is validated as a project ID/name plus service-stack IDs,
names, and process IDs. Cleanup uses only a project ID persisted by the same
review. Public `buildFromGit` supports immutable refs. Private repository source
delivery remains deliberately disabled until an installation-token-safe upload or
clone path is implemented and verified; tokens must not be embedded into project
YAML or clone URLs.
