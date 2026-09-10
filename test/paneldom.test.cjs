// Build the real StickiesPanel against a stubbed Obsidian and a minimal DOM, and check that
// opening it fills `contentEl`; the stub throws on any element API it does not implement.
const Module = require("module");
const path = require("path");
const fs = require("fs");

// --- a very small DOM -------------------------------------------------------

let attached = null; // the root that counts as "in the document"

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parent = null;
    this.classes = new Set();
    this.attrs = {};
    this.text = "";
    this.style = {};
    this.dataset = {};
    this.scrollTop = 0;
    this.onclick = null;
  }
  get isConnected() {
    let n = this;
    while (n) { if (n === attached) return true; n = n.parent; }
    return false;
  }
  get className() { return [...this.classes].join(" "); }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  append(child) { child.parent = this; this.children.push(child); return child; }
  empty() { for (const c of this.children) c.parent = null; this.children = []; this.text = ""; }
  addClass(c) { this.classes.add(c); }
  removeClass(c) { this.classes.delete(c); }
  toggleClass(c, on) { on ? this.classes.add(c) : this.classes.delete(c); }
  hasClass(c) { return this.classes.has(c); }
  setText(t) { this.text = String(t); }
  setAttr(k, v) { this.attrs[k] = v; }
  createEl(tag, o) { return this.append(build(tag, o)); }
  createDiv(o) { return this.append(build("div", o)); }
  createSpan(o) { return this.append(build("span", o)); }
  // Depth-first walk, for the assertions below.
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  find(cls) { return this.all().find((c) => c.classes.has(cls)) ?? null; }
  findAll(cls) { return this.all().filter((c) => c.classes.has(cls)); }
}

function build(tag, o) {
  const el = new El(tag);
  if (o?.cls) el.className = o.cls;
  if (o?.text != null) el.text = String(o.text);
  if (o?.attr) Object.assign(el.attrs, o.attr);
  return el;
}

global.window = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) };

// --- the obsidian stub ------------------------------------------------------

const iconCalls = [];
class TFile { constructor(p) { this.path = p; } }
const notices = [];

const stub = {
  TFile,
  Notice: class { constructor(m) { notices.push(m); } },
  Menu: class {},
  setIcon: (el, name) => { iconCalls.push(name); el.append(build("svg", { cls: "svg-icon" })); },
  ItemView: class {
    constructor(leaf) {
      this.leaf = leaf;
      this.containerEl = new El("div");
      this.contentEl = this.containerEl.createDiv({ cls: "view-content" });
      this.app = leaf.app;
    }
    registerEvent() {}
  },
};

const orig = Module._load;
Module._load = function (request) {
  if (request === "obsidian") return stub;
  return orig.apply(this, arguments);
};

// --- build and load ---------------------------------------------------------

const built = path.join(__dirname, "panel.build.cjs");
require("child_process").execFileSync("npx", [
  "esbuild", "src/panel.ts", "--bundle", "--format=cjs", "--external:obsidian",
  "--outfile=" + built, "--log-level=error",
], { cwd: path.resolve(__dirname, "..") });
const { StickiesPanel } = require(built);
fs.unlinkSync(built);

// --- the fixture ------------------------------------------------------------

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

function sticky(id, file, extra) {
  return Object.assign({
    id, file, x: 0, y: 0, width: 230, height: 170,
    color: "yellow", kind: "note", content: "a thought", rotation: 0,
  }, extra || {});
}

const FILE = "Notes/Alpha.md";
const stickies = [sticky("1", FILE), sticky("2", "Zeta/Beta.md")];

const app = {
  workspace: { on: () => ({}) },
  vault: { getAbstractFileByPath: (p) => (p === FILE ? new TFile(p) : null) },
};
const plugin = {
  app,
  settings: { panelScope: "vault" },
  store: { all: () => stickies, remove: () => {} },
  activePath: () => FILE,
  isVaultReady: () => true,
  addStickyToActiveNote: () => {},
  jumpToAnchor: () => {},
  revealSticky: () => {},
  setPanelScope: async () => {},
};

