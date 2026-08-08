import { readFile } from "node:fs/promises";

import { z } from "zod";

const coordinateSchema = z.number().int().nonnegative();
const boxSchema = z.strictObject({
  x: coordinateSchema,
  y: coordinateSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
const pointSchema = z.strictObject({ x: coordinateSchema, y: coordinateSchema });
const logoSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(["asset", "placeholder"]),
  label: z.string().min(1).max(3),
  assetPath: z.string().min(1).optional(),
  missingAssetPath: z.string().min(1).optional(),
});
const zoneSchema = boxSchema.extend({
  id: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().min(1),
  tone: z.enum(["neutral", "primary", "optional", "temporary"]),
});
const nodeSchema = boxSchema.extend({
  id: z.string().min(1),
  zoneId: z.string().min(1),
  title: z.string().min(1),
  details: z.array(z.string().min(1)).min(1).max(3),
  logoId: z.string().min(1),
  tone: z.enum(["neutral", "primary", "active", "optional", "temporary", "evidence"]),
});
const connectorSchema = z.strictObject({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  mode: z.enum(["active", "optional", "data", "evidence", "teardown"]),
  points: z.array(pointSchema).min(2),
  label: z.string().min(1).optional(),
  labelBox: boxSchema.optional(),
});
const exclusiveRouteSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  selection: z.literal("exactly-one"),
  defaultConnectorId: z.string().min(1),
  members: z.array(z.string().min(1)).min(2),
});

export const architectureSpecSchema = z.strictObject({
  canvas: z.strictObject({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    title: z.string().min(1),
    description: z.string().min(1),
  }),
  logos: z.array(logoSchema).min(1),
  zones: z.array(zoneSchema).min(1),
  nodes: z.array(nodeSchema).min(1),
  connectors: z.array(connectorSchema).min(1),
  exclusiveRoutes: z.array(exclusiveRouteSchema).min(1),
});

export type ArchitectureSpec = z.infer<typeof architectureSpecSchema>;
type Box = z.infer<typeof boxSchema>;
type Point = z.infer<typeof pointSchema>;
type DiagramNode = ArchitectureSpec["nodes"][number];
type Connector = ArchitectureSpec["connectors"][number];
type DiagramLogo = ArchitectureSpec["logos"][number];

export type EmbeddedArchitectureLogo = Readonly<{
  markup: string;
  viewBox: string;
}>;

export type EmbeddedArchitectureLogos = ReadonlyMap<string, EmbeddedArchitectureLogo>;

const palette = {
  background: "#fffdfa",
  foreground: "#171717",
  muted: "#67635f",
  border: "#d8d4ce",
  primary: "#6176ff",
  primarySoft: "#eef0ff",
  active: "#b9ff54",
  activeSoft: "#f3ffe3",
  optional: "#ff5eaa",
  optionalSoft: "#fff0f7",
  evidence: "#47c5e8",
  evidenceSoft: "#ecfbff",
  temporarySoft: "#f6f4f1",
  teardown: "#e34b4b",
} as const;

function unique(values: readonly string[], name: string, errors: string[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) errors.push(`${name} id '${value}' is duplicated.`);
    seen.add(value);
  }
}

function inside(inner: Box, outer: Box, inset = 0): boolean {
  return (
    inner.x >= outer.x + inset &&
    inner.y >= outer.y + inset &&
    inner.x + inner.width <= outer.x + outer.width - inset &&
    inner.y + inner.height <= outer.y + outer.height - inset
  );
}

function overlaps(a: Box, b: Box, gap = 0): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

function pointOnBorder(point: Point, box: Box): boolean {
  const onHorizontal =
    (point.y === box.y || point.y === box.y + box.height) &&
    point.x >= box.x &&
    point.x <= box.x + box.width;
  const onVertical =
    (point.x === box.x || point.x === box.x + box.width) &&
    point.y >= box.y &&
    point.y <= box.y + box.height;
  return onHorizontal || onVertical;
}

function segmentIntersectsBox(start: Point, end: Point, box: Box, inset = 3): boolean {
  const left = box.x + inset;
  const right = box.x + box.width - inset;
  const top = box.y + inset;
  const bottom = box.y + box.height - inset;
  if (start.x === end.x) {
    const minimum = Math.min(start.y, end.y);
    const maximum = Math.max(start.y, end.y);
    return start.x > left && start.x < right && maximum > top && minimum < bottom;
  }
  if (start.y === end.y) {
    const minimum = Math.min(start.x, end.x);
    const maximum = Math.max(start.x, end.x);
    return start.y > top && start.y < bottom && maximum > left && minimum < right;
  }
  return true;
}

