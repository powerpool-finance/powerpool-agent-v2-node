import { AbstractJob } from './AbstractJob.js';
import { EventWrapper, GetJobResponse, IAgent, IRandaoAgent } from '../Types.js';
import logger from '../services/Logger.js';

export class RandaoJob extends AbstractJob {
  private BLACKLIST_ESTIMATIONS_LIMIT = 5;

  public assignedKeeperId: number;
  protected createdAt: number;
  protected reservedSlasherId: number;
  protected slashingPossibleAfter: number;
  private _selfUnassignPending: boolean;
  private _initiateSlashingPending: boolean;
  private failedInitiateSlashingEstimationsInARow: number;

  protected clog(level: string, ...args) {
    logger.log(level, `RandaoJob${this.toString()}: ${args.join(' ')}`);
  }
  protected err(...args): Error {
    return new Error(`RandaoJobError${this.toString()}: ${args.join(' ')}`);
  }

  constructor(creationEvent: EventWrapper, agent: IAgent) {
    super(creationEvent, agent);
    this._initiateSlashingPending = false;
    this.failedInitiateSlashingEstimationsInARow = 0;
  }

  private _lockSelfUnassign() {
    this.clog('debug', '_lockSelfUnassign()');
    this._selfUnassignPending = true;
  }

  private _unlockSelfUnassign() {
    this.clog('debug', '_releaseSelfUnassign()');
    this._selfUnassignPending = false;
  }

  private _lockInitiateSlashing() {
    this.clog('debug', '_lockInitiateSlashing()');
    this._initiateSlashingPending = true;
  }

  private _unlockInitiateSlashing() {
    this.clog('debug', '_unlockInitiateSlashing()');
    this._initiateSlashingPending = false;
  }

  public getStatusObjectForApi(): object {
    let canInitiateSlashingIn = 0;
    if (this.t1) {
      const period1 = (this.agent as IRandaoAgent).getPeriod1Duration();
      const now = this.agent.nowS();
      canInitiateSlashingIn = this.t1 + period1 - now;
    }
    const obj = Object.assign(super.getStatusObjectForApi(), {
      jobRandaoFields: {
        currentPeriod: this._getCurrentPeriod(),
        t1: this.t1,
        b1: this.b1,
        tn: this.tn,
        bn: this.bn,
        assignedKeeperIsMe: this.assignedKeeperId === this.agent.getKeeperId(),
        assignedKeeperId: this.assignedKeeperId,
        reservedSlasherId: this.reservedSlasherId,
        slashingPossibleAfter: this.slashingPossibleAfter,
        failedEstimationsInARow: this.failedExecuteEstimationsInARow,
        failedInitiateSlashingEstimationsInARow: this.failedInitiateSlashingEstimationsInARow,
        selfUnassignPending: !!this._selfUnassignPending,
        initiateSlashingPending: !!this._initiateSlashingPending,
        canInitiateSlashingIn,

        createdAt: this.createdAt,
      },
    });
    if (this.isIntervalJob()) {
      obj['intervalPeriod2StartsAt'] = this.intervalPeriod2StartsAt();
    }
    return obj;
  }

  // true if it should update binJob
  public applyKeeperAssigned(keeperId: number): boolean {
    this.clog('info', 'keeperID update:', this.assignedKeeperId, '->', keeperId);
    if (keeperId === 0) {
      this._unlockSelfUnassign();
    }
    const prevAssignedKeeperId = this.assignedKeeperId;
    this.assignedKeeperId = keeperId;
    if (prevAssignedKeeperId === 0) {
      // When keeper is assigned again for an interval job it should update binJob before watching
      return this.isIntervalJob();
    }
    return false;
  }

  public applyInitiateKeeperSlashing(jobSlashingPossibleAfter: number, slasherKeeperId: number) {
    this.slashingPossibleAfter = jobSlashingPossibleAfter;
    this.reservedSlasherId = slasherKeeperId;
  }

  public applySlashKeeper() {
    this.slashingPossibleAfter = 0;
    this.reservedSlasherId = 0;
  }

  public applyClearResolverTimeouts(): void {
    this.t1 = 0;
    this.b1 = 0n;
    this.tn = 0;
    this.bn = 0n;
    this._unlockInitiateSlashing();
  }

  protected nextExecutionTimestamp(): number {
    if (this.details.intervalSeconds === 0) {
      throw this.err(`Unexpected nextExecutionTimestamp() callback for job ${this.key}`);
    }

    return (this.details.lastExecutionAt || this.createdAt) + this.details.intervalSeconds;
  }

  private intervalPeriod2StartsAt(): number {
    if (this.details.intervalSeconds === 0) {
      throw this.err(`Unexpected slashingAvailableTimestamp() callback for job ${this.key}`);
    }

    return (
      (this.details.lastExecutionAt || this.createdAt) +
      this.details.intervalSeconds +
      (this.agent as IRandaoAgent).getPeriod1Duration()
    );
  }

