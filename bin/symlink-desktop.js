/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@ts-check

'use strict';

const path = require('path');
const ln = require('./linking');

const root = path.dirname(__dirname);

(async function main() {
	console.log('Symlinking dist to out for desktop execution');

	await ln.softLink(path.join(root, 'out', 'desktop'), path.join(root, 'dist', 'desktop'));
})();