function estimatedTextWidth(value: string, fontSize: number, weight = 400): number {
  const averageGlyph = weight >= 600 ? 0.62 : 0.56;
  return value.length * fontSize * averageGlyph;
}

function nodeTextFits(node: DiagramNode): string[] {
  const errors: string[] = [];
  const titleWidth = node.width - 86;
  if (estimatedTextWidth(node.title, 15, 600) > titleWidth) {
    errors.push(`Node '${node.id}' title exceeds its measured text lane.`);
  }
  const detailsWidth = node.width - 36;
  for (const detail of node.details) {
    if (estimatedTextWidth(detail, 12) > detailsWidth) {
      errors.push(`Node '${node.id}' detail '${detail}' exceeds its measured text lane.`);
    }
  }
  const requiredHeight = 62 + node.details.length * 17;
  if (requiredHeight > node.height + 4) {
    errors.push(`Node '${node.id}' does not have enough height for its text rows.`);
  }
  return errors;
}

function verifyConnector(
  connector: Connector,
  nodesById: ReadonlyMap<string, DiagramNode>,
  canvas: Box,
): string[] {
  const errors: string[] = [];
  const source = nodesById.get(connector.source);
  const target = nodesById.get(connector.target);
  if (!source) errors.push(`Connector '${connector.id}' has missing source '${connector.source}'.`);
  if (!target) errors.push(`Connector '${connector.id}' has missing target '${connector.target}'.`);
  if (!source || !target) return errors;

  const first = connector.points[0];
  const last = connector.points.at(-1);
  if (!first || !last) return [`Connector '${connector.id}' has no route.`];
  if (!pointOnBorder(first, source)) {
    errors.push(`Connector '${connector.id}' does not start on '${source.id}'.`);
  }
  if (!pointOnBorder(last, target)) {
    errors.push(`Connector '${connector.id}' does not end on '${target.id}'.`);
  }

  for (const [index, point] of connector.points.entries()) {
    if (!inside({ ...point, width: 0, height: 0 }, canvas)) {
      errors.push(`Connector '${connector.id}' point ${index} is outside the canvas.`);
    }
    const next = connector.points[index + 1];
    if (!next) continue;
    if (point.x !== next.x && point.y !== next.y) {
      errors.push(`Connector '${connector.id}' segment ${index} is not orthogonal.`);
    }
    if (point.x === next.x && point.y === next.y) {
      errors.push(`Connector '${connector.id}' segment ${index} has zero length.`);
    }
    for (const node of nodesById.values()) {
      if (node.id === source.id || node.id === target.id) continue;
      if (segmentIntersectsBox(point, next, node)) {
        errors.push(`Connector '${connector.id}' crosses unintended node '${node.id}'.`);
      }
    }
  }

  if (connector.label && !connector.labelBox) {
    errors.push(`Connector '${connector.id}' has a label without a label box.`);
  }
  if (!connector.label && connector.labelBox) {
    errors.push(`Connector '${connector.id}' has a label box without a label.`);
  }
  if (connector.label && connector.labelBox) {
    if (!inside(connector.labelBox, canvas)) {
      errors.push(`Connector '${connector.id}' label is outside the canvas.`);
    }
    if (estimatedTextWidth(connector.label, 11, 600) > connector.labelBox.width - 16) {
      errors.push(`Connector '${connector.id}' label exceeds its label box.`);
    }
    for (const node of nodesById.values()) {
      if (overlaps(connector.labelBox, node, 3)) {
        errors.push(`Connector '${connector.id}' label overlaps node '${node.id}'.`);
      }
    }
  }
  return errors;
}

