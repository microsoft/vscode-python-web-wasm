/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ExtensionContext, Uri } from 'vscode';

import { Requests } from '@vscode/sync-api-service';
import { createMessageConnection, MessageConnection, BrowserMessageReader, BrowserMessageWriter } from 'vscode-jsonrpc/browser';
import { ServiceConnection } from '@vscode/sync-api-common/browser';

import { Launcher } from '../common/launcher';
import { Initialize } from '../common/messages';

export class WebLauncher extends Launcher {

	private worker: Worker | undefined;

	public constructor() {
		super();
	}

	protected async createMessageConnection(context: ExtensionContext): Promise<MessageConnection> {
		const filename = Uri.joinPath(context.extensionUri, './dist/web/pythonWasmWorker.js').toString();
		this.worker = new Worker(filename);
		const channel = new MessageChannel();
		const ready = new Promise<void>((resolve, reject) => {
			if (this.worker === undefined) {
				reject(new Error(`Worker died unexpectedly.`));
				return;
			}
			this.worker.onmessage = (event: MessageEvent<string>) => {
				if (event.data === 'ready') {
					resolve();
				} else {
					reject(new Error(`Missing ready event from worker`));
				}
				if (this.worker !== undefined) {
					this.worker.onmessage = null;
				}
			};
		});
		this.worker.postMessage(channel.port2, [channel.port2]);
		await ready;
		return createMessageConnection(new BrowserMessageReader(channel.port1), new BrowserMessageWriter(channel.port1));
	}

	protected async createSyncConnection(messageConnection: MessageConnection, pythonRoot: Uri, pythonWasm: string): Promise<ServiceConnection<Requests>> {
		const channel = new MessageChannel();
		await messageConnection.sendRequest(Initialize.type, { syncPort: channel.port2, pythonRoot: pythonRoot.toString(true), pythonWasm });
		return new ServiceConnection<Requests>(channel.port1);
	}

	protected async terminateConnection(): Promise<void> {
		this.worker?.terminate();
	}
}