# Security Policy

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private vulnerability reporting on this repository (*Security* → *Report a vulnerability*), or email **code@kingletas.com**.

Include what you did, what happened, and what you expected. A proof of concept is welcome but not required — a clear description of the flaw is more useful than a working exploit.

This is a personal project maintained by one person, so please expect a first response in days rather than hours. You will get an acknowledgement, an assessment, and credit in the changelog unless you would rather not be named.

## Supported versions

The latest release on `main` is the supported version. There are no long-term support branches; fixes ship forward.

## What it touches

This plugin keeps annotations *outside* your notes. Nothing is written into the Markdown, and a note with fifty stickies on it is byte-for-byte the note you wrote. The consequence is that one JSON file holds every annotation in the vault, and that file is the thing to think about.

| Surface | What it means |
|---|---|
| **The annotation store** | `.stickies/annotations.json` at the vault root holds every sticky in the vault, including the text you typed into them and the passages they are anchored to |
| **Your notes** | Read, to find and re-anchor the passages stickies point at. **Never written** |
| **Editor integration** | A CodeMirror extension tints anchored passages and an overlay draws the stickies themselves |
| **The network** | Nothing. There is no network code in the bundle |

Three properties exist deliberately and should not be quietly removed:

- **Nothing is ever written into a note.** Not a marker, not a comment, not an invisible anchor. Anchoring is done by matching text, which is harder than writing a marker and is the reason a note stays byte-for-byte what you wrote.
- **The store is written through `vault.adapter`, not the `Vault` API**, because Obsidian does not index dot-folders. That also means nothing else in Obsidian is watching the file — treat it as the plugin's private state and do not hand-edit it.
- **Stickies are ephemeral by design.** There is no resolving, no archive and no timestamps. Your vault's own version control is what records that a sticky existed, which keeps the store small and keeps its blast radius to *what is on screen now*.

## In scope

- Any write reaching a note. This plugin does not write notes, and one that did would be the bug
- Content injection through sticky text or an anchored passage — anything that escapes into markup rather than being rendered as text
- The store being written outside `.stickies/`, or a path in it escaping the vault
- A store write that loses annotations rather than updating them — the whole vault's annotations are in one file
- Any network call reaching the bundle, by any path including a dependency

## Out of scope

- Vulnerabilities in Obsidian itself, or in its plugin model. Report those to Obsidian
- Findings that require an attacker who already has your filesystem or write access to your vault — at that point the plugin is the least of it
- The plugin declining to do something you enabled deliberately


## If you are running it

- **`.stickies/annotations.json` holds the text of every sticky in the vault.** If you sync your vault, you are syncing your annotations; if you publish it, treat that file the way you would treat any other note.
- **Nothing in a default `.gitignore` covers it.** In a version-controlled vault the file *is* committed, and that is what gives you the history — but check that you meant to.
- **Do not hand-edit the store.** It is generated, and a running Obsidian will write over you.
