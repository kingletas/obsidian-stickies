<h1 align="center">🗒 Stickies</h1>

<p align="center">Movable Post-it annotations attached to Obsidian notes.</p>

<p align="center">
  <img alt="Obsidian" src="https://img.shields.io/badge/obsidian-1.5.0%2B-7c3aed">
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-strict-2a6db2">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green">
</p>

---

Movable Post-it annotations attached to Obsidian notes. Select some text, drop a sticky next to it, and the sticky stays with that text — it follows the passage as the note is edited around it, survives file renames, and tints the passage it belongs to so you can see at a glance which sentence someone had a thought about. A selection is optional: with nothing selected you get a free-floating sticky on the page instead.

Annotations live in one JSON file outside the notes themselves, so nothing is written into the Markdown and a note with fifty stickies on it is byte-for-byte the note you wrote.

**Stickies are ephemeral.** There is no resolving, no archive and no timestamps — a sticky is created, edited and deleted, and the vault's own git history is what records that it ever existed. That is a deliberate removal in 0.3.0; see [Ephemeral by design](#ephemeral-by-design).

---

## Using it

| Action | How |
|---|---|
| Add one, anchored | Select text → right-click → **Add sticky here**, or command **Stickies: Add sticky** |
| Add one, floating | Same two routes with **nothing selected**, or the panel's **＋ New** button |
| Write | Click into the sticky and type; saved automatically |
| Move | Drag the sticky by its header bar |
| Resize | Drag the bottom-right corner |
| Recolour | Click the **●** button in the header |
| Change type | **⋯** → *Next type* |
| See the anchored text | Hover or press the sticky — its text lights up in the note, even with *Highlight anchors* off |
| Jump to the anchored text | Double-click the sticky, or **⋯** → *Go to anchored text* |
| Jump to the sticky | Click the highlighted text in the note |
| Delete | The **×** in the sticky's header, **⋯** → *Delete*, or **Delete** on the panel row |
| Hide them all | Command **Stickies: Toggle sticky visibility** |
| Browse | Ribbon **sticky-note** icon, or **Stickies: Open sticky list** |

**No hotkey is claimed by default.** Assign one to *Stickies: Add sticky* in Obsidian's hotkey settings if you want one; a plugin taking a chord in a vault that already has twenty-odd of them is how conflicts start.

Deleting asks for no confirmation, on purpose. These are ephemeral and git holds the history, so a modal on every delete would be the wrong trade.

Seven colours (yellow, red, green, blue, purple, orange, gray) and six types (note, problem, idea, question, todo, research). Both cycle rather than opening a picker — with this few options a click is faster than a menu.

### The side panel

It scopes to the whole vault by default and toggles to the current note. In vault scope the list is **grouped by note** — the note you are reading first, then the rest by path; inside a group the order is creation order, **newest last**. A row carries the type, a badge, the body or the anchored text, and a **Delete**; hovering it shows the full path. Clicking a row opens the note and jumps to the sticky.

