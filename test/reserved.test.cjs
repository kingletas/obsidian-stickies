// Nothing this plugin defines may shadow a member of the Obsidian class it extends.
// TypeScript cannot see internals such as `View.open`, so the list below is kept by hand and
// errs on the broad side.
const Module = require("module");
const path = require("path");
const fs = require("fs");

/**
 * Members of Component -> View -> ItemView, documented and undocumented.
 * Sources: obsidian.d.ts, plus the internals that are real but unpublished (`open`, `close`,
 * `setState`/`getState` pairs, the `*EphemeralState` pair, `onResize`, `onPaneMenu`).
 */
const RESERVED = new Set([
  // Component
  "load", "onload", "unload", "onunload", "addChild", "removeChild", "register",
  "registerEvent", "registerDomEvent", "registerInterval", "registerScopeEvent",
  // View / ItemView, public
  "app", "leaf", "containerEl", "contentEl", "titleEl", "icon", "navigation", "scope",
  "getViewType", "getDisplayText", "getIcon", "onOpen", "onClose", "getState", "setState",
  "getEphemeralState", "setEphemeralState", "onResize", "onPaneMenu", "getViewData",
  "setViewData",
  // View, internal but real — these are the ones with teeth
  "open", "close", "onHeaderMenu", "onunloadFile", "onLoadFile", "onDelete", "onRename",
]);

/** The overrides that are the whole point of subclassing, and must not be flagged. */
const INTENDED = new Set(["getViewType", "getDisplayText", "getIcon", "onOpen", "onClose"]);

const stub = {
  ItemView: class { constructor(leaf) { this.leaf = leaf; } registerEvent() {} },
  TFile: class {}, Notice: class {}, setIcon: () => {},
};
const orig = Module._load;
Module._load = function (request) {
  if (request === "obsidian") return stub;
  return orig.apply(this, arguments);
};

const built = path.join(__dirname, "reserved.build.cjs");
require("child_process").execFileSync("npx", [
  "esbuild", "src/panel.ts", "--bundle", "--format=cjs", "--external:obsidian",
  "--outfile=" + built, "--log-level=error",
], { cwd: path.resolve(__dirname, "..") });
const { StickiesPanel } = require(built);
fs.unlinkSync(built);

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const own = Object.getOwnPropertyNames(StickiesPanel.prototype).filter((n) => n !== "constructor");
const clashes = own.filter((n) => RESERVED.has(n) && !INTENDED.has(n));

check(
  "no method shadows an Obsidian View member",
  clashes.length === 0,
  clashes.length ? `shadows: ${clashes.join(", ")} — rename them` : ""
);

// The guard is only worth having if it actually fires, so prove it does.
check("the guard would catch `open`", RESERVED.has("open") && !INTENDED.has("open"));
check("the guard would catch `scope`", RESERVED.has("scope") && !INTENDED.has("scope"));
check("the guard permits the intended overrides", ["getViewType", "onOpen"].every((n) => INTENDED.has(n)));
check("the panel still declares its intended overrides", INTENDED.has("onOpen") && own.includes("onOpen"));

console.log(`\n${pass} passed, ${fail} failed`);
console.log(`  (checked ${own.length} members: ${own.join(", ")})`);
if (fail) process.exitCode = 1;
