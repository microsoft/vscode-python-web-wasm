/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vscode-uri';

import {
	ApiClient, BaseFileDescriptor, BigInts, DeviceIds, Errno, fd, fdflags, fdstat, FileDescriptor, filestat, FileSystemDeviceDriver, Filetype, filetype,
	lookupflags, NoSysDeviceDriver, oflags, RAL, Rights, rights, size, WasiError, Whence
} from '@vscode/wasm-wasi';

class DebugFileDescriptor extends BaseFileDescriptor {

	public readonly path: string;

	constructor(deviceId: bigint, fd: fd, filetype: filetype, rights_base: rights, rights_inheriting: rights, fdflags: fdflags, inode: bigint, path: string) {
		super(deviceId, fd, Filetype.character_device, rights_base, rights_inheriting, fdflags, inode);
		this.path = path;
	}
}

class DebugCharacterDeviceFD extends DebugFileDescriptor {

	constructor(deviceId: bigint, fd: fd, rights_base: rights, rights_inheriting: rights, fdflags: fdflags, inode: bigint, path: string) {
		super(deviceId, fd, Filetype.character_device, rights_base, rights_inheriting, fdflags, inode, path);
	}
}

class DebugDirectoryFD extends DebugFileDescriptor {

	constructor(deviceId: bigint, fd: fd, rights_base: rights, rights_inheriting: rights, fdflags: fdflags, inode: bigint, path: string) {
		super(deviceId, fd, Filetype.directory, rights_base, rights_inheriting, fdflags, inode, path);
	}
}

class DebugFileFD extends DebugFileDescriptor {

	public cursor: number;

	constructor(deviceId: bigint, fd: fd, rights_base: rights, rights_inheriting: rights, fdflags: fdflags, inode: bigint, path: string) {
		super(deviceId, fd, Filetype.regular_file, rights_base, rights_inheriting, fdflags, inode, path);
		this.cursor = 0;
	}
}

