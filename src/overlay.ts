import { Menu } from "obsidian";
import { COLORS, KINDS, Sticky } from "./types";

export interface OverlayHost {
	/** Persist a content or type change promptly. */
	touch(): void;
	/** Persist a move or resize lazily — see `LAZY_MS` in `store.ts`. */
	touchGeometry(): void;
	remove(id: string): void;
	jumpToAnchor(sticky: Sticky): void;
	/** Emphasise this sticky's anchored text in the note; null clears the emphasis. */
	setActiveAnchor(id: string | null): void;
	repaint(): void;
}

const MIN_WIDTH = 140;
const MIN_HEIGHT = 90;

/** The selector for the sticky layer's parent — the editor's *scroll container*, not the view's outer element, so an absolutely positioned sticky moves with the document and stays beside its paragraph. */
const SCROLLERS = ".cm-scroller, .markdown-preview-view";

/** The scroll container the person is actually looking at — a MarkdownView holds the source and reading views at once with one hidden, so take the first candidate that is laid out and fall back to the first match for a view mid-construction. */
export function visibleScroller(container: HTMLElement): HTMLElement | null {
	const candidates = Array.from(container.querySelectorAll<HTMLElement>(SCROLLERS));
	return candidates.find((el) => el.offsetParent !== null && el.clientWidth > 0) ?? candidates[0] ?? null;
}

export class StickyOverlay {
	private layer: HTMLElement | null = null;
	private elements = new Map<string, HTMLElement>();
	private dragging: string | null = null;

	constructor(private host: OverlayHost) {}

	private ensureLayer(container: HTMLElement): HTMLElement | null {
		const scroller = visibleScroller(container);
		if (!scroller) return null;

		// Re-attach if Obsidian swapped the editor out from under us (mode switch, file change).
		if (this.layer && this.layer.parentElement === scroller) return this.layer;

		this.layer?.remove();
		this.elements.clear();

		const layer = scroller.createDiv({ cls: "stickies-overlay" });
		this.layer = layer;
		return layer;
	}

	detach(): void {
		this.layer?.remove();
		this.layer = null;
		this.elements.clear();
		this.dragging = null;
	}

	sync(container: HTMLElement, stickies: Sticky[]): void {
		const layer = this.ensureLayer(container);
		if (!layer) return;

		const wanted = new Set(stickies.map((s) => s.id));
		for (const [id, el] of this.elements) {
			if (!wanted.has(id)) {
				el.remove();
				this.elements.delete(id);
			}
		}

		for (const sticky of stickies) {
			let el = this.elements.get(sticky.id);
			if (!el) {
				el = this.createElement(sticky, layer);
				this.elements.set(sticky.id, el);
			}
			this.update(el, sticky);
		}
	}

	reveal(id: string): void {
		const el = this.elements.get(id);
		if (!el) return;
		el.scrollIntoView({ block: "center", behavior: "smooth" });
		el.addClass("is-flashing");
		window.setTimeout(() => el.removeClass("is-flashing"), 900);
	}

	private update(el: HTMLElement, sticky: Sticky): void {
		if (this.dragging === sticky.id) return;

		el.style.left = `${sticky.x}px`;
		el.style.top = `${sticky.y}px`;
		el.style.width = `${sticky.width}px`;
		el.style.height = `${sticky.height}px`;
		el.style.transform = `rotate(${sticky.rotation}deg)`;
		el.dataset.color = sticky.color;
		el.className = `stickies-note stickies-note--${sticky.color}`;
		el.toggleClass("is-orphaned", !!sticky.anchor?.orphaned);

		const label = el.querySelector<HTMLElement>(".stickies-note-kind");
		if (label) label.setText(sticky.kind);

		const textarea = el.querySelector<HTMLTextAreaElement>(".stickies-note-content");
		// Never overwrite what the person is typing.
		if (textarea && document.activeElement !== textarea && textarea.value !== sticky.content) {
			textarea.value = sticky.content;
		}

		const badge = el.querySelector<HTMLElement>(".stickies-note-badge");
		if (badge) {
			badge.toggleClass("is-visible", !!sticky.anchor?.orphaned);
			badge.setAttr("aria-label", "The anchored text is no longer in this note");
		}
	}

