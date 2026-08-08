import { readFile } from "node:fs/promises";

import { chromium } from "playwright";

import { loadArchitectureSpec } from "./architecture-diagram.js";

const workspace = new URL("../", import.meta.url);
const specUrl = new URL("docs/architecture/trialrun-architecture.json", workspace);
const outputUrl = new URL("docs/assets/trialrun-architecture.svg", workspace);

interface MeasuredBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: MeasuredBox, b: MeasuredBox, gap = 0): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

async function main(): Promise<void> {
  const spec = await loadArchitectureSpec(specUrl);
  const svg = await readFile(outputUrl, "utf8");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: spec.canvas.width, height: spec.canvas.height } });
    await page.setContent(svg, { waitUntil: "domcontentloaded" });
    const measurement = await page.evaluate(() => {
      const root = document.querySelector("svg");
      if (!(root instanceof SVGSVGElement)) throw new Error("Generated document has no SVG root.");
      const viewBox = root.viewBox.baseVal;
      const boxes = [...root.querySelectorAll<SVGGraphicsElement>("[data-geometry-owner]")].map(
        (element) => {
          const box = element.getBBox();
          return {
            id: element.dataset.geometryOwner ?? "missing-owner",
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
          };
        },
      );
      const nodeText = [...root.querySelectorAll<SVGTextElement>("[data-node-text]")].map((element) => {
        const parent = element.closest<SVGGElement>("[data-node-id]");
        const boundary = parent?.querySelector<SVGRectElement>(":scope > rect");
        if (!parent?.dataset.nodeId || !boundary) throw new Error("Node text has no measured boundary.");
        const textBox = element.getBBox();
        const nodeBox = boundary.getBBox();
        return {
          nodeId: parent.dataset.nodeId,
          text: { x: textBox.x, y: textBox.y, width: textBox.width, height: textBox.height },
          node: { x: nodeBox.x, y: nodeBox.y, width: nodeBox.width, height: nodeBox.height },
        };
      });
      return {
        viewBox: { x: viewBox.x, y: viewBox.y, width: viewBox.width, height: viewBox.height },
        title: root.querySelector("title")?.textContent ?? "",
        description: root.querySelector("desc")?.textContent ?? "",
        boxes,
        nodeText,
      };
    });

    const problems: string[] = [];
    if (
      measurement.viewBox.x !== 0 ||
      measurement.viewBox.y !== 0 ||
      measurement.viewBox.width !== spec.canvas.width ||
      measurement.viewBox.height !== spec.canvas.height
    ) {
      problems.push("SVG viewBox does not match the typed canvas.");
    }
    if (measurement.title !== spec.canvas.title) problems.push("SVG title is missing or stale.");
    if (measurement.description !== spec.canvas.description) {
      problems.push("SVG description is missing or stale.");
    }
    for (const item of measurement.nodeText) {
      const text = { id: item.nodeId, ...item.text };
      const node = { id: item.nodeId, ...item.node };
      if (
        text.x < node.x ||
        text.y < node.y ||
        text.x + text.width > node.x + node.width ||
        text.y + text.height > node.y + node.height
      ) {
        problems.push(`Computed text escapes node '${item.nodeId}'.`);
      }
    }
    for (const [index, box] of measurement.boxes.entries()) {
      for (const other of measurement.boxes.slice(index + 1)) {
        if (box.id === other.id) continue;
        if (overlaps(box, other, 1)) {
          problems.push(`Computed labels '${box.id}' and '${other.id}' overlap.`);
        }
      }
    }
    if (problems.length > 0) throw new Error(`Browser geometry failed:\n- ${problems.join("\n- ")}`);
    process.stdout.write(
      `Chromium geometry verified ${measurement.boxes.length} measured label groups and ${measurement.nodeText.length} node text rows.\n`,
    );
  } finally {
    await browser.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown browser geometry error.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
