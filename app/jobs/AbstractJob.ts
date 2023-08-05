import {
  CALLDATA_SOURCE,
  EmptyTxNotMinedInBlockCallback,
  EventWrapper,
  GetJobResponse,
  IAgent,
  JobDetails,
  JobType,
  ParsedJobConfig,
  RegisterJobEventArgs,
  Resolver,
  UpdateJobEventArgs,
} from '../Types.js';
import { BigNumber, ethers, Event } from 'ethers';
import { encodeExecute, parseConfig, parseRawJob, toNumber, weiValueToEth, weiValueToGwei } from '../Utils.js';
import { Network } from '../Network.js';
import { BN_ZERO } from '../Constants.js';

/**
 * Starts watching on:
 * - job init
 * - a new job registered (RegisterJob event)
 * - credits balance increased after being insufficient (raw update)
 *      (DepositJobCredits,DepositJobOwnerCredits events)
 * - job was transferred to a new owner with sufficient credit balance after being inactive (AcceptJobTransfer event)
 * - job activated (raw update) (SetJobConfig event)
 * - job triggered credits source and there is enough funds now (SetJobConfig event)
 * ***
 * * interval task starts a single timer with +1s timeout
 * * resolver tasks registers its callback on the network-level checker
 *
 * ==================
 * Stops watching on:
 * - job credits got lower a limit (raw update or owner's balance change)
 *      (Execute,WithdrawJobCredits,WithdrawJobOwnerCredits,WithdrawJobOwnerCredits events)
 * - job owner credits got lower than a limit
 * - job was disabled in config (raw update) (SetJobConfig event)
 * - job triggered credits source and there is no enough funds (SetJobConfig event)
 * ***
 * * interval task stops a timer
 * * resolver tasks deregisters its callback
 *
 * ==================
 * Restarts watching:
 * - interval changed (raw update) (JobUpdate event)
 * - pre-defined calldata changed (SetJobPreDefinedCalldata event)
 * - resolver calldata changed (SetJobResolver event)
 */
export abstract class AbstractJob {
  protected address: string;
  protected id: number;
  protected key: string;

  protected networkName: string;
  protected agentAddress: string;

  protected agent: IAgent;

  protected owner: string;
  protected details: JobDetails;
  protected config: ParsedJobConfig;
  private jobLevelMinKeeperCvp: BigNumber;
  protected resolver: Resolver;
  protected preDefinedCalldata: string;

  private averageBlockTimeSeconds: number;
  private network: Network;

  private initializing = true;
  protected failedExecuteEstimationsInARow = 0;

  protected abstract clog(...args): void;
  protected abstract err(...args): Error;

  protected toString(): string {
    return `(network: ${this.networkName}, agent: ${this.agentAddress}, job: ${this.address}, id: ${this.id}, key: ${
      this.key
    }, type: ${this.getJobTypeString()})`;
  }

  protected _watchIntervalJob(): void {
    this.agent.registerIntervalJobExecution(
      this.key,
      this.nextExecutionTimestamp(),
      this.intervalJobAvailableCallback.bind(this),
    );
  }

  protected _watchResolverJob(): void {
    this.agent.registerResolver(this.key, this.resolver, this.resolverSuccessCallback.bind(this));
  }

  protected _unwatchIntervalJob(): void {
    this.agent.unregisterIntervalJobExecution(this.key);
  }

  protected _unwatchResolverJob(): void {
    this.agent.unregisterResolver(this.key);
  }

  protected _beforeJobWatch(): boolean {
    return true;
  }
  protected _afterJobWatch(): void {}
  protected abstract _afterApplyJob(job: GetJobResponse): void;
  protected abstract intervalJobAvailableCallback(blockNumber: number);
  protected _executeTxEstimationFailed(_txData: string): void {}
  protected _executeTxExecutionFailed(_txData: string): void {}

  constructor(creationEvent: EventWrapper, agent: IAgent) {
    const args: RegisterJobEventArgs = creationEvent.args as never;
    if (creationEvent.name !== 'RegisterJob') {
      throw new Error(`Job->constructor(): Not RegisterJob event in constructor: ${creationEvent}`);
    }

    this.agent = agent;
    this.networkName = agent.getNetwork().getName();
    this.agentAddress = agent.getAddress();
    this.averageBlockTimeSeconds = agent.getNetwork().getAverageBlockTimeSeconds();
    this.network = agent.getNetwork();

    this.address = args.jobAddress;
    this.id = args.jobId.toNumber();
    this.key = args.jobKey;
    // NOTICE: this.details object remains uninitialized
  }

