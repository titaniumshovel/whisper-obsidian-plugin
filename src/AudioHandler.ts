import axios from "axios";
import Whisper from "main";
import { Notice, MarkdownView } from "obsidian";
import { getBaseFileName } from "./utils";

export class AudioHandler {
	private plugin: Whisper;

	constructor(plugin: Whisper) {
		this.plugin = plugin;
	}

	async sendAudioData(blob: Blob, fileName: string): Promise<void> {
		// Get the base file name without extension
		const baseFileName = getBaseFileName(fileName);

		const audioFilePath = `${
			this.plugin.settings.saveAudioFilePath
				? `${this.plugin.settings.saveAudioFilePath}/`
				: ""
		}${fileName}`;

		const noteFilePath = `${
			this.plugin.settings.createNewFileAfterRecordingPath
				? `${this.plugin.settings.createNewFileAfterRecordingPath}/`
				: ""
		}${baseFileName}.md`;

		if (this.plugin.settings.debugMode) {
			new Notice(`Sending audio data size: ${blob.size / 1000} KB`);
		}

		if (!this.plugin.settings.apiKey) {
			new Notice(
				"API key is missing. Please add your API key in the settings."
			);
			return;
		}

		const formData = new FormData();
		formData.append("file", blob, fileName);
		formData.append("model", this.plugin.settings.model);
		formData.append("language", this.plugin.settings.language);
		if (this.plugin.settings.prompt)
			formData.append("prompt", this.plugin.settings.prompt);

		try {
			// If the saveAudioFile setting is true, save the audio file
			if (this.plugin.settings.saveAudioFile) {
				const arrayBuffer = await blob.arrayBuffer();
				await this.plugin.app.vault.adapter.writeBinary(
					audioFilePath,
					new Uint8Array(arrayBuffer)
				);
				new Notice("Audio saved successfully.");
			}
		} catch (err) {
			console.error("Error saving audio file:", err);
			new Notice("Error saving audio file: " + err.message);
		}

		// Only transcribe if we need to save transcription or insert it somewhere
		const shouldTranscribe = this.plugin.settings.createNewFileAfterRecording || 
			this.plugin.app.workspace.getActiveViewOfType(MarkdownView);

		if (shouldTranscribe) {
			try {
				if (this.plugin.settings.debugMode) {
					new Notice("Parsing audio data:" + fileName);
				}
				const response = await axios.post(
					this.plugin.settings.apiUrl,
					formData,
					{
						headers: {
							"Content-Type": "multipart/form-data",
							Authorization: `Bearer ${this.plugin.settings.apiKey}`,
						},
					}
				);

				// Only create/insert transcription if the setting is enabled
				if (this.plugin.settings.createNewFileAfterRecording) {
					// Create a new transcription file
					await this.plugin.app.vault.create(
						noteFilePath,
						`![[${audioFilePath}]]\n${response.data.text}`
					);
					await this.plugin.app.workspace.openLinkText(
						noteFilePath,
						"",
						true
					);
				} else {
					// Insert the transcription at the cursor position only if there's an active view
					const activeView =
						this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
					if (activeView) {
						const editor = activeView.editor;
						if (editor) {
							const cursorPosition = editor.getCursor();
							editor.replaceRange(response.data.text, cursorPosition);

							// Move the cursor to the end of the inserted text
							const newPosition = {
								line: cursorPosition.line,
								ch: cursorPosition.ch + response.data.text.length,
							};
							editor.setCursor(newPosition);
						}
					}
					// If no active view and createNewFileAfterRecording is false, do nothing with transcription
				}

				new Notice("Audio parsed successfully.");
			} catch (err) {
				console.error("Error parsing audio:", err);
				new Notice("Error parsing audio: " + err.message);
			}
		}
	}
}
