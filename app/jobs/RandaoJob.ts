import { AbstractJob } from './AbstractJob.js';
import { nowS, nowTimeString } from '../Utils.js';
import { GetJobResponse, IRandaoAgent, JobType, TxGasUpdate } from '../Types.js';

export class RandaoJob extends AbstractJob {
  protected assignedKeeperId: number;
  protected createdAt: number;
  protected reservedSlasherId: number;
  protected slashingPossibleAfter: number;
  private selfUnassignPending: boolean;

  protected clog(...args) {
    console.log(`>>> ${nowTimeString()} >>> RandaoJob${this.toString()}:`, ...args);
  }
  protected err(...args): Error {
    return new Error(`RandaoJobError${this.toString()}: ${args.join(' ')}`);
  }

  public applyKeeperAssigned(keeperId: number) {
    console.log(this.key, 'keeperID update ✅✅✅✅✅✅✅✅✅✅✅✅✅', this.assignedKeeperId, '->', keeperId);
    if (keeperId === 0) {
      this.selfUnassignPending = false;
    }
    this.assignedKeeperId = keeperId;
  }

  private intervalPeriod2StartsAt(): number {
    if (this.details.intervalSeconds === 0) {
      throw this.err(`Unexpected slashingAvailableTimestamp() callback for job ${this.key}`);
    }

    return this.details.lastExecutionAt + this.details.intervalSeconds + (this.agent as IRandaoAgent).getPeriod1Duration();
  }

  protected _beforeJobWatch(): boolean {
    if (this.assignedKeeperId === 0) {
      return false;
    }
    return true;
  }

  protected _afterJobWatch(): void {
  }

  private _selfUnassign(): void {
    this.selfUnassignPending = true;
    return (this.agent as IRandaoAgent).selfUnassignFromJob(this.key)
  }

  // Should return 0, 1, 2, or 3.
  private _getCurrentPeriod(): number {
    const now = nowS();

    if (now < this.details.lastExecutionAt + this.details.intervalSeconds) {
      return 0;
    } else if (now < this.details.lastExecutionAt + this.details.intervalSeconds + (this.agent as IRandaoAgent).getPeriod1Duration()) {
      return 1;
    } else if (now < this.details.lastExecutionAt + this.details.intervalSeconds + (this.agent as IRandaoAgent).getPeriod1Duration()
      + (this.agent as IRandaoAgent).getPeriod2Duration()) {
      return 2;
    }

    return 3;
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

  protected _txEstimationFailed(): void {
    if (!this.selfUnassignPending && this._getCurrentPeriod() === 3) {
      this._selfUnassign();
    }
  }

  protected _txExecutionFailed(): void {
    if (!this.selfUnassignPending && this._getCurrentPeriod() === 3) {
      this._selfUnassign();
    }
  }

  protected async intervalJobAvailableCallback(blockNumber: number) {
    console.log('@@@ available, assigned/me/matches', this.key, this.assignedKeeperId, this.agent.getKeeperId(), this.assignedKeeperId === this.agent.getKeeperId());
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
    console.log('@@@ slashing, assigned/me/matches', this.key, this.assignedKeeperId, this.agent.getKeeperId(), this.assignedKeeperId === this.agent.getKeeperId());
    // WARNING: Either `rdConfig.slashingEpochBlocks` or `totalActiveKeepers` can affect the actual keeper id
    // that will be in the previous block
    const res = await this.agent.getNetwork().getExternalLensContract()
      .ethCall('getJobBytes32AndNextBlockSlasherId', [this.agentAddress, this.key]);

    // const nextBlockNumber = res.nextBlockNumber.toNumber();
    const nextBlockSlasherId = res.nextBlockSlasherId.toNumber();
    console.log('@@@ slashing, next slasher', this.key, nextBlockSlasherId);
    const binJob = res.binJob;

    this.applyBinJobData(binJob);
    if (this.agent.getKeeperId() === this.assignedKeeperId) {
      this.clog('Wont slash mine job', { nextBlockSlasherId, me: this.agent.getKeeperId() });
    } else if (this.agent.getKeeperId() === nextBlockSlasherId) {
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
