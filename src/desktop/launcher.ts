/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ExtensionContext, Uri } from 'vscode';

import { MessageChannel, Worker } from 'worker_threads';

import { BaseLauncher, MessageConnection } from '../common/launcher';

import { ServiceConnection, MessageConnection as SyncMessageConnection } from '@vscode/sync-api-common/node';

import { ApiServiceConnection, Requests } from '@vscode/sync-api-service';
import { MessageRequests, MessageNotifications } from '../common/messages';

export class DesktopLauncher extends BaseLauncher {

	private worker: Worker | undefined;

	public constructor() {
		super();
	}

	protected async createMessageConnection(context: ExtensionContext): Promise<MessageConnection> {
		const filename = Uri.joinPath(context.extensionUri, './dist/desktop/pythonWasmWorker.js').fsPath;
		this.worker = new Worker(filename);
		const channel = new MessageChannel();
		const ready = new Promise<void>((resolve, reject) => {
			if (this.worker === undefined) {
				reject(new Error(`Worker died unexpectedly.`));
				return;
			}
			this.worker.once('message', (value: string) => {
				if (value === 'ready') {
					resolve();
				} else {
					reject(new Error(`Missing ready event from worker`));
				}
			});
		});
		this.worker.postMessage(channel.port2, [channel.port2]);
		await ready;
		return new SyncMessageConnection<MessageRequests, undefined, undefined, MessageNotifications>(channel.port1);
	}

	protected async createSyncConnection(messageConnection: MessageConnection): Promise<[ApiServiceConnection, any]> {
		const channel = new MessageChannel();
		const result = new ServiceConnection<Requests, ApiServiceConnection.ReadyParams>(channel.port1);
		return [result, channel.port2];
	}

	protected async terminateConnection(): Promise<void> {
		await this.worker?.terminate();
	}
}