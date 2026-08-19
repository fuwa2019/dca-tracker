# Wealthfolio UI Alignment

## Context

The 2026-08 competitive study adopted Wealthfolio `v3.6.2` as the interaction
reference and recorded a boundary in
`docs/research/competitive/2026-08/decisions.md`:

> Copy any competitor visual language or brand wording | reject | project
> boundary | Research may transfer information architecture and interaction
> patterns only

`DESIGN.md` carried the same line: "patterns only. Brand, wording, visual
assets, and distinctive styling remain [ours]".

On 2026-08-20 the owner directed that the frontend should follow Wealthfolio
"尽可能复刻" — replicate as closely as practical, interaction **and** interface.
That is a deliberate change of product direction, so it needs a decision record
rather than a silent edit.

## Licensing and trademark facts

Checked before accepting the direction:

- Wealthfolio `v3.6.2` is licensed **AGPL-3.0** (`LICENSE` in the official
  source archive). Copying its components, stylesheets, Tailwind theme files,
  or icon assets into this repository would place this project — which is
  publicly deployed on Cloudflare Pages — under the AGPL network copyleft
  obligation.
- Wealthfolio publishes a `TRADEMARKS.md`: the word mark and logos may be used
  to discuss the project, but not in a product name, and not in a way that
  implies affiliation.
- Wealthfolio's color layer is **Flexoki**, an independently published palette
  by Steph Ango, released under the **MIT license** with a request for
  attribution and a link to `stephango.com/flexoki`. The palette is therefore
  available to this project directly from its own upstream source, with no
  dependency on Wealthfolio's licensing.
- The typefaces involved (Inter, JetBrains Mono, Merriweather) are open-licensed
  and already reachable through the existing Google Fonts link.

## Decision

Adopt Wealthfolio's interface language as the reference for this product's
frontend, implemented as follows:

1. **Replicate**: information architecture, navigation model, page composition,
   interaction flows, layout density, component anatomy, spacing/radius/type
   scales, numeric presentation, and the semantic use of color and state.
2. **Reimplement, never copy**: every pixel of it is written in this
   repository's own components. No Wealthfolio source file, stylesheet,
   Tailwind theme, SVG, or image is copied in, in whole or in part.
3. **Color**: take Flexoki from its own upstream definition, not from
   Wealthfolio's file, and carry the MIT attribution in the repository.
4. **Never adopt**: the Wealthfolio name, logo, wording that identifies the
   product, or any claim of affiliation. Product copy stays ours and stays in
   Chinese.
5. **Never adopt**: features on the existing reject list. Alignment is about
   how the interface behaves and looks, not about growing into multi-account
   wealth management, budgeting, or trade execution.

This supersedes the "reject — copy any competitor visual language" row in
`docs/research/competitive/2026-08/decisions.md` and the corresponding
`DESIGN.md` sentence. The WCAG 2.2 AA baseline in `DESIGN.md` is unchanged and
outranks visual fidelity: where Wealthfolio's own values fail the accessibility
gate, this project keeps the accessible value and records the divergence.

## Consequences

- The current visual identity — cool gray surfaces, Hanken Grotesk display
  type, Fraunces serif figures, the brand red accent, and the "workbench panel"
  card language — is replaced. That is a large, deliberate rewrite of the
  presentation layer; the calculation, import, and share contracts are not
  touched by it.
- `src/lib/calc/` stays pure, the public share payload stays percentage-only,
  and no migration follows from this decision.
- The measured reference and the per-surface mapping live in
  `docs/design/wealthfolio-ui-teardown.md`. Work is delivered surface by
  surface, each with its own verification, not as one release.
- Accessibility regressions are not acceptable as a cost of fidelity: the
  probes in `docs/accessibility/probes/` are re-run per surface, and
  `docs/accessibility/2026-08-20-wcag-route-audit.md` is the standing baseline.
