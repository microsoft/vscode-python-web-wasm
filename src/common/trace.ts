/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { OutputChannel, window } from 'vscode';

export namespace Tracer {
	let channel: OutputChannel;

	function getChannel(): OutputChannel {
		if (channel === undefined) {
			channel = window.createOutputChannel('Python WASM');
		}
		return channel;
	}

	export function append(message: string): void {
		const channel = getChannel();
		channel.appendLine(`[Info - ${(new Date().toLocaleTimeString())}] ${message}`);
	}
}