	private createElement(sticky: Sticky, layer: HTMLElement): HTMLElement {
		const el = layer.createDiv({ cls: `stickies-note stickies-note--${sticky.color}` });
		el.dataset.stickyId = sticky.id;

		const header = el.createDiv({ cls: "stickies-note-header" });
		header.createDiv({ cls: "stickies-note-kind", text: sticky.kind });
		header.createDiv({ cls: "stickies-note-badge", text: "⚠" });

		const colorButton = header.createEl("button", {
			cls: "stickies-note-button",
			text: "●",
			attr: { "aria-label": "Cycle colour", type: "button" },
		});
		colorButton.onclick = (event) => {
			event.stopPropagation();
			sticky.color = COLORS[(COLORS.indexOf(sticky.color) + 1) % COLORS.length];
			this.host.touch();
			this.host.repaint();
		};

		const menuButton = header.createEl("button", {
			cls: "stickies-note-button",
			text: "⋯",
			attr: { "aria-label": "More actions", type: "button" },
		});
		menuButton.onclick = (event) => {
			event.stopPropagation();
			this.showMenu(event, sticky);
		};

		// Deletion already existed, in the `⋯` menu and on each panel row, and neither was
		// reachable in practice. No confirmation: these are ephemeral and the vault's git
		// history holds them, so a modal on every delete would be the wrong trade.
		const closeButton = header.createEl("button", {
			cls: "stickies-note-button stickies-note-close",
			text: "×",
			attr: { "aria-label": "Delete this sticky", type: "button" },
		});
		closeButton.onclick = (event) => {
			event.stopPropagation();
			this.host.remove(sticky.id);
		};

		const textarea = el.createEl("textarea", {
			cls: "stickies-note-content",
			attr: { placeholder: "Write a note…" },
		});
		textarea.value = sticky.content;
		textarea.oninput = () => {
			sticky.content = textarea.value;
			this.host.touch();
		};
		// The editor grabs plenty of keys; keep them inside the textarea while it has focus.
		textarea.onkeydown = (event) => event.stopPropagation();

		this.wireDrag(el, header, sticky);
		this.wireResize(el, sticky);

		el.ondblclick = (event) => {
			if ((event.target as HTMLElement).closest(".stickies-note-content")) return;
			this.host.jumpToAnchor(sticky);
		};

		// Hover or press lights up the anchored text; pointerenter covers the mouse and
		// pointerdown covers touch, where enter/leave never fire.
		el.onpointerenter = () => this.host.setActiveAnchor(sticky.id);
		el.onpointerleave = () => this.host.setActiveAnchor(null);
		el.addEventListener("pointerdown", () => this.host.setActiveAnchor(sticky.id));

		return el;
	}

	private showMenu(event: MouseEvent, sticky: Sticky): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("Next type")
				.setIcon("tag")
				.onClick(() => {
					sticky.kind = KINDS[(KINDS.indexOf(sticky.kind) + 1) % KINDS.length];
					this.host.touch();
					this.host.repaint();
				})
		);
		menu.addItem((item) =>
			item
				.setTitle("Go to anchored text")
				.setIcon("crosshair")
				.setDisabled(!sticky.anchor || !!sticky.anchor.orphaned)
				.onClick(() => this.host.jumpToAnchor(sticky))
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Delete")
				.setIcon("trash")
				.onClick(() => this.host.remove(sticky.id))
		);
		menu.showAtMouseEvent(event);
	}

	/** Drag by the header — positions are container coordinates and pointer events are viewport coordinates, so the grab offset is measured against the element box rather than subtracted directly. */
	private wireDrag(el: HTMLElement, header: HTMLElement, sticky: Sticky): void {
		let grabX = 0;
		let grabY = 0;

		header.onpointerdown = (event) => {
			if ((event.target as HTMLElement).tagName === "BUTTON") return;
			const box = el.getBoundingClientRect();
			grabX = event.clientX - box.left;
			grabY = event.clientY - box.top;
			this.dragging = sticky.id;
			header.setPointerCapture(event.pointerId);
			el.addClass("is-dragging");
			event.preventDefault();
		};

		header.onpointermove = (event) => {
			if (this.dragging !== sticky.id) return;
			const parent = el.parentElement;
			if (!parent) return;
			const box = parent.getBoundingClientRect();
			sticky.x = Math.max(0, event.clientX - box.left + parent.scrollLeft - grabX);
			sticky.y = Math.max(0, event.clientY - box.top + parent.scrollTop - grabY);
			el.style.left = `${sticky.x}px`;
			el.style.top = `${sticky.y}px`;
		};

		const end = (event: PointerEvent) => {
			if (this.dragging !== sticky.id) return;
			this.dragging = null;
			header.releasePointerCapture?.(event.pointerId);
			el.removeClass("is-dragging");
			this.host.touchGeometry();
		};
		header.onpointerup = end;
		header.onpointercancel = end;
	}

	/** Resize from the bottom-right corner. The model carried width/height all along; nothing set them. */
	private wireResize(el: HTMLElement, sticky: Sticky): void {
		const handle = el.createDiv({ cls: "stickies-note-resize" });
		let startX = 0;
		let startY = 0;
		let startW = 0;
		let startH = 0;
		let active = false;

		handle.onpointerdown = (event) => {
			active = true;
			startX = event.clientX;
			startY = event.clientY;
			startW = sticky.width;
			startH = sticky.height;
			handle.setPointerCapture(event.pointerId);
			event.preventDefault();
			event.stopPropagation();
		};

		handle.onpointermove = (event) => {
			if (!active) return;
			sticky.width = Math.max(MIN_WIDTH, startW + (event.clientX - startX));
			sticky.height = Math.max(MIN_HEIGHT, startH + (event.clientY - startY));
			el.style.width = `${sticky.width}px`;
			el.style.height = `${sticky.height}px`;
		};

		const end = (event: PointerEvent) => {
			if (!active) return;
			active = false;
			handle.releasePointerCapture?.(event.pointerId);
			this.host.touchGeometry();
		};
		handle.onpointerup = end;
		handle.onpointercancel = end;
	}
}
