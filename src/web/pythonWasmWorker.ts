/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import path from 'path-browserify';

import { ClientConnection, Requests, MessageConnection } from '@vscode/sync-api-common/browser';
import { WASI } from '@vscode/wasm-wasi/browser';

import { WasmRunner } from '../common/pythonWasmWorker';
import { MessageRequests } from '../common/messages';

class WebWasmRunner extends WasmRunner {
	constructor(port: MessagePort) {
		super(new MessageConnection<undefined, undefined, MessageRequests, undefined>(port), path);
	}

	protected createClientConnection(port: MessagePort): ClientConnection<Requests> {
		return new ClientConnection<Requests>(port);
	}

	protected async doRun(binary: Uint8Array, wasi: WASI): Promise<void> {
		const { instance } = await WebAssembly.instantiate(binary, {
			wasi_snapshot_preview1: wasi
		});
		wasi.initialize(instance);
		(instance.exports._start as Function)();
	}
}

self.onmessage = (event: MessageEvent<MessagePort>) => {
	const runner = new WebWasmRunner(event.data);
	runner.listen();
	self.postMessage('ready');
};