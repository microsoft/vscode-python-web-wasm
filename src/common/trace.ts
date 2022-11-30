/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { workspace, OutputChannel, window } from 'vscode';

export namespace Tracer {
	let channel: OutputChannel;

	function getChannel(): OutputChannel {
		if (channel === undefined) {
			channel = window.createOutputChannel('Python WASM');
		}
		return channel;
	}

	export function getChannelIfEnabled(): OutputChannel | undefined {
		const mode = workspace.getConfiguration('python.wasm').get<string>('trace', 'off');
		if (mode !== 'off') {
			return getChannel();
		}
		return undefined;
	}

	export function append(message: string): void {
		const mode = workspace.getConfiguration('python.wasm').get<string>('trace', 'off');
		if (mode === 'off') {
			return;
		}

		const channel = getChannel();
		channel.appendLine(`[Trace - ${(new Date().toLocaleTimeString())}] ${message}`);
	}
}