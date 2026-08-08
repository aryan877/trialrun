import { mkdir, writeFile } from "node:fs/promises";

import {
  loadArchitectureLogos,
  loadArchitectureSpec,
  renderArchitectureSvg,
} from "./architecture-diagram.js";

const workspace = new URL("../", import.meta.url);
const specUrl = new URL("docs/architecture/trialrun-architecture.json", workspace);
const outputUrl = new URL("docs/assets/trialrun-architecture.svg", workspace);

async function main(): Promise<void> {
  const spec = await loadArchitectureSpec(specUrl);
  const logos = await loadArchitectureLogos(spec, workspace);
  const svg = renderArchitectureSvg(spec, logos);
  await mkdir(new URL("docs/assets/", workspace), { recursive: true });
  await writeFile(outputUrl, svg, "utf8");
  process.stdout.write(`Rendered ${outputUrl.pathname} from ${specUrl.pathname}.\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown architecture render error.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
