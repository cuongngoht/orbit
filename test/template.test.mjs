import assert from "node:assert/strict";
import { test } from "node:test";
import { esc, render } from "../src/report/template.mjs";

// The reason the renderer exists rather than a string literal per tag: escaping
// is decided ONCE, here, for every value. A report's values come from a
// product's own screen and its own database, so the safe thing has to be the
// thing that happens when the template author writes the short form.
test("a value is escaped unless the template asks for raw, and asking is visible", () => {
  const data = { row: '<script>alert(1)</script>', markup: "<b>ok</b>" };
  assert.equal(render("{{row}}", data), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(render("{{{markup}}}", data), "<b>ok</b>");
  assert.equal(render("{{missing}}", data), "", "an absent name is empty, never the word undefined");
  assert.equal(esc('a"b<c&d'), "a&quot;b&lt;c&amp;d");
});

test("a section repeats for a list, renders once for anything else truthy, and is skipped when empty", () => {
  const t = "{{#rows}}[{{n}}]{{/rows}}";
  assert.equal(render(t, { rows: [{ n: 1 }, { n: 2 }] }), "[1][2]");
  assert.equal(render(t, { rows: [] }), "", "an empty list renders nothing, not one blank block");
  assert.equal(render(t, { rows: null }), "");
  assert.equal(render("{{#on}}yes{{/on}}", { on: true }), "yes");
  assert.equal(render("{{#o}}{{a}}{{/o}}", { o: { a: "x" } }), "x", "an object pushes itself as the scope");
});

test("an inverted section is the empty case, which is how a report says 'nothing here' instead of showing a gap", () => {
  assert.equal(render("{{^rows}}none{{/rows}}", { rows: [] }), "none");
  assert.equal(render("{{^rows}}none{{/rows}}", { rows: [1] }), "");
  assert.equal(render("{{#rows}}x{{/rows}}{{^rows}}none{{/rows}}", { rows: null }), "none");
});

// A table's cells are strings, not objects, and a block inside a block has to be
// able to read a name from the page while standing on an item.
test("the current item is {{.}}, and an inner block can still see an outer name", () => {
  assert.equal(render("{{#cells}}<td>{{.}}</td>{{/cells}}", { cells: ["a", "b"] }), "<td>a</td><td>b</td>");
  assert.equal(render("{{#rows}}{{title}}:{{n}} {{/rows}}", { title: "T", rows: [{ n: 1 }, { n: 2 }] }), "T:1 T:2 ");
  assert.equal(render("{{#a}}{{#b}}{{x}}{{/b}}{{/a}}", { a: { b: { x: "deep" } } }), "deep", "sections nest");
});

test("a value escapes inside a section too, so a loop is not a hole in the rule", () => {
  const out = render("{{#rows}}<td>{{v}}</td>{{/rows}}", { rows: [{ v: "<img onerror=x>" }] });
  assert.ok(!out.includes("<img"));
  assert.match(out, /&lt;img onerror=x&gt;/);
});
