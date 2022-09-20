/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@ts-check

const esbuild = require('esbuild');

const webExtension = esbuild.build({
	entryPoints: ['out/web/extension.js'],
	outfile: 'dist/web/extension.js',
	bundle: true,
	external: ['vscode'],
	format: 'cjs',
	target: 'es2020',
	platform: 'browser'
}).catch(console.error);

const webWorker = esbuild.build({
	entryPoints: ['out/web/pythonWasmWorker.js'],
	outfile: 'dist/web/pythonWasmWorker.js',
	bundle: true,
	external: ['vscode'],
	format: 'iife',
	target: 'es2020',
	platform: 'browser'
}).catch(console.error);

const desktopExtension = esbuild.build({
	entryPoints: ['out/desktop/extension.js'],
	outfile: 'dist/desktop/extension.js',
	bundle: true,
	external: ['vscode'],
	format: 'cjs',
	target: 'es2020',
	platform: 'node'
}).catch(console.error);

const desktopWorker = esbuild.build({
	entryPoints: ['out/desktop/pythonWasmWorker.js'],
	outfile: 'dist/desktop/pythonWasmWorker.js',
	bundle: true,
	external: ['vscode'],
	format: 'iife',
	target: 'es2020',
	platform: 'node'
}).catch(console.error);


Promise.all([webExtension, webWorker, desktopExtension, desktopWorker]).catch(console.error);