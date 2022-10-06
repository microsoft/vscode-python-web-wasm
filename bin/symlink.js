/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@ts-check

'use strict';

const path = require('path');
const ln = require('./linking');

const extRoot = path.join(__dirname, '..');
const wasmRoot = path.join(__dirname, '..', '..', '..', 'vscode-wasm');
const node_modules = 'node_modules';

(async function main() {
	console.log('Symlinking vscode WASM node modules for development setup');

	await ln.softLink(path.join(wasmRoot, 'sync-api-common'), path.join(extRoot, node_modules, '@vscode', 'sync-api-common'));
	await ln.softLink(path.join(wasmRoot, 'sync-api-client'), path.join(extRoot, node_modules, '@vscode', 'sync-api-client'));
	await ln.softLink(path.join(wasmRoot, 'sync-api-service'), path.join(extRoot, node_modules, '@vscode', 'sync-api-service'));
	await ln.softLink(path.join(wasmRoot, 'wasm-wasi'), path.join(extRoot, node_modules, '@vscode', 'wasm-wasi'));
})();