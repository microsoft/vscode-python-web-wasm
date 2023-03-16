/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { NotebookCell, NotebookController, NotebookDocument } from 'vscode';

export function executeHandler(_cells: NotebookCell[], _notebook: NotebookDocument, _controller: NotebookController): void | Thenable<void> {
	console.log('Execution');
}