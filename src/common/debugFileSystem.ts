/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vscode-uri';

import {
	ApiClient, BaseFileDescriptor, DeviceIds, Errno, fd, fdflags, fdstat, FileDescriptor, filestat, FileSystemDeviceDriver, Filetype, filetype,
	lookupflags, NoSysDeviceDriver, oflags, RAL, Rights, rights, size, WasiError
} from '@vscode/wasm-wasi';

class DebugFileDescriptor extends BaseFileDescriptor {

	public readonly path: string;

	constructor(deviceId: bigint, fd: fd, filetype: filetype, rights_base: rights, rights_inheriting: rights, fdflags: fdflags, inode: bigint, path: string) {
		super(deviceId, fd, filetype, rights_base, rights_inheriting, fdflags, inode);
		this.path = path;
	}
}

export function create(apiClient: ApiClient, textEncoder: RAL.TextEncoder, fileDescriptorId: { next(): number }, mainContent: string, uri: URI): FileSystemDeviceDriver {

	const deviceId = DeviceIds.next();
	const fileDescriptorParams: Map<string, [filetype, rights /* base */, rights /* inheriting */, fdflags, bigint /* inode */ ]> = new Map([
		['/', [Filetype.directory, Rights.DirectoryBase, Rights.DirectoryInheriting, 0,  0n]],
		['/main.py', [Filetype.regular_file, Rights.FileBase, Rights.FileInheriting, 0,  1n]],
		['/input', [Filetype.character_device, Rights.CharacterDeviceBase, Rights.CharacterDeviceInheriting, 0,  2n]],
		['/output', [Filetype.character_device, Rights.CharacterDeviceBase, Rights.CharacterDeviceInheriting, 0,  3n]],
	]);
	const preOpenDirectories: string[] = ['/'];

	function createFileDescriptor(fd: fd, filetype: filetype, rights_base: rights, rights_inheriting: rights, fdflags: fdflags, inode: bigint, path: string): DebugFileDescriptor {
		return new DebugFileDescriptor(deviceId, fd, filetype, rights_base, rights_inheriting, fdflags, inode, path);
	}

	function assertFileDescriptor(fileDescriptor: FileDescriptor): asserts fileDescriptor is DebugFileDescriptor {
		if (!(fileDescriptor instanceof DebugFileDescriptor)) {
			throw new WasiError(Errno.badf);
		}
	}

	function assertDirectoryDescriptor(fileDescriptor: FileDescriptor): asserts fileDescriptor is DebugFileDescriptor {
		if (!(fileDescriptor instanceof DebugFileDescriptor) || fileDescriptor.fileType !== Filetype.directory) {
			throw new WasiError(Errno.badf);
		}
	}

	return Object.assign({}, NoSysDeviceDriver, {
		id: deviceId,
		createStdioFileDescriptor(): FileDescriptor {
			throw new WasiError(Errno.nosys);
		},
		fd_prestat_get(fd: fd): [string, FileDescriptor] | undefined {
			const next = preOpenDirectories.shift();
			if (next === undefined) {
				return undefined;
			}
			const params = fileDescriptorParams.get(next);
			if (params === undefined) {
				throw new WasiError(Errno.noent);
			}
			return [
				next,
				createFileDescriptor(fd, ...params, next)
			];
		},
		path_open(parentDescriptor: FileDescriptor, _dirflags: lookupflags, path: string, _oflags: oflags, fs_rights_base: rights, fs_rights_inheriting: rights, fdflags: fdflags): FileDescriptor {
			assertDirectoryDescriptor(parentDescriptor);

			if (path === '.') {
				path = parentDescriptor.path;
			}

			const params = fileDescriptorParams.get(path);
			if (params === undefined) {
				throw new WasiError(Errno.noent);
			}
			return createFileDescriptor(fileDescriptorId.next(), params[0], params[1] | fs_rights_base, params[2] | fs_rights_inheriting, params[3], params[4], path);
		},
		fd_fdstat_get(fileDescriptor: FileDescriptor, result: fdstat): void {
			result.fs_filetype = fileDescriptor.fileType;
			result.fs_flags = fileDescriptor.fdflags;
			result.fs_rights_base = fileDescriptor.rights_base;
			result.fs_rights_inheriting = fileDescriptor.rights_inheriting;
		},
		fd_filestat_get(fileDescriptor: FileDescriptor, result: filestat): void {
			result.dev = fileDescriptor.deviceId;
			result.ino = fileDescriptor.inode;
			result.filetype = Filetype.character_device;
			result.nlink = 0n;
			result.size = 101n;
			const now = BigInt(Date.now());
			result.atim = now;
			result.ctim = now;
			result.mtim = now;
		},
		fd_read(fileDescriptor: FileDescriptor, buffers: Uint8Array[]): size {
			if (buffers.length === 0) {
				return 0;
			}
			assertFileDescriptor(fileDescriptor);
			const maxBytesToRead = buffers.reduce<number>((prev, current) => prev + current.length, 0);
			let content: Uint8Array | undefined;
			if (fileDescriptor.path === '/input') {
				content = apiClient.byteSource.read(uri, maxBytesToRead);
			} else if (fileDescriptor.path === 'main.py') {
				content = textEncoder.encode(mainContent);
			}
			if (content === undefined) {
				throw new WasiError(Errno.badf);
			}
			let offset = 0;
			let totalBytesRead = 0;
			for (const buffer of buffers) {
				const toCopy = Math.min(buffer.length, content.length - offset);
				buffer.set(content.subarray(offset, toCopy));
				offset += toCopy;
				totalBytesRead += toCopy;
				if (toCopy < buffer.length) {
					break;
				}
			}
			return totalBytesRead;
		},
		fd_write(fileDescriptor: FileDescriptor, buffers: Uint8Array[]): size {
			assertFileDescriptor(fileDescriptor);

			if (fileDescriptor.path !== '/output') {
				throw new WasiError(Errno.badf);
			}
			let buffer: Uint8Array;
			if (buffers.length === 1) {
				buffer = buffers[0];
			} else {
				const byteLength: number = buffers.reduce<number>((prev, current) => prev + current.length, 0);
				buffer = new Uint8Array(byteLength);
				let offset = 0;
				for (const item of buffers) {
					buffer.set(item, offset);
					offset = item.byteLength;
				}
			}
			apiClient.byteSink.write(uri, buffer);
			return buffer.byteLength;
		}
	});
}