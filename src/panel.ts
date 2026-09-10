import { ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { diag } from "./diagnostic";
import type StickiesPlugin from "./main";
import { PanelGroup, PanelRow, PanelScope, countLabel, groupRows, signature } from "./panelmodel";
import { Sticky, VIEW_TYPE_STICKIES } from "./types";

/** Ceiling on how often the list is redrawn, so typing into a sticky costs one redraw per burst. */
const THROTTLE_MS = 120;

/** Sidebar list of stickies; the chrome is built once and the list redrawn only when it changes. */
export class StickiesPanel extends ItemView {
	private listEl: HTMLElement | null = null;
	private listScopeButton: HTMLElement | null = null;
	private countEl: HTMLElement | null = null;
	private lastSignature: string | null = null;
	private renderTimer: number | null = null;
	private lastDrawAt = 0;

	constructor(leaf: WorkspaceLeaf, private plugin: StickiesPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_STICKIES;
	}

	getDisplayText(): string {
		return "Stickies";
	}

	getIcon(): string {
		return "sticky-note";
	}

	async onOpen(): Promise<void> {
		diag("panel: onOpen");
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.render()));
		this.registerEvent(this.app.workspace.on("file-open", () => this.render()));
		this.render();
		diag(`panel: onOpen finished, contentEl has ${this.contentEl.childElementCount} children`);
	}

	async onClose(): Promise<void> {
		if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
		this.renderTimer = null;
		this.contentEl.empty();
		this.listEl = null;
		this.listScopeButton = null;
		this.countEl = null;
		this.lastSignature = null;
	}

	/** The note the workspace was last reading — never the panel itself. See `main.activePath`. */
	private activePath(): string | null {
		return this.plugin.activePath();
	}

	/** Read from settings, because the sidebar leaf is rebuilt on every layout change and restart. */
	private get listScope(): PanelScope {
		return this.plugin.settings.panelScope;
	}

	// --- chrome -----------------------------------------------------------------

	private ensureChrome(): void {
		if (this.listEl?.isConnected) return;

		const el = this.contentEl;
		el.empty();
		el.addClass("stickies-panel");

		const header = el.createDiv({ cls: "stickies-panel-header" });
		header.createEl("h3", { text: "Stickies" });

		const add = header.createEl("button", {
			cls: "stickies-panel-add",
			attr: { type: "button", "aria-label": "Add a sticky to the current note" },
		});
		setIcon(add, "plus");
		add.createSpan({ text: "New" });
		add.onclick = () => this.plugin.addStickyToActiveNote();

		const scopeRow = el.createDiv({ cls: "stickies-panel-scoperow" });
		this.listScopeButton = scopeRow.createEl("button", {
			cls: "stickies-panel-scope",
			attr: { type: "button", "aria-label": "Switch between this note and the whole vault" },
		});
		this.listScopeButton.onclick = () => {
			void this.plugin.setPanelScope(this.listScope === "file" ? "vault" : "file");
		};
		this.countEl = scopeRow.createSpan({ cls: "stickies-panel-count" });

		this.listEl = el.createDiv({ cls: "stickies-panel-list" });
		this.lastSignature = null;
	}

	// --- rendering ---------------------------------------------------------------

	/** Redraw at most once per `THROTTLE_MS`, drawing the first change at once and the last on a timer. */
	render(): void {
		const since = Date.now() - this.lastDrawAt;
		if (since >= THROTTLE_MS) {
			this.draw();
			return;
		}
		if (this.renderTimer !== null) return;
		this.renderTimer = window.setTimeout(() => {
			this.renderTimer = null;
			this.draw();
		}, THROTTLE_MS - since);
	}

	/** Draw, and put any failure on screen, because a blank panel reads as one with no stickies. */
	private draw(): void {
		try {
			this.paint();
		} catch (e) {
			diag(`panel: draw THREW ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
			console.error("Stickies: the panel failed to render", e);
			this.showFailure(e);
		}
	}

	private showFailure(error: unknown): void {
		const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
		try {
			// Rebuild from scratch: whatever state the panel is in, it is not one to trust.
			this.listEl = null;
			this.lastSignature = null;
			const el = this.contentEl;
			el.empty();
			el.addClass("stickies-panel");
			const box = el.createDiv({ cls: "stickies-panel-failure" });
			box.createEl("strong", { text: "Stickies could not draw this panel." });
			box.createDiv({ cls: "stickies-panel-failure-message", text: message });
			box.createDiv({
				cls: "stickies-panel-failure-hint",
				text: "The full stack is in the developer console (Ctrl+Shift+I). Your stickies are untouched — this is the list failing, not the data.",
			});
			const retry = box.createEl("button", { text: "Try again", attr: { type: "button" } });
			retry.onclick = () => this.draw();
		} catch (e) {
			// If even this fails there is nothing left to draw with; the console is the record.
			console.error("Stickies: could not render the failure message either", e);
		}
	}

	private paint(): void {
		this.lastDrawAt = Date.now();
		// The view type is registered before the store is built, deliberately — see `onload`. A
		// panel constructed in that window has nothing to list, and saying so beats the
		// `undefined` dereference that would otherwise be the only clue.
		if (!this.plugin.store) {
			throw new Error("the plugin did not finish loading — check the console for the error from onload");
		}
		this.ensureChrome();
		const list = this.listEl;
		if (!list) return;

		const path = this.activePath();
		const groups = groupRows(this.plugin.store.all(), path, this.listScope, (p) => this.exists(p));
		const total = groups.reduce((n, g) => n + g.rows.length, 0);

		if (this.listScopeButton) {
			this.listScopeButton.empty();
			setIcon(this.listScopeButton, this.listScope === "file" ? "file" : "vault");
			this.listScopeButton.createSpan({ text: this.listScope === "file" ? "This note" : "All notes" });
		}
		this.countEl?.setText(countLabel(total));

		const next = signature(groups, this.listScope, path);
		if (next === this.lastSignature) return;
		this.lastSignature = next;

		// Only the list is rebuilt, and its scroll position is put back afterwards.
		const scroll = this.contentEl.scrollTop;
		list.empty();

		if (!total) {
			list.createDiv({ cls: "stickies-panel-empty", text: this.emptyText(path) });
			this.contentEl.scrollTop = scroll;
			return;
		}

		for (const group of groups) {
			// The single group in file scope is the note you are already looking at; a heading
			// for it would only repeat the tab title.
			if (this.listScope === "vault") this.heading(list, group);
			for (const row of group.rows) this.row(list, row);
		}
		this.contentEl.scrollTop = scroll;
		diag(`panel: drew ${groups.length} group(s), ${total} row(s)`);
	}

	private emptyText(path: string | null): string {
		if (this.listScope === "vault") {
			return "No stickies anywhere in this vault yet. Open a note and use “New” above.";
		}
		return path
			? "No stickies on this note yet. Use “New” above, or right-click in the editor."
			: "Open a note to see its stickies.";
	}

	/**
	 * Is this sticky's note still in the vault? Assumed yes until layout-ready, because the vault
	 * answers null for every path while it is still indexing.
	 */
	private exists(path: string): boolean {
		if (!this.plugin.isVaultReady()) return true;
		return this.app.vault.getAbstractFileByPath(path) instanceof TFile;
	}

	private heading(parent: HTMLElement, group: PanelGroup): void {
		const heading = parent.createDiv({ cls: "stickies-panel-section", text: group.label });
		heading.setAttr("title", group.file);
		if (group.active) heading.addClass("is-active");
	}

	private row(parent: HTMLElement, { sticky, missing }: PanelRow): void {
		const row = parent.createDiv({
			cls: `stickies-panel-item stickies-panel-item--${sticky.color}`,
		});
		row.setAttr("title", missing ? `${sticky.file} — not in the vault` : sticky.file);
		if (missing) row.addClass("is-missing");

		const top = row.createDiv({ cls: "stickies-panel-item-top" });
		top.createSpan({ cls: "stickies-panel-kind", text: sticky.kind });

		// One badge, in order of how much it matters: a note that is gone outranks anything
		// the anchor has to say about itself.
		if (missing) {
			const gone = top.createSpan({ cls: "stickies-panel-missing" });
			setIcon(gone, "file-x");
			gone.setAttr("aria-label", "That note is no longer in the vault");
		} else if (!sticky.anchor) {
			const free = top.createSpan({ cls: "stickies-panel-free" });
			setIcon(free, "move");
			free.setAttr("aria-label", "Not attached to any text");
		} else if (sticky.anchor.orphaned) {
			const warn = top.createSpan({ cls: "stickies-panel-orphan" });
			setIcon(warn, "unlink");
			warn.setAttr("aria-label", "Anchored text not found");
		}

		row.createDiv({
			cls: "stickies-panel-body",
			text: sticky.content.trim() || sticky.anchor?.text || "(empty)",
		});

		if (sticky.content.trim() && sticky.anchor?.text) {
			row.createDiv({ cls: "stickies-panel-quote", text: sticky.anchor.text });
		}

		const actions = row.createDiv({ cls: "stickies-panel-actions" });
		this.action(actions, "Delete", () => this.plugin.store.remove(sticky.id));

		row.onclick = (event) => {
			if ((event.target as HTMLElement).closest(".stickies-panel-actions")) return;
			void this.openSticky(sticky);
		};
	}

	private action(parent: HTMLElement, label: string, run: () => void): void {
		const button = parent.createEl("button", { text: label, attr: { type: "button" } });
		button.onclick = (event) => {
			event.stopPropagation();
			run();
		};
	}

	/**
	 * Open the sticky's file if needed, then jump to its anchor and flash the note. Never name
	 * this `open`, which would override the untyped internal `View.open()` and stop the view opening.
	 * @see test/reserved.test.cjs
	 */
	private async openSticky(sticky: Sticky): Promise<void> {
		if (!sticky?.file) {
			console.error("Stickies: a panel row carried no file path", sticky);
			new Notice("Stickies: that row has no note attached to it.");
			return;
		}
		if (!this.plugin.isVaultReady()) {
			// Mid-startup the vault answers null for everything; refusing beats a false alarm.
			new Notice("Stickies: still opening the vault — try that again in a moment.");
			return;
		}
		const file = this.app.vault.getAbstractFileByPath(sticky.file);
		if (!(file instanceof TFile)) {
			// A row whose note is gone must say so rather than do nothing when clicked.
			new Notice(
				`Stickies: ${sticky.file} is not in the vault. The sticky is kept — restore the note, or delete the sticky.`
			);
			return;
		}
		if (sticky.file !== this.activePath()) {
			await this.app.workspace.getLeaf(false).openFile(file);
		}
		// A just-opened editor has not laid out yet, so a jump issued now is measured against a
		// document that is not on screen and lands in the wrong place. One frame is enough, and
		// costs nothing when the note was already open.
		window.requestAnimationFrame(() => {
			this.plugin.jumpToAnchor(sticky);
			this.plugin.revealSticky(sticky.id);
		});
	}
}
