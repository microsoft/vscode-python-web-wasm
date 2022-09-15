/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@ts-check

const esbuild = require('esbuild');

const extension = esbuild.build({
	entryPoints: ['out/web/extension.js'],
	outfile: 'dist/web/extension.js',
	bundle: true,
	external: ['vscode'],
	format: 'cjs',
	target: 'es2020',
	platform: 'browser'
}).catch(console.error);

const worker = esbuild.build({
	entryPoints: ['out/web/pythonWasmWorker.js'],
	outfile: 'dist/web/pythonWasmWorker.js',
	bundle: true,
	external: ['vscode'],
	format: 'iife',
	target: 'es2020',
	platform: 'browser'
}).catch(console.error);

Promise.all([extension, worker]).catch(console.error);