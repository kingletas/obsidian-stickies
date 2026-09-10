import { App, PluginSettingTab, Setting } from "obsidian";
import type StickiesPlugin from "./main";
import { COLORS, Color, KINDS, Kind } from "./types";

export class StickiesSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: StickiesPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Highlight anchored text")
			.setDesc("Tint the text a sticky was created from, in that sticky's colour.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.highlightAnchors).onChange(async (value) => {
					this.plugin.settings.highlightAnchors = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Default colour")
			.addDropdown((d) => {
				COLORS.forEach((c) => d.addOption(c, c));
				d.setValue(this.plugin.settings.defaultColor).onChange(async (value) => {
					this.plugin.settings.defaultColor = value as Color;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Default type")
			.addDropdown((d) => {
				KINDS.forEach((k) => d.addOption(k, k));
				d.setValue(this.plugin.settings.defaultKind).onChange(async (value) => {
					this.plugin.settings.defaultKind = value as Kind;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Annotation file")
			.setDesc(
				"Vault-relative path to the shared annotation store. A dot-folder keeps it out of " +
					"search and the file explorer while still being version-controlled with the vault."
			)
			.addText((t) =>
				t
					.setPlaceholder(".stickies/annotations.json")
					.setValue(this.plugin.settings.storePath)
					.onChange(async (value) => {
						const next = value.trim();
						if (!next.endsWith(".json")) return;
						this.plugin.settings.storePath = next;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Write a startup log")
			.setDesc(
				"Record what the plugin does as it loads, to .stickies/diagnostic.log. Off unless " +
					"something is wrong: turn it on, reload Obsidian, and read the file. It is " +
					"rewritten on every load, so it always holds one session."
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.diagnostics).onChange(async (value) => {
					this.plugin.settings.diagnostics = value;
					await this.plugin.saveSettings();
				})
			);
	}
}
