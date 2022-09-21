/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { RequestType, RequestType0 } from 'vscode-jsonrpc';

export namespace Initialize {
	export const method = 'initialize' as const;
	export const type: RequestType<{ syncPort: any, pythonRoot: string, pythonWasm: string }, void, void> = new RequestType(method);
}

export namespace ExecuteFile {
	export const method = 'executeFile' as const;
	export const type: RequestType<{ file: string }, number, void> = new RequestType(method);
}

export namespace RunRepl {
	export const method = 'runRepl' as const;
	export const type: RequestType0<number, void> = new RequestType0(method);
}
