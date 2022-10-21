import { BaseSpawnee, Spawnee, Spawner } from '../common/spawner';

class WebSpawnee extends BaseSpawnee implements Spawnee {
	_textDecoder = new TextDecoder();

	constructor(private readonly worker: Worker) {
		super();
		// TODO: Wire up writes to the stdout/stdin mocks for pdb to 
		// these events
	}
	stdin(data: string): void {
		// TODO: Wire up writes to the stdout/stdin mocks for pdb to 
		// these events
	}
	get killed(): boolean {
		return false;
	}
	kill(): void {
		this.worker.terminate();
	}

}

export class WebSpawner implements Spawner {
	async spawn(args: string[], cwd: string | undefined): Promise<Spawnee> {
		// TODO: Spawn a worker that loads pdb and the file. Args should
		// be passable to a python.js
		return new WebSpawnee(new Worker(''));
	}
}