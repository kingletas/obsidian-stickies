import { Editor, MarkdownView, Menu, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { captureAnchor, reanchor } from "./anchor";
import { describeView, diag, setDiagnosticEnabled, startDiagnostic } from "./diagnostic";
import { anchorHighlighter, stickiesChanged } from "./highlight";
import { StickyOverlay, visibleScroller } from "./overlay";
import { StickiesPanel } from "./panel";
import { StickiesSettingTab } from "./settings";
import { DEFAULT_SETTINGS, StickiesSettings, Sticky, VIEW_TYPE_STICKIES } from "./types";
import { StickyStore } from "./store";

/** Step of the cascade used when a new unanchored sticky would land on an existing one. */
const CASCADE = 20;

export default class StickiesPlugin extends Plugin {
	settings: StickiesSettings = { ...DEFAULT_SETTINGS };
	store!: StickyStore;

	private overlays = new Map<MarkdownView, StickyOverlay>();
	private anchorTimer: number | null = null;
	private hidden = false;
	/** The sticky whose card is hovered or pressed; its anchor is emphasised in the note. */
	private activeAnchorId: string | null = null;

	/** The note the workspace was last *reading* — the active Markdown view is null while the panel holds focus, so this is tracked forwards and deliberately never cleared when focus moves to a sidebar. */
	private lastPath: string | null = null;

	/** Whether layout-ready has fired — `vault.getAbstractFileByPath()` answers null for every path until the vault is indexed, so asking "is this note still here?" earlier is told no about every note. */
	private ready = false;

	async onload(): Promise<void> {
		startDiagnostic(this.app, this.manifest.version);
		try {
			await this.bootstrap();
			diag("onload: complete");
		} catch (e) {
			// Obsidian swallows a rejected onload silently, which is how a load failure became
			// indistinguishable from a plugin that loaded fine and simply drew nothing.
			diag(`onload: THREW ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
			console.error("Stickies: onload failed", e);
			new Notice("Stickies: failed to load. See .stickies/diagnostic.log");
			throw e;
		}
	}

	private async bootstrap(): Promise<void> {
		// Register the view before anything that can throw: Obsidian swallows a rejected
		// `onload`, and a leaf whose view type is unknown renders as an empty tab.
		this.registerView(VIEW_TYPE_STICKIES, (leaf: WorkspaceLeaf) => {
			diag("registerView: constructing a StickiesPanel");
			return new StickiesPanel(leaf, this);
		});
		diag(`bootstrap: view "${VIEW_TYPE_STICKIES}" registered`);

		await this.loadSettings();
		// Buffered lines from before this point are flushed now, or dropped. See `diagnostic.ts`.
		setDiagnosticEnabled(this.settings.diagnostics);
		diag(`bootstrap: settings read, panelScope=${this.settings.panelScope}`);

		this.store = new StickyStore(this.app, this.settings.storePath, () => this.repaint());
		await this.store.load();
		diag(`bootstrap: store read from ${this.settings.storePath}, ${this.store.all().length} stickies`);

		this.registerEditorExtension(
			anchorHighlighter({
				stickiesFor: (path) => this.store.forFile(path),
				enabled: () => this.settings.highlightAnchors && !this.hidden,
				activeId: () => this.activeAnchorId,
				reveal: (id) => this.revealSticky(id),
			})
		);

		// Registered as a plain check rather than an `editorCallback`, which only exists while
		// an editor has focus — the command was invisible from the palette with the sidebar
		// focused. No default hotkey: claiming a chord in a vault with 23 plugins starts fights.
		this.addCommand({
			id: "create-sticky",
			name: "Add sticky",
			checkCallback: (checking: boolean) => {
				const view = this.targetView();
				if (!view) return false;
				if (!checking) this.addSticky(view);
				return true;
			},
		});

		this.addCommand({
			id: "toggle-stickies",
			name: "Toggle sticky visibility",
			callback: () => {
				this.hidden = !this.hidden;
				document.body.toggleClass("stickies-hidden", this.hidden);
				this.repaint();
			},
		});

		this.addCommand({
			id: "open-panel",
			name: "Open sticky list",
			callback: () => void this.openPanel(),
		});

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, ctx) => {
				const view = ctx instanceof MarkdownView ? ctx : null;
				if (!view?.file) return;
				menu.addItem((item) =>
					item
						.setTitle(editor.getSelection().trim() ? "Add sticky here" : "Add sticky")
						.setIcon("sticky-note")
						.onClick(() => this.addSticky(view))
				);
			})
		);

		this.addRibbonIcon("sticky-note", "Open Stickies", () => void this.openPanel());
		this.addSettingTab(new StickiesSettingTab(this.app, this));

		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refresh()));
		this.registerEvent(this.app.workspace.on("layout-change", () => this.refresh()));
		this.registerEvent(this.app.workspace.on("file-open", () => this.refresh()));
		this.registerEvent(this.app.workspace.on("editor-change", () => this.scheduleAnchorRefresh()));
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => this.store.handleRename(file.path, oldPath))
		);
		this.registerEvent(this.app.vault.on("delete", (file) => this.store.handleDelete(file.path)));

		diag("bootstrap: commands, ribbon, settings tab and events registered");

		this.app.workspace.onLayoutReady(() => {
			diag("layout ready");
			// Before anything redraws: until this point the vault cannot answer path questions.
			this.ready = true;
			this.refresh();
			// A panel restored from the saved workspace has to be woken before it can draw —
			// see `wakePanel`. Doing it here means a blank tab cannot survive a restart.
			void this.wakePanels();
		});
	}

	onunload(): void {
		for (const overlay of this.overlays.values()) overlay.detach();
		this.overlays.clear();
		document.body.removeClass("stickies-hidden");
		// Any debounced write still pending would otherwise be dropped on disable/reload —
		// and geometry writes now wait several seconds, so there is usually one in flight.
		void this.store.flush();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		setDiagnosticEnabled(this.settings.diagnostics);
		this.store.setPath(this.settings.storePath);
		this.repaint();
	}

	/** The panel's scope toggle. Persisted, because the panel's leaf does not outlive a restart. */
	async setPanelScope(scope: StickiesSettings["panelScope"]): Promise<void> {
		if (this.settings.panelScope === scope) return;
		this.settings.panelScope = scope;
		await this.saveSettings();
	}

	// --- what note are we on ----------------------------------------------------

	/** False until `onLayoutReady`, while the vault cannot resolve a path. See `ready`. */
	isVaultReady(): boolean {
		return this.ready;
	}

	/** The note the panel and the commands act on. See `lastPath`. */
	activePath(): string | null {
		const live = this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path;
		if (live) this.lastPath = live;
		return this.lastPath;
	}

	/** The Markdown view a new sticky should go on, if one is open at all. */
	targetView(): MarkdownView | null {
		const live = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (live?.file) return live;
		const path = this.lastPath;
		return path ? this.viewFor(path) : null;
	}

	// --- creating ---------------------------------------------------------------

	/** Add a sticky to `view`, anchored to the selection if there is one — no selection is required, and an unanchored sticky floats free on the page. */
	addSticky(view: MarkdownView): void {
		const file = view.file;
		if (!file) return;

		const editor = view.editor;
		const selection = editor.getSelection();
		const anchored = !!selection.trim();

		let anchor: Sticky["anchor"];
		let at: { x: number; y: number };

		if (anchored) {
			// `getCursor("from"/"to")` is the supported way to read a selection's bounds. The MVP
			// called `editor.getRange()` with no arguments and read `.from` off the result, but
			// getRange takes two positions and returns a string, so this threw every time.
			const start = editor.posToOffset(editor.getCursor("from"));
			const end = editor.posToOffset(editor.getCursor("to"));
			anchor = captureAnchor(editor.getValue(), start, end);
			at = this.placeNear(view, start);
		} else {
			at = this.placeFloating(view, file.path);
		}

		const sticky: Sticky = {
			id: crypto.randomUUID(),
			file: file.path,
			anchor,
			x: at.x,
			y: at.y,
			width: this.settings.defaultWidth,
			height: this.settings.defaultHeight,
			color: this.settings.defaultColor,
			kind: this.settings.defaultKind,
			content: "",
			rotation: Math.random() * 4 - 2,
		};

		this.store.put(sticky);
		this.repaint();

		// Focus the new sticky so the person can type straight away.
		window.setTimeout(() => {
			this.revealSticky(sticky.id);
			const el = view.containerEl.querySelector<HTMLTextAreaElement>(
				`[data-sticky-id="${sticky.id}"] .stickies-note-content`
			);
			el?.focus();
		}, 0);
	}

	/** Add a sticky from outside the editor — the panel's button, mainly. */
	addStickyToActiveNote(): void {
		const view = this.targetView();
		if (!view) {
			new Notice("Stickies: open a note first.");
			return;
		}
		this.addSticky(view);
	}

	/** Put a new anchored sticky in the right margin, level with the text it annotates. */
	private placeNear(view: MarkdownView, offset: number): { x: number; y: number } {
		const scroller = this.scroller(view);
		const fallback = { x: 520, y: 60 };
		if (!scroller) return fallback;

		const x = this.marginX(scroller);
		const cm = this.editorView(view);
		if (!cm) return { x, y: fallback.y };

		try {
			const coords = cm.coordsAtPos(offset);
			if (!coords) return { x, y: fallback.y };
			const box = scroller.getBoundingClientRect();
			return { x, y: Math.max(0, coords.top - box.top + scroller.scrollTop - 8) };
		} catch {
			return { x, y: fallback.y };
		}
	}

	/**
	 * Put a new *unanchored* sticky at the top-right of what is currently on screen, which is
	 * where anchored ones land too, then cascade off anything already sitting there so a
	 * second one does not hide the first.
	 */
	private placeFloating(view: MarkdownView, path: string): { x: number; y: number } {
		const scroller = this.scroller(view);
		if (!scroller) return { x: 520, y: 60 };

		const baseX = this.marginX(scroller);
		const baseY = scroller.scrollTop + 16;
		const existing = this.store.forFile(path);

		for (let n = 0; n < 12; n++) {
			const x = baseX - n * CASCADE;
			const y = baseY + n * CASCADE;
			const taken = existing.some((s) => Math.abs(s.x - x) < CASCADE && Math.abs(s.y - y) < CASCADE);
			if (!taken) return { x: Math.max(8, x), y };
		}
		return { x: Math.max(8, baseX), y: baseY };
	}

	private marginX(scroller: HTMLElement): number {
		return Math.max(8, scroller.clientWidth - this.settings.defaultWidth - 28);
	}

	private scroller(view: MarkdownView): HTMLElement | null {
		// Must be the *visible* scroller, or a sticky created in reading mode is measured
		// against a hidden element — see `visibleScroller`.
		return visibleScroller(view.containerEl);
	}

	// --- navigation -------------------------------------------------------------

	jumpToAnchor(sticky: Sticky): void {
		if (!sticky.anchor) return;
		if (sticky.anchor.orphaned) {
			new Notice("Stickies: the anchored text is no longer in this note.");
			return;
		}
		const view = this.viewFor(sticky.file);
		if (!view) return;

		const from = view.editor.offsetToPos(sticky.anchor.start);
		const to = view.editor.offsetToPos(sticky.anchor.end);
		view.editor.setSelection(from, to);
		// scrollIntoView takes a range, not a position — passing a position silently did nothing.
		view.editor.scrollIntoView({ from, to }, true);
		view.editor.focus();
	}

	revealSticky(id: string): void {
		const sticky = this.store.get(id);
		if (!sticky) return;
		const view = this.viewFor(sticky.file);
		if (!view) return;
		this.overlays.get(view)?.reveal(id);
	}

	// --- rendering --------------------------------------------------------------

	private markdownViews(): MarkdownView[] {
		return this.app.workspace
			.getLeavesOfType("markdown")
			.map((leaf) => leaf.view)
			.filter((view): view is MarkdownView => view instanceof MarkdownView);
	}

	private viewFor(path: string): MarkdownView | null {
		return this.markdownViews().find((v) => v.file?.path === path) ?? null;
	}

	private editorView(view: MarkdownView): EditorView | null {
		// `cm` is real but not in the public typings.
		return ((view.editor as unknown as { cm?: EditorView }).cm) ?? null;
	}

	/** Re-locate anchors for every open note, then redraw. */
	private refresh(): void {
		this.activePath();
		let moved = false;
		for (const view of this.markdownViews()) {
			if (!view.file) continue;
			if (this.refreshAnchorsFor(view)) moved = true;
		}
		// `store.touch` repaints via its change callback, so only repaint directly when it did not.
		if (moved) this.store.touch();
		else this.repaint();
	}

	private scheduleAnchorRefresh(): void {
		if (this.anchorTimer !== null) window.clearTimeout(this.anchorTimer);
		this.anchorTimer = window.setTimeout(() => {
			this.anchorTimer = null;
			this.refresh();
		}, 300);
	}

	private refreshAnchorsFor(view: MarkdownView): boolean {
		const path = view.file?.path;
		if (!path) return false;
		const stickies = this.store.forFile(path);
		if (!stickies.length) return false;

		const doc = view.editor.getValue();
		let moved = false;
		for (const sticky of stickies) {
			if (!sticky.anchor) continue;
			const next = reanchor(sticky.anchor, doc);
			if (
				next.start !== sticky.anchor.start ||
				next.end !== sticky.anchor.end ||
				next.orphaned !== sticky.anchor.orphaned
			) {
				sticky.anchor = next;
				moved = true;
			}
		}
		return moved;
	}

	repaint(): void {
		const live = new Set<MarkdownView>();

		for (const view of this.markdownViews()) {
			const path = view.file?.path;
			if (!path) continue;
			live.add(view);

			let overlay = this.overlays.get(view);
			if (!overlay) {
				overlay = new StickyOverlay({
					touch: () => this.store.touch(),
					touchGeometry: () => this.store.touchGeometry(),
					remove: (id) => this.store.remove(id),
					jumpToAnchor: (sticky) => this.jumpToAnchor(sticky),
					setActiveAnchor: (id) => this.setActiveAnchor(id),
					repaint: () => this.repaint(),
				});
				this.overlays.set(view, overlay);
			}

			overlay.sync(view.containerEl, this.hidden ? [] : this.store.forFile(path));
		}

		for (const [view, overlay] of this.overlays) {
			if (!live.has(view)) {
				overlay.detach();
				this.overlays.delete(view);
			}
		}

		this.refreshHighlights();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_STICKIES)) {
			// A leaf restored from the saved workspace is a *deferred* view with no `render`
			// (Obsidian 1.7+); the panel renders itself in `onOpen` once instantiated for real.
			const view = leaf.view;
			if (view instanceof StickiesPanel) view.render();
		}
	}

	/** Track the hovered card and repaint, so its anchored text lights up as the pointer moves. */
	private setActiveAnchor(id: string | null): void {
		if (this.activeAnchorId === id) return;
		this.activeAnchorId = id;
		this.refreshHighlights();
	}

	/** Nudge every open editor so anchor highlights repaint without waiting for a keystroke. */
	private refreshHighlights(): void {
		for (const view of this.markdownViews()) {
			const cm = this.editorView(view);
			if (!cm) continue;
			try {
				cm.dispatch({ effects: stickiesChanged.of(null) });
			} catch {
				// An editor mid-teardown will reject the transaction; nothing to do about it.
			}
		}
	}

	private async openPanel(): Promise<void> {
		diag("openPanel: asked to open");
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_STICKIES);
		if (existing.length) {
			await this.app.workspace.revealLeaf(existing[0]);
			await this.wakePanel(existing[0]);
			return;
		}
		// `false` means "do not create one"; it returns null when the right sidebar has no room
		// for a new tab, and the MVP's silent `return` there was indistinguishable from a panel
		// that opened and drew nothing.
		const leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getRightLeaf(true);
		if (!leaf) {
			new Notice("Stickies: could not open a panel in the right sidebar.");
			return;
		}
		await leaf.setViewState({ type: VIEW_TYPE_STICKIES, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	/** Load a deferred sticky-panel leaf — `getLeavesOfType()` returns deferred views that have no `onOpen`, so an uninstantiated tab stays blank while looking like an empty panel. */
	private async wakePanel(leaf: WorkspaceLeaf): Promise<void> {
		diag(`wakePanel: leaf holds ${describeView(leaf.view)}`);
		if (leaf.view instanceof StickiesPanel) {
			diag("wakePanel: already a StickiesPanel, nothing to do");
			return;
		}
		const deferrable = leaf as WorkspaceLeaf & { loadIfDeferred?: () => Promise<void> };
		diag(`wakePanel: loadIfDeferred is ${typeof deferrable.loadIfDeferred}`);
		try {
			await deferrable.loadIfDeferred?.();
		} catch (e) {
			diag(`wakePanel: loadIfDeferred threw ${e}`);
			console.error("Stickies: could not load a deferred panel leaf", e);
		}
		diag(`wakePanel: after loadIfDeferred, leaf holds ${describeView(leaf.view)}`);
		if (leaf.view instanceof StickiesPanel) return;
		// Still not ours. Re-asserting the view state constructs it, which is the one route that
		// does not depend on how this Obsidian handles deferral.
		try {
			await leaf.setViewState({ type: VIEW_TYPE_STICKIES, active: true });
			diag(`wakePanel: after setViewState, leaf holds ${describeView(leaf.view)}`);
		} catch (e) {
			diag(`wakePanel: setViewState threw ${e}`);
			console.error("Stickies: could not construct the panel view", e);
			new Notice("Stickies: the sticky list could not be opened. See the console.");
		}
	}

	/** Every sticky-panel leaf, woken. Runs once the layout is ready; see `wakePanel`. */
	private async wakePanels(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_STICKIES);
		diag(`wakePanels: getLeavesOfType("${VIEW_TYPE_STICKIES}") returned ${leaves.length}`);
		// If that came back empty the leaf is there but not being matched, which is a different
		// bug entirely — so dump what the workspace actually holds.
		if (!leaves.length) {
			const seen: string[] = [];
			this.app.workspace.iterateAllLeaves((leaf) => seen.push(describeView(leaf.view)));
			diag(`wakePanels: every leaf in the workspace — ${seen.join(", ")}`);
		}
		for (const leaf of leaves) {
			await this.wakePanel(leaf);
		}
		diag("wakePanels: done");
	}
}
