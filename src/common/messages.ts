/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

export type MessageRequests = {
	method: 'initialize',
	params: {
		syncPort: any;
		pythonRoot: string;
		pythonWasm: string;
	}
	result: void;
} | {
	method: 'executeFile',
	params: {
		file: string;
	}
	result: number;
} | {
	method: 'runRepl',
	params: undefined,
	result: number;
};