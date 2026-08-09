<p align="center">
  <img src="docs/assets/logos/trialrun.svg" width="72" height="72" alt="TrialRun" />
</p>

<h1 align="center">Codex tests the app you have and the app your pull request creates, live on Zerops.</h1>

<p align="center">
  TrialRun starts both versions with separate data. Codex reads the code, drives Chrome, calls the live APIs, and checks Zerops logs. TrialRun posts the verdict, screenshots, and video to GitHub after Zerops deletes the test project.
</p>

<p align="center">
  <a href="https://trialrun.aryankumar.dev"><strong>Open TrialRun</strong></a> ·
  <a href="https://github.com/apps/trialrun-by-aryan">Install the GitHub App</a> ·
  <a href="https://github.com/aryan877/trialrun-proof/pull/4">See the proof PR</a>
</p>

<!-- TRIALRUN_FINAL_PROOF_START -->

### A real PR. A real regression. Reproduced live.

On [proof PR #4](https://github.com/aryan877/trialrun-proof/pull/4), Codex read the cart change, ran the existing app beside the pull request version, and clicked the same second product in each one. The existing app changed item two. The pull request changed item one. Live API calls still returned the right total, so Codex isolated the bug to the pull request's browser handler and cited the exact lines.

[![TrialRun's public verdict for the reproduced pull request regression](docs/assets/screenshots/trialrun-verdict.jpg)](https://trialrun.aryankumar.dev/proof/reviews/426b3539-3d48-46de-bd6d-8bb78a24c2ca/p1_SHdqvYNZ60xdFOzF9-qT2hTiPTXlbtzQW2T6E0yrfoE)

This one review used 13 repository reads and searches, 17 live browser operations, 4 live API responses, and both applications' Zerops logs. Codex wrote the finding; TrialRun kept the evidence tied to the exact commits.

[![Matched base and pull request screenshots, API evidence, GitHub publication, and confirmed Zerops teardown](docs/assets/screenshots/trialrun-live-proof.jpg)](https://trialrun.aryankumar.dev/proof/reviews/426b3539-3d48-46de-bd6d-8bb78a24c2ca/p1_SHdqvYNZ60xdFOzF9-qT2hTiPTXlbtzQW2T6E0yrfoE)

These WebMs are not demo clips or manual uploads. TrialRun's Chrome executor recorded them automatically inside the temporary Zerops project while Codex drove both live apps. The same run captured API responses and Zerops service logs before the project was deleted.

[Watch the base WebM](https://trialrun.aryankumar.dev/proof/reviews/426b3539-3d48-46de-bd6d-8bb78a24c2ca/p1_SHdqvYNZ60xdFOzF9-qT2hTiPTXlbtzQW2T6E0yrfoE/artifacts/a8594caa-7cd0-4cc8-9ecf-c99af4936c3b) · [Watch the pull request WebM](https://trialrun.aryankumar.dev/proof/reviews/426b3539-3d48-46de-bd6d-8bb78a24c2ca/p1_SHdqvYNZ60xdFOzF9-qT2hTiPTXlbtzQW2T6E0yrfoE/artifacts/e3541c1b-653a-4724-b667-fb913bb3675a)

[GitHub Check](https://github.com/aryan877/trialrun-proof/runs/93265050893) · [Bot comment](https://github.com/aryan877/trialrun-proof/pull/4#issuecomment-5232414375) · [Open the public proof](https://trialrun.aryankumar.dev/proof/reviews/426b3539-3d48-46de-bd6d-8bb78a24c2ca/p1_SHdqvYNZ60xdFOzF9-qT2hTiPTXlbtzQW2T6E0yrfoE)

Zerops then deleted project `bm8bQgyTQrC23Kqm5spgnA` in process `t2l5VUuSRhuwTW6FAHx7FA`. TrialRun waited until the exact project lookup returned `projectNotFound`, then published the result.

<!-- TRIALRUN_FINAL_PROOF_END -->

## It reads the code. Then it tests the product.

1. **Codex understands the change.** It searches the full repository, follows the code, and decides what needs to run and what could break.
2. **Zerops boots both commits.** The base and PR run as separate live systems with separate data.
3. **Codex tests its own theory.** It drives Chrome, calls the app's APIs, reads logs, and changes course when the app surprises it.
4. **GitHub gets the proof.** TrialRun saves the evidence, deletes the exact Zerops project, and only then publishes Codex's review.

Chrome is one testing tool, not the boundary. Codex can compare live HTTP status, headers, and response bodies, inspect both applications' Zerops logs, return to the code, and keep investigating in the same thread. In the proof above, the UI diverged while the API responses matched. That distinction is how Codex narrowed the regression to client-side code.

![One Codex thread reads code, drives Chrome, tests live APIs, and reads Zerops service logs from either the managed runner or an optional customer ZCP workspace](docs/assets/trialrun-live-investigation.svg)

For a Zerops review, TrialRun reads each app's recent output with `zcli service log` using that review's exact project and service IDs. It fetches base and PR separately, keeps at most 500 recent records, removes supplied test secrets, and gives Codex a bounded tail. Locally, the same tool reads the matching container logs. Codex gets useful app output without receiving Zerops credentials or arbitrary shell access.

## No customer Zerops file

![Codex explores the full exact commit, returns a cited typed run plan, TrialRun checks and compiles it, and Zerops runs isolated base and pull request systems](docs/assets/trialrun-planning.svg)

Codex can search and read the full, exact commit. It follows entrypoints, build scripts, routes, database clients, and environment names until it knows what must run. TrialRun checks that answer against hard resource and security limits, then generates the Zerops input. The customer never writes `zerops.yaml`.

## One PR gets one private lab

![A pull request enters TrialRun, Zerops boots the base and PR apps, Codex tests them in Chrome, Zerops deletes the temporary project, and GitHub receives the verdict and video](docs/assets/trialrun-architecture.svg)

TrialRun itself runs on Zerops as a web app, runner, PostgreSQL database, and object store. Each review creates one short-lived Zerops project containing:

- the base app and its private data;
- the PR app and separate private data;
- a native Chromium executor that both apps can reach over the project's private network.

The runner waits for every service to become ready before Codex starts. When the review ends, it deletes that exact project ID and waits for Zerops to return `projectNotFound`.

## What GitHub gets

- Codex's `pass`, `fail`, or `inconclusive` verdict;
- exact code citations and a short explanation;
- matched base/PR screenshots;
- automatic Chrome recordings captured inside the temporary Zerops project while Codex works;
- one public proof page with media hashes and teardown proof; authenticated owners also get the API results and application logs.

Codex writes the verdict. TrialRun checks that every cited line and evidence ID came from this exact run. It does not replace Codex with a hardcoded pass/fail script.

<details>
<summary><strong>What Codex can and cannot touch</strong></summary>

Codex can read the repository and use TrialRun's browser, API, and log tools. It cannot write the checkout, call random hosts, or hold GitHub and Zerops credentials.

The tested app receives only approved test values. Never use production database, payment, cloud, or personal credentials: any app can leak a value it receives.

Every saved file is redacted, size-bounded, and SHA-256 checked before publication. A missing file, failed GitHub delivery, or unproved deletion cannot become a successful review.

</details>

<details>
<summary><strong>Use TrialRun's Codex or connect yours</strong></summary>

Every job is pinned to one Codex connection before it starts. TrialRun-managed Codex is the default. A customer can also connect their subscription inside a private Zerops ZCP workspace with OpenAI's device login.

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
