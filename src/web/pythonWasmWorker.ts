/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import path from 'path-browserify';

import { ClientConnection, Requests, MessageConnection as SyncMessageConnection } from '@vscode/sync-api-common/browser';
import { ApiClientConnection, WASI } from '@vscode/wasm-wasi/browser';

import { WasmRunner, MessageConnection } from '../common/pythonWasmWorker';
import { MessageRequests, MessageNotifications } from '../common/messages';

class WebWasmRunner extends WasmRunner {
	constructor(port: MessagePort) {
		super(new SyncMessageConnection<undefined, MessageNotifications, MessageRequests, undefined>(port), path);
	}

	protected createClientConnection(port: MessagePort): ApiClientConnection {
		return new ClientConnection<Requests, ApiClientConnection.ReadyParams>(port);
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