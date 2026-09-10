import { Anchor } from "./types";

export const CONTEXT_CHARS = 100;

/** Capture the anchor for a fresh selection, including the context used to re-find it later. */
export function captureAnchor(doc: string, start: number, end: number): Anchor {
	return {
		text: doc.slice(start, end),
		before: doc.slice(Math.max(0, start - CONTEXT_CHARS), start),
		after: doc.slice(end, end + CONTEXT_CHARS),
		start,
		end,
	};
}

/** Length of the longest common suffix of two strings. */
function commonSuffix(a: string, b: string): number {
	let n = 0;
	while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
	return n;
}

/** Length of the longest common prefix of two strings. */
function commonPrefix(a: string, b: string): number {
	let n = 0;
	while (n < a.length && n < b.length && a[n] === b[n]) n++;
	return n;
}

/**
 * Re-locate an anchor in the current document, preferring the cached offsets, then a single
 * occurrence, then the occurrence sharing the most context; text that is gone marks it `orphaned`.
 */
export function reanchor(anchor: Anchor, doc: string): Anchor {
	if (!anchor.text) return anchor;

	if (doc.slice(anchor.start, anchor.end) === anchor.text) {
		return anchor.orphaned ? { ...anchor, orphaned: false } : anchor;
	}

	const hits: number[] = [];
	for (let i = doc.indexOf(anchor.text); i !== -1; i = doc.indexOf(anchor.text, i + 1)) {
		hits.push(i);
		// A pathological document (one repeated word) should not cost a full scan on every keystroke.
		if (hits.length > 200) break;
	}

	if (hits.length === 0) {
		return { ...anchor, orphaned: true };
	}

	let best = hits[0];
	if (hits.length > 1) {
		let bestScore = -1;
		for (const at of hits) {
			const before = doc.slice(Math.max(0, at - CONTEXT_CHARS), at);
			const after = doc.slice(at + anchor.text.length, at + anchor.text.length + CONTEXT_CHARS);
			const score = commonSuffix(anchor.before, before) + commonPrefix(anchor.after, after);
			if (score > bestScore) {
				bestScore = score;
				best = at;
			}
		}
	}

	const start = best;
	const end = best + anchor.text.length;
	return {
		text: anchor.text,
		// Refresh the context too, so an anchor that drifts gradually keeps tracking its
		// neighbourhood instead of scoring against text that has long since been rewritten.
		before: doc.slice(Math.max(0, start - CONTEXT_CHARS), start),
		after: doc.slice(end, end + CONTEXT_CHARS),
		start,
		end,
		orphaned: false,
	};
}
