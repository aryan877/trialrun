# TrialRun design system

Checked: 2026-08-08

Measured reference surfaces:

- <https://fal.ai/>
- <https://fal.ai/dashboard> (authenticated, read-only inspection)

This is TrialRun's owned interface specification. The linked surfaces were measured
to replace guesswork with real geometry; they are provenance, not branding or a
component source. TrialRun uses its own name, copy, palette, icons, and evidence-first
information architecture.

## Measurement method

Measurements came from a 1512 x 805 CSS-pixel Chrome viewport at device pixel ratio
2. We combined screenshots with `getBoundingClientRect()` and computed-style reads.
The browser reported a 1497 px document client width because the vertical scrollbar
consumed 15 px. Counts below are computed across 1,028 visible dashboard elements,
so they describe the rendered interface rather than a guessed design system.

## Reference measurements: public landing page

- Main headline: x 348.5, y 255, width 764.28, height 300.
- Headline type: 120/100 px, weight 500, letter spacing -4.8 px.
- Headline container: x 332.5, y 32, width 796.28, height 703, horizontal
  padding 16 px.
- Supporting copy: x 348.5, y 579, width 480, height 84; 18/28 px.
- Copy-to-actions gap: 24 px.
- Primary and secondary actions: 48 px high, 4 px radius, 24 px horizontal
  padding, 16/24 px label.
- Secondary action border: 1 px at roughly 13% black opacity.

The useful principle is deliberate scale contrast: one strong product statement,
then compact controls. TrialRun should not reproduce fal's cyan hero or typeface.

## Reference measurements: authenticated dashboard shell

### Vertical geometry

| Region | y | height | notes |
| --- | ---: | ---: | --- |
| Announcement | 0 | 32 | 6 px vertical, 44 px horizontal padding |
| Utility header | 32 | 56 | 16 px outer horizontal padding |
| Product navigation | 88 | 40 | second row inside a 96 px sticky shell |
| Page heading | 128 | 98 | inner content x 36, width 1440 |
| Main content | 226 | continues | 36 px outer margin, 16 px inner padding |

The header shell is sticky and totals 96 px below the optional 32 px announcement.
The dashboard content uses a near-full-width canvas: 36 px page gutter plus 16 px
content padding, placing primary content at x 52.

### Controls and surfaces

- Search control: x 852.51, y 42, width 300, height 36; 8 px gap; 8 px
  horizontal padding; 4 px radius; 1 px white-at-10% border.
- Page-heading inner row: x 36, y 128, width 1440, height 97; 24 px vertical
  and 16 px horizontal padding; 16 px gap.
- "Getting started" heading: x 52, y 250, width 177.55, height 28; 20/28 px,
  weight 500.
- Two-column guide frame: x 52, y 318, width 1408, height 251.5; 1 px
  white-at-10% border; 4 px radius.
- Model tab: x 52, y 625.5, width 145.65, height 40; 4 x 16 px padding;
  2 px radius; 14/20 px, weight 600.
- Latest-model grid: x 52, y 681.5, width 1408; 8 px grid gap.
- Large preview card sample: x 52, y 913.5, width 340, height 372; 4 px
  radius and a 3% white border.

### Computed token frequencies

These frequencies prevent arbitrary one-off values in TrialRun:

- Font sizes: 16 px (547 elements), 14 px (227), 12 px (179), 10 px (70).
  Only four visible elements exceeded 16 px.
- Line heights: 24 px (476), 20 px (276), 16 px (174), 15 px (67).
- Radii: 0 px (891), 4 px (94), 2 px (37), pill (4).
- Non-zero borders: 78 at 1 px and one at 2 px.
- Flex/grid gaps: 8 px (94), 4 px (23), 6 px (22), 16 px (4), 12 px
  (3). Large gaps are exceptional.
- Common horizontal control padding is 24 px; section padding is 24 x 16 px.
- Base dark surface is rgb(22, 22, 24). Secondary solid surface is
  rgb(32, 32, 34). The two common stroke strengths are white at 3% and 10%.
- Most surfaces are transparent. Hierarchy comes from thin borders, spacing,
  type weight, and occasional 2-5% white overlays rather than many card fills.

## TrialRun tokens and translation

TrialRun will use:

- a 56 px utility header and 40 px product navigation on desktop;
- 36 px page gutters at wide desktop, collapsing to 20 px and 16 px;
- a 4/8/12/16/24/32/48 px spacing scale;
- 2 px control and 4 px panel radii;
- 1 px semantic borders;
- compact 12/16, 14/20, 16/24, 20/28 and 30/36 typography;
- a charcoal evidence canvas with an owned electric-lime running signal, cyan
  informational signal, amber warning, and coral failure signal;
- large uninterrupted evidence regions instead of ornamental dashboard cards;
- matched base/PR screenshots on a strict two-column grid at desktop, with a
  toggle at narrow widths;
- real skeletons that preserve final geometry, a visible runner heartbeat, and
  an explicit teardown state. No fake terminal output.

Implementation uses Tailwind CSS v4 semantic tokens and selectively installed
shadcn/ui primitives. `components.json`, the `@/*` TypeScript alias, CSS-variable
theming, and the shared `cn()` utility must agree. Components are generated through
the shadcn CLI and then shaped to these TrialRun tokens; a stock shadcn theme is not
the product design.

## Verification targets

For TrialRun itself, inspect at 1440, 1024, 768, and 390 CSS pixels. At each width
verify bounding boxes, computed tokens, keyboard focus, contrast, and overflow in
addition to screenshots. A page is not accepted solely because it looks close.
