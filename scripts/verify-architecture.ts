import { readFile } from "node:fs/promises";

import {
  loadArchitectureSpec,
  loadArchitectureLogos,
  renderArchitectureSvg,
  verifyArchitectureSpec,
} from "./architecture-diagram.js";

const workspace = new URL("../", import.meta.url);
const specUrl = new URL("docs/architecture/trialrun-architecture.json", workspace);
const outputUrl = new URL("docs/assets/trialrun-architecture.svg", workspace);

async function main(): Promise<void> {
  const spec = await loadArchitectureSpec(specUrl);
  const logos = await loadArchitectureLogos(spec, workspace);
  const errors = verifyArchitectureSpec(spec);
  if (errors.length > 0) throw new Error(`Architecture geometry failed:\n- ${errors.join("\n- ")}`);
  const expected = renderArchitectureSvg(spec, logos);
  const actual = await readFile(outputUrl, "utf8");
  if (actual !== expected) {
    throw new Error("Generated SVG is stale. Run: pnpm exec tsx scripts/render-architecture.ts");
  }
  process.stdout.write(
    `Architecture verified: ${spec.zones.length} zones, ${spec.nodes.length} nodes, ${spec.connectors.length} collision-checked routes.\n`,
  );
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown architecture verification error.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
