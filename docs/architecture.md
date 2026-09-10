# Architecture

About 2,000 lines of TypeScript, no runtime dependencies, and one hard constraint that shapes everything: **nothing is ever written into a note.**

## The shape

```text
Editor selection ──▶ main.ts ──▶ anchor.ts   (find the passage, record how to find it again)
                        │
                        ├──▶ store.ts        (one JSON file, outside the notes)
                        │
                        ├──▶ overlay.ts      (the sticky itself, drawn over the editor)
                        ├──▶ highlight.ts    (a CodeMirror extension tinting the passage)
                        └──▶ panel.ts        (the side list) ◀── panelmodel.ts (grouping, pure)
```

| File | Responsibility |
|---|---|
| `main.ts` | The plugin. Commands, the context menu, lifecycle, the vault-ready gate |
| `anchor.ts` | Attaching a sticky to a passage, and re-finding that passage after edits |
| `store.ts` | Reading and writing `.stickies/annotations.json` |
| `panelmodel.ts` | Grouping and ordering for the side panel — pure, and tested without an app |
| `panel.ts` | The side panel view |
| `overlay.ts` | The draggable, resizable sticky drawn over the editor |
| `highlight.ts` | The CodeMirror extension that tints anchored passages |
| `diagnostic.ts` | The optional startup log |
| `types.ts`, `settings.ts` | Shapes and the settings tab |

## Four decisions worth knowing

### Nothing is written into a note

Not a marker, not an HTML comment, not an invisible anchor. **A note with fifty stickies on it is byte-for-byte the note you wrote.**

The cost is that anchoring is hard: a sticky has to re-find its passage by matching text after the note has been edited around it, rather than by looking up a marker somebody helpfully left in the file. That cost is paid on purpose. A plugin that annotates your files to index them is a plugin you cannot remove cleanly, and the annotations become something your Markdown carries forever.

`anchor.ts` is where that lives, and `test/anchor.test.cjs` is the file to read before changing it.

### One store, outside the vault's index

`.stickies/annotations.json` at the vault root holds every sticky in the vault.

It is written through `vault.adapter` rather than the `Vault` API, because **Obsidian does not index dot-folders** — the normal API cannot see the file at all. Two consequences follow and both matter:

- Nothing else in Obsidian is watching it. It is the plugin's private state; hand-editing it while Obsidian is running loses.
- **Nothing in a default `.gitignore` covers it.** In a version-controlled vault the file *is* committed and does have real history — which is what makes the next decision workable.

The blast radius is the reason to be careful here: a bug in the writer loses every sticky in the vault at once, not one.

### Stickies are ephemeral

No resolving, no archive, no timestamps. A sticky is created, edited and deleted; the vault's own version history records that it existed.

This was a deliberate *removal* in 0.3.0. An annotation with a lifecycle is a task tracker, and a vault generally already has one. Keeping the model this small is also what makes deleting without a confirmation the right trade rather than a careless one.

### The vault is not ready when the panel first draws

Measured: the panel renders up to **5.5 seconds** before `onLayoutReady` fires.

`getAbstractFileByPath()` returns null for every path until the vault is indexed, and an existence check that takes null as *the note is gone* will flag every sticky in the vault as orphaned at startup — dashed, dimmed, and reporting that a note plainly present is missing. It resolves later, *later* being whenever something happens to redraw.

So existence **assumes present** until a vault-ready flag is set, and `onLayoutReady` sets that flag before triggering the redraw that replaces the assumption with a real answer. Handlers refuse with an honest message during that window rather than raising a false alarm.

## The bug that cost three releases

**A method named `open()` on a `View` subclass silently overrides `View.open()`** — the undocumented internal Obsidian calls to *attach* a view.

The panel's row-click handler was called `open(sticky)`. Obsidian called it one millisecond after constructing the panel, the code read `undefined` off the object it was handed, announced that *undefined is not in the vault*, and returned. **Obsidian's own `open` never ran**: `onOpen()` never fired, `contentEl` was never attached to the document, and `repaint()` went on rendering rows into a detached element — a panel logging *drew 5 groups, 12 rows* while showing nothing.

Three properties of this are worth carrying into any other plugin:

- **`tsc` cannot catch it.** `View.open` is absent from the public typings, so there is no declaration to conflict with. `scope` *is* declared, which is why an identical collision on that name failed at compile time.
- **A working settings tab proves nothing about a view.** The settings tab is registered separately and kept working throughout, which is what sent three rounds of investigation into the renderer — the one place the bug was not.
- **Every round before it fixed something real and missed the symptom**, because every fix landed on code building markup nobody could see.

`test/reserved.test.cjs` is the durable half: it walks the declared members against a hand-maintained list of `Component` / `View` / `ItemView` members, undocumented internals included, allowing only the five overrides that are the point of subclassing. It was verified by putting `open()` back, which fails it with *shadows: open*.

## The diagnostic log

Off by default, and kept rather than deleted because **it is what found the override** after inference had failed three times. It caught it in two lines: the panel being constructed, then `open()` being called one millisecond later with no arguments.

`onload` starts logging before it knows whether logging is wanted — the earliest steps are the ones worth having — so lines are buffered until the setting has been read, then flushed or dropped. Enabling it costs nothing at startup and still captures startup. The buffer is bounded, so a load that never reaches the setting cannot grow it without limit.

It is diagnostic equipment, not telemetry: nothing leaves the machine, and nothing is written unless you ask for it.

## Testing

The suite `require()`s an esbuild bundle rather than the TypeScript sources, because the bundle is the only thing Obsidian ever loads.

`panelmodel.ts` is pure and tested without an app at all — grouping and ordering are the parts most likely to be wrong and least likely to need a DOM. `test/paneldom.test.cjs` drives the panel against a minimal DOM stub for the parts that do.
