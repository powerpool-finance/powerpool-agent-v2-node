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
  SourceMetadata,
  TxEnvelope,
  TxGasUpdate,
  UnsignedTransaction,
} from '../Types.js';
import { BigNumber, ethers, Wallet } from 'ethers';
import { getEncryptedJson } from '../services/KeyService.js';
import { BN_ZERO, DEFAULT_SYNC_FROM_CHAINS } from '../Constants.js';
import {
  filterFunctionResultObject,
  numberToBigInt,
  toChecksummedAddress,
  weiValueToEth,
  jsonStringify,
} from '../Utils.js';
import { FlashbotsExecutor } from '../executors/FlashbotsExecutor.js';
import { PGAExecutor } from '../executors/PGAExecutor.js';
import { getAgentDefaultSyncFromSafe, getDefaultExecutorConfig, setConfigDefaultValues } from '../ConfigGetters.js';
import { getPPAgentVersionInterface } from '../services/AbiService.js';
import { LightJob } from '../jobs/LightJob.js';
import { RandaoJob } from '../jobs/RandaoJob.js';
import { AbstractJob } from '../jobs/AbstractJob';
import logger from '../services/Logger.js';

// const FLAG_ACCEPT_MAX_BASE_FEE_LIMIT = 1;
const FLAG_ACCRUE_REWARD = 2;
// const BIG_NUMBER_1E18 = BigNumber.from(10).pow(18);

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
  // currently ignored, will need this for legacy tx support
  // type2 is eip1559
  private useType2TxFeeData: boolean;

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

  abstract _isVersionSupported(version): boolean;

  protected toString(): string {
    return `(network: ${this.networkName}, address: ${this.address}, keeperId: ${this.keeperId || 'Fetching...'})`;
  }

  protected clog(level: string, ...args: unknown[]) {
    logger.log(level, `Agent${this.toString()}: ${args.join(' ')}`);
  }

  protected err(...args: unknown[]): Error {
    return new Error(`AgentError${this.toString()}: ${args.join(' ')}`);
  }

  protected _beforeInit(_version: string): void {}
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
    this.dataSourceType = (agentConfig.data_source || 'blockchain') as DataSourceType;
    this.subgraphUrl = agentConfig.subgraph_url;

    if (this.dataSourceType === 'subgraph' || this.dataSourceType === 'subquery') {
      if (!this.subgraphUrl) {
        throw new Error(`Please set 'subgraph_url' if you want to use {'data_source': '${this.dataSourceType}'}.`);
      }
    } else if (this.dataSourceType !== 'blockchain') {
      throw this.err(
        `Invalid data_source: ${agentConfig.data_source}. Can be either 'blockchain', 'subgraph' or 'subquery'.`,
      );
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

  public async init(network: Network, dataSource: IDataSource): Promise<number> {
    this.network = network;
    this.dataSource = dataSource;

    const version = await this.queryAgentVersion();
    this.clog('info', `Contract version: ${version}`);

    if (!this._isVersionSupported(version)) {
      throw this.err(`Version not supported: ${version}`);
    }

    await this._beforeInit(version);

    if (!this.contract) {
      throw this.err('Constructor not initialized');
    }

    this.network.getNewBlockEventEmitter().on('newBlock', this.newBlockEventHandler.bind(this));

    this.network.getNewBlockEventEmitter().on('newBlockDelay', this.newBlockDelayEventHandler.bind(this));

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
    if (!this.myKeeperIsActive) {
      this.clog('warn', `Your keeper(${this.keeperId}) is not active in agent contract(${this.contract.address})`);
    }

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
    this.clog('info', `Keeper stake: (current=${keeperConfig.currentStake},min=${this.minKeeperCvp})`);
    // TODO: track agent SetAgentParams
    // TODO: assert the keeper has enough CVP for a job
    // TODO: set event listener for the global contract change

    // this.workerNonce = await this.network.getProvider().getTransactionCount(this.workerSigner.address);
    await this.executor.init();

    const upTo = await this.checkStatusAndResyncAllJobs();
    this.initializeListeners(upTo);
    // setTimeout(this.verifyLastExecutionAtLoop.bind(this), 3 * 60 * 1000);

    await this._afterInit();
    this.clog('info', '✅ Agent initialization done!');
    return upTo;
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

  public removeJobFromBlacklist(jobKey, reason) {
    if (!this.isJobBlacklisted(jobKey)) {
      return;
    }
    this.clog('info', `removeJobFromBlacklist: ${jobKey}, reason ${reason}`);
    this.blacklistedJobs.delete(jobKey);
    this.executor.sendRemoveBlacklistedJob(this, jobKey, reason);
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

  public async getJob(jobKey: string): Promise<RandaoJob | LightJob | null> {
    let job = this.jobs.get(jobKey);
    if (!job) {
      job = await this.dataSource.getJob(this, jobKey);
      await this.addJob(job);
    }
    return job;
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

  public async checkStatusAndResyncAllJobs(): Promise<number> {
    await this._beforeResyncAllJobs();

    // Task #2
    this.isAgentUp = this.myKeeperIsActive && this.myStakeIsSufficient();
    return this.resyncAllJobs();
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
    this.clog('info', 'resyncAllJobs: Start');

    this.stopAllJobs();

    this.clog('info', 'resyncAllJobs: All jobs stopped');

    let latestBock = this.network.getLatestBlockNumber();
    // 1. init jobs
    let newJobs = new Map<string, RandaoJob | LightJob>(),
      sourceMeta: SourceMetadata = null;
    //TODO: handle timeout error on getting all jobs from blockchain
    ({ data: newJobs, meta: sourceMeta } = await this.dataSource.getRegisteredJobs(this));

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
    this.ownerBalances = await this.dataSource.getOwnersBalances(this, jobOwnersSet).then(r => r.data);
    this.jobs = newJobs;

    await this.startAllJobs();

    if (this.dataSource.getType() === 'subgraph' && this.networkName !== 'testnet' && sourceMeta.diff > 10) {
      latestBock = sourceMeta.sourceBlockNumber;
    }

    this.clog('info', `resyncAllJobs: End (${Array.from(this.jobs.keys()).length} synced)`);

    return Number(latestBock);
  }
  abstract _buildNewJob(event): LightJob | RandaoJob;

  private async addJobByRegisterEvent(creationEvent: EventWrapper) {
    return this.addJob(this._buildNewJob(creationEvent));
  }

  private async addJob(job: LightJob | RandaoJob) {
    this.jobs.set(job.getKey(), job);

    await this.dataSource.addLensFieldsToOneJob(job);
    job.clearJobCredits();

    if (!this.ownerJobs.has(job.getOwner())) {
      this.ownerJobs.set(job.getOwner(), new Set());
    }
    const set = this.ownerJobs.get(job.getOwner());
    set.add(job.getKey());

    if (!this.ownerBalances.has(job.getOwner())) {
      this.ownerBalances.set(job.getOwner(), BN_ZERO);
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
    this.clog('debug', 'stopAllJobs');
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

  public async buildTx(calldata: string): Promise<UnsignedTransaction> {
    return {
      to: this.getAddress(),
      data: calldata,
      type: /*this.useType2TxFeeData*/ true ? 2 : 0,
    };
  }

  public async sendTxEnvelope(envelope: TxEnvelope) {
    try {
      await this.trySendExecuteEnvelope(envelope);
    } catch (e) {
      try {
        this.clog('error', `Error sending tx envelope: ${e}. Tx: ${JSON.stringify(envelope.tx)}. ${e?.stack}`);
      } catch (ee) {
        this.clog('error', `Error sending tx envelope: ${e?.stack}`);
      }
    }
  }

  getBaseFeePerGas(multiplier = 2n) {
    return BigInt(this.network.getBaseFee() * multiplier);
  }

  // get tx type 0 fees
  protected async getLegacyTxFeeData(): Promise<bigint> {
    return this.network.queryGasPrice();
  }

  // get tx type 2 fees
  protected async getEip1559TxFeeData(): Promise<{ baseFeePerGas: bigint; maxPriority: bigint }> {
    const baseFeePerGas = this.network.getBaseFee();

    try {
      // Attempt to build EIP1559 gas fee values
      const maxPriority = BigInt(await this.network.queryMaxPriorityFeePerGas());
      return { baseFeePerGas, maxPriority };
    } catch (e) {
      // NOTICE: For BSC it's better to implement pre-eip1559 txs.
      throw new Error('Pre-EIP1559 txs are not supported');
    }
  }

  public getWorkerSignerAddress() {
    return this.workerSigner.address;
  }

  public getWorkerSigner() {
    return this.workerSigner;
  }

  protected async populateTxExtraFields(tx: UnsignedTransaction) {
    tx.chainId = this.network.getChainId();
    tx['from'] = this.getWorkerSignerAddress();

    if (true /* this.useType2TxFeeData */) {
      tx.type = 2;

      let priorityFeeExtraFromConfig = 0n;
      if (this.executorConfig.gas_price_priority_add_gwei) {
        priorityFeeExtraFromConfig = BigInt(this.executorConfig.gas_price_priority_add_gwei);
      }
      const { baseFeePerGas, maxPriority } = await this.getEip1559TxFeeData();
      this.clog(
        'debug',
        `populateTxExtraFields: getEip1559TxFeeData(baseFeePerGas: ${baseFeePerGas}, maxPriority: ${maxPriority}`,
      );
      if (priorityFeeExtraFromConfig > 0n) {
        tx.maxPriorityFeePerGas = maxPriority + priorityFeeExtraFromConfig * 1000000000n;
      } else {
        tx.maxPriorityFeePerGas = (maxPriority * 15n) / 10n;
      }
      tx.maxFeePerGas = baseFeePerGas + tx.maxPriorityFeePerGas;
    } else {
      tx.type = 0;
      tx.gasPrice = await this.network.queryGasPrice();
    }
  }

  // WARNING: Missing support for Legacy tx replacement
  async txNotMinedInBlock(tx: UnsignedTransaction, txHash: string): Promise<TxGasUpdate> {
    const receipt = await this.network.getProvider().getTransactionReceipt(txHash);
    if (receipt) {
      return { action: 'ignore' };
    }
    const { maxPriorityFeePerGas } = tx;
    await this.populateTxExtraFields(tx);
    const priorityIncrease = (tx.maxPriorityFeePerGas * 100n) / maxPriorityFeePerGas;
    if (priorityIncrease < 110n) {
      tx.maxPriorityFeePerGas = (maxPriorityFeePerGas * 111n) / 100n;
    }
    const baseFeePerGas = this.network.getBaseFee();
    const newMax = baseFeePerGas + tx.maxPriorityFeePerGas;
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

  public parseAndSetUnrecognizedErrorMessage(err) {
    const iface = this.contract;
    const parseError = iface.decodeError.bind(iface);
    let errMessage, decodedError, errorCase, errorObj;
    try {
      if (err.reason && err.reason !== 'execution reverted' && !err.reason.includes('without a reason string')) {
        errMessage = err.reason;
      } else {
        errMessage = err.message && err.message.toString();
      }

      if (errMessage && errMessage.includes('Too many requests')) {
        errMessage = 'Too many requests';
      } else if (errMessage && errMessage.includes('error={"code":3')) {
        errorCase = 1;
        // 'cannot estimate gas; transaction may fail or may require manual gas limit [ See: https://links.ethers.org/v5-errors-UNPREDICTABLE_GAS_LIMIT ] (reason="execution reverted", method="estimateGas", transaction={"from":"0x779bEfe2b4C43cD1F87924defd13c8b9d3B1E1d8","maxPriorityFeePerGas":{"type":"BigNumber","hex":"0x05196259dd"},"maxFeePerGas":{"type":"BigNumber","hex":"0x05196259ed"},"to":"0x071412e301C2087A4DAA055CF4aFa2683cE1e499","data":"0x00000000ef0b5a45ff9b79d4b9162130bf0cd44dcf68b90d0000010200003066f23ebc0000000000000000000000000000000000000000000000000000000000000000","type":2,"accessList":null}, error={"code":3,"response":"{\"jsonrpc\":\"2.0\",\"id\":20442,\"error\":{\"code\":3,\"message\":\"execution reverted\",\"data\":\"0xbe32c0ad\"}}\n"}, code=UNPREDICTABLE_GAS_LIMIT, version=providers/5.7.2)'
        // ->
        // '{"code":3,"response":{"jsonrpc":"2.0","id":20442,"error":{"code":3,"message":"execution reverted","data":"0xbe32c0ad"}}}'
        const responseJson = errMessage
          .split('error=')[1]
          .split(', code=UNPREDICTABLE_GAS_LIMIT')[0]
          .replace(/\\n/g, '')
          .replace(/\\"/g, '"')
          .replace(/\n/g, '')
          .replace('}"', '}')
          .replace('}"', '}')
          .replace('"{', '{');
        errorObj = JSON.parse(responseJson).response.error;
      } else if (
        errMessage &&
        (errMessage.includes('error={"code":-320') || errMessage.includes('error={"code":-320'))
      ) {
        errorCase = 2;
        // Error: PGAExecutorError(network: gnosis, signer: 0x840ccC99c425eDCAfebb0e7ccAC022CD15Fd49Ca): gasLimitEstimation failed with error: missing revert data in call exception; Transaction reverted without a reason string [ See: https://links.ethers.org/v5-errors-CALL_EXCEPTION ] (data="0x", transaction={"from":"0x840ccC99c425eDCAfebb0e7ccAC022CD15Fd49Ca","gasLimit":{"type":"BigNumber","hex":"0x4c4b40"},"maxPriorityFeePerGas":{"type":"BigNumber","hex":"0xd09dc300"},"maxFeePerGas":{"type":"BigNumber","hex":"0xd0a004f5"},"to":"0x071412e301C2087A4DAA055CF4aFa2683cE1e499","data":"0x52ee5b350000000000000000000000000b98057ea310f4d31f2a452b414647007d1645d900000000000000000000000000000000000000000000000000000000000000070000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000024a3066aab0000000000000000000000007ca19667f10d8642cd9c9834fae340db58ac925f00000000000000000000000000000000000000000000000000000000","type":2,"accessList":null}, error={"code":-32015,"response":"{\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32015,\"message\":\"VM execution error.\",\"data\":\"Reverted 0xaf6058030000000000000000000000000000000000000000000000000000000000000051\"},\"id\":1270}"}, code=CALL_EXCEPTION, version=providers/5.7.2)
        // ->
        // '{"code":-32015,"response":{"jsonrpc":"2.0","error":{"code":-32015,"message":"VM execution error.","data":"Reverted 0xaf6058030000000000000000000000000000000000000000000000000000000000000051"},"id":1270}}'

        // insufficient funds for intrinsic transaction cost [ See: https://links.ethers.org/v5-errors-INSUFFICIENT_FUNDS ] (error={"code":-32010,"response":"{\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32010,\"message\":\"InsufficientFunds, Balance is 13756802920248756 less than sending value + gas 20996696515000000\"},\"id\":90}"}, method="sendTransaction", transaction="0x02f8af645b84fa4b6ea384fa4cd527834c4b4094071412e301c2087a4daa055cf4afa2683ce1e49980b8430000000053bcf6ec8189a58876d13f85afd7e3cec660bc7a000001020000b066f23ebc000000000000000000000000fffffffffffffffffffffffffffffffffffffffec080a050f1602b83a96afcb27b4943f09f87cb96f52a179fb59ff3af453f76f9817878a00f896993b1f153d098037404c5137b790d41aed88eff6e6d57a6eeeca97570cc", code=INSUFFICIENT_FUNDS, version=providers/5.7.2
        // ->
        // '{"code":-32015,"response":"{\"id\":3622,\"jsonrpc\":\"2.0\",\"error\":{\"message\":\"Reverted 0x74ab6781\",\"code\":-32015}}"}'
        const responseJson = errMessage
          .split('error=')[1]
          .split(', code=CALL_EXCEPTION')[0]
          .split(', method')[0]
          .replace(/\\n/g, '')
          .replace(/\\"/g, '"')
          .replace(/\n/g, '')
          .replace('}"', '}')
          .replace('"{', '{');
        errorObj = JSON.parse(responseJson).response.error;
        if (!errorObj.data && errorObj.message.includes('Reverted ')) {
          errorObj.data = errorObj.message;
        }
        if (errorObj.data) {
          errorObj.data = errorObj.data.replace('Reverted ', '');
        }
      } else if (errMessage && errMessage.includes('response":"')) {
        errorCase = 3;
        errorObj = JSON.parse(JSON.parse(`"${errMessage.split('response":"')[1].split('"},')[0]}"`)).error;
      } else if (errMessage && errMessage.includes('unrecognized custom error')) {
        errorCase = 4;
        decodedError = parseError(errMessage.split('data: ')[1].slice(0, -1));
      }

      if (errorObj && !decodedError) {
        if (errorObj.data && !errorObj.data.includes(' ')) {
          decodedError = parseError(errorObj.data);
        } else if (errorObj.message) {
          errMessage = errorObj.message;
        }
      }

      if (decodedError) {
        const filteredArgs = filterFunctionResultObject(decodedError.args, true);
        errMessage =
          `Error: VM Exception while processing transaction: reverted with ${decodedError.name}` +
          `(${decodedError.signature}) decoded error and ${jsonStringify(filteredArgs)} args`;
      }
      err.message = errMessage;
    } catch (e) {
      console.error('decode error', e, 'errorCase', errorCase, 'errMessage', errMessage);
    }
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

  private async queryAgentVersion(): Promise<string> {
    const ppAgentVersionInterface = getPPAgentVersionInterface();
    const checkVersionContract = this.network.getContractWrapperFactory().build(this.address, ppAgentVersionInterface);
    return await checkVersionContract.ethCall('VERSION');
  }

  private async queryKeeperId(workerAddress: string): Promise<number> {
    return parseInt(await this.contract.ethCall('workerKeeperIds', [workerAddress]));
  }

  private async queryKeeperDetails(keeperId: number): Promise<any> {
    return await this.contract.ethCall('getKeeper', [keeperId]);
  }

  public async queryPastEvents(eventName: string, from: number, to: number, filters = []): Promise<any> {
    if (filters.length) {
      eventName = this.contract[eventName](filters);
    }
    return this.contract.getPastEvents(eventName, from, to);
  }

  protected on(eventName: string, callback: (event: any) => void) {
    this.network.getContractEventEmitter(this.contract).on(eventName, callback);
  }

  protected initializeListeners(blockNumber: number) {
    // Job events
    this.on('DepositJobCredits', async event => {
      const { jobKey, amount, fee } = event.args;

      this.clog(
        'debug',
        `'DepositJobCredits' event: (block=${event.blockNumber},jobKey=${jobKey},amount=${amount},fee=${fee})`,
      );

      if (!this.jobs.has(jobKey)) {
        this.clog('error', `Ignoring DepositJobCredits event due the job missing: (jobKey=${jobKey})`);
      }

      const job = await this.getJob(jobKey);
      job.applyJobCreditsDeposit(BigNumber.from(amount));
      job.watch();
    });

    this.on('WithdrawJobCredits', async event => {
      const { jobKey, amount } = event.args;

      this.clog('debug', `'WithdrawJobCredits' event: (block=${event.blockNumber},jobKey=${jobKey},amount=${amount})`);

      const job = await this.getJob(jobKey);
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

    this.on('AcceptJobTransfer', async event => {
      const { jobKey_, to_: ownerAfter } = event.args;

      this.clog(
        'debug',
        `'AcceptJobTransfer' event: (block=${event.blockNumber},jobKey_=${jobKey_},to_=${ownerAfter})`,
      );

      const job = await this.getJob(jobKey_);
      const ownerBefore = job.getOwner();
      this.ownerJobs.get(ownerBefore).delete(jobKey_);

      if (!this.ownerJobs.has(ownerAfter)) {
        this.ownerJobs.set(ownerAfter, new Set());
      }
      this.ownerJobs.get(ownerAfter).add(jobKey_);

      job.applyOwner(ownerAfter);
      job.watch();
    });

    this.on('JobUpdate', async event => {
      const { jobKey, maxBaseFeeGwei, rewardPct, fixedReward, jobMinCvp, intervalSeconds } = event.args;

      this.clog(
        'debug',
        `'JobUpdate' event: (block=${event.blockNumber},jobKey=${jobKey},maxBaseFeeGwei=${maxBaseFeeGwei},reardPct=${rewardPct},fixedReward=${fixedReward},jobMinCvp=${jobMinCvp},intervalSeconds=${intervalSeconds})`,
      );

      const job = await this.getJob(jobKey);
      job.applyUpdate(maxBaseFeeGwei, rewardPct, fixedReward, jobMinCvp, intervalSeconds);
      job.watch();
    });

    this.on('SetJobPreDefinedCalldata', async event => {
      const { jobKey, preDefinedCalldata } = event.args;

      this.clog(
        'debug',
        `'SetJobPreDefinedCalldata' event: (block=${event.blockNumber},jobKey=${jobKey},preDefinedCalldata=${preDefinedCalldata})`,
      );

      const job = await this.getJob(jobKey);
      job.applyPreDefinedCalldata(preDefinedCalldata);
      job.watch();
    });

    this.on('SetJobResolver', async event => {
      const { jobKey, resolverAddress, resolverCalldata } = event.args;

      this.clog(
        'debug',
        `'SetJobResolver' event: (block=${event.blockNumber},jobKey=${jobKey},resolverAddress=${resolverAddress},useJobOwnerCredits_=${resolverCalldata})`,
      );

      const job = await this.getJob(jobKey);
      job.applyResolver(resolverAddress, resolverCalldata);
      job.watch();
    });

    this.on('SetJobConfig', async event => {
      const { jobKey, isActive_, useJobOwnerCredits_, assertResolverSelector_ } = event.args;

      this.clog(
        'debug',
        `'SetJobConfig' event: (block=${event.blockNumber},jobKey=${jobKey},isActive=${isActive_},useJobOwnerCredits_=${useJobOwnerCredits_},assertResolverSelector_=${assertResolverSelector_})`,
      );

      const job = await this.getJob(jobKey);
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

      await this.addJobByRegisterEvent(event);
    });

    this.on('Execute', async event => {
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

      const job = await this.getJob(jobKey);
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
