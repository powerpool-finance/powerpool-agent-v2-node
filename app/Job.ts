import {
  CALLDATA_SOURCE,
  EventWrapper,
  GetJobResponse,
  JobDetails,
  JobType,
  ParsedJobConfig,
  RegisterJobEventArgs,
  Resolver,
  SetResolverEventArgs,
  UpdateJobEventArgs,
} from './Types.js';
import { BigNumber, ethers, providers, Event } from 'ethers';
import { Agent } from './Agent.js';
import { encodeExecute, nowS, nowTimeString, parseConfig, parseRawJob, toNumber } from './Utils.js';
import { Network } from './Network.js';
import { BN_ZERO } from './Constants.js';
import { clearTimeout } from 'timers';

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
export class Job {
  private address: string;
  private id: number;
  private key: string;

  private networkName: string;
  private agentAddress: string;

  private agent: Agent;

  private owner: string;
  private details: JobDetails;
  private config: ParsedJobConfig;
  private jobLevelMinKeeperCvp: BigNumber;
  private resolver: Resolver;

  private averageBlockTimeSeconds: number;
  private network: Network;
  private intervalTimeout: NodeJS.Timeout;

  private initializing = true;

  private toString(): string {
    return `(network: ${this.networkName}, agent: ${this.agentAddress}, job: ${
      this.address
    }, id: ${this.id}, key: ${this.key}, type: ${this.getJobTypeString()})`;
  }

  private clog(...args) {
    console.log(`>>> ${nowTimeString()} >>> Job${this.toString()}:`, ...args);
  }

  private err(...args): Error {
    return new Error(`JobError${this.toString()}: ${args.join(' ')}`);
  }

