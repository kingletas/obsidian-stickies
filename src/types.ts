export type Color = "yellow" | "red" | "green" | "blue" | "purple" | "orange" | "gray";
export type Kind = "note" | "problem" | "idea" | "question" | "todo" | "research";

export const COLORS: Color[] = ["yellow", "red", "green", "blue", "purple", "orange", "gray"];
export const KINDS: Kind[] = ["note", "problem", "idea", "question", "todo", "research"];

/** The current on-disk format. `1` carried `resolved`/`created`/`modified`; see `store.ts`. */
export const STORE_VERSION = 2;

/**
 * Where a sticky is attached in the note; `start`/`end` are a cache that `anchor.ts` re-derives
 * from `text`, `before` and `after` on every load.
 */
export interface Anchor {
	text: string;
	before: string;
	after: string;
	start: number;
	end: number;
	/** Set when the anchored text can no longer be found; the sticky survives, the link does not. */
	orphaned?: boolean;
}

/**
 * One sticky, with no lifecycle state or timestamps, and no `anchor` when it floats free. Order
 * is insertion order, which holds only because the keys are UUIDs rather than numeric strings.
 */
export interface Sticky {
	id: string;
	file: string;
	anchor?: Anchor;
	x: number;
	y: number;
	width: number;
	height: number;
	color: Color;
	kind: Kind;
	content: string;
	rotation: number;
}

export interface Store {
	version: number;
	stickies: Record<string, Sticky>;
}

export interface StickiesSettings {
	highlightAnchors: boolean;
	defaultColor: Color;
	defaultKind: Kind;
	defaultWidth: number;
	defaultHeight: number;
	storePath: string;
	/** Whether the side panel lists this note or the whole vault; kept here to survive a rebuilt leaf. */
	panelScope: "file" | "vault";
	/** Write a startup trace to `.stickies/diagnostic.log`. */
	diagnostics: boolean;
}

export const DEFAULT_SETTINGS: StickiesSettings = {
	highlightAnchors: true,
	defaultColor: "yellow",
	defaultKind: "note",
	defaultWidth: 230,
	defaultHeight: 170,
	storePath: ".stickies/annotations.json",
	panelScope: "vault",
	diagnostics: false,
};

export const VIEW_TYPE_STICKIES = "stickies-panel";
