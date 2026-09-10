# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **A release workflow.** Pushing a tag equal to the manifest's version, such as `0.5.0`, builds and tests that commit, then publishes a GitHub release with `main.js`, `manifest.json` and `styles.css` attached, and the matching CHANGELOG section as its notes. It refuses a tag that disagrees with `manifest.json`, `package.json` or `versions.json`.

### Changed

- **CI runs `make check`**, the same gate a commit runs, on Ubuntu with Node 20 and 22. The macOS and Windows jobs are gone, and the manifest check now covers `versions.json` too.
- **`make install` and `make plan` need a vault named.** They used to default to a folder on the author's machine, which doesn't exist anywhere else. Run `make install VAULT=/path/to/test-vault`; without `VAULT` both stop with a usage message.

### Fixed

- **`package.json` now says 0.4.0, matching `manifest.json`.** It still said 0.3.6, so npm and Obsidian disagreed about which version this is.

## [0.4.0] — 2026-08-28

### Added

- **Hovering or pressing a sticky lights up its anchored text in the note**, so the pair reads as one thing without hunting for the matching highlight. The emphasis follows the sticky's colour, clears when the pointer leaves, and works on touch through press. It also paints when the *Highlight anchors* setting is off — the persistent highlight stays off, and the hovered card's anchor shows alone. The reciprocal direction already existed: clicking highlighted text brings its sticky forward.

### Changed

- The repository gains a licence, a contributing guide, a security policy, an architecture document, a `versions.json` and CI that builds the artifact Obsidian actually loads.

## [0.3.6] — 2026-08-24

### Fixed

- **The panel method named `open()` was overriding `View.open()`. This was the whole thing.** Obsidian's `View` has an internal `open()` that it calls to *open* a view; the panel's own `open(sticky)` — the row click handler — silently replaced it. Obsidian called it one millisecond after constructing the panel, this code read `undefined` off the object it was handed, announced that *undefined is not in the vault*, and returned.
  - Obsidian's own `open` never ran. `onOpen()` never fired, `contentEl` was never attached to the document, and `repaint()` went on rendering twelve rows into a detached element — hence a panel that logged *drew 5 groups, 12 rows* while showing nothing.
  - **It also explains the three earlier rounds.** There was no rendering bug, no data bug and no deferred-leaf bug worth the name; every fix landed on code that was building markup nobody could see.
  - **TypeScript could not catch it.** `View.open` is absent from the public typings, so there was no declaration to conflict with — unlike `scope`, which collided at compile time in 0.3.0 precisely *because* `scope` is declared. Renamed to `openSticky`.
  - `test/reserved.test.cjs` now checks every declared member by name against a hand-maintained list of `Component` / `View` / `ItemView` members, undocumented ones included, allowing only the five overrides that are the point of subclassing. It was verified by putting `open()` back, which fails it with *shadows: open*.

### Added

- **The startup diagnostic log is now a setting, off by default.** It is diagnostic equipment rather than telemetry, so it should not write a file into the vault on every load. It stays rather than being deleted because it is what found the `View.open()` override after three rounds of inference had each fixed something real and missed the symptom.
  - `onload` starts logging before it knows whether logging is wanted — the earliest steps are the ones worth having — so lines are buffered until the setting has been read, then flushed or dropped. **Enabling it costs nothing at startup and still captures startup.** The buffer is bounded, so a load that never reaches the setting cannot grow it without limit.

## [0.3.5] — 2026-08-24

### Fixed

- **Stop asking the vault about paths before it can answer.** The panel renders up to 5.5 seconds before the workspace is up, and `getAbstractFileByPath()` returns null for every path until the vault is indexed — which `exists()` took as *the note is gone*.
  - At startup every sticky was flagged as an orphaned note, every row drew the dashed and dimmed *file-x* badge, and clicking one reported that a note plainly present was not in the vault. It resolved later, *later* being the moment something happened to redraw after the index came up.
  - `exists()` now assumes the note is present until the vault is ready, and `onLayoutReady` sets that flag before triggering the redraw that replaces the assumption with a real answer. The open handler refuses with an honest message during that window rather than raising a false alarm.
  - **A handler now logs the object it was handed rather than interpolating `undefined` into a sentence about a missing file.** The next occurrence will name its own cause.

## [0.3.4] — 2026-08-24

### Fixed

- A blank panel is now impossible, and a panel restored from the workspace wakes up.
- The panel's redraw is throttled as well as gated on a signature — it was redrawing on every keystroke.
- Panel grouping, dead rows, and the deferred-leaf failure path.

## [0.3.0] — 2026-08-20

### Removed

- **Stickies are ephemeral.** No resolving, no archive, no timestamps — a sticky is created, edited and deleted, and the vault's own version history records that it ever existed. A deliberate removal: an annotation with a lifecycle is a task tracker, and the vault already has one.

### Fixed

- The startup crash, and both broken surfaces.

## [0.1.0] — 2026-08-20

### Added

- **Stickies** — movable Post-it annotations attached to Obsidian notes. Select text, drop a sticky beside it, and the sticky follows that passage as the note is edited around it, survives file renames, and tints the passage so you can see at a glance which sentence someone had a thought about. With nothing selected you get a free-floating sticky instead.
  - **Nothing is written into the Markdown.** Annotations live in one JSON file outside the notes, so a note with fifty stickies on it is byte-for-byte the note you wrote.
  - **No hotkey is claimed by default.** A plugin taking a chord in a vault that already has twenty-odd of them is how conflicts start.
  - Deleting asks for no confirmation, on purpose — these are ephemeral and version control holds the history, so a modal on every delete would be the wrong trade.
