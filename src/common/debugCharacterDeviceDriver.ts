
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

	private encoder: SyncRal.TextEncoder;
	private decoder: SyncRal.TextDecoder;

	private cmdIndex: number;
	private readonly commands: string[];

	constructor() {
		this.uri = Uri.from({ scheme: 'debug', authority: uuid.v4()});
		this.fileDescriptor = {
			kind: 'fileSystem',
			uri: this.uri,
			path: ''
		};
		this.encoder = SyncRal().TextEncoder.create();
		this.decoder = SyncRal().TextDecoder.create();
		this.commands = [
			'b app.py:3\n',
			'c\n',
			'w\n',
			'c\n'
		];
		this.cmdIndex = 0;
	}

	write(bytes: Uint8Array): Promise<number> {
		// We need to slice the bytes since we can't pass a shared array
		// buffer in the browser to the decode function
		console.log(this.decoder.decode(bytes.slice()));
		return Promise.resolve(bytes.byteLength);
	}
	read(maxBytesToRead: number): Promise<Uint8Array> {
		return Promise.resolve(this.encoder.encode(this.commands[this.cmdIndex++]));
	}
}