  protected _beforeJobWatch(): boolean {
    if (this.assignedKeeperId === 0) {
      this.clog('debug', '_beforeJobWatch(): assignedKeeper is 0');
      return false;
    }
    if (this.getCreditsAvailable() < (this.agent as IRandaoAgent).getJobMinCredits()) {
      this.clog(
        'warn',
        `_beforeJobWatch(): Scheduling self-unassign due insufficient credits (required=${(
          this.agent as IRandaoAgent
        ).getJobMinCredits()},available=${this.getCreditsAvailable()}`,
      );
      this._selfUnassign();
      return false;
    }
    return true;
  }

  protected _afterJobWatch(): void {}

  private _selfUnassign(): void {
    if (this._selfUnassignPending) {
      this.clog('debug', 'Self-Unassign is already pending...');
      return;
    }
    if (this.assignedKeeperId !== this.agent.getKeeperId()) {
      return;
    }

    this._lockSelfUnassign();
    return (this.agent as IRandaoAgent).selfUnassignFromJob(this.key);
  }

  private exitIfStrictTopic(topic) {
    this.agent.exitIfStrictTopic(topic);
  }

  private async _initiateSlashingIncrementFailedCounter() {
    // TODO: implement interval job counter
    if (this.isResolverJob()) {
      this.failedInitiateSlashingEstimationsInARow += 1;

      if (this.failedInitiateSlashingEstimationsInARow > this.BLACKLIST_ESTIMATIONS_LIMIT) {
        this.applyClearResolverTimeouts();
        this.agent.addJobToBlacklist(this.key);
        this.failedInitiateSlashingEstimationsInARow = 0;
      } else {
        this._unlockInitiateSlashing();
      }
    }

    this.watch();
  }

  private async initiateSlashing(resolverCalldata) {
    const txEstimationFailed = () => {
      this.clog('error', 'InitiateSlashing() estimation failed');
      this.exitIfStrictTopic('estimations');
      this._initiateSlashingIncrementFailedCounter();
    };
    const txExecutionFailed = () => {
      this.clog('error', 'InitiateSlashing() execution failed');
      this.exitIfStrictTopic('executions');
      this._initiateSlashingIncrementFailedCounter();
    };
    if (this._initiateSlashingPending) {
      this.clog('debug', 'Slashing is already pending...');
      return;
    } else {
      this.clog('info', 'initiateSlashing()');
      this._lockInitiateSlashing();
    }
    return (this.agent as IRandaoAgent).initiateKeeperSlashing(this.address, this.id, this.key, resolverCalldata, {
      txEstimationFailed,
      txExecutionFailed,
      txNotMinedInBlock: this.agent.txNotMinedInBlock.bind(this.agent),
    });
  }

  // Should return 0, 1, 2, or 3.
  private _getCurrentPeriod(): number {
    if (this.isIntervalJob()) {
      return this._getCurrentPeriodIntervalJob();
    } else {
      return this._getCurrentPeriodResolverJob();
    }
  }

  private _getCurrentPeriodIntervalJob(): number {
    const now = this.agent.nowS();

    if (now < this.details.lastExecutionAt + this.details.intervalSeconds) {
      return 0;
    } else if (
      now <
      this.details.lastExecutionAt + this.details.intervalSeconds + (this.agent as IRandaoAgent).getPeriod1Duration()
    ) {
      return 1;
    } else if (
      now <
      this.details.lastExecutionAt +
        this.details.intervalSeconds +
        (this.agent as IRandaoAgent).getPeriod1Duration() +
        (this.agent as IRandaoAgent).getPeriod2Duration()
    ) {
      return 2;
    }

    return 3;
  }

