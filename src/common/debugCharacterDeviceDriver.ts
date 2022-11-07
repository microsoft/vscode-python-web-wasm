
/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as uuid from 'uuid';

import { Uri } from 'vscode';
import { CharacterDeviceDriver, FileDescriptorDescription } from '@vscode/sync-api-service';

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
		throw new Error('Method not implemented.');
	}
	read(maxBytesToRead: number): Promise<Uint8Array> {
		throw new Error('Method not implemented.');
	}
}