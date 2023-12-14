import { AbstractAgent } from './AbstractAgent.js';
import { getPPAgentV2_3_0_RandaoAbi } from '../services/AbiService.js';
import { ExecutorCallbacks, IRandaoAgent, LensGetJobBytes32AndNextBlockSlasherIdResponse } from '../Types.js';
import { RandaoJob } from '../jobs/RandaoJob.js';
import { BI_10E15 } from '../Constants.js';
import { AbstractJob } from '../jobs/AbstractJob.js';

export class AgentRandao_2_3_0 extends AbstractAgent implements IRandaoAgent {
  private slashingEpochBlocks: number;
  private period1: number;
  private period2: number;
  private slashingFeeFixedCVP: number;
  private slashingFeeBps: number;

  private jobMinCreditsFinney: bigint;

  _isVersionSupported(version): boolean {
    return version.startsWith('2.');
  }

  async _beforeInit() {
    const ppAgentV2Abi = getPPAgentV2_3_0_RandaoAbi();
    this.contract = this.network.getContractWrapperFactory().build(this.address, ppAgentV2Abi);
  }

  public getStatusObjectForApi(): object {
    const obj = Object.assign(super.getStatusObjectForApi(), {
      agentRandaoFields: {
        slashingEpochBlocks: this.slashingEpochBlocks,
        period1Seconds: this.period1,
        period2Seconds: this.period2,
        slashingFeeFixedCVP: this.slashingFeeFixedCVP,
        slashingFeeBps: this.slashingFeeBps,
        jobMinCreditsFinney: this.jobMinCreditsFinney,
        blacklistedJobs: Array.from(this.blacklistedJobs),
      },
    });
    return obj;
  }

  protected async _beforeResyncAllJobs() {
    const rdConfig = await this.queryAgentRdConfig();
    this.slashingEpochBlocks = rdConfig.slashingEpochBlocks;
    this.period1 = rdConfig.period1;
    this.period2 = rdConfig.period2;
    this.slashingFeeFixedCVP = rdConfig.slashingFeeFixedCVP;
    this.slashingFeeBps = rdConfig.slashingFeeBps;
    this.jobMinCreditsFinney = BigInt(rdConfig.jobMinCreditsFinney);
  }

  protected _afterExecuteEvent(job: AbstractJob) {
    (job as RandaoJob).applyClearResolverTimeouts();
  }

  _buildNewJob(event): RandaoJob {
    return new RandaoJob(event, this);
  }

  public registerJobSlashingTimeout(jobKey: string, timestamp: number, callback: (calldata) => void) {
    this.network.registerTimeout(`${this.address}/${jobKey}/slashing`, timestamp, callback);
  }

  public async amINextSlasher(jobKey: string): Promise<boolean> {
    const { nextBlockSlasherId } = await this.getNetwork().queryLensJobBytes32AndNextBlockSlasherId(
      this.address,
      jobKey,
    );

    return nextBlockSlasherId === this.getKeeperId();
  }

  public async getJobBytes32AndNextBlockSlasherId(
    jobKey: string,
  ): Promise<LensGetJobBytes32AndNextBlockSlasherIdResponse> {
    return this.getNetwork().queryLensJobBytes32AndNextBlockSlasherId(this.address, jobKey);
  }

  public unregisterJobSlashingTimeout(jobKey: string) {
    this.network.unregisterTimeout(`${this.address}/${jobKey}/slashing`);
  }

  public getPeriod1Duration(): number {
    if (typeof this.period1 !== 'number') {
      throw this.err(`period1 is not a number: '${this.period1}'`);
    }

    return this.period1;
  }

  public getPeriod2Duration(): number {
    if (typeof this.period2 !== 'number') {
      throw this.err('period2 is not a number');
    }

    return this.period2;
  }

  public getJobMinCredits(): bigint {
    if (typeof this.jobMinCreditsFinney !== 'bigint') {
      throw this.err('period2 is not a bigint');
    }

    return this.jobMinCreditsFinney * BI_10E15;
  }

  async selfUnassignFromJob(jobKey: string) {
    this.clog('info', 'Executing Self-Unassign');
    const calldata = this.encodeABI('releaseJob', [jobKey]);
    const tx = await this.buildTx(calldata);
    await this.populateTxExtraFields(tx);
    const txEstimationFailed = (error): void => {
      this.clog('error', 'Error: Self-Unassign releaseJob() estimation failed', error);
      this.exitIfStrictTopic('estimations');
    };
    const txExecutionFailed = (error): void => {
      this.clog('error', 'Error: Self-Unassign releaseJob() execution failed', error);
      this.exitIfStrictTopic('executions');
    };
    const envelope = {
      executorCallbacks: {
        txEstimationFailed,
        txExecutionFailed,
        txExecutionSuccess: (_, __) => {},
        txNotMinedInBlock: this.txNotMinedInBlock.bind(this),
      },
      jobKey,
      tx,
      creditsAvailable: 0n,
      fixedCompensation: 0n,
      ppmCompensation: 0,
      minTimestamp: 0,
    };
    await this._sendNonExecuteTransaction(envelope);
  }

  async initiateKeeperSlashing(
    jobAddress: string,
    jobId: number,
    jobKey: string,
    jobCalldata: string,
    executorCallbacks: ExecutorCallbacks,
  ) {
    // jobAddress, jobId, myKeeperId, useResolver, jobCalldata
    const calldata = this.encodeABI('initiateKeeperSlashing', [
      jobAddress,
      jobId,
      this.getKeeperId(),
      false,
      jobCalldata,
    ]);
    const tx = await this.buildTx(calldata);
    await this.populateTxExtraFields(tx);
    const envelope = {
      executorCallbacks,
      jobKey,
      tx,
    };
    await this._sendNonExecuteTransaction(envelope);
  }

