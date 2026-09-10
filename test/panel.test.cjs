// The panel's list model: grouping, the count label and the redraw signature.
const path = require("path");
const fs = require("fs");

// `panelmodel.ts` imports nothing from obsidian on purpose — that is what makes the part of
// the panel worth testing testable without the app.
const src = path.join(__dirname, "panelmodel.build.cjs");
require("child_process").execFileSync("npx", [
  "esbuild", "src/panelmodel.ts", "--bundle", "--format=cjs",
  "--outfile=" + src, "--log-level=error",
], { cwd: path.resolve(__dirname, "..") });
const { groupRows, countLabel, signature } = require(src);
fs.unlinkSync(src);

let passed = 0;
let failed = 0;

function ok(name, cond) {
  if (cond) { passed++; console.log("  ok  ", name); }
  else { failed++; console.log("  FAIL", name); }
}

function eq(name, actual, expected) {
  ok(name + (actual === expected ? "" : ` — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`),
     actual === expected);
}

function sticky(id, file, extra) {
  return Object.assign({
    id, file, x: 0, y: 0, width: 230, height: 170,
    color: "yellow", kind: "note", content: "", rotation: 0,
  }, extra || {});
}

const A = "Notes/Alpha.md";
const B = "Zeta/Beta.md";
const GONE = "Notes/Plan/gone.md";
const all = (p) => p !== GONE;

// --- grouping ---------------------------------------------------------------

{
  // Interleaved in creation order, which is how they arrive from the store.
  const items = [sticky("1", A), sticky("2", B), sticky("3", A)];
  const groups = groupRows(items, null, "vault", all);
  eq("vault scope groups by file", groups.length, 2);
  eq("a file's stickies stay together", groups.map((g) => g.rows.length).join(","), "2,1");
  eq("insertion order survives inside a group",
     groups.find((g) => g.file === A).rows.map((r) => r.sticky.id).join(""), "13");
}

{
  const items = [sticky("1", B), sticky("2", A)];
  eq("groups sort by path when no note is active",
     groupRows(items, null, "vault", all).map((g) => g.file).join("|"), `${A}|${B}`);
  eq("the active note sorts first",
     groupRows(items, B, "vault", all).map((g) => g.file).join("|"), `${B}|${A}`);
  ok("the active group is flagged", groupRows(items, B, "vault", all)[0].active === true);
}

{
  const items = [sticky("1", A), sticky("2", B)];
  const groups = groupRows(items, A, "file", all);
  eq("file scope keeps only the active note", groups.length, 1);
  eq("file scope keeps the right note", groups[0].file, A);
  eq("file scope with no active note is empty", groupRows(items, null, "file", all).length, 0);
}

{
  // A sticky whose note was moved on disk, outside Obsidian, points at a path that is gone.
  const groups = groupRows([sticky("1", GONE), sticky("2", A)], A, "vault", all);
  const missing = groups.find((g) => g.file === GONE).rows[0];
  ok("a sticky on a vanished note is marked missing", missing.missing === true);
  ok("a sticky on a live note is not", groups.find((g) => g.file === A).rows[0].missing === false);
}

{
  eq("the heading drops the extension", groupRows([sticky("1", A)], null, "vault", all)[0].label, "Alpha");
}

// --- the count label ---------------------------------------------------------

eq("zero is plural", countLabel(0), "0 stickies");
eq("one is singular", countLabel(1), "1 sticky");
eq("twelve is not 'stickys'", countLabel(12), "12 stickies");

// --- the redraw signature ----------------------------------------------------

{
  const items = [sticky("1", A, { content: "hello" })];
  const sig = () => signature(groupRows(items, A, "vault", all), "vault", A);
  const before = sig();
  eq("an unchanged store redraws nothing", sig(), before);

  items[0].x = 400;
  items[0].y = 900;
  eq("a move does not redraw the list", sig(), before);

  items[0].content = "hello there";
  ok("an edit does redraw the list", sig() !== before);
}

{
  const items = [sticky("1", A)];
  const base = signature(groupRows(items, A, "vault", all), "vault", A);
  ok("switching scope redraws", signature(groupRows(items, A, "file", all), "file", A) !== base);

  const orphaned = [sticky("1", A, { anchor: { text: "x", before: "", after: "", start: 0, end: 1, orphaned: true } })];
  ok("orphaning redraws", signature(groupRows(orphaned, A, "vault", all), "vault", A) !== base);

  const lost = [sticky("1", A)];
  ok("a note leaving the vault redraws",
     signature(groupRows(lost, A, "vault", () => false), "vault", A) !== base);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
