
/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as uuid from 'uuid';

import { Uri } from 'vscode';
import { CharacterDeviceDriver, FileDescriptorDescription, RAL as SyncRal } from '@vscode/sync-api-service';

export class DebugCharacterDeviceDriver implements CharacterDeviceDriver {

	public readonly uri: Uri;
	public readonly fileDescriptor: FileDescriptorDescription;

	constructor() {
		this.uri = Uri.from({ scheme: 'debug', authority: uuid.v4()});
		this.fileDescriptor = {
			kind: 'fileSystem',
			uri: this.uri,
			path: ''
		};
	}

	write(bytes: Uint8Array): Promise<number> {
		// We need to slice the bytes since we can't pass a shared array
		// buffer in the browser to the decode function
		console.log('write to device driver');
		return Promise.resolve(bytes.byteLength);
	}
	read(maxBytesToRead: number): Promise<Uint8Array> {
		console.log('read from the device driver');
		return Promise.resolve(new Uint8Array());
	}
}