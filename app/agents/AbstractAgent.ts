import { Network } from '../Network';
import {
  AgentConfig,
  ContractWrapper,
  DataSourceType,
  EventWrapper,
  Executor,
  ExecutorConfig,
  ExecutorType,
  IAgent,
  IDataSource,
  Resolver,
  TxEnvelope,
  TxGasUpdate,
  UnsignedTransaction,
} from '../Types.js';
import { BigNumber, ethers, Wallet } from 'ethers';
import { getEncryptedJson } from '../services/KeyService.js';
import { BN_ZERO, DEFAULT_SYNC_FROM_CHAINS } from '../Constants.js';
import { numberToBigInt, toChecksummedAddress, weiValueToEth } from '../Utils.js';
import { FlashbotsExecutor } from '../executors/FlashbotsExecutor.js';
import { PGAExecutor } from '../executors/PGAExecutor.js';
import { getAgentDefaultSyncFromSafe, getDefaultExecutorConfig, setConfigDefaultValues } from '../ConfigGetters.js';
import { LightJob } from '../jobs/LightJob.js';
import { RandaoJob } from '../jobs/RandaoJob.js';
import { AbstractJob } from '../jobs/AbstractJob';
import logger from '../services/Logger.js';

// const FLAG_ACCEPT_MAX_BASE_FEE_LIMIT = 1;
const FLAG_ACCRUE_REWARD = 2;
const BIG_NUMBER_1E18 = BigNumber.from(10).pow(18);

export abstract class AbstractAgent implements IAgent {
  public readonly executorType: ExecutorType;
  public readonly address: string;
  private readonly networkName: string;
  protected network: Network;
  public keeperId: number;
  protected contract: ContractWrapper;
  public readonly subgraphUrl: string;
  public readonly dataSourceType: DataSourceType;
  public dataSource: IDataSource;
  private workerSigner: ethers.Wallet;
  private executorConfig: ExecutorConfig;
  private executor: Executor;

  // Agent Config
  private isAgentUp: boolean;
  private minKeeperCvp: BigNumber;
  private fullSyncFrom: number;
  private acceptMaxBaseFeeLimit: boolean;
  private accrueReward: boolean;
  private keeperConfig: number;

  protected jobs: Map<string, LightJob | RandaoJob>;
  protected ownerBalances: Map<string, BigNumber>;
  private ownerJobs: Map<string, Set<string>>;
  private keyAddress: string;
  private keyPass: string;

  // Keeper fields
  protected myStake: BigNumber;
  protected myKeeperIsActive: boolean;
  protected myStakeIsSufficient(): boolean {
    if (this.minKeeperCvp) return this.myStake.gte(this.minKeeperCvp);
    return false;
  }

  // blacklisting by a job key
  protected blacklistedJobs: Set<string>;

  abstract _getSupportedAgentVersions(): string[];

  protected toString(): string {
    return `(network: ${this.networkName}, address: ${this.address}, keeperId: ${this.keeperId || 'Fetching...'})`;
  }

  protected clog(level: string, ...args: unknown[]) {
    logger.log(level, `Agent${this.toString()}: ${args.join(' ')}`);
  }

  protected err(...args: unknown[]): Error {
    return new Error(`AgentError${this.toString()}: ${args.join(' ')}`);
  }

  protected _beforeInit(): void {}
  protected _afterInit(): void {}
  protected async _beforeResyncAllJobs() {}

  protected _afterExecuteEvent(_job: AbstractJob) {}