  public isTxDataOfJobInitiateSlashing(data, jobAddress, jobId) {
    const result = this.contract.decodeTxData(data);
    return (
      result.name === 'initiateKeeperSlashing' &&
      result.args.jobAddress_.toLowerCase() === jobAddress.toLowerCase() &&
      result.args.jobId_.toString() === jobId.toString()
    );
  }

  private async queryAgentRdConfig(): Promise<any> {
    return this.contract.ethCall('getRdConfig', []);
  }

  private encodeABI(method: string, args: any[]): string {
    return this.contract.encodeABI(method, args);
  }

  _afterInitializeListeners() {
    this.on('ExecutionReverted', event => {
      const { assignedKeeperId, actualKeeperId, compensation, executionReturndata, jobKey } = event.args;

      this.clog(
        'debug',
        `'ExecutionReverted' event 🔈: (block=${event.blockNumber},jobKey=${jobKey},assignedKeeperId=${assignedKeeperId},actualKeeperId=${actualKeeperId},compensation=${compensation},executionReturndata=${executionReturndata})`,
      );

      const job = this.jobs.get(jobKey);
      job.applyWasExecuted();

      if (job.creditsSourceIsJobOwner()) {
        const ownerCreditsBefore = this.ownerBalances.get(job.getOwner());
        const ownerCreditsAfter = ownerCreditsBefore.sub(compensation);
        this.clog(
          'debug',
          `Owner balance credited: (jobOwner=${job.getOwner()},amount=${compensation.toString()},before=${ownerCreditsBefore},after=${ownerCreditsAfter}`,
        );
        this.ownerBalances.set(job.getOwner(), ownerCreditsAfter);
      } else {
        job.applyJobCreditsCredit(compensation);
      }

      // The keeper was unassigned earlier with JobKeeperChanged event, thus no need to call watch() here
    });

    this.on('JobKeeperChanged', async event => {
      const { keeperFrom, keeperTo, jobKey } = event.args;

      this.clog(
        'debug',
        `'JobKeeperChanged' event 🔈: (block=${event.blockNumber},jobKey=${jobKey},keeperFrom=${keeperFrom},keeperTo=${keeperTo})`,
      );

      const job = this.jobs.get(jobKey) as RandaoJob;
      const shouldUpdateBinJob = job.applyKeeperAssigned(parseInt(keeperTo));
      if (shouldUpdateBinJob) {
        const binJob = await this.network.queryLensJobsRawBytes32(this.address, jobKey);
        this.clog('debug', 'Updating binJob to', binJob);
        job.applyBinJobData(binJob);
      }
      job.finalizeInitialization();
      job.watch();
    });

    this.on('SetRdConfig', event => {
      const { slashingEpochBlocks, period1, period2, slashingFeeFixedCVP, slashingFeeBps, jobMinCreditsFinney } =
        event.args[0];

      this.clog('debug', `'SetRdConfig' event 🔈: (block=${event.blockNumber}. Restarting all the jobs...`);

      this.slashingEpochBlocks = slashingEpochBlocks;
      this.period1 = period1;
      this.period2 = period2;
      this.slashingFeeFixedCVP = slashingFeeFixedCVP;
      this.slashingFeeBps = slashingFeeBps;
      this.jobMinCreditsFinney = BigInt(jobMinCreditsFinney);

      this.startAllJobs();
    });

    this.on('InitiateKeeperSlashing', event => {
      const { jobKey, jobSlashingPossibleAfter, slasherKeeperId, useResolver } = event.args;

      this.clog(
        'debug',
        `'InitiateKeeperSlashing' event 🔈: (block=${event.blockNumber},jobKey=${jobKey},jobSlashingPossibleAfter=${jobSlashingPossibleAfter},slasherKeeperId=${slasherKeeperId},useResolver=${useResolver})`,
      );

      const job = this.jobs.get(jobKey) as RandaoJob;
      job.applyInitiateKeeperSlashing(jobSlashingPossibleAfter, slasherKeeperId);
    });

    this.on('SlashKeeper', event => {
      const { jobKey, assignedKeeperId, actualKeeperId, fixedSlashAmount, dynamicSlashAmount, slashAmountMissing } =
        event.args;

      this.clog(
        'debug',
        `'SlashKeeper' event 🔈: (block=${event.blockNumber},jobKey=${jobKey},assignedKeeperId=${assignedKeeperId},actualKeeperId=${actualKeeperId},fixedSlashAmount=${fixedSlashAmount},dynamicSlashAmount=${dynamicSlashAmount},slashAmountMissing=${slashAmountMissing})`,
      );

      if (this.getKeeperId() === assignedKeeperId.toNumber()) {
        const amount = fixedSlashAmount.add(dynamicSlashAmount).sub(slashAmountMissing);
        this.myStake = this.myStake.sub(amount);
        this.activateOrTerminateAgentIfRequired();
      } else if (this.getKeeperId() === actualKeeperId.toNumber()) {
        const amount = fixedSlashAmount.add(dynamicSlashAmount).sub(slashAmountMissing);
        this.myStake = this.myStake.add(amount);
        this.activateOrTerminateAgentIfRequired();
      }

      const job = this.jobs.get(jobKey) as RandaoJob;
      job.applySlashKeeper();
    });
  }
}
