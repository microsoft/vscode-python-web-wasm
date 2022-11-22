/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
/// <reference path="./typings.d.ts" />

import * as _path from 'path';
const path = _path.posix;
import { MessagePort, parentPort } from 'worker_threads';

import { ClientConnection, Requests, MessageConnection as SyncMessageConnection } from '@vscode/sync-api-common/node';
import { ApiClientConnection, WASI } from '@vscode/wasm-wasi/node';

import { WasmRunner } from '../common/pythonWasmWorker';
import { MessageRequests, MessageNotifications } from '../common/messages';

if (parentPort === null) {
	process.exit();
}

class NodeWasmRunner extends WasmRunner {
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

parentPort.on('message', (port: MessagePort) => {
	const runner = new NodeWasmRunner(port);
	runner.listen();
	parentPort?.postMessage('ready');
});