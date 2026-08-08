import { describe, expect, it } from "vitest";

import {
  architectureSpecSchema,
  loadArchitectureLogos,
  loadArchitectureSpec,
  renderArchitectureSvg,
  verifyArchitectureSpec,
} from "./architecture-diagram.js";

const specUrl = new URL("../docs/architecture/trialrun-architecture.json", import.meta.url);
const workspace = new URL("../", import.meta.url);

describe("TrialRun architecture diagram", () => {
  it("keeps every zone, node, label, and route inside verified geometry", async () => {
    const spec = await loadArchitectureSpec(specUrl);
    expect(verifyArchitectureSpec(spec)).toEqual([]);
  });

  it("renders accessible SVG from the typed source of truth", async () => {
    const spec = await loadArchitectureSpec(specUrl);
    const logos = await loadArchitectureLogos(spec, workspace);
    const svg = renderArchitectureSvg(spec, logos);
    expect(svg).toContain(`viewBox="0 0 ${spec.canvas.width} ${spec.canvas.height}"`);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-labelledby="architecture-title architecture-description"');
    expect(svg).toContain('<title id="architecture-title">');
    expect(svg).toContain('<desc id="architecture-description">');
    expect(svg).toContain('data-logo-asset="zerops"');
    expect(svg).toContain('href="#architecture-logo-codex"');
    expect(svg).not.toContain("data-logo-placeholder");
  });

  it("rejects a connector that crosses an unrelated node", async () => {
    const spec = await loadArchitectureSpec(specUrl);
    const unsafe = architectureSpecSchema.parse({
      ...spec,
      connectors: spec.connectors.map((connector) =>
        connector.id === "selector-zcp"
          ? {
              ...connector,
              points: [
                { x: 900, y: 340 },
                { x: 900, y: 435 },
                { x: 1070, y: 435 },
                { x: 1070, y: 280 },
              ],
            }
          : connector,
      ),
    });
    expect(verifyArchitectureSpec(unsafe)).toContain(
      "Connector 'selector-zcp' crosses unintended node 'managed-codex'.",
    );
  });

  it("models managed and ZCP Codex as mutually exclusive job routes", async () => {
    const spec = await loadArchitectureSpec(specUrl);
    const [connectionRoute] = spec.exclusiveRoutes;
    expect(connectionRoute).toMatchObject({
      selection: "exactly-one",
      defaultConnectorId: "selector-managed",
      members: ["selector-managed", "selector-zcp"],
    });
  });
});