| Badge | Meaning |
|---|---|
| *(none)* | Anchored to text that is still there |
| **move** | A free-floating sticky, not attached to any text |
| **unlink** | Anchored, but the text is gone — see [How anchoring works](#how-anchoring-works) |
| **file-x** | The **note** is gone. The row is dashed and dimmed, and cannot be opened |

The scope toggle is remembered in `data.json`. It used to live on the panel object, and a sidebar leaf does not survive a restart or a layout change, so the toggle quietly reverted to *All notes* and read as a button that had not worked.

**A sticky whose note has left the vault is kept, and says so.** Renames and deletions are followed only when they happen *through Obsidian*: a `git mv`, a Syncthing delivery or a folder regroup done on disk fires no vault event, and the sticky is left pointing at a path that no longer resolves.

Before 0.3.1 that row looked entirely normal and did nothing whatsoever when clicked. It now carries the **file-x** badge and names the path when clicked, so you can restore the note or delete the sticky. Nothing is removed automatically — a path that does not resolve today is often a note that comes back tomorrow.

**The panel redraws only when its contents change.** `repaint()` runs on every store change, and the store notifies its listener synchronously while debouncing only the *write* — so every keystroke typed into a sticky reached the panel. Rebuilding the list that often threw the scroll position back to the top and moved rows out from under the pointer.

The rendered state is now hashed into one string and compared, the chrome is built once, and the scroll position is restored across the redraws that do still happen. Moving or resizing a sticky changes nothing the panel shows, so it does not redraw at all, and typing in the note itself does not either.

Typing **into a sticky** genuinely does change what a row shows, so that case is throttled instead — leading edge, 120 ms — which makes it one redraw per burst rather than one per character.

The panel tracks *the note you were last reading*, not the active view. Opening a sidebar makes that sidebar the active leaf, so a panel that asks Obsidian for "the active Markdown view" at render time gets null and blanks itself the instant you focus it — which is exactly what 0.2.0 did, and why the list looked permanently empty. It is tracked forwards now and never cleared when focus moves to a sidebar.

---

## How anchoring works

A sticky stores the text it was made from plus 100 characters either side of it. The stored character offsets are a cache, not the truth — they are re-derived from that context every time the note changes.

```text
edit the note
      |
      v
  offsets still hold the exact text?  --yes-->  done
      |
      no
      v
  search the document for the stored text
      |
      +-- one hit  --------------------------->  take it
      |
      +-- several hits  ----------------------->  score each by how much of the
      |                                           stored before/after context it
      |                                           still shares; take the best
      |
      +-- no hits  ---------------------------->  mark the anchor orphaned
                                                  (the sticky survives)
```

An orphaned sticky is drawn with a dashed border and a **⚠** badge, and is flagged in the panel. It keeps its text and its position; only the link into the note is broken. If the passage comes back — an undo, a paste — the anchor reattaches by itself on the next edit.

---

## Where the data lives

| File | Contents |
|---|---|
| `.stickies/annotations.json` (vault root) | Every sticky in the vault. Shared, portable, version-controlled with the vault. |
| `.obsidian/plugins/stickies/data.json` | Plugin settings only. |

The annotation path is configurable in settings. A leading dot keeps the folder out of the file explorer, search and graph while still being an ordinary file on disk that git will track.

Reads and writes go through `vault.adapter`, never the `Vault` API. **Obsidian's `Vault` API does not index dot-folders**, so `vault.getAbstractFileByPath(".stickies/annotations.json")` returns null no matter what is on disk. Point `storePath` at a normal folder and the adapter still works, so there is no reason to special-case it.

---

## Settings

| Setting | Default | Effect |
|---|---|---|
| Highlight anchored text | on | Tints the anchored passage in the sticky's colour |
| Default colour | yellow | Colour for newly created stickies |
| Default type | note | Type for newly created stickies |
| Annotation file | `.stickies/annotations.json` | Vault-relative path to the shared store |
| Write a startup log | off | Records what the plugin does as it loads, to `.stickies/diagnostic.log` |

The panel's **scope toggle** is written to the same `data.json` but is deliberately not in this tab: it is UI state you set by clicking the toggle, not a preference you go looking for. It is persisted only because the sidebar leaf that used to hold it does not survive a restart.

---

## Ephemeral by design

0.3.0 removed the whole lifecycle. Out went the `resolved` flag, the *Resolve* / *Reopen* actions, the panel's Open/Resolved split, the *Show resolved stickies* setting, and the `created` / `modified` timestamps.

What replaces them is the vault's git history: `.stickies/annotations.json` is not covered by any ignore rule, so obsidian-git commits it like anything else, and a sticky that once existed is recoverable from a commit rather than from a hidden-but-kept record inside the file.

Two consequences worth knowing:

- **The panel's ordering flipped.** It used to sort by `modified` descending. With no timestamps, order falls out of insertion order in the JSON object — stable, because the keys are UUIDs and JavaScript preserves insertion order for non-numeric keys — so the newest sticky is now **last** rather than first.
- **Geometry is persisted lazily.** Every write here is a candidate commit, so a move or resize waits ~6 s before reaching disk while a content edit still lands in ~0.4 s. A flurry of nudges coalesces into one write. An eager save always pulls a pending lazy one forward; a lazy one can never postpone an eager one. `onunload` flushes whatever is still pending.

The store format went `1` → `2`. A v1 file is migrated on load, dropping the three retired fields. **A sticky that was *resolved* in v1 becomes visible again** rather than being deleted — resolution no longer exists as a concept, and quietly deleting someone's note to honour a flag from a retired workflow is the worse of the two surprises. You get a notice saying so. A file written by a *newer* version than the plugin understands is read but never rewritten.

---

## Gotchas

- **CodeMirror must stay external in the build.** Obsidian ships its own copy; bundling a second one gives two module registries and the editor extension registered by this plugin silently fails to match the running editor's. `esbuild.config.mjs` lists every `@codemirror/*` and `@lezer/*` package as external, and `package.json` pins `@codemirror/view` and `@codemirror/state` to the **exact** versions `obsidian`'s typings peer-depend on. A caret range there fails `npm install` outright.
- **The overlay attaches to the scroll container**, `.cm-scroller` in source and live preview, `.markdown-preview-view` in reading mode. That is what makes a sticky travel with its paragraph instead of hovering over whatever is on screen. The stylesheet gives both `position: relative`, without which nothing would anchor to them.
- **Pick the *visible* scroller, not the first one that matches.** A `MarkdownView` can hold the source view and the reading view at the same time with the inactive one hidden, and `.cm-scroller` comes first in document order — so `querySelector(".cm-scroller, .markdown-preview-view")` handed back a hidden element whenever the note was in reading mode. The stickies were invisible, and a new one measured `clientWidth === 0` and landed at `x: 8` in the corner of a layer nobody could see. `visibleScroller()` in `overlay.ts` filters on `offsetParent` and `clientWidth` and is the only way either the overlay or the placement maths finds a scroller.
- **Sticky positions are container coordinates; pointer events are viewport coordinates.** Anything touching drag maths has to convert through the container's bounding rect *and* its scroll offset. Getting this wrong makes the first drag teleport the note.
- **The overlay updates in place and never rebuilds a focused or dragging sticky.** Rebuilding the layer wholesale on every editor change destroys the textarea you are typing into.
- **Enabling the plugin is a job for Obsidian's UI.** It rewrites `.obsidian/community-plugins.json` from memory on exit, so an id appended to that file while the app is running is discarded.
- **`data.json` is settings, not annotations.** Deleting the plugin folder loses your settings; it does not lose your stickies.
- **Never name a method after something on `View`, and do not trust the compiler to tell you.** `StickiesPanel.open()` — the row click handler — silently overrode `View.open()`, an internal Obsidian calls to open a view. Obsidian invoked it one millisecond after constructing the panel, it read `undefined` off the object it was handed, showed a notice and returned; Obsidian's own `open` never ran, so `onOpen()` never fired, `contentEl` was never attached to the document, and the panel rendered its rows into a detached element for three releases. **`View.open` is not in the public typings**, so there was nothing for `tsc` to conflict with — `scope` was caught at compile time in 0.3.0 only because `scope` *is* declared. `test/reserved.test.cjs` now checks every method the panel declares against a hand-maintained list of `Component`/`View`/`ItemView` members, undocumented ones included.
- **When it only breaks inside Obsidian, instrument first.** Everything checkable from outside passed — the model handled the real store, a headless harness built the real panel and drew it, the bundle was installed, the plugin enabled, no CSS hid it — while the tab showed nothing. Three rounds of inference each fixed something real and missed the symptom. Two lines of `.stickies/diagnostic.log` settled it. That is what the **Write a startup log** setting is for; it is off by default and rewritten on every load.
- **A deferred leaf is not just a `render()` hazard — it is why the panel can be blank.** A deferred view has no `onOpen`, so nothing builds the markup, and `getLeavesOfType()` hands the leaf back as readily as a real one. `openPanel()` would then reveal a tab that had never drawn anything, which looks identical to a panel that rendered and found no stickies. `wakePanel()` calls `loadIfDeferred()` and re-asserts the view state if the leaf still is not a `StickiesPanel`; it runs on layout-ready and whenever the panel is opened.
- **`registerView` goes first in `onload`.** Obsidian swallows a rejected `onload`, so anything that throws while reading settings or the store used to mean the view type was never registered — and a leaf whose view type is unknown renders as an empty tab with nothing anywhere saying why. The cost is that a panel can be constructed before the store exists, which the panel now detects and reports.
- **The panel never fails silently.** `draw()` catches, logs, and draws the error in the panel with a *Try again* button. This is the only place in the plugin that shows an exception to the person rather than only to the console, and it is there because a blank panel reads as *you have no stickies* — which is how a broken surface survived two releases.
- **A sidebar leaf restored from the saved workspace is a *deferred view*.** Obsidian 1.7+ puts a placeholder in the leaf until the tab is first shown, and `getLeavesOfType()` returns those leaves too. `leaf.view` is then not the view class, so calling a method on it throws — `leaf.view.render is not a function`, out of `onLayoutReady`, on every single vault open. That was the startup error in 0.2.0. Guard every such call with `instanceof`; there is nothing to draw anyway, because the real view renders itself in `onOpen` when Obsidian eventually instantiates it.

---

## Build and install

```bash
npm install && npm run build
```

Build, then copy the three files Obsidian loads into `<vault>/.obsidian/plugins/stickies/`. Leave any existing `data.json` alone — it is your annotations' companion settings file:

```bash
git clone https://github.com/kingletas/obsidian-stickies && cd obsidian-stickies && npm ci && npm run build
```

```bash
cp main.js manifest.json styles.css "$YOUR_VAULT/.obsidian/plugins/stickies/"
```

Then enable it in **Settings → Community plugins**. Do the enabling through Obsidian's own UI: the running app rewrites `community-plugins.json` from memory when it exits, so a hand-edit made while Obsidian is open is discarded.

---

## Tests

Two suites plus a smoke check, all without the app:

| Suite | Covers |
|---|---|
| `test/anchor.test.cjs` | Re-anchoring — 9 cases over the stable, moved, deleted, ambiguous and orphaned paths, plus recovery after undo |
| `test/store.test.cjs` | The v1 → v2 migration, a newer store being left alone, a corrupt store not being clobbered, and the two debounce-deadline rules — 12 cases against a fake vault adapter and a controlled clock |
| `test/panel.test.cjs` | The panel's list model — grouping by note, the active note sorting first, file scope, a sticky whose note has left the vault, the count label, and the redraw signature — 21 cases |
| `test/paneldom.test.cjs` | The real `StickiesPanel` built against a minimal DOM — that `onOpen` puts chrome, headings and rows in `contentEl` at all, that a render failure is *drawn* rather than left blank, and that nothing is marked missing before the vault can answer — 20 cases |
| `test/reserved.test.cjs` | That no method the panel declares shadows a `Component`/`View`/`ItemView` member. Verified by putting `open()` back, which fails it with `shadows: open` — 5 cases |
| `test/smoke.cjs` | The built bundle loads, the default export extends `Plugin`, CodeMirror resolved to Obsidian's copy, and `repaint()` survives a **deferred** sticky-panel leaf |

```bash
npm test
```

The deferred-leaf case is a regression test, and it was checked the only way worth checking one: by putting the old unguarded cast back and confirming it reproduces `leaf.view.render is not a function`.

Re-anchoring and the migration are the parts that quietly ruin data when they are wrong, which is why they were the first parts with tests. The panel's list model joined them by being extracted into `src/panelmodel.ts`, which imports nothing from `obsidian` for exactly that reason — grouping, ordering and the redraw signature are decisions, and a decision is testable. What is left needing the running app is the DOM: drag, resize, decorations, and the panel's own markup.

---

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md) covers the toolchain and the rules that are not obvious from the code. [`docs/architecture.md`](docs/architecture.md) explains how the pieces fit together. [`SECURITY.md`](SECURITY.md) covers vulnerability reports — **and read it before you sync your vault**, because `.stickies/annotations.json` holds the text of every sticky you have written.

## License

[MIT](LICENSE) © Luis Tineo
