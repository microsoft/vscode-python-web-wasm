/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import type { DTOs } from '@vscode/sync-api-service';

export type MessageRequests = {
	method: 'initialize',
	params: {
		pythonRepository: string;
		pythonRoot: string | undefined;
		binary: SharedArrayBuffer
	}
	result: void;
} | {
	method: 'executeFile',
	params: {
		syncPort: any;
		file: string;
	}
	result: number;
} | {
	method: 'debugFile',
	params: {
		syncPort: any;
		file: string;
		uri: DTOs.UriComponents;
		terminator: string;
	}
	result: number;
} | {
	method: 'runRepl',
	params: {
		syncPort: any
	},
	result: number;
};

export type MessageNotifications = {
	method: 'pathMappings',
	params: {
		mapping: { [key: string]: DTOs.UriComponents; };
	},
	result: void;
};