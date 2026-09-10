// Load the built plugin with a stubbed `obsidian` module but the REAL CodeMirror
// packages, to prove the top-level class extends and StateEffect.define resolve.
const Module = require("module");
const path = require("path");
const orig = Module._load;

class Base { constructor(...a){ this._a = a; } }
const stub = {
  Plugin: class extends Base { constructor(app, manifest){ super(app, manifest); this.app = app; this.manifest = manifest; } registerView(){} registerEditorExtension(){} addCommand(){} addRibbonIcon(){} addSettingTab(){} registerEvent(){} loadData(){return {};} saveData(){} },
  ItemView: class extends Base { registerEvent(){} },
  PluginSettingTab: class extends Base {},
  Setting: class { setName(){return this;} setDesc(){return this;} addToggle(){return this;} addDropdown(){return this;} addText(){return this;} },
  MarkdownView: class extends Base {},
  Notice: class {}, Menu: class {}, TFile: class {},
  setIcon: () => {},
  editorInfoField: require("@codemirror/state").StateField.define({ create: () => null, update: (v) => v }),
};

Module._load = function (request, parent, isMain) {
  if (request === "obsidian") return stub;
  return orig.apply(this, arguments);
};

// package.json sets "type":"module" but Obsidian requires a CJS bundle; Node needs the
// extension to agree before it will require() it. Obsidian loads main.js itself and does not care.
const fs = require("fs");
const tmp = path.join(__dirname, "main.build.cjs");
fs.copyFileSync(path.resolve(__dirname, "..", "main.js"), tmp);
const mod = require(tmp);
fs.unlinkSync(tmp);
const Plugin = mod.default ?? mod;
console.log("default export is a function:", typeof Plugin === "function");
console.log("extends the stubbed Plugin:  ", Object.getPrototypeOf(Plugin) === stub.Plugin);
console.log("prototype methods:           ", Object.getOwnPropertyNames(Plugin.prototype).filter(n => n !== "constructor").sort().join(", "));

// repaint() must survive a deferred sticky-panel leaf: the placeholder view Obsidian 1.7+
// restores until the tab is first shown, which getLeavesOfType() returns and which has no `render`.
const deferred = { __deferred: true }; // no `render`, exactly like the real placeholder
const plugin = new Plugin(
  { workspace: { getLeavesOfType: (t) => (t === "markdown" ? [] : [{ view: deferred }]) } },
  {}
);
let threw = null;
try { plugin.repaint(); } catch (e) { threw = e; }
console.log("repaint survives a deferred leaf:", threw === null ? "yes" : `NO — ${threw.message}`);
if (threw) process.exitCode = 1;
