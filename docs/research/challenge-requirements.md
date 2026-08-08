# WeMakeDevs Zerops Challenge requirements

Recorded: 2026-08-08

Source: submission form text supplied by the project owner. Re-check the live rules page immediately before submission.

## Qualification gates

The entry is not eligible unless all of these are true:

1. The submitted product is deployed on Zerops and working at the submitted live URL.
2. It is materially beyond Hello World. The form asks for a reasonably complex architecture and recommends at least a frontend, backend, and database.
3. Judges can read the source repository. It may remain private only if the judging team receives reliable access.
4. The form includes a title, project description, repository URL, and live Zerops deployment URL.
5. A social-post URL is optional for the main entry but required for the separate social prize.

## TrialRun proof against the gates

The persistent Zerops project must contain at least:

- `web`: the live Next.js product and webhook/API surface;
- `runner`: a separately deployed durable review worker;
- `db`: managed PostgreSQL;
- `evidence`: Zerops object storage for sanitized run artifacts.

The live product must let a judge sign in, connect or use an already connected judge repository, inspect a real policy-checked repository recipe, launch a review, and open durable evidence. At least one prepared public pull request must exercise the full loop. Its review must create a separate disposable Zerops project with base, head, executor, and any detected managed dependencies, then delete it with visible proof.

A deployed marketing page plus screenshots of a local simulation does not qualify. A hardcoded fixture does not qualify. A live dashboard whose buttons do not run the real Zerops/GitHub path does not qualify.

## Submission dossier (create after live proof)

Near completion, create `docs/SUBMISSION.md` containing only verified facts:

- final title and concise description;
- repository URL and judge-access instructions;
- live Zerops URL;
- architecture diagram and exact Zerops services;
- prepared PR and its GitHub Check URL;
- artifact/evidence link and teardown proof;
- local and live verification commands;
- limitations stated honestly;
- 90-second judge walkthrough;
- optional social post URL.

Do not write final claims before the corresponding live gate is checked.