  constructor(address: string, agentConfig: AgentConfig, networkName: string) {
    this.jobs = new Map();
    this.ownerBalances = new Map();
    this.ownerJobs = new Map();
    this.address = address;
    this.networkName = networkName;
    this.executorType = agentConfig.executor;

    this.keeperConfig = 0;
    this.blacklistedJobs = new Set();

    this.executorConfig = agentConfig.executor_config || {};
    setConfigDefaultValues(this.executorConfig, getDefaultExecutorConfig());

    // Check if all data for subgraph is provided
    if (agentConfig.data_source) {
      if (agentConfig.data_source === 'subgraph') {
        if (!agentConfig.subgraph_url) {
          throw new Error(
            "Please set 'subgraph_url' if you want to proceed with {'data_source': 'subgraph'}. Notice that 'graph_url' is deprecated so please change it to 'subgraph_url'.",
          );
        }
        this.dataSourceType = 'subgraph';
        this.subgraphUrl = agentConfig.subgraph_url;
      } else if (agentConfig.data_source === 'blockchain') {
        this.dataSourceType = 'blockchain';
      } else {
        throw this.err(
          `Invalid agent data_source: ${agentConfig.data_source}. Can be either 'blockchain' or 'subgraph'.`,
        );
      }
    } else {
      this.dataSourceType = 'blockchain';
    }

    if (
      !('keeper_worker_address' in agentConfig) ||
      !agentConfig.keeper_worker_address ||
      agentConfig.keeper_worker_address.length === 0
    ) {
      throw this.err(
        `Missing keeper_worker_address for agent: (network=${networkName},address=${this.address},keeper_address_value=${agentConfig.keeper_worker_address})`,
      );
    }

    if (!('key_pass' in agentConfig) || !agentConfig.key_pass || agentConfig.key_pass.length === 0) {
      throw this.err(
        `Missing key_pass for agent: (network=${networkName},address=${this.address},key_pass_value=${agentConfig.key_pass})`,
      );
    }

    this.keyAddress = ethers.utils.getAddress(agentConfig.keeper_worker_address);
    this.keyPass = agentConfig.key_pass;

    // TODO: move acceptMaxBaseFeeLimit logic to Light agent only
    // if ('accept_max_base_fee_limit' in agentConfig) {
    //   this.acceptMaxBaseFeeLimit = !!agentConfig.accept_max_base_fee_limit;
    //   if (this.acceptMaxBaseFeeLimit) {
    //     this.keeperConfig = this.keeperConfig | FLAG_ACCEPT_MAX_BASE_FEE_LIMIT;
    //   }
    // } else {
    //   this.acceptMaxBaseFeeLimit = false;
    // }

    // accrueReward
    this.accrueReward = !!agentConfig.accrue_reward;
    if (this.accrueReward) {
      this.keeperConfig = this.keeperConfig | FLAG_ACCRUE_REWARD;
    }

    this.fullSyncFrom =
      agentConfig.deployed_at ||
      getAgentDefaultSyncFromSafe(this.address, networkName) ||
      DEFAULT_SYNC_FROM_CHAINS[networkName] ||
      0;
    this.clog('debug', 'Sync from', this.fullSyncFrom);
  }

  public async init(network: Network, dataSource: IDataSource) {
    this.network = network;
    this.dataSource = dataSource;

    await this._beforeInit();

    if (!this.contract) {
      throw this.err('Constructor not initialized');
    }

    this.network.getNewBlockEventEmitter().on('newBlock', this.newBlockEventHandler.bind(this));

    this.network.getNewBlockEventEmitter().on('newBlockDelay', this.newBlockDelayEventHandler.bind(this));

    // Ensure version matches
    // TODO: extract check
    const version = await this.queryContractVersion();
    if (!this._getSupportedAgentVersions().includes(version)) {
      throw this.err(`Invalid version: ${version}`);
    }

    this.keeperId = await this.queryKeeperId(this.keyAddress);
    if (this.keeperId < 1) {
      throw this.err(`Worker address '${this.keyAddress}' is not assigned  to any keeper`);
    }

    await this.initKeeperWorkerKey();

    switch (this.executorType) {
      case 'flashbots':
        // eslint-disable-next-line no-case-declarations
        let wallet;
        try {
          wallet = await Wallet.fromEncryptedJson(
            getEncryptedJson(this.network.getFlashbotsAddress()),
            this.network.getFlashbotsPass(),
          );
        } catch (e) {
          this.clog(
            'error',
            'Flashbots wallet decryption error for the address:',
            this.network.getFlashbotsAddress(),
            e,
          );
          process.exit(0);
        }
        if (wallet.address.toLowerCase() !== this.network.getFlashbotsAddress().toLowerCase()) {
          throw this.err('Flashbots address recovery error');
        }
        wallet.connect(this.network.getProvider());

        this.executor = new FlashbotsExecutor(this.network, this.workerSigner, wallet, this.contract);
        break;
      case 'pga':
        this.executor = new PGAExecutor(this.network, this.workerSigner, this.contract, this.executorConfig);
        break;
      default:
        throw this.err(`Invalid executor type: '${this.executorType}'. Only 'flashbots' and 'pga' are supported.`);
    }

    const keeperConfig = await this.queryKeeperDetails(this.keeperId);
    this.myStake = keeperConfig.currentStake;
    this.myKeeperIsActive = keeperConfig.isActive;

    if (toChecksummedAddress(this.workerSigner.address) !== toChecksummedAddress(keeperConfig.worker)) {
      throw this.err(
        `The worker address for the keeper #${this.keeperId} stored on chain (${keeperConfig.worker}) doesn't match the one specified in config (${this.workerSigner.address}).`,
      );
    }

    this.clog(
      'info',
      `My Keeper Details: (keeperId=${this.keeperId},workerAddress=${keeperConfig.worker},stake=${this.myStake},isActive=${this.myKeeperIsActive})`,
    );

    // Task #1
    const agentConfig = await this.queryAgentConfig();
    this.minKeeperCvp = agentConfig.minKeeperCvp_;
    if (keeperConfig.currentStake.lt(agentConfig.minKeeperCvp_)) {
      throw this.err(
        `The keeper's stake for agent '${this.address}' is insufficient: ${keeperConfig.currentStake.div(
          BIG_NUMBER_1E18,
        )} CVP (actual) < ${this.minKeeperCvp.div(BIG_NUMBER_1E18)} CVP (required).`,
      );
    }
    this.clog('info', `Keeper stake: (current=${keeperConfig.currentStake},min=${this.minKeeperCvp})`);
    // TODO: track agent SetAgentParams
    // TODO: assert the keeper has enough CVP for a job
    // TODO: set event listener for the global contract change

    // this.workerNonce = await this.network.getProvider().getTransactionCount(this.workerSigner.address);
    await this.executor.init();

    await this._beforeResyncAllJobs();

    // Task #2
    this.isAgentUp = this.myKeeperIsActive && this.myStakeIsSufficient();
    const upTo = await this.resyncAllJobs();
    this.initializeListeners(upTo);
    // setTimeout(this.verifyLastExecutionAtLoop.bind(this), 3 * 60 * 1000);

    await this._afterInit();
    this.clog('info', '✅ Agent initialization done!');
  }