  constructor(creationEvent: EventWrapper, agent: Agent) {
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

  public isInitializing(): boolean {
    return this.initializing;
  }

  private getFixedReward(): BigNumber {
    return BigNumber.from(this.details.fixedReward).mul('1000000000000000');
  }

  private assertEvent(event: Event, eventName: string) {
    if (event.event !== eventName) {
      throw this.err(`Not ${eventName} event in constructor: ${event}`);
    }
    if (event.removed) {
      throw this.err(`Unexpected "removed === true" flag for this event: ${event}`);
    }
  }

  // HANDLERS (applies and resubscribes). Required for an already active jobs.

  public async handleUpdateEvent(updateEvent: Event) {
    await this.unwatch();

    this.applyUpdateEvent(updateEvent);

    await this.watch();
  }

  // APPLIERS (only applies, but doesn't resubscribe). Required for a job initialization.

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
    this.resolver = {resolverAddress: job.resolver.resolverAddress, resolverCalldata: job.resolver.resolverCalldata};
    this.details = job.details;
    this.owner = job.owner;
    this.config = parseConfig(BigNumber.from(job.details.config));
    if (Array.isArray(this.details)) {
      throw new Error('details are an array')
    }
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
  public applyRawJobData(rawJob: string): boolean {
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

  public rewatchIfRequired(rawJob: string) {
    if (typeof rawJob !== 'string') {
      throw this.err('rawJob is not a string:', typeof rawJob, rawJob);
    }
    const parsedJobData = parseRawJob(rawJob);
    const secondsToCall = this.secondsToCall(parsedJobData.lastExecutionAt);
    if (secondsToCall < this.averageBlockTimeSeconds) {
      this.clog('Rewatch required')
      this.watch();
    }
  }

  public applyJobCreditsDeposit(credits: BigNumber) {
    this.details.credits = this.details.credits.add(credits);
  }

  public applyJobCreditWithdrawal(credits: BigNumber) {
    this.details.credits = this.details.credits.sub(credits);
  }

  public applyResolver(resolverAddress: string, resolverCalldata: string) {
    this.resolver = { resolverAddress, resolverCalldata };
  }

  public applyConfig(isActive: boolean, useJobOwnerCredits: boolean, assertResolverSelector: boolean) {
    this.config.isActive = isActive;
    this.config.useJobOwnerCredits = useJobOwnerCredits;
    this.config.assertResolverSelector = assertResolverSelector;
  }

  public applyOwner(owner: string) {
    this.owner = owner;
  }

  private assertType(title: string, type: string, value: any) {
    if (typeof value !== type) {
      throw this.err(`${title} not ${type}: (actualType=${typeof value},value=${value})`);
    }
  }

  public applyUpdate(maxBaseFeeGwei: number, rewardPct: number, fixedReward: number, jobMinCvp: BigNumber, intervalSeconds: number) {
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
      case JobType.Resolver:
        this.agent.unregisterResolver(this.key);
        break;
      case JobType.SelectorOrPDCalldata:
        break;
      default:
        throw this.err(`Invalid job type: ${this.getJobType()}`);
    }

    if (this.intervalTimeout) {
      clearTimeout(this.intervalTimeout);
      this.intervalTimeout = null;
    }
  }

  public async watch() {
    this.unwatch();

    this.clog('watch()');

    if (this.initializing) {
      this.initializing = false;
    }

    if (!this.config) {
      throw this.err('Cant read the jobs config');
    }
    if (!this.config.isActive) {
      this.clog('Ignoring a disabled job');
      return;
    }
    if (this.getCreditsAvailable().eq(BN_ZERO)) {
      this.clog('Ignoring a job with 0 credits');
      return;
    }

    switch (this.getJobType()) {
      case JobType.IntervalResolver:
        this.watchIntervalJob();
        break;
      case JobType.Resolver:
        this.agent.registerResolver(this.key, this.resolver, this.resolverSuccessCallback.bind(this));
        break;
      case JobType.SelectorOrPDCalldata:
        this.watchIntervalJob();
        break;
      default:
        throw this.err(`Invalid job type: ${this.getJobType()}`);
    }
  }

  private async watchIntervalJob() {
    const secondsToCall = this.secondsToCall(this.details.lastExecutionAt);
    if (typeof this.details.lastExecutionAt !== 'number') {
      throw this.err(`watchIntervalJob(): this.lastExecutionAt not configured: (value=${this.details.lastExecutionAt
        },typeof=${typeof this.details.lastExecutionAt})`);
    }
    console.log({
      action: 'execute now',
      key: this.key,
      secondsToCall,
      now: nowS(),
      lastExecution: this.details.lastExecutionAt,
      interval: this.details.intervalSeconds,
      secondsToCallManual: this.details.lastExecutionAt + this.details.intervalSeconds - nowS()
    });
    if (secondsToCall < this.averageBlockTimeSeconds) {
      if (this.getJobType() === JobType.IntervalResolver) {
        this.clog('watchIntervalJob()->registerResolver()')
        this.agent.registerResolver(this.key, this.resolver, this.resolverSuccessCallback.bind(this));
      } else {
        await this.tryExecuteIntervalJob();
      }
    } else {
      const timeout = secondsToCall + 1;
      this.clog(`watchIntervalJob()->setTimeout ${timeout} seconds`)
      this.intervalTimeout = setTimeout(this.watchIntervalJob.bind(this), timeout * 1000);
    }
  }

  private async resolverSuccessCallback(invokeCalldata) {
    if (this.getJobType() === JobType.IntervalResolver) {
      this.agent.unregisterResolver(this.key);
    }
    return this.executeTx(
      this.key,
      await this.buildTx(
        this.buildResolverCalldata(invokeCalldata)
      )
    );
  }

  private buildIntervalCalldata(): string {
    return encodeExecute(this.address, this.id, this.agent.getCfg(), this.agent.getKeeperId());
  }

  private buildResolverCalldata(jobCalldata): string {
    return encodeExecute(this.address, this.id, this.agent.getCfg(), this.agent.getKeeperId(), jobCalldata);
  }

  private async buildTx(calldata: string): Promise<ethers.UnsignedTransaction> {
    const maxFeePerGas = await this.calculateMaxFeePerGas();
    return {
      to: this.agent.getAddress(),

      data: calldata,

      // Typed-Transaction features
      type: 2,

      // EIP-1559; Type 2
      maxFeePerGas
    }
  }

  private async calculateMaxFeePerGas(): Promise<number> {
    const gasPrice = await this.agent.getNetwork().queryGasPrice();
    const currentDouble = Math.ceil(gasPrice * 2);
    const max = this.details.maxBaseFeeGwei * 1e9;
    console.log({gasPrice, max});
    if (max < gasPrice) {
      return 0;
    }
    if (currentDouble > max) {
      return max;
    } else {
      return currentDouble;
    }
  }

  private getCreditsAvailable(): BigNumber {
    let balanceAvailable = this.details.credits;
    if (this.config.useJobOwnerCredits) {
      balanceAvailable = this.agent.getJobOwnerBalance(this.owner);
    }
    return balanceAvailable;
  }

  private async executeTx(jobKey: string, tx: ethers.UnsignedTransaction, minTimestamp = 0) {
    return this.agent.sendOrEnqueueTxEnvelope({
      jobKey,
      tx,
      creditsAvailable: this.getCreditsAvailable(),
      fixedCompensation: this.getFixedReward(),
      ppmCompensation: this.details.rewardPct,
      minTimestamp
    });
  }

  private async tryExecuteIntervalJob() {
    return this.executeTx(this.key, await this.buildTx(this.buildIntervalCalldata()), this.nextExecutionTimestamp());
  }

  private nextExecutionTimestamp(): number {
    if (this.details.intervalSeconds === 0) {
      throw this.err(`Unexpected nextExecutionTimestamp() call for job ${this.key}`);
    }

    return this.details.lastExecutionAt + this.details.intervalSeconds;
  }

  private secondsToCall(lastExecutionAt): number {
    const now = nowS();
    const nextExecutionAt = lastExecutionAt + this.details.intervalSeconds;
    if (nextExecutionAt < now) {
      return 0;
    } else {
      return nextExecutionAt - now;
    }
  }

  public getJobType(): JobType {
    if (this.details.intervalSeconds > 0 && this.details.calldataSource === CALLDATA_SOURCE.RESOLVER) {
      return JobType.IntervalResolver;
    } else if (this.details.calldataSource === CALLDATA_SOURCE.RESOLVER) {
      return JobType.Resolver;
    } else if (this.details.calldataSource === CALLDATA_SOURCE.PRE_DEFINED_CALLDATA || this.details.calldataSource === CALLDATA_SOURCE.SELECTOR) {
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
    return this.owner
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
}
