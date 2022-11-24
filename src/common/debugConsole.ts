/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as uuid from 'uuid';

import { Event, EventEmitter, Uri } from 'vscode';
import { CharacterDeviceDriver, FileDescriptorDescription, RAL } from '@vscode/sync-api-service';

export class DebugConsole implements CharacterDeviceDriver {
	public readonly uri: Uri;
	public readonly fileDescriptor: FileDescriptorDescription;

	public readonly onStdout: Event<string>;
	public readonly onStderr: Event<string>;

	private readonly _onStdout: EventEmitter<string>;
	private readonly _onStderr: EventEmitter<string>;
	private readonly _decoder: RAL.TextDecoder;

	constructor() {
		this.uri= Uri.from({ scheme: 'console', authority: uuid.v4() });
		this.fileDescriptor = {
			kind: 'console',
			uri: this.uri
		};

		this._onStdout = new EventEmitter();
		this.onStdout = this._onStdout.event;

		this._onStderr = new EventEmitter();
		this.onStderr = this._onStderr.event;

		this._decoder = RAL().TextDecoder.create();
	}

	write(bytes: Uint8Array): Promise<number> {
		this._onStdout.fire(this._decoder.decode(bytes.slice()));
		return Promise.resolve(bytes.length);
	}

	public read(_maxBytesToRead: number): Promise<Uint8Array> {
		return Promise.resolve(new Uint8Array(0));
	}
}