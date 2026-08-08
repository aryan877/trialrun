# Pre-submission cleanup ledger

Nothing in this file is authorization to remove or rotate anything yet. Every entry is tagged `REMOVE-BEFORE-PUBLIC` so the final cleanup can be deliberate, reviewed, and verified after the live proof is complete.

## Deployment identity

- [ ] `REMOVE-BEFORE-PUBLIC` Parameterize or document the deployment-specific hostname `trialrun.aryankumar.dev` in `zerops.yaml`, `AGENTS.md`, and the live handoff. Keep the verified URL in the private judge submission.
- [ ] `REMOVE-BEFORE-PUBLIC` Replace the seeded `judge@trialrun.aryankumar.dev` address in `scripts/render-live-import.ts` with a deployment input before making the repository reusable.
- [ ] `REMOVE-BEFORE-PUBLIC` Move the GitHub owner, repository names, installation ID, App ID, App client ID, App slug, and “TrialRun by Aryan” values out of durable product documentation where they are operational handoff rather than product defaults.
- [ ] `REMOVE-BEFORE-PUBLIC` Remove the Zerops client ID/account name and Cloudflare zone/account details from the public handoff while preserving them in a private operator record if still needed.

## Local-machine and development-only references

- [ ] `REMOVE-BEFORE-PUBLIC` Replace absolute `/Users/aryankumar/...` research paths in `AGENTS.md` and `docs/research/*` with repository-relative instructions or public source URLs.
- [ ] `REMOVE-BEFORE-PUBLIC` Delete ignored `.data/tasks/` OpenCode/DeepSeek packets and reports after every accepted finding is represented by code, tests, or a durable decision record.
- [ ] `REMOVE-BEFORE-PUBLIC` Remove Keychain service names, local private-key locations, local ports, and machine-specific operational notes from the public handoff; keep a separate private deployment runbook if required.
- [ ] `REMOVE-BEFORE-PUBLIC` Decide whether the internal `docs/TASKS.md` and live-delivery section of `AGENTS.md` should be archived or reduced before judge/source access.

## External inspiration and borrowed context

- [ ] `REMOVE-BEFORE-PUBLIC` Remove named fal.ai comparison URLs and measurement notes from the public design-system document after translating the useful geometry into TrialRun-owned tokens and rationale.
- [ ] `REMOVE-BEFORE-PUBLIC` Re-scan UI copy, source comments, screenshots, and submission media for external product names, copied phrases, browser-extension overlays, dictation overlays, “Ask …” controls, profile avatars, or unrelated tabs. These are research/session artifacts, not TrialRun product assets.
- [ ] `REMOVE-BEFORE-PUBLIC` Keep only the original TrialRun brand asset and product copy; verify no third-party logo, screenshot crop, or copied visual artwork ships in `apps/web/public`.

## Credentials and proof material

- [ ] `REMOVE-BEFORE-PUBLIC` Confirm `.data/`, `.env*`, PEM files, Codex auth caches, Cloudflare/Zerops/GitHub secrets, generated judge password, callback codes, and artifact payloads remain ignored and absent from every Git object.
- [ ] `REMOVE-BEFORE-PUBLIC` Rotate the judge password, webhook secret, GitHub client secret, App private key, Zerops token, and Cloudflare token after the judging window or immediately after any suspected exposure.
- [ ] `REMOVE-BEFORE-PUBLIC` Keep the proof repository private until explicit authorization, then grant judges only the minimum access required by the challenge rules.

## Final verification

- [ ] `REMOVE-BEFORE-PUBLIC` Run a case-insensitive identity/reference scan and a value-based secret scan over the complete Git history, not only the working tree.
- [ ] `REMOVE-BEFORE-PUBLIC` Capture fresh submission screenshots in a clean browser profile with no extensions, personal tabs, account avatar, dictation HUD, or developer overlays visible.
- [ ] `REMOVE-BEFORE-PUBLIC` Review every removal separately from the live deployment so cleanup cannot silently break the judge URL, GitHub App, prepared PR, or evidence links.
