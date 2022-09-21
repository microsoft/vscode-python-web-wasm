/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ExtensionContext, Uri } from 'vscode';

import { MessageChannel, Worker } from 'worker_threads';

import { Launcher } from '../common/launcher';

import { createMessageConnection, MessageConnection, PortMessageReader, PortMessageWriter } from 'vscode-jsonrpc/node';
import { ServiceConnection } from '@vscode/sync-api-common/node';

import { Requests } from '@vscode/sync-api-service';
import { Initialize } from '../common/messages';

export class DesktopLauncher extends Launcher {

	private worker: Worker | undefined;

	public constructor() {
		super();
	}

	protected async createMessageConnection(context: ExtensionContext): Promise<MessageConnection> {
		const filename = Uri.joinPath(context.extensionUri, './out/desktop/pythonWasmWorker.js').fsPath;
		this.worker = new Worker(filename);
		return createMessageConnection(new PortMessageReader(this.worker), new PortMessageWriter(this.worker));
	}

	protected async createSyncConnection(messageConnection: MessageConnection, pythonRoot: Uri, pythonWasm: string): Promise<ServiceConnection<Requests>> {
		const channel = new MessageChannel();
		await messageConnection.sendRequest(Initialize.type, { syncPort: channel.port2, pythonRoot: pythonRoot.toString(true), pythonWasm });
		return new ServiceConnection<Requests>(channel.port1);
	}

	protected async terminateConnection(): Promise<void> {
		await this.worker?.terminate();
	}
}