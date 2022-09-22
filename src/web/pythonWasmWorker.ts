/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import path from 'path-browserify';

import { createMessageConnection, BrowserMessageReader, BrowserMessageWriter } from 'vscode-jsonrpc/browser';
import { ClientConnection, Requests } from '@vscode/sync-api-common/browser';
import { WASI } from '@vscode/wasm-wasi/browser';

import { WasmRunner } from '../common/pythonWasmWorker';

class WebWasmRunner extends WasmRunner {
	constructor(port: MessagePort) {
		super(createMessageConnection(new BrowserMessageReader(port), new BrowserMessageWriter(port)), path);
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