  private getFixedReward(): bigint {
    return BigInt(this.details.fixedReward) * 1000000000000000n;
  }

  private assertEvent(event: Event, eventName: string) {
    if (event.event !== eventName) {
      throw this.err(`Not ${eventName} event in constructor: ${event}`);
    }
    if (event.removed) {
      throw this.err(`Unexpected "removed === true" flag for this event: ${event}`);
    }
  }

  // APPLIERS (only applies, but doesn't resubscribe).

  // TODO: deprecate
  public applyUpdateEvent(event: Event): boolean {
    this.assertEvent(event, 'JobUpdate');

    const args: UpdateJobEventArgs = event.args as never;
    this.clog('JobUpdateEvent: params, args (TODO: ensure types match):', this.details, args);

    let requiresRestart = false;

    if (this.details.intervalSeconds !== args.intervalSeconds) {
      requiresRestart = true;
    }

    // TODO: ensure types match
    this.details.maxBaseFeeGwei = args.maxBaseFeeGwei;
    this.details.rewardPct = args.rewardPct;
    this.details.fixedReward = args.fixedReward;
    this.details.intervalSeconds = args.intervalSeconds;
    this.jobLevelMinKeeperCvp = args.jobMinCvp;

    return requiresRestart;
  }

  //assignFields

  public applyJob(job: GetJobResponse): boolean {
    this.resolver = { resolverAddress: job.resolver.resolverAddress, resolverCalldata: job.resolver.resolverCalldata };
    this.preDefinedCalldata = job.preDefinedCalldata;

    if (typeof job.details !== 'object') {
      throw this.err(`applyJob(): job.details is not an object: ${job.details}`);
    }
    if (Array.isArray(job.details)) {
      throw this.err(`applyJob(): job.details are an array: ${job.details}`);
    }
    if (!job.config) {
      throw this.err(`applyJob(): job.config not defined: ${job.config}`);
    }

    this.owner = job.owner;
    this.details = job.details;
    this.config = job.config;
    this.jobLevelMinKeeperCvp = job.jobLevelMinKeeperCvp;

    this._afterApplyJob(job);
    return true;
  }

  /**
   * Applies job data by its raw 32-byte EVM word.
   * Called from:
   *  - Initial load (updates all the info)
   *  - Execute event (update lastExecutedAt, nativeCredits fields only)
   * @param rawJob
   * @returns boolean Requires restart watcher
   */
  public applyBinJobData(rawJob: string): boolean {
    if (typeof rawJob !== 'string') {
      throw this.err('rawJob is not a string:', typeof rawJob, rawJob);
    }
    const parsedJobData = parseRawJob(rawJob);
    let requiresRestart = false;

    if (this.details.intervalSeconds !== parsedJobData.intervalSeconds) {
      requiresRestart = true;
    }
    if (this.details.lastExecutionAt !== parsedJobData.lastExecutionAt) {
      requiresRestart = true;
    }

    this.details.lastExecutionAt = parsedJobData.lastExecutionAt;
    this.details.intervalSeconds = parsedJobData.intervalSeconds;
    this.details.calldataSource = parsedJobData.calldataSource;
    this.details.fixedReward = parsedJobData.fixedReward;
    this.details.rewardPct = parsedJobData.rewardPct;
    this.details.maxBaseFeeGwei = parsedJobData.maxBaseFeeGwei;
    this.details.credits = parsedJobData.nativeCredits;
    this.details.selector = parsedJobData.selector;
    this.config = parseConfig(BigNumber.from(rawJob));

    return requiresRestart;
  }

  // Use this only when handling live RegisterJob event since there will be DepositJobCredits event later
  // which will actually assign a proper credits value.
  public clearJobCredits() {
    this.details.credits = BN_ZERO;
  }

  public finalizeInitialization() {
    this.initializing = false;
  }

  public applyJobCreditsDeposit(credits: BigNumber) {
    this.details.credits = this.details.credits.add(credits);
  }

  public applyJobCreditWithdrawal(credits: BigNumber) {
    this.details.credits = this.details.credits.sub(credits);
  }

