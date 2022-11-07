/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

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
	}
	result: number;
} | {
	method: 'runRepl',
	params: {
		syncPort: any;
	},
	result: number;
};