  private async initKeeperWorkerKey() {
    const keyString = getEncryptedJson(this.keyAddress);
    if (!keyString) {
      throw this.err(`Empty JSON key for address ${this.keyAddress}`);
    }

    const beforeDecrypt = this.nowMs();
    try {
      this.workerSigner = await ethers.Wallet.fromEncryptedJson(keyString, this.keyPass);
    } catch (e) {
      throw this.err(`Error decrypting JSON key for address ${this.keyAddress}`, e);
    }
    this.clog('info', `${this.keyAddress} worker key decryption time: ${this.nowMs() - beforeDecrypt}ms.`);
    this.workerSigner.connect(this.getNetwork().getProvider());
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private newBlockEventHandler(blockTimestamp, blockNumber) {
    this.activateOrTerminateAgentIfRequired();
    if (this.network.isBlockDelayAboveMax()) {
      this.executor.sendBlockDelayLog(this, this.network.blockDelay(), blockNumber);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private newBlockDelayEventHandler(blockNumber) {
    this.executor.sendNewBlockDelayLog(this, this.network.getMaxNewBlockDelay(), blockNumber);
  }

  public exitIfStrictTopic(topic) {
    this.network.exitIfStrictTopic(topic);
  }

  public addJobToBlacklist(jobKey, errMessage) {
    this.clog('info', `addJobToBlacklist: ${jobKey}, errMessage ${errMessage}`);
    this.blacklistedJobs.add(jobKey);
    this.executor.sendAddBlacklistedJob(this, jobKey, errMessage);
  }

  public getJobOwnerBalance(address: string): BigNumber {
    if (!this.ownerBalances.has(address)) {
      throw this.err(`getJobOwnerBalance(): Address ${address} not tracked`);
    }
    return this.ownerBalances.get(address);
  }

  public getNetwork(): Network {
    return this.network;
  }

  public getExecutor(): Executor {
    return this.executor;
  }

  public getDataSource(): IDataSource {
    return this.dataSource;
  }

  public nowS(): number {
    return this.network.nowS();
  }

  public nowMs(): number {
    return this.network.nowMs();
  }

  public getAddress(): string {
    return this.address;
  }

  public getIsAgentUp(): boolean {
    return this.isAgentUp;
  }

  public getKeyAddress(): string {
    return this.keyAddress;
  }

  public getKeeperId(): number {
    return this.keeperId;
  }

  public getCfg(): number {
    return this.keeperConfig;
  }

  public isJobBlacklisted(jobKey: string): boolean {
    return this.blacklistedJobs.has(jobKey);
  }

  public getJob(jobKey: string): RandaoJob | LightJob | null {
    return this.jobs.get(jobKey);
  }
  public getJobsCount(): { total: number; interval: number; resolver: number } {
    const counters = {
      total: 0,
      interval: 0,
      resolver: 0,
    };
    for (const job of this.jobs.values()) {
      if (job.isIntervalJob()) counters.interval++;
      else counters.resolver++;

      counters.total++;
    }
    return counters;
  }

  public getStatusObjectForApi(): object {
    const jobs = [];
    for (const job of this.jobs.values()) {
      jobs.push(job.getStatusObjectForApi());
    }

    const jobOwnerBalances = Object.fromEntries(
      Array.from(this.ownerBalances).map(pair => [pair[0], { wei: pair[1].toString(), eth: weiValueToEth(pair[1]) }]),
    );

    return {
      isAgentUp: this.isAgentUp,
      keeperStakeCvpWei: this.myStake?.toString(),
      keeperStakeCvp: weiValueToEth(this.myStake),
      address: this.address,
      workerAddress: this.keyAddress,
      keeperId: this.keeperId,
      keeperConfigNumeric: this.keeperConfig,
      supportedAgentVersions: this._getSupportedAgentVersions(),
      fullSyncFrom: this.fullSyncFrom,
      minKeeperCvpWei: this.minKeeperCvp?.toString(),
      minKeeperCvp: weiValueToEth(this.minKeeperCvp),
      accrueReward: this.accrueReward,
      acceptMaxBaseFeeLimit: this.acceptMaxBaseFeeLimit,
      subgraphUrl: this.subgraphUrl,
      dataSourceType: this.dataSourceType,
      jobsCounter: this.getJobsCount(),
      executor: this.executor?.getStatusObjectForApi(),

      jobOwnerBalances,
      ownerJobs: Object.fromEntries(Array.from(this.ownerJobs).map(pair => [pair[0], Array.from(pair[1])])),

      jobs,
    };
  }

  /**
   * Job Update Pipeline:
   * 1. Handle RegisterJob events
   * 2. Handle JobUpdate events
   * 3. Handle SetJobResolver events
   * 4. Handle SetJobResolver events
   * @private
   */
  private async resyncAllJobs(): Promise<number> {
    const latestBock = this.network.getLatestBlockNumber();
    // 1. init jobs
    let newJobs = new Map<string, RandaoJob | LightJob>();
    newJobs = await this.dataSource.getRegisteredJobs(this);

    // 2. set owners
    const jobOwnersSet = new Set<string>();
    const jobKeys = Array.from(newJobs.keys());
    for (let i = 0; i < jobKeys.length; i++) {
      const job = newJobs.get(jobKeys[i]);
      const owner = job.getOwner();
      jobOwnersSet.add(owner);
      if (!this.ownerJobs.has(owner)) {
        this.ownerJobs.set(owner, new Set());
      }
      job.finalizeInitialization();
      const set = this.ownerJobs.get(owner);
      set.add(jobKeys[i]);
    }

    // 3. Load job owner balances
    this.ownerBalances = await this.dataSource.getOwnersBalances(this, jobOwnersSet);
    this.jobs = newJobs;

    await this.startAllJobs();

    return Number(latestBock);
  }
  abstract _buildNewJob(event): LightJob | RandaoJob;

  private async addJob(creationEvent: EventWrapper) {
    const jobKey = creationEvent.args.jobKey;
    const owner = creationEvent.args.owner;

    const job = this._buildNewJob(creationEvent);
    this.jobs.set(jobKey, job);

    await this.dataSource.addLensFieldsToOneJob(job);
    job.clearJobCredits();

    if (!this.ownerJobs.has(owner)) {
      this.ownerJobs.set(owner, new Set());
    }
    const set = this.ownerJobs.get(owner);
    set.add(jobKey);

    if (!this.ownerBalances.has(owner)) {
      this.ownerBalances.set(owner, BN_ZERO);
    }
  }

  public async updateJob(jobObj) {
    return this.dataSource.addLensFieldsToOneJob(jobObj);
  }

  protected startAllJobs() {
    for (const [, job] of this.jobs) {
      job.watch();
    }
  }

  protected stopAllJobs() {
    for (const [, job] of this.jobs) {
      job.unwatch();
    }
  }

  public registerIntervalJobExecution(jobKey: string, timestamp: number, callback: (calldata) => void) {
    this.network.registerTimeout(`${this.address}/${jobKey}/execution`, timestamp, callback);
  }

  public unregisterIntervalJobExecution(jobKey: string) {
    this.network.unregisterTimeout(`${this.address}/${jobKey}/execution`);
  }

  public registerResolver(jobKey: string, resolver: Resolver, callback: (calldata) => void) {
    this.network.registerResolver(`${this.address}/${jobKey}`, resolver, callback);
  }

  public unregisterResolver(jobKey: string) {
    this.network.unregisterResolver(`${this.address}/${jobKey}`);
  }

  public async sendTxEnvelope(envelope: TxEnvelope) {
    await this.trySendExecuteEnvelope(envelope);
  }

  getBaseFeePerGas(multiplier = 2n) {
    return BigInt(this.network.getBaseFee() * multiplier);
  }

  protected async populateTxExtraFields(tx: UnsignedTransaction) {
    tx.chainId = this.network.getChainId();
    tx['from'] = this.workerSigner.address;
    const baseFeePerGas = this.getBaseFeePerGas();
    const priorityFeeAddGwei = BigInt(this.executorConfig.gas_price_priority_add_gwei);
    const maxPriorityFeePerGas = await this.network
      .getMaxPriorityFeePerGas()
      .catch(() => priorityFeeAddGwei * 1000000000n);
    tx.maxPriorityFeePerGas = BigInt(maxPriorityFeePerGas) + priorityFeeAddGwei * 1000000000n;
    tx.maxFeePerGas = baseFeePerGas + tx.maxPriorityFeePerGas;
  }

  public async buildTx(calldata: string): Promise<UnsignedTransaction> {
    return {
      to: this.getAddress(),

      data: calldata,

      // Typed-Transaction features
      type: 2,

      // EIP-1559; Type 2
      // maxFeePerGas: this.getBaseFeePerGas(),
    };
  }

  async txNotMinedInBlock(tx: UnsignedTransaction, txHash: string): Promise<TxGasUpdate> {
    const receipt = await this.network.getProvider().getTransactionReceipt(txHash);
    if (receipt) {
      return { action: 'ignore' };
    }
    const { maxPriorityFeePerGas } = tx;
    await this.populateTxExtraFields(tx);
    const priorityIncrease = (tx.maxPriorityFeePerGas * 100n) / maxPriorityFeePerGas;
    // console.log(
    //   'tx.maxPriorityFeePerGas',
    //   tx.maxPriorityFeePerGas,
    //   'maxPriorityFeePerGas',
    //   maxPriorityFeePerGas,
    //   'priorityIncrease',
    //   priorityIncrease,
    // );
    if (priorityIncrease < 110n) {
      tx.maxPriorityFeePerGas = (maxPriorityFeePerGas * 111n) / 100n;
    }
    const newMax = this.getBaseFeePerGas() + tx.maxPriorityFeePerGas;
    //TODO: check nonce
    //TODO: check resends count and max feePerGas

    // this.clog('Warning: txNotMinedInBlock', tx);
    // this.exitIfStrictTopic('executions');
    return {
      action: 'replace',
      newMax,
      newPriority: tx.maxPriorityFeePerGas,
    };
  }

  txExecutionFailed(err, txData) {
    this.parseAndSetUnrecognizedErrorMessage(err);
    this.clog('error', `txExecutionFailed: ${err.message}, txData: ${txData}`);
  }

  txEstimationFailed(err, txData) {
    this.parseAndSetUnrecognizedErrorMessage(err);
    this.clog('error', `txEstimationFailed: ${err.message}, txData: ${txData}`);
  }

  private parseAndSetUnrecognizedErrorMessage(err) {
    try {
      let decodedError;
      const reason = err.reason || (err.message && err.message.toString());
      if (reason && reason.includes('unrecognized custom error')) {
        decodedError = this.contract.decodeError(reason.split('data: ')[1].slice(0, -1));
      } else if (reason && reason.includes('error={"code":3')) {
        // 'cannot estimate gas; transaction may fail or may require manual gas limit [ See: https://links.ethers.org/v5-errors-UNPREDICTABLE_GAS_LIMIT ] (reason="execution reverted", method="estimateGas", transaction={"from":"0x779bEfe2b4C43cD1F87924defd13c8b9d3B1E1d8","maxPriorityFeePerGas":{"type":"BigNumber","hex":"0x05196259dd"},"maxFeePerGas":{"type":"BigNumber","hex":"0x05196259ed"},"to":"0x071412e301C2087A4DAA055CF4aFa2683cE1e499","data":"0x00000000ef0b5a45ff9b79d4b9162130bf0cd44dcf68b90d0000010200003066f23ebc0000000000000000000000000000000000000000000000000000000000000000","type":2,"accessList":null}, error={"code":3,"response":"{\"jsonrpc\":\"2.0\",\"id\":20442,\"error\":{\"code\":3,\"message\":\"execution reverted\",\"data\":\"0xbe32c0ad\"}}\n"}, code=UNPREDICTABLE_GAS_LIMIT, version=providers/5.7.2)'
        // ->
        // '{"code":3,"response":{"jsonrpc":"2.0","id":20442,"error":{"code":3,"message":"execution reverted","data":"0xbe32c0ad"}}}'
        const responseJson = reason
          .split('error=')[1]
          .split(', code=UNPREDICTABLE_GAS_LIMIT')[0]
          .replace('\n', '')
          .replace('}"', '}')
          .replace('"{', '{');
        decodedError = this.contract.decodeError(JSON.parse(responseJson).response.error.data);
      }
      err.message =
        `Error: VM Exception while processing transaction: reverted with ${decodedError.name} ` +
        `decoded error and ${JSON.stringify(decodedError.args)} args`;
    } catch (_) {}
  }

  private async trySendExecuteEnvelope(envelope: TxEnvelope) {
    const { tx, jobKey /*, _ppmCompensation, _fixedCompensation, _creditsAvailable*/ } = envelope;
    if (tx.maxFeePerGas === 0n) {
      this.clog('warn', `Dropping tx due job gasPrice limit: (data=${tx.data})`);
      return;
    }
    await this.populateTxExtraFields(tx);
    // const minTxFee = BigNumber.from(tx.maxFeePerGas)
    //   .add(tx.maxPriorityFeePerGas)
    //   .mul(MIN_EXECUTION_GAS)
    //   .mul(ppmCompensation)
    //   .div(100)
    //   .add(fixedCompensation);

    // TODO: rewrite this estimation with a new randao formula
    // if (minTxFee.gt(creditsAvailable)) {
    //   this.clog(`⛔️ Ignoring a tx with insufficient credits: (data=${tx.data},required=${minTxFee},available=${creditsAvailable})`);
    // } else {
    this.executor.push(`${this.address}/${jobKey}`, envelope);
    // }
  }

  protected async _sendNonExecuteTransaction(envelope: TxEnvelope) {
    await this.populateTxExtraFields(envelope.tx);
    return this.executor.push(`other-tx-type/${this.nowMs()}`, envelope);
  }

  protected activateOrTerminateAgentIfRequired() {
    if (
      !this.isAgentUp &&
      this.myStakeIsSufficient() &&
      this.myKeeperIsActive &&
      !this.network.isBlockDelayAboveMax()
    ) {
      this.activateAgent();
    } else if (
      this.isAgentUp &&
      !this.isAssignedJobsInProcess() &&
      !(this.myStakeIsSufficient() && this.myKeeperIsActive && !this.network.isBlockDelayAboveMax())
    ) {
      this.terminateAgent();
    }
  }

  private activateAgent() {
    this.clog(
      'info',
      `Activate agent, minKeeperCvp: ${ethers.utils.formatEther(
        this.minKeeperCvp,
      )}, myStake: ${ethers.utils.formatEther(this.myStake)}`,
    );
    this.isAgentUp = true;
    this.startAllJobs();
  }

  private terminateAgent() {
    this.clog(
      'info',
      `Terminate agent, minKeeperCvp: ${ethers.utils.formatEther(
        this.minKeeperCvp,
      )}, myStake: ${ethers.utils.formatEther(this.myStake)}, delay: ${this.network.blockDelay()}`,
    );
    this.isAgentUp = false;
    this.stopAllJobs();
  }

  abstract _afterInitializeListeners(blockNumber: number);

  private async queryAgentConfig(): Promise<any> {
    return this.contract.ethCall('getConfig');
  }

  private async queryContractVersion(): Promise<string> {
    return this.contract.ethCall('VERSION');
  }

  private async queryKeeperId(workerAddress: string): Promise<number> {
    return parseInt(await this.contract.ethCall('workerKeeperIds', [workerAddress]));
  }

  private async queryKeeperDetails(keeperId: number): Promise<any> {
    return await this.contract.ethCall('getKeeper', [keeperId]);
  }

  public async queryPastEvents(eventName: string, from: number, to: number): Promise<any> {
    return this.contract.getPastEvents(eventName, from, to);
  }

  protected on(eventName: string, callback: (event: any) => void) {
    this.network.getContractEventEmitter(this.contract).on(eventName, callback);
  }

  protected initializeListeners(blockNumber: number) {
    // Job events
    this.on('DepositJobCredits', event => {
      const { jobKey, amount, fee } = event.args;

      this.clog(
        'debug',
        `'DepositJobCredits' event: (block=${event.blockNumber},jobKey=${jobKey},amount=${amount},fee=${fee})`,
      );

      if (!this.jobs.has(jobKey)) {
        this.clog('error', `Ignoring DepositJobCredits event due the job missing: (jobKey=${jobKey})`);
      }

      const job = this.jobs.get(jobKey);
      job.applyJobCreditsDeposit(BigNumber.from(amount));
      job.watch();
    });

    this.on('WithdrawJobCredits', event => {
      const { jobKey, amount } = event.args;

      this.clog('debug', `'WithdrawJobCredits' event: (block=${event.blockNumber},jobKey=${jobKey},amount=${amount})`);

      const job = this.jobs.get(jobKey);
      job.applyJobCreditWithdrawal(BigNumber.from(amount));
      job.watch();
    });

    this.on('DepositJobOwnerCredits', event => {
      const { jobOwner, amount, fee } = event.args;

      this.clog(
        'debug',
        `'DepositJobOwnerCredits' event: (block=${event.blockNumber},jobOwner=${jobOwner},amount=${amount},fee=${fee})`,
      );

      if (this.ownerBalances.has(jobOwner)) {
        const newBalance = this.ownerBalances.get(jobOwner).add(BigNumber.from(amount));
        this.ownerBalances.set(jobOwner, newBalance);
      } else {
        this.ownerBalances.set(jobOwner, BigNumber.from(amount));
      }

      if (this.ownerJobs.has(jobOwner)) {
        for (const jobKey of this.ownerJobs.get(jobOwner)) {
          this.jobs.get(jobKey).watch();
        }
      }
    });

    this.on('WithdrawJobOwnerCredits', event => {
      const { jobOwner, amount } = event.args;

      this.clog(
        'debug',
        `'WithdrawJobOwnerCredits' event: (block=${event.blockNumber},jobOwner=${jobOwner},amount=${amount})`,
      );

      if (this.ownerBalances.has(jobOwner)) {
        const newBalance = this.ownerBalances.get(jobOwner).sub(BigNumber.from(amount));
        this.ownerBalances.set(jobOwner, newBalance);
      } else {
        throw this.err(`On 'WithdrawJobOwnerCredits' event: The owner is not initialized: ${jobOwner}`);
      }

      if (this.ownerJobs.has(jobOwner)) {
        for (const jobKey of this.ownerJobs.get(jobOwner)) {
          this.jobs.get(jobKey).watch();
        }
      }
    });

    this.on('AcceptJobTransfer', event => {
      const { jobKey_, to_: ownerAfter } = event.args;

      this.clog(
        'debug',
        `'AcceptJobTransfer' event: (block=${event.blockNumber},jobKey_=${jobKey_},to_=${ownerAfter})`,
      );

      const job = this.jobs.get(jobKey_);
      const ownerBefore = job.getOwner();
      this.ownerJobs.get(ownerBefore).delete(jobKey_);

      if (!this.ownerJobs.has(ownerAfter)) {
        this.ownerJobs.set(ownerAfter, new Set());
      }
      this.ownerJobs.get(ownerAfter).add(jobKey_);

      job.applyOwner(ownerAfter);
      job.watch();
    });

    this.on('JobUpdate', event => {
      const { jobKey, maxBaseFeeGwei, rewardPct, fixedReward, jobMinCvp, intervalSeconds } = event.args;

      this.clog(
        'debug',
        `'JobUpdate' event: (block=${event.blockNumber},jobKey=${jobKey},maxBaseFeeGwei=${maxBaseFeeGwei},reardPct=${rewardPct},fixedReward=${fixedReward},jobMinCvp=${jobMinCvp},intervalSeconds=${intervalSeconds})`,
      );

      const job = this.jobs.get(jobKey);
      job.applyUpdate(maxBaseFeeGwei, rewardPct, fixedReward, jobMinCvp, intervalSeconds);
      job.watch();
    });

    this.on('SetJobPreDefinedCalldata', event => {
      const { jobKey, preDefinedCalldata } = event.args;

      this.clog(
        'debug',
        `'SetJobPreDefinedCalldata' event: (block=${event.blockNumber},jobKey=${jobKey},preDefinedCalldata=${preDefinedCalldata})`,
      );

      const job = this.jobs.get(jobKey);
      job.applyPreDefinedCalldata(preDefinedCalldata);
      job.watch();
    });

    this.on('SetJobResolver', event => {
      const { jobKey, resolverAddress, resolverCalldata } = event.args;

      this.clog(
        'debug',
        `'SetJobResolver' event: (block=${event.blockNumber},jobKey=${jobKey},resolverAddress=${resolverAddress},useJobOwnerCredits_=${resolverCalldata})`,
      );

      const job = this.jobs.get(jobKey);
      job.applyResolver(resolverAddress, resolverCalldata);
      job.watch();
    });

    this.on('SetJobConfig', async event => {
      const { jobKey, isActive_, useJobOwnerCredits_, assertResolverSelector_ } = event.args;

      this.clog(
        'debug',
        `'SetJobConfig' event: (block=${event.blockNumber},jobKey=${jobKey},isActive=${isActive_},useJobOwnerCredits_=${useJobOwnerCredits_},assertResolverSelector_=${assertResolverSelector_})`,
      );

      const job = this.jobs.get(jobKey);
      const binJob = await this.network.queryLensJobsRawBytes32(this.address, jobKey);
      job.applyBinJobData(binJob);
      job.watch();
    });

    this.on('RegisterJob', async event => {
      const { jobKey, jobAddress, jobId, owner, params } = event.args;

      this.clog(
        'debug',
        `'RegisterJob' event: (block=${
          event.blockNumber
        },jobKey=${jobKey},jobAddress=${jobAddress},jobId=${jobId},owner=${owner},params=${JSON.stringify(params)})`,
      );

      await this.addJob(event);
    });

    this.on('Execute', event => {
      const { jobKey, job: jobAddress, keeperId, gasUsed, baseFee, gasPrice, compensation, binJobAfter } = event.args;

      this.clog(
        'debug',
        `'Execute' event: (block=${
          event.blockNumber
        },jobKey=${jobKey},jobAddress=${jobAddress},keeperId=${numberToBigInt(keeperId)},gasUsed=${numberToBigInt(
          gasUsed,
        )},baseFee=${numberToBigInt(baseFee)}gwei,gasPrice=${numberToBigInt(gasPrice)}wei,compensation=${weiValueToEth(
          compensation,
        )}eth/${numberToBigInt(compensation)}wei,binJobAfter=${binJobAfter})`,
      );

      const job = this.jobs.get(jobKey);
      job.applyBinJobData(binJobAfter);
      job.applyWasExecuted();

      if (job.creditsSourceIsJobOwner()) {
        const ownerCreditsBefore = this.ownerBalances.get(job.getOwner());
        const ownerCreditsAfter = ownerCreditsBefore.sub(compensation);
        this.clog(
          'debug',
          `Owner balance credited: (jobOwner=${job.getOwner()},amount=${compensation.toString()},before=${ownerCreditsBefore},after=${ownerCreditsAfter}`,
        );
        this.ownerBalances.set(job.getOwner(), ownerCreditsAfter);
      }

      this._afterExecuteEvent(job);

      job.watch();
    });

    // Agent events
    this.on('SetAgentParams', event => {
      const { minKeeperCvp_, timeoutSeconds_, feePct_ } = event.args;

      this.clog(
        'debug',
        `'SetAgentParams' event: (block=${event.blockNumber},minKeeperCvp_=${minKeeperCvp_},timeoutSeconds_=${timeoutSeconds_},feePct_=${feePct_})`,
      );

      this.clog('debug', "'SetAgentParams' event requires the bot to be restarted");
      process.exit(0);
    });

    // Keeper events
    this.on('Stake', event => {
      const { keeperId, amount } = event.args;
      if (this.keeperId == keeperId) {
        this.clog('debug', `Stake for a keeperId ${keeperId}. Amount of stake is ${amount}.`);

        this.myStake = this.myStake.add(amount);

        this.activateOrTerminateAgentIfRequired();
      }
    });

    this.on('InitiateRedeem', event => {
      const { keeperId, redeemAmount } = event.args;
      if (this.keeperId == keeperId) {
        this.clog('debug', `Redeem from a keeperId ${keeperId}. Amount of redeem is ${redeemAmount}.`);

        this.myStake = this.myStake.sub(redeemAmount);

        this.activateOrTerminateAgentIfRequired();
      }
    });

    this.on('DisableKeeper', event => {
      const keeperId = event.args[0];
      if (this.keeperId == keeperId) {
        this.clog('debug', 'Keeper is disabled.');
        this.myKeeperIsActive = false;

        (async () => {
          while (this.isAssignedJobsInProcess()) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          this.clog('debug', 'Deactivate Keeper.');
          this.activateOrTerminateAgentIfRequired();
        })();
      }
    });

    this.on('FinalizeKeeperActivation', event => {
      const keeperId = event.args[0];
      if (this.keeperId == keeperId) {
        this.clog('debug', `Keeper with id ${keeperId} is enabled.`);

        this.myKeeperIsActive = true;
        this.activateOrTerminateAgentIfRequired();
      }
    });
    this._afterInitializeListeners(blockNumber);
  }

  /**
   * Checks whether there are assigned jobs currently in progress for the keeper.
   * This function verifies if any jobs in the 'jobs' map have the same assigned keeper ID as the current keeper.
   * Additionally, it checks if the block delay is not above the maximum threshold.
   *
   * @returns boolean indicating whether there are assigned jobs in progress for the keeper.
   */
  public isAssignedJobsInProcess() {
    return (
      Array.from(this.jobs.values()).some(job => (job as RandaoJob).assignedKeeperId === this.keeperId) &&
      !this.network.isBlockDelayAboveMax()
    );
  }
}
