
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

	private textEncoder: SyncRal.TextEncoder;
	private textDecoder: SyncRal.TextDecoder;

	constructor() {
		this.uri = Uri.from({ scheme: 'debug', authority: uuid.v4()});
		this.fileDescriptor = {
			kind: 'fileSystem',
			uri: this.uri,
			path: ''
		};
		this.textEncoder = SyncRal().TextEncoder.create();
		this.textDecoder = SyncRal().TextDecoder.create();
	}

	write(bytes: Uint8Array): Promise<number> {
		console.log(this.textDecoder.decode(bytes));
		return Promise.resolve(bytes.byteLength);
	}
	read(maxBytesToRead: number): Promise<Uint8Array> {
		return Promise.resolve(this.textEncoder.encode('Hello World\n'));
	}
}