  private _getCurrentPeriodResolverJob(): number {
    const now = this.agent.nowS();

    if (this.slashingPossibleAfter === 0) {
      return 0;
    }

    if (now < this.slashingPossibleAfter) {
      return 1;
    }

    if (now < this.slashingPossibleAfter + (this.agent as IRandaoAgent).getPeriod2Duration()) {
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
    (this.agent as IRandaoAgent).unregisterJobSlashingTimeout(this.key);
  }

  protected _watchIntervalJob(): void {
    super._watchIntervalJob();
    (this.agent as IRandaoAgent).registerJobSlashingTimeout(
      this.key,
      this.intervalPeriod2StartsAt(),
      this.intervalJobSlashingAvailableCallback.bind(this),
    );
  }

  protected _watchResolverJob(): void {
    super._watchResolverJob();
  }

  protected _executeTxEstimationFailed(_txData: string): void {
    if (this._getCurrentPeriod() === 3) {
      this.clog('info', 'Scheduling self-unassign since the current period is #3...');
      this._selfUnassign();
      this.watch();
      return;
    }

    if (this.isResolverJob()) {
      // Assume that a failed execution behaviour is equal to a failed estimation
      this.failedExecuteEstimationsInARow += 1;
      if (this.failedExecuteEstimationsInARow > this.BLACKLIST_ESTIMATIONS_LIMIT) {
        this.agent.addJobToBlacklist(this.key);
        this.failedExecuteEstimationsInARow = 0;
      }
    }

    this.watch();
  }

  protected _executeTxExecutionFailed(_txData: string): void {
    this._executeTxEstimationFailed(_txData);
  }

  // t1 - resolver available at;
  private t1 = 0;
  private b1 = 0n;
  private tn = 0;
  private bn = 0n;

  private async executeResolverJob(invokeCalldata) {
    this.agent.unregisterResolver(this.key);
    return this.executeTx(this.key, await this.buildTx(this.buildResolverCalldata(invokeCalldata)));
  }

  protected async resolverSuccessCallback(triggeredByBlockNumber, invokeCalldata) {
    // execute
    if (this.agent.getKeeperId() === this.assignedKeeperId) {
      await this.executeResolverJob(invokeCalldata);
      // executeSlashing
    } else if (
      this.slashingPossibleAfter > 0 &&
      this.agent.nowS() > this.slashingPossibleAfter &&
      this.reservedSlasherId == this.agent.getKeeperId()
    ) {
      this.clog('debug', `Need execute slashing bn=${triggeredByBlockNumber}`);
      await this.executeResolverJob(invokeCalldata);
      // initiateSlashing
    } else {
      const now = this.agent.nowS();
      const latestBlock = this.agent.getNetwork().getLatestBlockNumber();
      const period1 = (this.agent as IRandaoAgent).getPeriod1Duration();

      this.tn = Number(this.agent.getNetwork().getLatestBlockTimestamp());
      this.bn = latestBlock;

      // reset t1 & b1 if the bn is more than two blocks behind
      if (this.bn + 2n < latestBlock) {
        this.clog('debug', `Resetting counter, bn=${triggeredByBlockNumber}`);
        this.t1 = this.tn;
        this.b1 = this.bn;
      }

      if (this.t1) {
        const left = this.t1 + period1 - now;
        this.clog(
          'debug',
          'Can initiate slashing after',
          left,
          JSON.stringify({ t1: this.t1, period1, now }),
          `bn=${triggeredByBlockNumber}`,
        );
      }

      // if can slash
      if (this.t1 && now > this.t1 + period1) {
        if (await (this.agent as IRandaoAgent).amINextSlasher(this.key)) {
          await this.initiateSlashing(invokeCalldata);
        } else {
          this.clog('debug', "😟 Can't initiate slashing, i'm not the next block slasher");
        }
      } else {
        if (this.t1 === 0) {
          this.clog('debug', `Initiate resolver slashing counter bn=${triggeredByBlockNumber}`);
          this.t1 = Number(this.agent.getNetwork().getLatestBlockTimestamp());
          this.b1 = latestBlock;
        }
      }
    }
  }

  protected async intervalJobAvailableCallback(blockNumber: number) {
    // TODO: remove
    this.clog(
      'debug',
      '@@@ available, assigned/me/matches',
      this.key,
      this.assignedKeeperId,
      this.agent.getKeeperId(),
      this.assignedKeeperId === this.agent.getKeeperId(),
    );
    if (this.assignedKeeperId === this.agent.getKeeperId()) {
      this.clog(
        'debug',
        'job callback',
        this.key,
        blockNumber,
        JSON.stringify({
          assigned: this.assignedKeeperId,
          me: this.agent.getKeeperId(),
        }),
      );
      this.agent.unregisterIntervalJobExecution(this.key);
      return this.executeTx(this.key, await this.buildTx(this.buildIntervalCalldata()));
    }
  }

  private async intervalJobSlashingAvailableCallback(_blockNumber: number) {
    // TODO: remove
    this.clog(
      'debug',
      '@@@ slashing, assigned/me/matches',
      this.key,
      this.assignedKeeperId,
      this.agent.getKeeperId(),
      this.assignedKeeperId === this.agent.getKeeperId(),
    );
    // WARNING: Either `rdConfig.slashingEpochBlocks` or `totalActiveKeepers` can affect the actual keeper id
    // that will be in the previous block
    const { binJob, nextBlockSlasherId } = await (this.agent as IRandaoAgent).getJobBytes32AndNextBlockSlasherId(
      this.key,
    );

    this.applyBinJobData(binJob);
    if (this.agent.getKeeperId() === this.assignedKeeperId) {
      this.clog('debug', 'Wont slash mine job', JSON.stringify({ nextBlockSlasherId, me: this.agent.getKeeperId() }));
    } else if (this.agent.getKeeperId() === nextBlockSlasherId) {
      this.unwatch();
      return this.executeTx(this.key, await this.buildTx(this.buildIntervalCalldata()));
    } else {
      this.clog('debug', 'Slasher is not me', JSON.stringify({ nextBlockSlasherId, me: this.agent.getKeeperId() }));
    }
  }
}