  public applyJobCreditsCredit(credits: BigNumber) {
    this.details.credits = this.details.credits.sub(credits);
  }

  public applyResolver(resolverAddress: string, resolverCalldata: string) {
    this.resolver = { resolverAddress, resolverCalldata };
  }

  public applyPreDefinedCalldata(preDefinedCalldata: string) {
    this.preDefinedCalldata = preDefinedCalldata;
  }

  public applyConfig(isActive: boolean, useJobOwnerCredits: boolean, assertResolverSelector: boolean) {
    this.config.isActive = isActive;
    this.config.useJobOwnerCredits = useJobOwnerCredits;
    this.config.assertResolverSelector = assertResolverSelector;
  }

  public applyOwner(owner: string) {
    this.owner = owner;
  }

  public applyWasExecuted() {
    this.failedExecuteEstimationsInARow = 0;
  }

  private assertType(title: string, type: string, value: any) {
    if (typeof value !== type) {
      throw this.err(`${title} not ${type}: (actualType=${typeof value},value=${value})`);
    }
  }

  public applyUpdate(
    maxBaseFeeGwei: number,
    rewardPct: number,
    fixedReward: number,
    jobMinCvp: BigNumber,
    intervalSeconds: number,
  ) {
    this.details.maxBaseFeeGwei = toNumber(maxBaseFeeGwei);
    this.details.rewardPct = toNumber(rewardPct);
    this.details.fixedReward = toNumber(fixedReward);
    this.details.intervalSeconds = toNumber(intervalSeconds);

    this.jobLevelMinKeeperCvp = jobMinCvp;
  }

  public unwatch() {
    this.clog('unwatch()');
    switch (this.getJobType()) {
      case JobType.IntervalResolver:
        this.clog('Deprecated job type: IntervalResolver');
        break;
      case JobType.Resolver:
        this._unwatchResolverJob();
        break;
      case JobType.SelectorOrPDCalldata:
        this._unwatchIntervalJob();
        break;
      default:
        throw this.err(`Invalid job type: ${this.getJobType()}`);
    }
  }

  public watch() {
    this.unwatch();

    this.clog('watch()');

    if (!this.config) {
      throw this.err('Job.watch(): Cant read the jobs config');
    }
    if (this.initializing) {
      this.clog('Ignoring watch(): Job still initializing...');
      return;
    }

    if (!this.agent.getIsAgentUp()) {
      this.clog(`Agent with keeperId ${this.agent.getKeeperId()} is currently disabled. Can't watch job`);
      return;
    }
    if (this.agent.isJobBlacklisted(this.key)) {
      this.clog('Ignoring a blacklisted job');
      return;
    }
    if (!this.config.isActive) {
      this.clog('Ignoring a disabled job');
      return;
    }

    if (!this._beforeJobWatch()) {
      return;
    }

    switch (this.getJobType()) {
      case JobType.IntervalResolver:
        this.clog('Deprecated job type: IntervalResolver');
        break;
      case JobType.Resolver:
        this._watchResolverJob();
        break;
      case JobType.SelectorOrPDCalldata:
        this._watchIntervalJob();
        break;
      default:
        throw this.err(`Invalid job type: ${this.getJobType()}`);
    }

    this._afterJobWatch();
  }

  protected async resolverSuccessCallback(_triggeredByBlockNumber, _invokeCalldata) {}

  protected buildIntervalCalldata(): string {
    return encodeExecute(this.address, this.id, this.agent.getCfg(), this.agent.getKeeperId());
  }

  protected buildResolverCalldata(jobCalldata): string {
    return encodeExecute(this.address, this.id, this.agent.getCfg(), this.agent.getKeeperId(), jobCalldata);
  }

  protected async buildTx(calldata: string): Promise<ethers.UnsignedTransaction> {
    const maxFeePerGas = this.calculateMaxFeePerGas().toString();
    return {
      to: this.agent.getAddress(),

      data: calldata,

      // Typed-Transaction features
      type: 2,

      // EIP-1559; Type 2
      maxFeePerGas,
    };
  }

  private calculateMaxFeePerGas(): bigint {
    const baseFee = this.agent.getNetwork().getBaseFee();
    // TODO: maxBaseFee supported by lightjob, not by randao
    const jobConfigMaxFee = BigInt(this.details.maxBaseFeeGwei) * BigInt(1e9);

    console.log({ baseFee, max: jobConfigMaxFee });

    if (jobConfigMaxFee < baseFee) {
      return 0n;
    }

    // TODO: set back to 2n when txNotMined callback is implemented
    const currentDouble = baseFee * 3n;
    if (currentDouble > jobConfigMaxFee) {
      return jobConfigMaxFee;
    } else {
      return currentDouble;
    }
  }

