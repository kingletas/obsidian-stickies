import { App } from "obsidian";

/**
 * A breadcrumb trail of the plugin's startup, written through `vault.adapter` when the setting is
 * on; the file is truncated on every load, so it holds exactly one session.
 */
const PATH = ".stickies/diagnostic.log";

let target: App | null = null;
let header = "";
/** `null` until the setting is read; lines logged before then are buffered, then flushed or dropped. */
let enabled: boolean | null = null;
let buffer: string[] = [];
/** Every write is chained, so lines land in the order they were logged rather than racing. */
let chain: Promise<void> = Promise.resolve();

function stamp(): string {
	return new Date().toISOString().slice(11, 23);
}

/** Begin a session. Nothing reaches disk until `setDiagnosticEnabled` says it may. */
export function startDiagnostic(app: App, version: string): void {
	target = app;
	enabled = null;
	header = `=== stickies ${version} loading at ${new Date().toISOString()} ===\n`;
	buffer = [];
}

/** Apply the setting: flush what was buffered during startup, or discard it. */
export function setDiagnosticEnabled(on: boolean): void {
	const app = target;
	enabled = on;
	if (!on || !app) {
		buffer = [];
		return;
	}
	const pending = header + buffer.join("");
	buffer = [];
	chain = chain.then(async () => {
		try {
			const dir = PATH.split("/").slice(0, -1).join("/");
			if (dir && !(await app.vault.adapter.exists(dir))) await app.vault.adapter.mkdir(dir);
			await app.vault.adapter.write(PATH, pending);
		} catch (e) {
			console.error("Stickies: could not write the diagnostic log", e);
		}
	});
}

/** Record one step. Never throws, never blocks the caller, free when switched off. */
export function diag(line: string): void {
	if (enabled === false) return;
	const entry = `${stamp()}  ${line}\n`;
	if (enabled === null) {
		// Bounded, so a load that never reaches the setting cannot grow this without limit.
		if (buffer.length < 200) buffer.push(entry);
		return;
	}
	const app = target;
	if (!app) return;
	chain = chain.then(async () => {
		try {
			await app.vault.adapter.append(PATH, entry);
		} catch {
			// A failed breadcrumb must not become the thing that breaks the load.
		}
	});
}

/** Describe whatever is sitting in a leaf, without assuming it is one of ours. */
export function describeView(view: unknown): string {
	if (!view) return "none";
	const named = view as { constructor?: { name?: string }; getViewType?: () => string };
	const cls = named.constructor?.name ?? "unknown";
	let type = "?";
	try {
		type = named.getViewType?.() ?? "?";
	} catch {
		type = "threw";
	}
	return `${cls}(type=${type})`;
}
