import { AbstractJob } from './AbstractJob.js';
import { nowTimeString } from '../Utils.js';
import { GetJobResponse, JobType } from "../Types";

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

  public applyKeeperRemoved() {
    console.log(this.key, 'keeperID remove 🧱🧱🧱🧱🧱🧱🧱🧱🧱🧱🧱🧱🧱', this.assignedKeeperId, '->', 0);
    this.assignedKeeperId = 0;
  }

  protected async intervalJobSlashingAvailableCallback() {
  }

  private nextSlashingTimestamp(): number {
    if (this.details.intervalSeconds === 0) {
      throw this.err(`Unexpected nextSlashingTimestamp() callback for job ${this.key}`);
    }

    return this.details.lastExecutionAt + this.details.intervalSeconds;
  }

  protected _afterApplyJob(job: GetJobResponse): void {
    this.assignedKeeperId = parseInt(job.randaoData.jobNextKeeperId.toString());
    this.createdAt = parseInt(job.randaoData.jobCreatedAt.toString());
    this.reservedSlasherId = parseInt(job.randaoData.jobReservedSlasherId.toString());
    this.slashingPossibleAfter = parseInt(job.randaoData.jobSlashingPossibleAfter.toString());
  }

  protected async intervalJobAvailableCallback(blockNumber: number) {
    console.log('job callback', this.key, blockNumber, {assigned: this.assignedKeeperId, me: this.agent.getKeeperId()});
    if (this.assignedKeeperId === this.agent.getKeeperId()) {
      this.agent.unregisterIntervalJobExecution(this.key);
      return this.executeTx(
        this.key,
        await this.buildTx(
          this.buildIntervalCalldata()
        )
      );
    }
  }

  protected beforeJobWatch(): boolean {
    return this.assignedKeeperId !== 0;
  }
}
