import { App, Editor, MarkdownView, Modal, FileSystemAdapter, Plugin, PluginSettingTab, Setting, moment } from 'obsidian';
import { clipboard } from "electron";
import { extname, resolve, join } from 'path';

// Remember to rename these classes and interfaces!

interface ObsidianAvifPluginSettings {
	avifPath: string;
}

const DEFAULT_SETTINGS: ObsidianAvifPluginSettings = {
	avifPath: '/Users/$USER/go/bin/avif'
}

const exec = require('child_process').exec;

function execute(command, callback) {
	exec(command, (error, stdout, stderr) => {
		console.log(error, stdout, stderr)
		callback(error, stdout, stderr);
	});
};


export default class ObsidianAvifPlugin extends Plugin {
	settings: ObsidianAvifPluginSettings;

	async onload() {
		await this.loadSettings();

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'sample-editor-command',
			name: 'Sample editor command',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection('Sample Editor Command');
			}
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-sample-modal-complex',
			name: 'Open sample modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		this.setupPasteHandler()

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	setupPasteHandler() {
		this.app.workspace.on(
			"editor-paste",
			(evt: ClipboardEvent, editor: Editor, markdownView: MarkdownView) => {
				const os = this.getOS();
				if (os !== "MacOS") {
					console.log("not macos, pic won't be processed")
					return
				}
				let files = evt.clipboardData.files;
				if (
					this.isCopyImageFile() ||
					files.length !== 0 ||
					files[0].type.startsWith("image")
				) {
					console.log("pasting image")
					const avif: string = this.getAvifPasteFile(editor)
					evt.preventDefault();
				} else {
					console.log("cannot paste")
				}
			}
		);
	}

	getAvifPasteFile(editor: Editor): string {
		const timebase = moment(new Date()).format("-YYYYMMDD-")
		const baseFile = (
			this.app.vault.adapter as FileSystemAdapter
		).getName();
		const randomPrefix: string = baseFile + timebase + (Math.random() + 1).toString(36).substr(2, 7)
		const pngPath: string = randomPrefix + ".png"
		const avifPath = randomPrefix + ".avif"
		const fullAvifPath = this.getFileAssetPath() + "/" + avifPath
		console.debug("pngpath:", pngPath)
		console.debug("avifpath:", avifPath)
		console.debug("full avifpath:", fullAvifPath)
		console.debug("full avif exec path:", this.settings.avifPath)
		execute("/usr/local/bin/pngpaste /tmp/" + pngPath, () => {
			execute(this.settings.avifPath + " --fast -e /tmp/" + pngPath + " -o \"" + fullAvifPath + "\"", () => {
				this.insertTemporaryText(editor, fullAvifPath)
			})
		})
		return fullAvifPath
	}

	isCopyImageFile() {
		let filePath = "";
		const os = this.getOS();

		if (os === "Windows") {
			var rawFilePath = clipboard.read("FileNameW");
			filePath = rawFilePath.replace(
				new RegExp(String.fromCharCode(0), "g"),
				""
			);
		} else if (os === "MacOS") {
			filePath = clipboard.read("public.file-url").replace("file://", "");
		} else {
			filePath = "";
		}
		return this.isAssetTypeAnImage(filePath);
	}
	isAssetTypeAnImage(path: string): Boolean {
		return (
			[".png", ".jpg", ".jpeg", ".bmp", ".gif", ".svg", ".tiff"].indexOf(
				extname(path).toLowerCase()
			) !== -1
		);
	}
	getOS() {
		const { appVersion } = navigator;
		if (appVersion.indexOf("Win") !== -1) {
			return "Windows";
		} else if (appVersion.indexOf("Mac") !== -1) {
			return "MacOS";
		} else if (appVersion.indexOf("X11") !== -1) {
			return "Linux";
		} else {
			return "Unknown OS";
		}
	}
	insertTemporaryText(editor: Editor, progressText: string) {
		editor.replaceSelection(`![](${ObsidianAvifPlugin.getFileName(progressText)})` + "\n");
	}

	static getFileName(fn: string): string {
		return "file:///" + encodeURI(fn)
	}
	embedMarkDownImage(editor: Editor, pasteId: string, imageUrl: string) {
		let progressText = ObsidianAvifPlugin.progressTextFor(pasteId);
		let markDownImage = `![](${imageUrl})`;

		ObsidianAvifPlugin.replaceFirstOccurrence(
			editor,
			progressText,
			markDownImage
		);
	}

	handleFailedUpload(editor: Editor, pasteId: string, reason: any) {
		console.error("Failed request: ", reason);
		let progressText = ObsidianAvifPlugin.progressTextFor(pasteId);
		ObsidianAvifPlugin.replaceFirstOccurrence(
			editor,
			progressText,
			"⚠️upload failed, check dev console"
		);
	}
	private static progressTextFor(id: string) {
		return `![Uploading file...${id}]()`;
	}

	static replaceFirstOccurrence(
		editor: Editor,
		target: string,
		replacement: string
	) {
		let lines = editor.getValue().split("\n");
		for (let i = 0; i < lines.length; i++) {
			let ch = lines[i].indexOf(target);
			if (ch != -1) {
				let from = { line: i, ch: ch };
				let to = { line: i, ch: ch + target.length };
				editor.replaceRange(replacement, from, to);
				break;
			}
		}
	}
	getFileAssetPath() {
		const basePath = (
			this.app.vault.adapter as FileSystemAdapter
		).getBasePath();

		// @ts-ignore
		const assetFolder: string = this.app.vault.config.attachmentFolderPath;
		const activeFile = this.app.vault.getAbstractFileByPath(
			this.app.workspace.getActiveFile().path
		);

		// 当前文件夹下的子文件夹
		if (assetFolder.startsWith("./")) {
			const activeFolder = decodeURI(resolve(basePath, activeFile.parent.path));
			return join(activeFolder, assetFolder);
		} else {
			// 根文件夹
			return join(basePath, assetFolder);
		}
	}


	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: ObsidianAvifPlugin;

	constructor(app: App, plugin: ObsidianAvifPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Settings for my awesome plugin.' });

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					console.log('Secret: ' + value);
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
