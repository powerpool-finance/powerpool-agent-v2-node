import {
  CALLDATA_SOURCE,
  EventWrapper,
  GetJobResponse,
  IAgent,
  JobDetails,
  JobType,
  ParsedJobConfig,
  RegisterJobEventArgs,
  Resolver,
  UnsignedTransaction,
} from '../Types.js';
import { BigNumber, Event } from 'ethers';
import { encodeExecute, parseConfig, parseRawJob, toNumber, weiValueToEth, weiValueToGwei } from '../Utils.js';
import { Network } from '../Network.js';
import { BN_ZERO } from '../Constants.js';

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
  protected failedResolverEstimationsInARow = 0;

  protected abstract clog(...args): void;
  protected abstract err(...args): Error;

  protected toString(): string {
    return `(network: ${this.networkName}, agent: ${this.agentAddress}, job: ${this.address}, id: ${this.id}, key: ${
      this.key
    }, type: ${this.getJobTypeString()}, kid: ${this.agent.getKeeperId()})`;
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
  protected _executeTxEstimationFailed(_, __: string): any {
    return null;
  }
  protected _executeTxExecutionFailed(_, __: string): any {
    return null;
  }
  protected _executeTxExecutionSuccess(_, __: string): any {
    return null;
  }

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

  // TODO: move to light job
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
    this.failedResolverEstimationsInARow = 0;
    this.agent.removeJobFromBlacklist(this.key, 'execute');
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
    this.clog('debug', 'unwatch()');
    switch (this.getJobType()) {
      case JobType.Resolver:
        this._unwatchResolverJob();
        break;
      case JobType.Interval:
        this._unwatchIntervalJob();
        break;
      default:
        throw this.err(`Invalid job type: ${this.getJobType()}`);
    }
  }

  public watch() {
    this.unwatch();

    this.clog('debug', 'watch()');

    if (!this.config) {
      throw this.err('Job.watch(): Cant read the jobs config');
    }
    if (this.initializing) {
      this.clog('debug', 'Ignoring watch(): Job still initializing...');
      return;
    }

    if (!this.agent.getIsAgentUp()) {
      this.clog('info', "Agent is currently disabled. Can't watch job");
      return;
    }
    if (this.agent.isJobBlacklisted(this.key)) {
      this.clog('debug', 'Ignoring a blacklisted job');
      return;
    }
    if (!this.config.isActive) {
      this.clog('debug', 'Ignoring a disabled job');
      return;
    }

    if (!this._beforeJobWatch()) {
      return;
    }

    switch (this.getJobType()) {
      case JobType.Resolver:
        this._watchResolverJob();
        break;
      case JobType.Interval:
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

  protected isNotSuitableForBlacklistError(e) {
    return (
      e.message &&
      (e.message.includes("sender doesn't have enough funds to send tx") ||
        e.message.includes('Tx not mined, max attempts') ||
        e.message.includes('replacement transaction underpriced') ||
        e.message.includes('0xaf605803') || // OnlyCurrentSlasher
        e.message.includes('0xe096085e')) // IntervalNotReached
    );
  }

  protected isResolverError(e) {
    return e.message && e.message.includes('0x74ab6781'); // SelectorCheckFailed
  }

  // 1 is 1 wei
  public getCreditsAvailable(): bigint {
    let balanceAvailable = this.details.credits;
    if (this.config.useJobOwnerCredits) {
      balanceAvailable = this.agent.getJobOwnerBalance(this.owner);
    }
    return BigInt(balanceAvailable.toString());
  }

  protected async executeTx(jobKey: string, tx: UnsignedTransaction) {
    return this.agent.sendTxEnvelope({
      executorCallbacks: {
        txEstimationFailed: this._executeTxEstimationFailed.bind(this),
        txExecutionFailed: this._executeTxExecutionFailed.bind(this),
        txExecutionSuccess: this._executeTxExecutionSuccess.bind(this),
        txNotMinedInBlock: this.agent.txNotMinedInBlock.bind(this.agent),
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
    if (this.details.calldataSource === CALLDATA_SOURCE.RESOLVER) {
      return JobType.Resolver;
    } else if (
      this.details.calldataSource === CALLDATA_SOURCE.PRE_DEFINED_CALLDATA ||
      this.details.calldataSource === CALLDATA_SOURCE.SELECTOR
    ) {
      return JobType.Interval;
    } else {
      throw this.err('Invalid job type');
    }
  }

  public getJobTypeString(): string {
    switch (this.getJobType()) {
      case JobType.Resolver:
        return 'Resolver';
      case JobType.Interval:
        return 'Interval';
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
      initializing: this.initializing,

      type: this.getJobType(),
      calldataSource: this.getJobCalldataSourceString(),
      creditsAvailableWei: this.getCreditsAvailable(),
      creditsAvailableEth: weiValueToEth(this.getCreditsAvailable()),
      maxFeePerGasWei: this.agent.getBaseFeePerGas(),
      maxFeePerGasGwei: weiValueToGwei(this.agent.getBaseFeePerGas()),
      jobLevelMinKeeperCvp: this.jobLevelMinKeeperCvp,
      preDefinedCalldata: this.preDefinedCalldata,

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
