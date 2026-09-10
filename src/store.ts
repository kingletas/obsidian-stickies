import { App, Notice } from "obsidian";
import { STORE_VERSION, Sticky, Store } from "./types";

/** Content edits should reach disk promptly; a keystroke is worth keeping. */
const EAGER_MS = 400;

/** Geometry waits much longer, so a flurry of separate moves and resizes becomes one write. */
const LAZY_MS = 6000;

/** Persistence for the annotation store, only via `vault.adapter`: the Vault API skips dot-folders. */
export class StickyStore {
	store: Store = { version: STORE_VERSION, stickies: {} };

	private timer: number | null = null;
	/** Absolute deadline of the pending write, so a lazy save cannot postpone an eager one. */
	private due = 0;
	private writing = false;
	private dirtyAgain = false;

	constructor(private app: App, private path: string, private onChange: () => void) {}

	setPath(path: string): void {
		this.path = path;
	}

	all(): Sticky[] {
		return Object.values(this.store.stickies);
	}

	forFile(file: string): Sticky[] {
		return this.all().filter((s) => s.file === file);
	}

	get(id: string): Sticky | undefined {
		return this.store.stickies[id];
	}

	put(sticky: Sticky): void {
		this.store.stickies[sticky.id] = sticky;
		this.touch();
	}

	remove(id: string): void {
		delete this.store.stickies[id];
		this.touch();
	}

	/** Schedule a write after a content or type change. Call after any such mutation. */
	touch(): void {
		this.save(EAGER_MS);
	}

	/** Schedule a write after a move or resize. Same data, far lazier, see `LAZY_MS`. */
	touchGeometry(): void {
		this.save(LAZY_MS);
	}

	async load(): Promise<void> {
		try {
			if (!(await this.app.vault.adapter.exists(this.path))) return;
			const parsed = JSON.parse(await this.app.vault.adapter.read(this.path));
			if (!parsed?.stickies || typeof parsed.version !== "number") {
				new Notice("Stickies: annotation file is not in a shape I recognise; leaving it alone.");
				this.writing = true;
				return;
			}
			if (parsed.version > STORE_VERSION) {
				// A newer plugin wrote this. Read-only is the honest response — rewriting it
				// would silently drop whatever the newer version added.
				new Notice("Stickies: annotation file is from a newer version; saving is paused.");
				this.store = parsed;
				this.writing = true;
				return;
			}
			this.store = parsed;
			if (parsed.version < STORE_VERSION) this.migrate(parsed.version);
		} catch (e) {
			// Do not fall through to an empty store and then save over the file — that would
			// turn a transient read error into permanent data loss.
			console.error("Stickies: failed to read the annotation store", e);
			new Notice("Stickies: could not read annotations. Saving is paused; see the console.");
			this.writing = true;
		}
	}

	/**
	 * Bring an older store up to `STORE_VERSION`. v1 -> v2 drops `resolved`, `created` and
	 * `modified`, and keeps a resolved sticky visible rather than deleting it.
	 */
	private migrate(from: number): void {
		let resurrected = 0;
		for (const s of this.all()) {
			const legacy = s as Sticky & { resolved?: boolean; created?: string; modified?: string };
			if (legacy.resolved) resurrected++;
			delete legacy.resolved;
			delete legacy.created;
			delete legacy.modified;
		}
		this.store.version = STORE_VERSION;
		if (resurrected) {
			new Notice(
				`Stickies: ${resurrected} resolved sticky${resurrected === 1 ? "" : "s"} is now visible again — resolving was removed.`
			);
		}
		console.info(`Stickies: migrated the annotation store from v${from} to v${STORE_VERSION}.`);
		this.touch();
	}

	/** Debounced write. `delay` is a floor, never a postponement of an earlier deadline. */
	private save(delay: number): void {
		this.onChange();
		const at = Date.now() + delay;
		if (this.timer !== null) {
			if (this.due <= at) return;
			window.clearTimeout(this.timer);
		}
		this.due = at;
		this.timer = window.setTimeout(() => void this.flush(), delay);
	}

	async flush(): Promise<void> {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
		this.due = 0;
		if (this.writing) {
			this.dirtyAgain = true;
			return;
		}
		this.writing = true;
		try {
			const dir = this.path.split("/").slice(0, -1).join("/");
			if (dir && !(await this.app.vault.adapter.exists(dir))) {
				await this.app.vault.adapter.mkdir(dir);
			}
			await this.app.vault.adapter.write(this.path, JSON.stringify(this.store, null, 2));
		} catch (e) {
			console.error("Stickies: failed to write the annotation store", e);
			new Notice("Stickies: could not save annotations. See the console.");
		} finally {
			this.writing = false;
			if (this.dirtyAgain) {
				this.dirtyAgain = false;
				this.touch();
			}
		}
	}

	/** Follow a rename, including a folder move, which Obsidian reports as one event for the folder. */
	handleRename(newPath: string, oldPath: string): void {
		let changed = false;
		for (const s of this.all()) {
			if (s.file === oldPath) {
				s.file = newPath;
				changed = true;
			} else if (s.file.startsWith(oldPath + "/")) {
				s.file = newPath + s.file.slice(oldPath.length);
				changed = true;
			}
		}
		if (changed) this.touch();
	}

	/** Drop stickies for a deleted file or folder. */
	handleDelete(path: string): void {
		let changed = false;
		for (const s of this.all()) {
			if (s.file === path || s.file.startsWith(path + "/")) {
				delete this.store.stickies[s.id];
				changed = true;
			}
		}
		if (changed) this.touch();
	}
}
