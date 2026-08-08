import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const releaseMode = process.argv.slice(2).includes("--release");
const documents = ["README.md", "docs/submission/README.md"] as const;
const svgAssets = [
  "docs/assets/trialrun-architecture.svg",
  "docs/assets/logos/trialrun.svg",
  "docs/assets/logos/zerops.svg",
  "docs/assets/logos/github.svg",
  "docs/assets/logos/openai.svg",
  "docs/assets/logos/playwright.svg",
  "docs/assets/logos/postgresql.svg",
] as const;

function localTargets(markdown: string): string[] {
  const markdownLinks = [
    ...markdown.matchAll(/!?(?:\[[^\]]*\])\(([^)\s]+)(?:\s+"[^"]*")?\)/g),
  ].flatMap((match) => (match[1] ? [match[1]] : []));
  const htmlSources = [...markdown.matchAll(/\b(?:src|href)="([^"]+)"/g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
  return [...markdownLinks, ...htmlSources].filter(
    (target) =>
      !target.startsWith("#") &&
      !target.startsWith("http://") &&
      !target.startsWith("https://") &&
      !target.startsWith("mailto:"),
  );
}

function svgProblems(path: string, svg: string): string[] {
  const problems: string[] = [];
  if (/<script\b/i.test(svg)) problems.push(`${path} contains a script element.`);
  if (/\son[a-z]+\s*=/i.test(svg)) problems.push(`${path} contains an event-handler attribute.`);
  if (/\b(?:href|xlink:href)\s*=\s*["'](?!#)/i.test(svg)) {
    problems.push(`${path} contains a non-local href.`);
  }
  if (/\b(?:src|url)\s*=\s*["'](?:https?:|\/\/|data:|file:)/i.test(svg)) {
    problems.push(`${path} contains an external or embedded resource.`);
  }
  if (/url\(\s*["']?(?:https?:|\/\/|data:|file:)/i.test(svg)) {
    problems.push(`${path} contains an external CSS resource.`);
  }
  return problems;
}

async function main(): Promise<void> {
  const problems: string[] = [];
  for (const document of documents) {
    const absoluteDocument = resolve(workspace, document);
    const markdown = await readFile(absoluteDocument, "utf8");
    for (const target of localTargets(markdown)) {
      const pathWithoutFragment = target.split("#", 1)[0];
      if (!pathWithoutFragment) continue;
      const absoluteTarget = resolve(
        dirname(absoluteDocument),
        decodeURIComponent(pathWithoutFragment),
      );
      try {
        await access(absoluteTarget);
      } catch {
        problems.push(`${document} links missing local file '${target}'.`);
      }
    }
    if (releaseMode && /TRIALRUN_RELEASE_PLACEHOLDER|\{\{[A-Z0-9_]+\}\}/.test(markdown)) {
      problems.push(`${document} still contains release placeholders.`);
    }
  }

  const readme = await readFile(resolve(workspace, "README.md"), "utf8");
  if (/\bbeta\b/i.test(readme)) problems.push("README.md labels a feature as beta.");
  if (/fal\.ai/i.test(readme))
    problems.push("README.md contains an external design-inspiration reference.");

  for (const asset of svgAssets) {
    const svg = await readFile(resolve(workspace, asset), "utf8");
    problems.push(...svgProblems(asset, svg));
  }

  if (problems.length > 0) {
    throw new Error(`README verification failed:\n- ${problems.join("\n- ")}`);
  }
  process.stdout.write(
    `README verified: ${documents.length} documents and ${svgAssets.length} local SVG assets${releaseMode ? "; no release placeholders" : ""}.\n`,
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown README verification error.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
