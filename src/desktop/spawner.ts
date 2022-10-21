import { ChildProcess, spawn } from 'child_process';
import { TextDecoder } from 'util';
import { extensions } from 'vscode';
import { BaseSpawnee, Spawnee, Spawner } from '../common/spawner';

class NodeDesktopSpawnee extends BaseSpawnee implements Spawnee {
	_textDecoder = new TextDecoder();

	constructor(private readonly process: ChildProcess) {
		super();
		process.stdout?.on('data', this._decodeAndFire.bind(this, this.fireStdout.bind(this)));
		process.stderr?.on('data', this._decodeAndFire.bind(this, this.fireStderr.bind(this)));
		process.on('exit', this._exitEmitter.fire.bind(this._exitEmitter));
	}
	stdin(data: string): void {
		const result = this.process.stdin?.write(data);
		if (!result) {
			this.process.stdin?.once('drain', () => {
				this.process.stdin?.write(data);
			});
		}
	}
	get killed(): boolean {
		return this.process.killed;
	}
	kill(): void {
		this.process.kill();
	}
	_decodeData(data: Buffer) {
		return this._textDecoder.decode(data);
	}
	_decodeAndFire(fire: (s: string) => void, data: Buffer) {
		fire(this._decodeData(data));
	}

}

export class DesktopSpawner implements Spawner {
	async spawn(args: string[], cwd: string | undefined): Promise<Spawnee> {
		// Find python using the python extension if it's installed
		const python = await this._computePythonPath();

		// For now use node. Switch this to wasm later (or add both)
		return new NodeDesktopSpawnee(spawn(python, args, {cwd}));
	}

	async _computePythonPath() {
		// Use the python extension's current python if available
		const python = extensions.getExtension('ms-python.python');
		let pythonPath = `python`;
		if (python) {
			const api = await python.activate();
			if (api.settings?.getExecutionDetails) {
				const details = api.settings.getExecutionDetails();
				pythonPath = details.execCommand[0];
			}
		}
		return pythonPath;
	}


}