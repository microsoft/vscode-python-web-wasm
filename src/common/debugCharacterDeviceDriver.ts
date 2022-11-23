
/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as uuid from 'uuid';

import { Uri, Event, EventEmitter } from 'vscode';
import { CharacterDeviceDriver, FileDescriptorDescription, RAL as SyncRal } from '@vscode/sync-api-service';

export class DebugCharacterDeviceDriver implements CharacterDeviceDriver {

	public readonly uri: Uri;
	public readonly fileDescriptor: FileDescriptorDescription;
	public get output(): Event<string> {
		return this._outputEmitter.event;
	}
	public input(str: string): void {
		this._inputQueue.push(str);
		this._inputEmitter.fire();
	}

	private _encoder: SyncRal.TextEncoder = SyncRal().TextEncoder.create();
	private _decoder: SyncRal.TextDecoder = SyncRal().TextDecoder.create();
	private _outputEmitter = new EventEmitter<string>();
	private _inputEmitter = new EventEmitter<void>();
	private _inputQueue: string[] = [];
	constructor() {
		this.uri = Uri.from({ scheme: 'debug', authority: uuid.v4()});
		this.fileDescriptor = {
			kind: 'fileSystem',
			uri: this.uri,
			path: ''
		};
	}

	write(bytes: Uint8Array): Promise<number> {
		/**
		 * ⚠️⚠️ We need to slice the bytes since we can't pass a shared array ⚠️⚠️
		 * ⚠️⚠️ buffer in the browser to the decode function ⚠️⚠️
		 */
		const str = this._decoder.decode(bytes.slice());
		this._outputEmitter.fire(str);
		return Promise.resolve(bytes.byteLength);
	}
	read(_maxBytesToRead: number): Promise<Uint8Array> {
		// TODO: Handle inputs longer than maxBytesToRead
		if (this._inputQueue.length > 0) {
			return Promise.resolve(this._encoder.encode(this._inputQueue.shift()!));
		}
		// No input available, wait for it
		return new Promise<Uint8Array>((resolve, reject) => {
			const disposable = this._inputEmitter.event(() => {
				const bytes = this._encoder.encode(this._inputQueue.shift()! || '');
				disposable.dispose();
				resolve(bytes);
			});
		});
	}
}