export function create(apiClient: ApiClient, textEncoder: RAL.TextEncoder, fileDescriptorId: { next(): number }, posix_path: { readonly join: (...paths: string[]) => string, readonly sep: string }, uri: URI, mainContent: string): FileSystemDeviceDriver {

	const mainContentBytes = textEncoder.encode(mainContent);

	const deviceId = DeviceIds.next();
	const fileDescriptorParams: Map<string, [filetype, rights /* base */, rights /* inheriting */, fdflags, bigint /* inode */ ]> = new Map([
		['/', [Filetype.directory, Rights.DirectoryBase, Rights.DirectoryInheriting, 0,  0n]],
		['/main.py', [Filetype.regular_file, Rights.FileBase, Rights.FileInheriting, 0,  1n]],
		['/input', [Filetype.character_device, Rights.CharacterDeviceBase, Rights.CharacterDeviceInheriting, 0,  2n]],
		['/output', [Filetype.character_device, Rights.CharacterDeviceBase, Rights.CharacterDeviceInheriting, 0,  3n]],
	]);
	const preOpenDirectories: string[] = ['/$debug'];

	function createCharacterDeviceFD(fd: fd, rights_base: rights, rights_inheriting: rights, fdflags: fdflags, inode: bigint, path: string): DebugCharacterDeviceFD {
		return new DebugCharacterDeviceFD(deviceId, fd, rights_base, rights_inheriting, fdflags, inode, path);
	}

	function createDirectoryFD(fd: fd, rights_base: rights, rights_inheriting: rights, fdflags: fdflags, inode: bigint, path: string): DebugDirectoryFD {
		return new DebugDirectoryFD(deviceId, fd, rights_base, rights_inheriting, fdflags, inode, path);
	}

	function createFileFD(fd: fd, rights_base: rights, rights_inheriting: rights, fdflags: fdflags, inode: bigint, path: string): DebugFileFD {
		return new DebugFileFD(deviceId, fd, rights_base, rights_inheriting, fdflags, inode, path);
	}

	function createFileDescriptor(fd: fd, fs_rights_base: rights, fs_rights_inheriting: rights, filePath: string): BaseFileDescriptor {
		const params = fileDescriptorParams.get(filePath);
		if (params === undefined) {
			throw new WasiError(Errno.noent);
		}
		switch (params[0]) {
			case Filetype.character_device:
				return createCharacterDeviceFD(fd, params[1] | fs_rights_base, params[2] | fs_rights_inheriting, params[3], params[4], filePath);
			case Filetype.directory:
				return createDirectoryFD(fd, params[1] | fs_rights_base, params[2] | fs_rights_inheriting, params[3], params[4], filePath);
			case Filetype.regular_file:
				return createFileFD(fd, params[1] | fs_rights_base, params[2] | fs_rights_inheriting, params[3], params[4], filePath);
		}
		throw new WasiError(Errno.noent);
	}

	function assertDebugFileDescriptor(fileDescriptor: FileDescriptor): asserts fileDescriptor is DebugFileDescriptor {
		if (!(fileDescriptor instanceof DebugFileDescriptor)) {
			throw new WasiError(Errno.badf);
		}
	}

	function assertCharacterDevice(fileDescriptor: FileDescriptor): asserts fileDescriptor is DebugCharacterDeviceFD {
		if (!(fileDescriptor instanceof DebugCharacterDeviceFD)) {
			throw new WasiError(Errno.badf);
		}
	}

	function assertDirectory(fileDescriptor: FileDescriptor): asserts fileDescriptor is DebugDirectoryFD {
		if (!(fileDescriptor instanceof DebugDirectoryFD)) {
			throw new WasiError(Errno.badf);
		}
	}

	function assertFile(fileDescriptor: FileDescriptor): asserts fileDescriptor is DebugFileFD {
		if (!(fileDescriptor instanceof DebugFileFD)) {
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
			return [
				next,
				createFileDescriptor(fd, 0n, 0n, '/')
			];
		},
		path_open(parentDescriptor: FileDescriptor, _dirflags: lookupflags, path: string, _oflags: oflags, fs_rights_base: rights, fs_rights_inheriting: rights, fdflags: fdflags): FileDescriptor {
			assertDirectory(parentDescriptor);

			const filePath = posix_path.join(parentDescriptor.path, path);
			return createFileDescriptor(fileDescriptorId.next(), fs_rights_base, fs_rights_inheriting, filePath);
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
			result.filetype = fileDescriptor.fileType;
			result.nlink = 0n;
			const now = BigInt(Date.now());
			result.atim = now;
			result.ctim = now;
			result.mtim = now;
			if (fileDescriptor instanceof DebugCharacterDeviceFD) {
				result.size = 101n;
			} else if (fileDescriptor instanceof DebugFileFD) {
				result.size = BigInt(mainContentBytes.byteLength);
			} else {
				result.size = 0n;
			}
		},
		fd_seek(fileDescriptor: FileDescriptor, _offset: bigint, whence: number): bigint {
			// we can't really seek on the input / output character device.
			if (fileDescriptor instanceof DebugCharacterDeviceFD) {
				return _offset;
			}
			assertFile(fileDescriptor);

			const offset = BigInts.asNumber(_offset);
			switch(whence) {
				case Whence.set:
					fileDescriptor.cursor = offset;
					break;
				case Whence.cur:
					fileDescriptor.cursor = fileDescriptor.cursor + offset;
					break;
				case Whence.end:
					fileDescriptor.cursor = Math.max(0, mainContentBytes.byteLength - offset);
					break;
			}
			return BigInt(fileDescriptor.cursor);
		},
		fd_read(fileDescriptor: FileDescriptor, buffers: Uint8Array[]): size {
			if (buffers.length === 0) {
				return 0;
			}
			const maxBytesToRead = buffers.reduce<number>((prev, current) => prev + current.length, 0);
			let content: Uint8Array | undefined;
			let offset: number | undefined;
			let fileFD: DebugFileFD | undefined;
			assertDebugFileDescriptor(fileDescriptor);
			if (fileDescriptor.path === '/input') {
				content = apiClient.byteSource.read(uri, maxBytesToRead);
				offset = 0;
			} else if (fileDescriptor.path === '/main.py') {
				assertFile(fileDescriptor);
				fileFD = fileDescriptor;
				content = textEncoder.encode(mainContent);
				offset= fileDescriptor.cursor;
			}
			if (content === undefined || offset === undefined) {
				throw new WasiError(Errno.badf);
			}
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
			if (fileFD !== undefined) {
				fileFD.cursor = fileFD.cursor + totalBytesRead;
			}
			return totalBytesRead;
		},
		fd_write(fileDescriptor: FileDescriptor, buffers: Uint8Array[]): size {
			assertCharacterDevice(fileDescriptor);

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
		},
		fd_close(_fileDescriptor: FileDescriptor): void {
		},
	});
}