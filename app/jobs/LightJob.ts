import { AbstractJob } from './AbstractJob.js';
import { nowTimeString } from '../Utils.js';

export class LightJob extends AbstractJob {
  protected clog(...args) {
    console.log(`>>> ${nowTimeString()} >>> LightJob${this.toString()}:`, ...args);
  }
  protected err(...args): Error {
    return new Error(`LightJobError${this.toString()}: ${args.join(' ')}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected _afterApplyJob(): void {
  }

  protected intervalJobAvailableCallback(_blockNumber: number) {
  }
  protected beforeJobWatch(): boolean {
    return true;
  }
}