export function verifyArchitectureSpec(spec: ArchitectureSpec): string[] {
  const errors: string[] = [];
  const canvas: Box = { x: 0, y: 0, width: spec.canvas.width, height: spec.canvas.height };
  unique(
    spec.logos.map(({ id }) => id),
    "Logo",
    errors,
  );
  unique(
    spec.zones.map(({ id }) => id),
    "Zone",
    errors,
  );
  unique(
    spec.nodes.map(({ id }) => id),
    "Node",
    errors,
  );
  unique(
    spec.connectors.map(({ id }) => id),
    "Connector",
    errors,
  );
  unique(
    spec.exclusiveRoutes.map(({ id }) => id),
    "Exclusive route",
    errors,
  );

  const logosById = new Map(spec.logos.map((logo) => [logo.id, logo]));
  const zonesById = new Map(spec.zones.map((zone) => [zone.id, zone]));
  const nodesById = new Map(spec.nodes.map((node) => [node.id, node]));
  const connectorsById = new Map(spec.connectors.map((connector) => [connector.id, connector]));

  for (const logo of spec.logos) {
    if (logo.kind === "asset" && !logo.assetPath) {
      errors.push(`Asset logo '${logo.id}' is missing assetPath.`);
    }
    if (logo.kind === "placeholder" && !logo.missingAssetPath) {
      errors.push(`Placeholder logo '${logo.id}' is missing the intended asset path.`);
    }
  }

  for (const [index, zone] of spec.zones.entries()) {
    if (!inside(zone, canvas, 24)) errors.push(`Zone '${zone.id}' is outside the canvas.`);
    for (const other of spec.zones.slice(index + 1)) {
      if (overlaps(zone, other, 24)) errors.push(`Zones '${zone.id}' and '${other.id}' overlap.`);
    }
    if (estimatedTextWidth(zone.title, 18, 600) > zone.width - 36) {
      errors.push(`Zone '${zone.id}' title exceeds its boundary.`);
    }
    if (estimatedTextWidth(zone.subtitle, 12) > zone.width - 36) {
      errors.push(`Zone '${zone.id}' subtitle exceeds its boundary.`);
    }
  }

  for (const [index, node] of spec.nodes.entries()) {
    const zone = zonesById.get(node.zoneId);
    if (!zone) {
      errors.push(`Node '${node.id}' has missing zone '${node.zoneId}'.`);
    } else {
      const contentArea = { ...zone, y: zone.y + 64, height: zone.height - 64 };
      if (!inside(node, contentArea, 18))
        errors.push(`Node '${node.id}' escapes zone '${zone.id}'.`);
    }
    if (!logosById.has(node.logoId)) {
      errors.push(`Node '${node.id}' has missing logo '${node.logoId}'.`);
    }
    errors.push(...nodeTextFits(node));
    for (const other of spec.nodes.slice(index + 1)) {
      if (node.zoneId === other.zoneId && overlaps(node, other, 20)) {
        errors.push(`Nodes '${node.id}' and '${other.id}' overlap.`);
      }
    }
  }

  for (const connector of spec.connectors) {
    errors.push(...verifyConnector(connector, nodesById, canvas));
  }

  const labels = spec.connectors.filter(
    (connector): connector is Connector & { labelBox: Box } => connector.labelBox !== undefined,
  );
  for (const [index, connector] of labels.entries()) {
    for (const other of labels.slice(index + 1)) {
      if (overlaps(connector.labelBox, other.labelBox, 4)) {
        errors.push(`Connector labels '${connector.id}' and '${other.id}' overlap.`);
      }
    }
  }

  for (const group of spec.exclusiveRoutes) {
    const members = group.members.map((id) => connectorsById.get(id));
    if (members.some((connector) => connector === undefined)) {
      errors.push(`Exclusive route '${group.id}' references a missing connector.`);
      continue;
    }
    const defaultConnector = connectorsById.get(group.defaultConnectorId);
    if (!defaultConnector || !group.members.includes(defaultConnector.id)) {
      errors.push(`Exclusive route '${group.id}' has an invalid default connector.`);
      continue;
    }
    if (defaultConnector.mode !== "active") {
      errors.push(`Exclusive route '${group.id}' default must be the active path.`);
    }
    const optionalCount = members.filter((connector) => connector?.mode === "optional").length;
    if (optionalCount !== members.length - 1) {
      errors.push(
        `Exclusive route '${group.id}' must have one active default and optional alternatives.`,
      );
    }
  }

  return errors;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function zoneStyle(tone: ArchitectureSpec["zones"][number]["tone"]): {
  fill: string;
  stroke: string;
} {
  if (tone === "primary") return { fill: palette.primarySoft, stroke: palette.primary };
  if (tone === "optional") return { fill: palette.optionalSoft, stroke: palette.optional };
  if (tone === "temporary") return { fill: palette.temporarySoft, stroke: palette.foreground };
  return { fill: palette.background, stroke: palette.border };
}

function nodeStyle(tone: DiagramNode["tone"]): { fill: string; stroke: string } {
  if (tone === "primary") return { fill: palette.primarySoft, stroke: palette.primary };
  if (tone === "active") return { fill: palette.activeSoft, stroke: palette.active };
  if (tone === "optional") return { fill: palette.optionalSoft, stroke: palette.optional };
  if (tone === "temporary") return { fill: palette.temporarySoft, stroke: palette.foreground };
  if (tone === "evidence") return { fill: palette.evidenceSoft, stroke: palette.evidence };
  return { fill: palette.background, stroke: palette.border };
}

function connectorStyle(mode: Connector["mode"]): {
  color: string;
  dash: string | undefined;
  marker: string;
} {
  if (mode === "optional")
    return { color: palette.optional, dash: "8 7", marker: "arrow-optional" };
  if (mode === "evidence")
    return { color: palette.evidence, dash: undefined, marker: "arrow-evidence" };
  if (mode === "teardown")
    return { color: palette.teardown, dash: "5 5", marker: "arrow-teardown" };
  if (mode === "active")
    return { color: palette.foreground, dash: undefined, marker: "arrow-active" };
  return { color: palette.muted, dash: undefined, marker: "arrow-data" };
}

function renderConnector(connector: Connector): string {
  const style = connectorStyle(connector.mode);
  const route = connector.points
    .map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`)
    .join(" ");
  const dash = style.dash ? ` stroke-dasharray="${style.dash}"` : "";
  const label =
    connector.label && connector.labelBox
      ? `<g data-connector-label="${escapeXml(connector.id)}" data-geometry-owner="connector:${escapeXml(connector.id)}">
          <rect x="${connector.labelBox.x}" y="${connector.labelBox.y}" width="${connector.labelBox.width}" height="${connector.labelBox.height}" rx="7" fill="${palette.background}" stroke="${style.color}" stroke-width="1" />
          <text x="${connector.labelBox.x + connector.labelBox.width / 2}" y="${connector.labelBox.y + 18}" text-anchor="middle" font-size="11" font-weight="600" fill="${style.color}">${escapeXml(connector.label)}</text>
        </g>`
      : "";
  const labelMarkup = label ? `\n      ${label}` : "";
  return `<g data-connector-id="${escapeXml(connector.id)}" data-connector-mode="${connector.mode}">
      <path d="${route}" fill="none" stroke="${style.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#${style.marker})"${dash} />${labelMarkup}
    </g>`;
}

function renderLogo(node: DiagramNode, logo: DiagramLogo): string {
  const owner = `node:${escapeXml(node.id)}`;
  if (logo.kind === "asset") {
    return `<g data-logo-asset="${escapeXml(logo.id)}" data-geometry-owner="${owner}">
        <rect x="${node.x + 18}" y="${node.y + 17}" width="34" height="26" fill="transparent" />
        <use href="#architecture-logo-${escapeXml(logo.id)}" x="${node.x + 18}" y="${node.y + 17}" width="34" height="26" />
      </g>`;
  }
  return `<g data-logo-placeholder="${escapeXml(logo.id)}" data-geometry-owner="${owner}">
        <rect x="${node.x + 18}" y="${node.y + 17}" width="34" height="26" rx="6" fill="${palette.foreground}" />
        <text x="${node.x + 35}" y="${node.y + 35}" text-anchor="middle" font-size="10" font-weight="700" fill="${palette.background}">${escapeXml(logo.label)}</text>
      </g>`;
}

function renderNode(node: DiagramNode, logo: DiagramLogo): string {
  const style = nodeStyle(node.tone);
  const details = node.details
    .map(
      (detail, index) =>
        `<text data-node-text="detail" data-geometry-owner="node:${escapeXml(node.id)}" x="${node.x + 18}" y="${node.y + 61 + index * 17}" font-size="12" fill="${palette.muted}">${escapeXml(detail)}</text>`,
    )
    .join("\n");
  return `<g data-node-id="${escapeXml(node.id)}">
      <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="9" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1.5" />
      ${renderLogo(node, logo)}
      <text data-node-text="title" data-geometry-owner="node:${escapeXml(node.id)}" x="${node.x + 64}" y="${node.y + 35}" font-size="15" font-weight="650" fill="${palette.foreground}">${escapeXml(node.title)}</text>
      ${details}
    </g>`;
}

function renderLogoSymbols(
  spec: ArchitectureSpec,
  embeddedLogos: EmbeddedArchitectureLogos,
): string {
  return spec.logos
    .filter((logo) => logo.kind === "asset")
    .map((logo) => {
      const asset = embeddedLogos.get(logo.id);
      if (!asset) throw new Error(`Architecture logo '${logo.id}' was not loaded.`);
      return `<symbol id="architecture-logo-${escapeXml(logo.id)}" viewBox="${escapeXml(asset.viewBox)}" preserveAspectRatio="xMidYMid meet">${asset.markup}</symbol>`;
    })
    .join("\n");
}

export function renderArchitectureSvg(
  spec: ArchitectureSpec,
  embeddedLogos: EmbeddedArchitectureLogos,
): string {
  const errors = verifyArchitectureSpec(spec);
  if (errors.length > 0)
    throw new Error(`Architecture specification is invalid:\n- ${errors.join("\n- ")}`);
  const logos = new Map(spec.logos.map((logo) => [logo.id, logo]));
  const logoSymbols = renderLogoSymbols(spec, embeddedLogos);
  const zones = spec.zones
    .map((zone) => {
      const style = zoneStyle(zone.tone);
      return `<g data-zone-id="${escapeXml(zone.id)}">
        <rect x="${zone.x}" y="${zone.y}" width="${zone.width}" height="${zone.height}" rx="16" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1.5" />
        <text data-zone-text="title" data-geometry-owner="zone:${escapeXml(zone.id)}" x="${zone.x + 18}" y="${zone.y + 29}" font-size="18" font-weight="650" fill="${palette.foreground}">${escapeXml(zone.title)}</text>
        <text data-zone-text="subtitle" data-geometry-owner="zone:${escapeXml(zone.id)}" x="${zone.x + 18}" y="${zone.y + 50}" font-size="12" fill="${palette.muted}">${escapeXml(zone.subtitle)}</text>
      </g>`;
    })
    .join("\n");
  const connectors = spec.connectors.map(renderConnector).join("\n");
  const nodes = spec.nodes
    .map((node) => {
      const logo = logos.get(node.logoId);
      if (!logo) throw new Error(`Node '${node.id}' references missing logo '${node.logoId}'.`);
      return renderNode(node, logo);
    })
    .join("\n");
  const exclusiveRoute = spec.exclusiveRoutes[0];
  const note = exclusiveRoute
    ? `<text data-footer-text="exclusive-route" data-geometry-owner="footer" x="40" y="1168" font-size="13" font-weight="650" fill="${palette.foreground}">${escapeXml(exclusiveRoute.title)}. Managed runs now; ZCP can replace it per customer.</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${spec.canvas.width} ${spec.canvas.height}" role="img" aria-labelledby="architecture-title architecture-description" preserveAspectRatio="xMidYMid meet">
  <title id="architecture-title">${escapeXml(spec.canvas.title)}</title>
  <desc id="architecture-description">${escapeXml(spec.canvas.description)}</desc>
  <defs>
    <marker id="arrow-active" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="${palette.foreground}" /></marker>
    <marker id="arrow-data" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="${palette.muted}" /></marker>
    <marker id="arrow-optional" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="${palette.optional}" /></marker>
    <marker id="arrow-evidence" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="${palette.evidence}" /></marker>
    <marker id="arrow-teardown" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="${palette.teardown}" /></marker>
    ${logoSymbols}
  </defs>
  <rect width="${spec.canvas.width}" height="${spec.canvas.height}" fill="${palette.background}" />
  <text data-canvas-title="true" data-geometry-owner="canvas-title" x="40" y="58" font-size="30" font-weight="650" fill="${palette.foreground}">${escapeXml(spec.canvas.title)}</text>
  <text data-canvas-subtitle="true" data-geometry-owner="canvas-subtitle" x="40" y="89" font-size="14" fill="${palette.muted}">One selected Codex connection → one isolated review project → recorded proof → exact teardown.</text>
  ${zones}
  ${connectors}
  ${nodes}
  ${note}
  <g data-legend="true" data-geometry-owner="legend" transform="translate(40 1200)">
    <line x1="0" y1="0" x2="34" y2="0" stroke="${palette.foreground}" stroke-width="2" /><text x="44" y="4" font-size="12" fill="${palette.muted}">active/default</text>
    <line x1="180" y1="0" x2="214" y2="0" stroke="${palette.optional}" stroke-width="2" stroke-dasharray="8 7" /><text x="224" y="4" font-size="12" fill="${palette.muted}">optional alternative</text>
    <line x1="430" y1="0" x2="464" y2="0" stroke="${palette.evidence}" stroke-width="2" /><text x="474" y="4" font-size="12" fill="${palette.muted}">evidence</text>
    <line x1="590" y1="0" x2="624" y2="0" stroke="${palette.teardown}" stroke-width="2" stroke-dasharray="5 5" /><text x="634" y="4" font-size="12" fill="${palette.muted}">verified teardown</text>
  </g>
</svg>
`;
}

export async function loadArchitectureSpec(url: URL): Promise<ArchitectureSpec> {
  const source = await readFile(url, "utf8");
  const document: unknown = JSON.parse(source);
  return architectureSpecSchema.parse(document);
}

function prefixAssetIds(markup: string, logoId: string): string {
  const ids = [...markup.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
  let prefixed = markup;
  for (const id of ids) {
    if (!id) continue;
    const replacement = `architecture-logo-${logoId}-${id}`;
    prefixed = prefixed
      .replaceAll(`id="${id}"`, `id="${replacement}"`)
      .replaceAll(`id='${id}'`, `id='${replacement}'`)
      .replaceAll(`url(#${id})`, `url(#${replacement})`)
      .replaceAll(`href="#${id}"`, `href="#${replacement}"`)
      .replaceAll(`href='#${id}'`, `href='#${replacement}'`)
      .replaceAll(`xlink:href="#${id}"`, `xlink:href="#${replacement}"`)
      .replaceAll(`xlink:href='#${id}'`, `xlink:href='#${replacement}'`);
  }
  return prefixed;
}

function parseEmbeddedLogo(source: string, logoId: string): EmbeddedArchitectureLogo {
  if (
    /<\/?(?:script|foreignObject|iframe|object|embed|image)\b/i.test(source) ||
    /\bon[a-z]+\s*=/i.test(source) ||
    /\b(?:href|xlink:href)\s*=\s*["'](?!#)/i.test(source) ||
    /(?:data:|file:|javascript:)/i.test(source) ||
    /url\(\s*["']?(?:https?:|\/\/)/i.test(source) ||
    /@import/i.test(source)
  ) {
    throw new Error(`Architecture logo '${logoId}' contains unsafe or external content.`);
  }
  const root = source.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>\s*$/i);
  if (!root) throw new Error(`Architecture logo '${logoId}' is not a complete SVG document.`);
  const attributes = root[1] ?? "";
  const markup = root[2] ?? "";
  const viewBoxMatch = attributes.match(/\bviewBox\s*=\s*["']([^"']+)["']/i);
  const viewBox = viewBoxMatch?.[1];
  if (!viewBox) throw new Error(`Architecture logo '${logoId}' has no viewBox.`);
  const coordinates = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    coordinates.length !== 4 ||
    coordinates.some((coordinate) => !Number.isFinite(coordinate)) ||
    (coordinates[2] ?? 0) <= 0 ||
    (coordinates[3] ?? 0) <= 0
  ) {
    throw new Error(`Architecture logo '${logoId}' has an invalid viewBox.`);
  }
  return { markup: prefixAssetIds(markup, logoId), viewBox };
}

export async function loadArchitectureLogos(
  spec: ArchitectureSpec,
  workspace: URL,
): Promise<EmbeddedArchitectureLogos> {
  const entries = await Promise.all(
    spec.logos
      .filter(
        (logo): logo is DiagramLogo & { kind: "asset"; assetPath: string } =>
          logo.kind === "asset" && logo.assetPath !== undefined,
      )
      .map(async (logo) => {
        const source = await readFile(new URL(logo.assetPath, workspace), "utf8");
        return [logo.id, parseEmbeddedLogo(source, logo.id)] as const;
      }),
  );
  return new Map(entries);
}
