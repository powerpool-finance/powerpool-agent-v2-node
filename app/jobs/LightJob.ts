import { AbstractJob } from './AbstractJob.js';
import logger from '../services/Logger.js';

export class LightJob extends AbstractJob {
  protected clog(level: string, ...args) {
    logger.log(level, `LightJob${this.toString()}: ${args.join(' ')}`);
  }
  protected err(...args): Error {
    return new Error(`LightJobError${this.toString()}: ${args.join(' ')}`);
  }

  protected _beforeJobWatch(): boolean {
    if (this.getCreditsAvailable() === 0n) {
      this.clog('debug', 'Ignoring a job with 0 credits');
      return false;
    }
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected _afterApplyJob(): void {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected _watchIntervalJob(): void {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected intervalJobAvailableCallback(_blockNumber: number) {}

  protected async resolverSuccessCallback(triggeredByBlockNumber, invokeCalldata) {
    this.agent.unregisterResolver(this.key);
    return this.executeTx(this.key, await this.agent.buildTx(this.buildResolverCalldata(invokeCalldata)));
  }
}