const panel = new StickiesPanel({ app }, plugin);
attached = panel.containerEl; // the view is in the document

let threw = null;
try {
  panel.onOpen();
} catch (e) {
  threw = e;
}

check("onOpen does not throw", threw === null, threw && `${threw.name}: ${threw.message}`);

const content = panel.contentEl;
check("the panel builds its chrome", content.children.length > 0,
      `contentEl has ${content.children.length} children — a blank panel is exactly this`);
check("there is a header", content.find("stickies-panel-header") !== null);
check("there is a scope toggle", content.find("stickies-panel-scope") !== null);
check("there is a count", content.find("stickies-panel-count") !== null);
check("the count is not 'stickys'", (content.find("stickies-panel-count")?.text ?? "").includes("stickies"));
check("there is a list container", content.find("stickies-panel-list") !== null);
check("a row is drawn for each sticky", content.findAll("stickies-panel-item").length === 2,
      `got ${content.findAll("stickies-panel-item").length}`);
check("vault scope draws a heading per note", content.findAll("stickies-panel-section").length === 2,
      `got ${content.findAll("stickies-panel-section").length}`);
check("the sticky on a missing note is marked", content.findAll("is-missing").length === 1,
      `got ${content.findAll("is-missing").length}`);

// --- a render failure must be visible, not blank ---------------------------
{
  const broken = new StickiesPanel({ app }, Object.assign({}, plugin, {
    store: { all: () => { throw new TypeError("store exploded"); }, remove: () => {} },
  }));
  attached = broken.containerEl;
  let boom = null;
  try { broken.onOpen(); } catch (e) { boom = e; }
  check("a throwing store does not escape onOpen", boom === null, boom && boom.message);
  const box = broken.contentEl.find("stickies-panel-failure");
  check("the failure is drawn in the panel", box !== null, "contentEl is blank — the old symptom");
  const msg = broken.contentEl.find("stickies-panel-failure-message");
  check("the failure names the error", (msg?.text ?? "").includes("store exploded"), msg?.text);
}

// A panel constructed before onload finished has no store at all.
{
  const early = new StickiesPanel({ app }, Object.assign({}, plugin, { store: undefined }));
  attached = early.containerEl;
  let boom = null;
  try { early.onOpen(); } catch (e) { boom = e; }
  check("a panel built before the store exists does not throw", boom === null, boom && boom.message);
  const msg = early.contentEl.find("stickies-panel-failure-message");
  check("it says the plugin had not finished loading",
        (msg?.text ?? "").includes("did not finish loading"), msg?.text);
}

// --- nothing is "missing" before the vault can answer ----------------------
{
  const early = new StickiesPanel({ app }, Object.assign({}, plugin, { isVaultReady: () => false }));
  attached = early.containerEl;
  early.onOpen();
  check("no rows are marked missing before layout-ready",
        early.contentEl.findAll("is-missing").length === 0,
        `got ${early.contentEl.findAll("is-missing").length} of ${early.contentEl.findAll("stickies-panel-item").length}`);
  check("the rows are still drawn", early.contentEl.findAll("stickies-panel-item").length === 2);
}

// And once it is ready, the real answer replaces the assumption. The redraw is throttled, so
// this has to wait for the trailing timer rather than assert straight after render().
(async () => {
  let ready = false;
  const late = new StickiesPanel({ app }, Object.assign({}, plugin, { isVaultReady: () => ready }));
  attached = late.containerEl;
  late.onOpen();
  check("before ready: nothing missing", late.contentEl.findAll("is-missing").length === 0);

  ready = true;
  late.render();
  await new Promise((r) => setTimeout(r, 250));
  check("after ready: the genuinely missing note is flagged",
        late.contentEl.findAll("is-missing").length === 1,
        `got ${late.contentEl.findAll("is-missing").length}`);
  check("after ready: the present note is not flagged",
        late.contentEl.findAll("stickies-panel-item").length === 2);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})();
