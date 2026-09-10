// Exercise the store against a fake vault adapter: the v1 -> v2 migration, and the
// debounce deadline rule that a lazy geometry save must not postpone an eager content save.
const Module = require("module");
const path = require("path");
const fs = require("fs");
const orig = Module._load;

const notices = [];
Module._load = function (request) {
	if (request === "obsidian") return { App: class {}, Notice: class { constructor(m) { notices.push(m); } } };
	return orig.apply(this, arguments);
};

// A controllable clock and timer queue, so the debounce is tested by arithmetic not by waiting.
let now = 1000;
const timers = [];
global.window = {
	setTimeout: (fn, ms) => { timers.push({ fn, at: now + ms }); return timers.length; },
	clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cancelled = true; },
};
const realNow = Date.now;
Date.now = () => now;

function fakeApp(initial) {
	const files = { ...initial };
	return {
		files,
		vault: {
			adapter: {
				exists: async (p) => p in files,
				read: async (p) => files[p],
				write: async (p, data) => { files[p] = data; },
				mkdir: async (p) => { files[p] = null; },
			},
		},
	};
}

const src = path.join(__dirname, "store.build.cjs");
require("child_process").execFileSync("npx", [
	"esbuild", "src/store.ts", "--bundle", "--format=cjs", "--external:obsidian",
	"--outfile=" + src, "--log-level=error",
], { cwd: path.resolve(__dirname, "..") });
const { StickyStore } = require(src);
fs.unlinkSync(src);

let pass = 0, fail = 0;
function check(name, ok, extra) {
	if (ok) { pass++; console.log("  ok  ", name); }
	else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const V1 = {
	version: 1,
	stickies: {
		"a-1": { id: "a-1", file: "n.md", x: 1, y: 2, width: 3, height: 4, color: "orange",
			kind: "note", content: "keep me", rotation: 0,
			created: "2026-08-20T17:23:48.661Z", modified: "2026-08-20T17:24:58.273Z", resolved: false },
		"b-2": { id: "b-2", file: "n.md", x: 5, y: 6, width: 3, height: 4, color: "red",
			kind: "todo", content: "was resolved", rotation: 0,
			created: "2026-08-19T00:00:00.000Z", modified: "2026-08-19T00:00:00.000Z", resolved: true },
	},
};

(async () => {
	// --- v1 -> v2 migration ---------------------------------------------------
	{
		const app = fakeApp({ ".stickies/annotations.json": JSON.stringify(V1) });
		const store = new StickyStore(app, ".stickies/annotations.json", () => {});
		await store.load();

		check("migration bumps the version", store.store.version === 2, store.store.version);
		check("migration keeps every sticky", store.all().length === 2, store.all().length);
		check("migration keeps the content", store.get("a-1").content === "keep me");
		const dropped = ["resolved", "created", "modified"].filter((k) => k in store.get("a-1"));
		check("migration drops the retired fields", dropped.length === 0, dropped.join(","));
		check("a resolved sticky survives, unresolved", store.get("b-2") && !("resolved" in store.get("b-2")));
		check("the person is told resolving is gone", notices.some((n) => /visible again/.test(n)), notices.join(" | "));

		// Insertion order is the panel's ordering now; prove the keys keep it through a load.
		check("insertion order survives the load", Object.keys(store.store.stickies).join(",") === "a-1,b-2");

		await store.flush();
		const written = JSON.parse(app.files[".stickies/annotations.json"]);
		check("v2 is what lands on disk", written.version === 2 && !("resolved" in written.stickies["b-2"]));
	}

	// --- a newer file is left alone -------------------------------------------
	{
		const app = fakeApp({ "s.json": JSON.stringify({ version: 99, stickies: {} }) });
		const store = new StickyStore(app, "s.json", () => {});
		await store.load();
		store.touch();
		await store.flush();
		check("a newer store is not rewritten", JSON.parse(app.files["s.json"]).version === 99);
	}

	// --- an unreadable file is not overwritten with an empty store ------------
	{
		const app = fakeApp({ "s.json": "{ not json" });
		const store = new StickyStore(app, "s.json", () => {});
		await store.load();
		store.touch();
		await store.flush();
		check("a corrupt store is not clobbered", app.files["s.json"] === "{ not json");
	}

	// --- the debounce deadline ------------------------------------------------
	{
		const app = fakeApp({});
		const store = new StickyStore(app, "s.json", () => {});
		timers.length = 0;

		store.touchGeometry();            // lazy: due at now + 6000
		const lazyAt = timers.find((t) => !t.cancelled).at;
		store.touch();                   // eager: must pull the write forward
		const live = timers.filter((t) => !t.cancelled);
		check("an eager save pulls a pending lazy one forward", live.length === 1 && live[0].at < lazyAt,
			`${live.length} live, at ${live[0] && live[0].at} vs ${lazyAt}`);

		const eagerAt = live[0].at;
		store.touchGeometry();           // lazy again: must NOT push the eager deadline out
		const live2 = timers.filter((t) => !t.cancelled);
		check("a lazy save cannot postpone an eager one", live2.length === 1 && live2[0].at === eagerAt,
			`${live2.length} live, at ${live2[0] && live2[0].at} vs ${eagerAt}`);
	}

	Date.now = realNow;
	console.log(`\n${pass} passed, ${fail} failed`);
	process.exit(fail ? 1 : 0);
})();
