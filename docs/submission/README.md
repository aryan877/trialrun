# TrialRun submission packet

This file is the release owner's final checklist and 90-second judge path. It contains placeholders because the final private pull request has not completed its verified Zerops run yet. Replace a value only after opening the URL and checking that it shows the stated proof.

Do not paste passwords, API keys, callback codes, installation tokens, PEM files, or Codex credential data into this file.

## Form fields

| Field                  | Value                                                                                                                                                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project title          | TrialRun                                                                                                                                                                                                                                                        |
| Project description    | TrialRun boots the exact base and pull request commits in an isolated Zerops project, lets Codex inspect the code and drive a real Chrome session across both versions, posts the recorded difference to GitHub, then proves the temporary project was deleted. |
| Source repository      | `{{SOURCE_REPOSITORY_URL}}`                                                                                                                                                                                                                                     |
| Live Zerops deployment | `{{LIVE_ZEROPS_URL}}`                                                                                                                                                                                                                                           |
| Social post            | `{{SOCIAL_POST_URL_OR_NOT_SUBMITTED}}`                                                                                                                                                                                                                          |

## Judge access

| Item                     | Value                                   |
| ------------------------ | --------------------------------------- |
| Source access granted to | `{{JUDGE_GITHUB_ACCOUNT_OR_TEAM}}`      |
| Access checked at        | `{{SOURCE_ACCESS_VERIFIED_AT_ISO8601}}` |
| Judge email              | `{{JUDGE_EMAIL}}`                       |
| Password delivery        | `{{PRIVATE_PASSWORD_DELIVERY_METHOD}}`  |
| Login checked at         | `{{JUDGE_LOGIN_VERIFIED_AT_ISO8601}}`   |

The password itself belongs in the challenge's private credential field or another judge-only channel. It does not belong in Git.

## One-run proof

All links in this table must describe the same repository, pull request, base SHA, head SHA, TrialRun review, and disposable Zerops project.

| Proof                        | Value                                     |
| ---------------------------- | ----------------------------------------- |
| Prepared pull request        | `{{PROOF_PR_URL}}`                        |
| Base SHA                     | `{{BASE_COMMIT_SHA}}`                     |
| PR SHA                       | `{{HEAD_COMMIT_SHA}}`                     |
| GitHub Check                 | `{{GITHUB_CHECK_URL}}`                    |
| GitHub PR comment            | `{{GITHUB_COMMENT_URL}}`                  |
| TrialRun review              | `{{TRIALRUN_REVIEW_URL}}`                 |
| PR WebM evidence             | `{{HEAD_RECORDING_URL}}`                  |
| Base WebM comparison         | `{{BASE_RECORDING_URL}}`                  |
| Evidence bundle              | `{{EVIDENCE_BUNDLE_URL}}`                 |
| Disposable Zerops project ID | `{{DISPOSABLE_PROJECT_ID}}`               |
| Teardown proof               | `{{TEARDOWN_PROOF_URL_OR_REVIEW_ANCHOR}}` |
| Absence checked at           | `{{PROJECT_ABSENCE_VERIFIED_AT_ISO8601}}` |

## Codex connection proof

The prepared PR can use managed Codex. Verify the customer ZCP path separately if it does not.

| Proof                                          | Value                                    |
| ---------------------------------------------- | ---------------------------------------- |
| Connection mode pinned to the prepared review  | `{{PROOF_REVIEW_CONNECTION_MODE}}`       |
| Customer ZCP connection page                   | `{{ZCP_CONNECTION_PROOF_URL}}`           |
| Device login and bounded invocation checked at | `{{ZCP_INVOCATION_VERIFIED_AT_ISO8601}}` |
| Revocation checked at                          | `{{ZCP_REVOCATION_VERIFIED_AT_ISO8601}}` |
| Exact workspace deletion proof                 | `{{ZCP_WORKSPACE_DELETION_PROOF}}`       |

## Persistent Zerops services

Verify these in the submitted Zerops project and in the running product before filing the form.

| Service    | Expected role                                                      | Verified live            |
| ---------- | ------------------------------------------------------------------ | ------------------------ |
| `web`      | Next.js product, account flow, API, webhook, evidence pages        | `{{YES_WITH_TIMESTAMP}}` |
| `runner`   | Durable queue, Codex session, Zerops lifecycle, GitHub publication | `{{YES_WITH_TIMESTAMP}}` |
| `db`       | Managed PostgreSQL                                                 | `{{YES_WITH_TIMESTAMP}}` |
| `evidence` | Persistent object storage for sanitized artifacts                  | `{{YES_WITH_TIMESTAMP}}` |

## 90-second judge walkthrough

1. Open `{{LIVE_ZEROPS_URL}}` and sign in with the privately supplied judge credentials.
2. Open the connected proof repository. Point out the plain-language run setup and that the repository does not need a customer `zerops.yaml`.
3. Open review `{{TRIALRUN_REVIEW_URL}}`. Show the exact base and PR SHAs.
4. Play the PR WebM at the reproduced failure. Open the base WebM beside it and show the same path working.
5. Open the code finding, ordered browser actions, assertion result, console/network evidence, and artifact SHA-256 values.
6. Open `{{GITHUB_CHECK_URL}}` and `{{GITHUB_COMMENT_URL}}`. Show that GitHub received the same deterministic verdict and evidence link.
7. Return to the TrialRun teardown section. Show the exact Zerops project ID, delete timestamp, and absence proof.
8. Open the architecture diagram in the root README. Explain that managed Codex and customer ZCP Codex are two exclusive connection routes into the same bounded review tools.

## Final release checks

- [ ] Re-read the live Zerops Challenge rules and form.
- [ ] Open the source URL from an account with the same access judges receive.
- [ ] Open the live deployment in a clean browser profile.
- [ ] Sign in with the exact judge credentials supplied outside Git.
- [ ] Confirm the proof PR, Check, comment, review, videos, hashes, and teardown all refer to one run.
- [ ] Confirm the disposable project is absent in Zerops.
- [ ] Confirm `web`, `runner`, `db`, and `evidence` are active in the persistent Zerops project.
- [ ] Replace the marked release blocks in the root README.
- [ ] Run `pnpm check`.
- [ ] Run `pnpm exec tsx scripts/verify-architecture.ts`.
- [ ] Run `pnpm exec tsx scripts/verify-architecture-browser.ts`.
- [ ] Run `pnpm exec tsx scripts/verify-readme-assets.ts --release`.
- [ ] Scan the clean screenshots and videos for personal tabs, avatars, extensions, dictation overlays, and secrets.
- [ ] Grant judges repository access before filing the form.

## Honest constraints to keep in the submission

- TrialRun supports runnable web applications and HTTP APIs with a provable run contract.
- Ambiguous setup, an invalid base, missing evidence, infrastructure failure, or unproved teardown produces `inconclusive`, not `pass`.
- Video supports a finding; deterministic assertions decide the verdict.
- Test secrets can be exposed by malicious tested code. Never use production credentials.
- The submission shows one real private proof repository. It does not claim every repository can boot without confirmation.
