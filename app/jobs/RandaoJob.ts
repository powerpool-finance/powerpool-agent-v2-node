import { AbstractJob } from './AbstractJob.js';
import {nowTimeString, parseConfig} from '../Utils.js';
import { GetJobResponse, IRandaoAgent, JobType } from '../Types.js';
import { BigNumber } from 'ethers';

export class RandaoJob extends AbstractJob {
  protected assignedKeeperId: number;
  protected createdAt: number;
  protected reservedSlasherId: number;
  protected slashingPossibleAfter: number;

  protected clog(...args) {
    console.log(`>>> ${nowTimeString()} >>> RandaoJob${this.toString()}:`, ...args);
  }
  protected err(...args): Error {
    return new Error(`RandaoJobError${this.toString()}: ${args.join(' ')}`);
  }

  public applyKeeperAssigned(keeperId: number) {
    console.log(this.key, 'keeperID update ✅✅✅✅✅✅✅✅✅✅✅✅✅', this.assignedKeeperId, '->', keeperId);
    this.assignedKeeperId = keeperId;
  }

  public applyJob(job: GetJobResponse, source?: string): boolean {
    if (source === 'blockchain') {
      this.resolver = {resolverAddress: job.resolver.resolverAddress, resolverCalldata: job.resolver.resolverCalldata};
      this.details = job.details;
      this.owner = job.owner;
      this.config = parseConfig(BigNumber.from(job.details.config));
      if (Array.isArray(this.details)) {
        throw new Error('details are an array')
      }
      this._afterApplyJob(job);
    } else {
      //
    }
    return true;
  }

  private intervalPeriod2StartsAt(): number {
    if (this.details.intervalSeconds === 0) {
      throw this.err(`Unexpected slashingAvailableTimestamp() callback for job ${this.key}`);
    }

    return this.details.lastExecutionAt + this.details.intervalSeconds + (this.agent as IRandaoAgent).getPeriod1Duration();
  }

  protected _beforeJobWatch(): boolean {
    return this.assignedKeeperId !== 0;
  }

  protected _afterJobWatch(): void {
  }

  protected _afterApplyJob(job: GetJobResponse): void {
    this.assignedKeeperId = parseInt(job.randaoData.jobNextKeeperId.toString());
    this.createdAt = parseInt(job.randaoData.jobCreatedAt.toString());
    this.reservedSlasherId = parseInt(job.randaoData.jobReservedSlasherId.toString());
    this.slashingPossibleAfter = parseInt(job.randaoData.jobSlashingPossibleAfter.toString());
  }

  protected _unwatchIntervalJob(): void {
    super._unwatchIntervalJob();
    (this.agent as IRandaoAgent).unregisterIntervalJobSlashing(this.key);
  }

  protected _watchIntervalJob(): void {
    super._watchIntervalJob();
    (this.agent as IRandaoAgent).registerIntervalJobSlashing(
      this.key, this.intervalPeriod2StartsAt(), this.intervalJobSlashingAvailableCallback.bind(this));
  }

  protected async intervalJobAvailableCallback(blockNumber: number) {
    if (this.assignedKeeperId === this.agent.getKeeperId()) {
      console.log('job callback', this.key, blockNumber, {assigned: this.assignedKeeperId, me: this.agent.getKeeperId()});
      this.agent.unregisterIntervalJobExecution(this.key);
      return this.executeTx(
        this.key,
        await this.buildTx(
          this.buildIntervalCalldata()
        )
      );
    }
  }

  private async intervalJobSlashingAvailableCallback(blockNumber: number) {
    // WARNING: Either `rdConfig.slashingEpochBlocks` or `totalActiveKeepers` can affect the actual keeper id
    // that will be in the previous block
    const res = await this.agent.getNetwork().getExternalLensContract()
      .ethCall('getJobBytes32AndNextBlockSlasherId', [this.agentAddress, this.key]);

    // const nextBlockNumber = res.nextBlockNumber.toNumber();
    const nextBlockSlasherId = res.nextBlockSlasherId.toNumber();
    const binJob = res.binJob;

    this.applyBinJobData(binJob);
    if (this.agent.getKeeperId() === nextBlockSlasherId) {
      this.unwatch();
      return this.executeTx(
        this.key,
        await this.buildTx(
          this.buildIntervalCalldata()
        )
      );
    } else {
      this.clog('Slasher is not me', { nextBlockSlasherId, me: this.agent.getKeeperId() });
    }
  }
}
