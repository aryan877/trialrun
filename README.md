<p align="center">
  <img src="docs/assets/logos/trialrun.svg" width="72" height="72" alt="TrialRun" />
</p>

<h1 align="center">A code review that opens the app.</h1>

<p align="center">
  Codex reads the PR, runs both commits on Zerops, drives their UIs in real Chrome, calls their APIs, and posts a video-backed verdict to GitHub after the test project is gone.
</p>

<p align="center">
  <a href="https://trialrun.aryankumar.dev"><strong>Open TrialRun</strong></a> ·
  <a href="https://github.com/apps/trialrun-by-aryan">Install the GitHub App</a> ·
  <a href="https://github.com/aryan877/trialrun-proof/pull/4">See the proof PR</a>
</p>

<!-- TRIALRUN_FINAL_PROOF_START -->

> The final private proof run is in progress. This block is replaced with the real Check, comment, screenshots, WebMs, hashes, and teardown result before release.

<!-- TRIALRUN_FINAL_PROOF_END -->

## One PR. One live review.

1. **Understand it.** Codex explores the repository and diff, then decides how the app should run and what deserves testing.
2. **Run it.** Zerops boots the exact base and PR commits as separate apps with separate data. No `zerops.yaml` required.
3. **Prove it.** The same Codex session checks code, UI, APIs, logs, and failures live. TrialRun records the evidence, deletes the temporary Zerops project, and posts the verdict to GitHub.

## The loop in one diagram

![A pull request enters TrialRun, Zerops boots the base and PR apps, Codex tests them in Chrome, Zerops deletes the temporary project, and GitHub receives the verdict and video](docs/assets/trialrun-architecture.svg)

Codex owns the review and verdict. TrialRun owns the credentials, cloud lifecycle, evidence integrity, GitHub delivery, and cleanup.

## TrialRun runs on Zerops. Each review gets its own lab.

TrialRun itself runs on Zerops as four services: the web app, runner, PostgreSQL, and object storage.

Each review creates one more short-lived Zerops project containing:

- the base app and its private data;
- the PR app and separate private data;
- a native Chromium executor that both apps can reach over the project's private network.

The runner waits for every service to become ready before Codex starts. When the review ends, it deletes that exact project ID and waits until Zerops confirms it no longer exists.

## What lands in GitHub

- Codex's `pass`, `fail`, or `inconclusive` verdict;
- exact code citations and a short explanation;
- matched base/PR screenshots;
- compact, genuine browser recordings;
- a read-only evidence page with hashes, logs, API results, and teardown proof.

The recording shows what happened. Codex writes the verdict; TrialRun verifies its cited proof before publication.

<details>
<summary><strong>Safety boundaries</strong></summary>

Customer code is untrusted. Codex can read the safe repository view and use TrialRun's narrow browser, API, and log tools. It cannot run arbitrary shell commands, write the checkout, call random hosts, or hold GitHub and Zerops credentials.

The tested app receives only approved test values. Never use production database, payment, cloud, or personal credentials: any app can leak a value it receives.

Every artifact is redacted, size-bounded, and SHA-256 checked before publication. A missing artifact, failed GitHub delivery, or unproved deletion cannot become a successful review.

</details>

<details>
<summary><strong>Managed Codex or your own subscription</strong></summary>

Every job is pinned to one Codex connection before it starts. TrialRun-managed Codex is the default. A customer can also connect their own subscription inside a dedicated Zerops ZCP workspace through OpenAI's device login.

TrialRun never reads or copies `~/.codex/auth.json`. The workspace receives only short-lived access to one review's repository and live testing tools.

</details>

## Run it locally

You need Node.js 22+, pnpm 9.15.5, and Docker Compose.

```bash
git clone https://github.com/aryan877/trialrun.git
cd trialrun

corepack enable
corepack prepare pnpm@9.15.5 --activate
pnpm install --frozen-lockfile

cp .env.example .env
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The source repository is private during judging, so cloning requires access. Local reviews are labeled local and never presented as Zerops proof.

```bash
pnpm check
```

## Built with

[Zerops](https://zerops.io) · [OpenAI Codex](https://openai.com/codex/) · [Chrome](https://www.google.com/chrome/) · [Playwright](https://playwright.dev) · [GitHub Apps](https://docs.github.com/en/apps) · [PostgreSQL](https://www.postgresql.org)

The diagram uses official local GitHub, Zerops, and Chrome marks on a light surface so it stays readable in GitHub light and dark mode. Sources and usage notes are in [logo attribution](docs/assets/logos/ATTRIBUTION.md).