  // 1 is 1 wei
  public getCreditsAvailable(): bigint {
    let balanceAvailable = this.details.credits;
    if (this.config.useJobOwnerCredits) {
      balanceAvailable = this.agent.getJobOwnerBalance(this.owner);
    }
    return BigInt(balanceAvailable.toString());
  }

  protected async executeTx(jobKey: string, tx: ethers.UnsignedTransaction) {
    return this.agent.sendTxEnvelope({
      executorCallbacks: {
        txEstimationFailed: this._executeTxEstimationFailed.bind(this),
        txExecutionFailed: this._executeTxExecutionFailed.bind(this),
        txNotMinedInBlock: EmptyTxNotMinedInBlockCallback,
      },
      jobKey,
      tx,
    });
  }

  protected nextExecutionTimestamp(): number {
    if (this.details.intervalSeconds === 0) {
      throw this.err(`Unexpected nextExecutionTimestamp() callback for job ${this.key}`);
    }

    return this.details.lastExecutionAt + this.details.intervalSeconds;
  }

  public getJobCalldataSourceString(): string {
    switch (this.details.calldataSource) {
      case CALLDATA_SOURCE.SELECTOR:
        return 'Selector';
      case CALLDATA_SOURCE.PRE_DEFINED_CALLDATA:
        return 'Pre-Defined Calldata';
      case CALLDATA_SOURCE.RESOLVER:
        return 'Resolver';
      default:
        throw this.err(`Invalid job calldata source: ${this.details.calldataSource}`);
    }
  }

  public getJobType(): JobType {
    if (this.details.intervalSeconds > 0 && this.details.calldataSource === CALLDATA_SOURCE.RESOLVER) {
      return JobType.IntervalResolver;
    } else if (this.details.calldataSource === CALLDATA_SOURCE.RESOLVER) {
      return JobType.Resolver;
    } else if (
      this.details.calldataSource === CALLDATA_SOURCE.PRE_DEFINED_CALLDATA ||
      this.details.calldataSource === CALLDATA_SOURCE.SELECTOR
    ) {
      return JobType.SelectorOrPDCalldata;
    } else {
      throw this.err('Invalid job type');
    }
  }

  private getJobTypeString(): string {
    switch (this.getJobType()) {
      case JobType.IntervalResolver:
        return 'IntervalResolver';
      case JobType.Resolver:
        return 'Resolver';
      case JobType.SelectorOrPDCalldata:
        return 'SelectorOrPDCalldata';
      default:
        throw this.err(`Invalid job type: ${this.getJobType()}`);
    }
  }

  public getOwner(): string {
    return this.owner;
  }

  public getKey(): string {
    return this.key;
  }

  public isActive(): boolean {
    return this.config.isActive;
  }

  public isIntervalJob(): boolean {
    return this.details.intervalSeconds > 0;
  }

  public isResolverJob(): boolean {
    return this.details.calldataSource === CALLDATA_SOURCE.RESOLVER;
  }

  public creditsSourceIsJobOwner(): boolean {
    return !!this.config.useJobOwnerCredits;
  }

  public getStatusObjectForApi(): object {
    const obj: object = {
      key: this.getKey(),
      address: this.address,
      id: this.id,
      owner: this.owner,
      active: this.isActive(),

      type: this.isIntervalJob() ? 'Interval' : 'Resolver',
      calldataSource: this.getJobCalldataSourceString(),
      creditsAvailableWei: this.getCreditsAvailable(),
      creditsAvailableEth: weiValueToEth(this.getCreditsAvailable()),
      maxFeePerGasWei: this.calculateMaxFeePerGas(),
      maxFeePerGasGwei: weiValueToGwei(this.calculateMaxFeePerGas()),
      jobLevelMinKeeperCvp: this.jobLevelMinKeeperCvp,

      config: this.config,
      details: this.details,
      resolver: this.resolver,
    };
    if (obj['details']) {
      obj['details'].creditsEth = weiValueToEth(obj['details'].credits);
    }
    return obj;
  }
}
