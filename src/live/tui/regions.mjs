// WHERE THE SCREEN'S ROWS COME FROM (0.0.3, ADR 0029): an ordered table of REGIONS -- what sits on top, the one body
// between, what sits at the bottom -- so a header, a rule or a footer is a row of this table and never a line assembled
// by hand in the frame. The body is given every row the other regions leave (frame.mjs), so a region added, dropped or
// made taller moves nothing else. A region says WHEN it is drawn: the rules under the header and over the footer stay
// where nothing else marks the edge (the dashboard, sixteen colours, no colour) and give way to the bands that do beside
// an AI CLI, as Orbit Live's look draws it. A region that is `animated` may hold the orbit: its rows carry
// `orbit: { part, k }`, and the terminal draws them again between data frames through ORBIT_PARTS, and nothing else.
//
//   REGIONS: [{ name, place: "top" | "body" | "bottom", rows?: (ctx) -> [row], when?: (ctx) -> bool, animated? }]
//   placed(ctx, place) -> [row]          the rows of one place, in the table's order, of the regions that are drawn
//   ORBIT_PARTS: part -> (ctx) -> [row]  every row that may hold the orbit, by the name its `orbit.part` says
import { expandedOrbitRows } from "./pane-frame.mjs";
import { rule } from "./sections/parts.mjs";
import { footerRow, headerRow } from "./sections/top.mjs";

// The bands mark the edges beside an AI CLI; everywhere else a rule does.
const ruled = (ctx) => !(ctx.state.viewer.bands && ctx.state.viewer.layout === "pane");

export const REGIONS = Object.freeze([
  Object.freeze({ name: "header", place: "top", rows: (ctx) => [headerRow(ctx)], animated: true }),
  Object.freeze({ name: "header-rule", place: "top", when: ruled, rows: (ctx) => [rule(ctx.width, "═")] }),
  Object.freeze({ name: "body", place: "body" }),
  Object.freeze({ name: "footer-rule", place: "bottom", when: ruled, rows: (ctx) => [rule(ctx.width, "─")] }),
  Object.freeze({ name: "footer", place: "bottom", rows: (ctx) => [footerRow(ctx)] }),
]);

const drawnHere = (ctx, place) => (r) => r.place === place && typeof r.rows === "function" && (r.when?.(ctx) ?? true);

export const placed = (ctx, place) => REGIONS.filter(drawnHere(ctx, place)).flatMap((r) => r.rows(ctx));

const animatedParts = () => Object.fromEntries(REGIONS.filter((r) => r.animated).map((r) => [r.name, r.rows]));

export const ORBIT_PARTS = Object.freeze({ ...animatedParts(), expanded: expandedOrbitRows });
