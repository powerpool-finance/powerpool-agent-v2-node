import { AbstractJob } from './AbstractJob.js';
import { nowTimeString } from '../Utils.js';

export class LightJob extends AbstractJob {
  protected clog(...args) {
    console.log(`>>> ${nowTimeString()} >>> LightJob${this.toString()}:`, ...args);
  }
  protected err(...args): Error {
    return new Error(`LightJobError${this.toString()}: ${args.join(' ')}`);
  }

  protected _beforeJobWatch(): boolean {
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected _afterApplyJob(): void {
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected _watchIntervalJob(): void {
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected intervalJobAvailableCallback(_blockNumber: number) {
  }
}
