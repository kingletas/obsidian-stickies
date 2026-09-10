# From nothing to a working Stickies

By the end of this page you'll have built the plugin from source, installed it in a throwaway vault, and stuck your first note to a sentence.

## Contents

- [What this is](#what-this-is)
- [What you need](#what-you-need)
- [Step 1: get the code and build it](#step-1-get-the-code-and-build-it)
- [Step 2: make a throwaway vault](#step-2-make-a-throwaway-vault)
- [Step 3: install the plugin into it](#step-3-install-the-plugin-into-it)
- [Step 4: turn it on and add your first sticky](#step-4-turn-it-on-and-add-your-first-sticky)
- [Where to go next](#where-to-go-next)

## What this is

Stickies is an Obsidian plugin that puts movable Post-it notes on top of your notes. You select some text, drop a sticky beside it, and the sticky stays with that text while you edit around it.

The stickies are kept in one file, `.stickies/annotations.json`, outside your notes. Your Markdown is never changed.

## What you need

- Obsidian 1.5 or newer.
- git, Node.js 20 or 22 with npm, and GNU make.

Check the command-line tools are there:

```bash
node --version && npm --version && make --version | head -1 && git --version
```

```text
v20.20.2
10.8.2
GNU Make 4.3
git version 2.43.0
```

Your version numbers will differ. What matters is that Node starts with `v20` or `v22`, and none of the four says `command not found`.

## Step 1: get the code and build it

```bash
git clone https://github.com/kingletas/obsidian-stickies
cd obsidian-stickies
npm ci
```

The clone from GitHub is not verified: the repository wasn't published when this page was written, so the run below cloned a local copy instead. Everything after the clone was run for real.

`npm ci` installs exactly the package versions recorded in `package-lock.json`. It should end like this:

```text
added 16 packages, and audited 17 packages in 2s

found 0 vulnerabilities
```

Now build the plugin and run its tests:

```bash
make check
```

This type-checks the code, bundles it into `main.js`, and runs the tests against that bundle. One test deliberately makes the panel fail, so you'll see a stack trace scroll past. That's expected. The end of a good run looks like this:

```text
default export is a function: true
extends the stubbed Plugin:   true
...
repaint survives a deferred leaf: yes

  the bundle builds and the suite passes
```

If it stops with `sh: 1: tsc: not found`, you skipped `npm ci`. Run it and try again.

## Step 2: make a throwaway vault

Try the plugin in a vault you don't care about first. A bug in the file that holds the stickies could lose all of them at once, so don't start in your real notes.

1. Open Obsidian and choose **Create new vault**.
2. Call it `obsidian-sandbox` and put it in your home folder.
3. Create a note in it and type a sentence or two.

Obsidian creates a hidden `.obsidian` folder inside the vault. That's where plugins live.

This step is not verified here: it happens in Obsidian's window, which this page's test run didn't open.

## Step 3: install the plugin into it

Obsidian loads a plugin from `<vault>/.obsidian/plugins/<plugin id>/`, and it needs three files there: `main.js`, `manifest.json` and `styles.css`. From the `obsidian-stickies` folder, copy them in:

```bash
VAULT=~/obsidian-sandbox
mkdir -p "$VAULT/.obsidian/plugins/stickies"
cp main.js manifest.json styles.css "$VAULT/.obsidian/plugins/stickies/"
ls "$VAULT/.obsidian/plugins/stickies"
```

```text
main.js
manifest.json
styles.css
```

If you see those three names, the files are in place.

You may notice a `make install` target. It hands the copy to a helper script that isn't part of this repository, so on your machine the copy above is the way to do it.

## Step 4: turn it on and add your first sticky

1. In Obsidian, open **Settings → Community plugins**.
2. If you see **Restricted mode**, turn it off.
3. Find **Stickies** in the list of installed plugins and switch it on.

Turn plugins on through Obsidian's settings, not by editing `community-plugins.json`. Obsidian rewrites that file from memory when it quits, so a hand edit can vanish.

Now add a sticky:

1. Open the note you wrote and select a few words.
2. Right-click the selection and choose **Add sticky here**.
3. Type into the sticky that appears.

The words you selected are tinted to match the sticky. Hover the sticky and they light up. To see every sticky in the vault, click the sticky-note icon in the left ribbon, or run **Stickies: Open sticky list** from the command palette.

This step is not verified here either. The test suite checks anchoring, the store and the panel without Obsidian, but nobody clicked through it in Obsidian during this page's test run.

## Where to go next

- [README](../README.md) covers every action, the side panel, anchoring and the settings.
- [SECURITY.md](../SECURITY.md) is worth reading before you sync a vault, because `.stickies/annotations.json` holds the text of every sticky.
- [docs/architecture.md](architecture.md) explains how the pieces fit together.
- [CONTRIBUTING.md](../CONTRIBUTING.md) covers development and pull requests.
