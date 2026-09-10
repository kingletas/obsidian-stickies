import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { Extension, Range, StateEffect } from "@codemirror/state";
import { editorInfoField } from "obsidian";
import { Sticky } from "./types";

/** Dispatched at every open editor when the sticky set changes — a ViewPlugin only recomputes on document or viewport changes, so without it a recoloured or new sticky would wait for a keystroke to repaint. */
export const stickiesChanged = StateEffect.define<null>();

export interface HighlightSource {
	stickiesFor(path: string): Sticky[];
	enabled(): boolean;
	/** The sticky whose card is under the pointer or holds focus, or null. */
	activeId(): string | null;
	reveal(id: string): void;
}

function build(view: EditorView, source: HighlightSource): DecorationSet {
	// A hovered card paints its own anchor even with persistent highlighting off.
	const active = source.activeId();
	if (!source.enabled() && !active) return Decoration.none;

	const path = view.state.field(editorInfoField, false)?.file?.path;
	if (!path) return Decoration.none;

	const len = view.state.doc.length;
	const ranges: Range<Decoration>[] = [];

	for (const s of source.stickiesFor(path)) {
		if (!s.anchor || s.anchor.orphaned) continue;
		if (!source.enabled() && s.id !== active) continue;
		// Offsets are re-derived on load, but a decoration built against a stale document
		// throws and takes the whole editor down with it. Clamp defensively.
		const from = Math.max(0, Math.min(s.anchor.start, len));
		const to = Math.max(0, Math.min(s.anchor.end, len));
		if (to <= from) continue;
		const emphasis = s.id === active ? " stickies-anchor--active" : "";
		ranges.push(
			Decoration.mark({
				class: `stickies-anchor stickies-anchor--${s.color}${emphasis}`,
				attributes: { "data-sticky-id": s.id },
			}).range(from, to)
		);
	}

	// `true` sorts for us, which matters because anchors are free to overlap.
	return Decoration.set(ranges, true);
}

export function anchorHighlighter(source: HighlightSource): Extension {
	const plugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = build(view, source);
			}

			update(update: ViewUpdate) {
				const forced = update.transactions.some((tr) =>
					tr.effects.some((e) => e.is(stickiesChanged))
				);
				if (update.docChanged || update.viewportChanged || forced) {
					this.decorations = build(update.view, source);
				}
			}
		},
		{ decorations: (v) => v.decorations }
	);

	// The reciprocal of double-clicking a sticky to jump to its text: click the highlighted
	// text to bring its sticky forward.
	const clickToReveal = EditorView.domEventHandlers({
		mousedown(event) {
			const target = event.target as HTMLElement | null;
			const hit = target?.closest?.(".stickies-anchor") as HTMLElement | null;
			const id = hit?.dataset?.stickyId;
			if (id) source.reveal(id);
			return false;
		},
	});

	return [plugin, clickToReveal];
}
