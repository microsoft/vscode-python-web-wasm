/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { LogOutputChannel, window } from 'vscode';

let channel: LogOutputChannel;
function Logger(): LogOutputChannel {
	if (channel === undefined) {
		channel = window.createOutputChannel('Python WASM', { log: true });
	}
	return channel;
}

export default Logger;