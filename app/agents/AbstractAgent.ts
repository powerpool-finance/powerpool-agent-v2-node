import { Network } from '../Network';
import {
  AgentConfig,
  ContractWrapper,
  EventWrapper,
  Executor,
  ExecutorType,
  IAgent,
  Resolver,
  TxEnvelope,
} from '../Types.js';
import { BigNumber, ethers, Wallet } from 'ethers';
import { getEncryptedJson } from '../services/KeyService.js';
import { DEFAULT_SYNC_FROM_CHAINS } from '../Constants.js';
import { nowMs, nowTimeString } from '../Utils.js';
import { FlashbotsExecutor } from '../executors/FlashbotsExecutor.js';
import { PGAExecutor } from '../executors/PGAExecutor.js';
import { getAgentDefaultSyncFromSafe } from '../ConfigGetters.js';
import { LightJob } from '../jobs/LightJob.js';
import { RandaoJob } from '../jobs/RandaoJob.js';
import { AbstractJob } from '../jobs/AbstractJob';
import { BlockchainSource } from '../dataSources/BlockchainSource.js';
import { SubgraphSource } from '../dataSources/SubgraphSource.js';

const FLAG_ACCEPT_MAX_BASE_FEE_LIMIT = 1;
const FLAG_ACCRUE_REWARD = 2;
const BIG_NUMBER_1E18 = BigNumber.from(10).pow(18);

export abstract class AbstractAgent implements IAgent {
  private executorType: ExecutorType;
  protected network: Network;
  protected address: string;
  protected keeperId: number;
  protected contract: ContractWrapper;
  private source: BlockchainSource | SubgraphSource;
  private workerSigner: ethers.Wallet;
  private executor: Executor;

  // Agent Config
  private minKeeperCvp: BigNumber;
  private fullSyncFrom: number;
  private acceptMaxBaseFeeLimit: boolean;
  private accrueReward: boolean;
  private cfg: number;

  protected jobs: Map<string, LightJob | RandaoJob>;
  private ownerBalances: Map<string, BigNumber>;
  private ownerJobs: Map<string, Set<string>>;
  private lastBlockTimestamp: number;
  private keyAddress: string;
  private keyPass: string;

  abstract _getSupportedAgentVersions(): string[];

  protected toString(): string {
    return `(network: ${this.network.getName()}, address: ${this.address})`;
  }

  protected clog(...args: unknown[]) {
    console.log(`>>> ${nowTimeString()} >>> Agent${this.toString()}:`, ...args);
  }

  protected err(...args: unknown[]): Error {
    return new Error(`AgentError${this.toString()}: ${args.join(' ')}`);
  }

  protected _beforeInit(): void {}
  protected _afterInit(): void {}
  protected async _beforeResyncAllJobs() {}

  protected _afterExecuteEvent(_job: AbstractJob) {}

  constructor(address: string, agentConfig: AgentConfig, network: Network) {
    this.jobs = new Map();
    this.ownerBalances = new Map();
    this.ownerJobs = new Map();
    this.address = address;
    this.network = network;
    this.executorType = agentConfig.executor;

    this.lastBlockTimestamp = 0;
    this.cfg = 0;

    if (!('keeper_address' in agentConfig) || !agentConfig.keeper_address || agentConfig.keeper_address.length === 0) {
      throw this.err(
        `Missing keeper_address for agent: (network=${this.network.getName()},address=${
          this.address
        },keeper_address_value=${agentConfig.keeper_address})`,
      );
    }

    if (!('key_pass' in agentConfig) || !agentConfig.key_pass || agentConfig.key_pass.length === 0) {
      throw this.err(
        `Missing key_pass for agent: (network=${this.network.getName()},address=${this.address},key_pass_value=${
          agentConfig.key_pass
        })`,
      );
    }

    this.keyAddress = ethers.utils.getAddress(agentConfig.keeper_address);
    this.keyPass = agentConfig.key_pass;

    // acceptMaxBaseFeeLimit
    if ('accept_max_base_fee_limit' in agentConfig) {
      this.acceptMaxBaseFeeLimit = !!agentConfig.accept_max_base_fee_limit;
      if (this.acceptMaxBaseFeeLimit) {
        this.cfg = this.cfg | FLAG_ACCEPT_MAX_BASE_FEE_LIMIT;
      }
    } else {
      this.acceptMaxBaseFeeLimit = false;
    }

    // accrueReward
    this.accrueReward = !!agentConfig.accrue_reward;
    if (this.accrueReward) {
      this.cfg = this.cfg | FLAG_ACCRUE_REWARD;
    }

    this.network.getNewBlockEventEmitter().on('newBlock', this.newBlockEventHandler.bind(this));

    this.fullSyncFrom =
      agentConfig.deployed_at ||
      getAgentDefaultSyncFromSafe(this.address, this.network.getName()) ||
      DEFAULT_SYNC_FROM_CHAINS[this.network.getName()] ||
      0;
    this.clog('Sync from', this.fullSyncFrom);
  }

  public async init() {
    await this._beforeInit();

    if (!this.contract) {
      throw this.err('Constructor not initialized');
    }

    // setting data source
    if (this.network.source === 'subgraph' && this.network.getGraphUrl) {
      this.source = new SubgraphSource(this.network, this.contract);
    } else {
      this.source = new BlockchainSource(this.network, this.contract);
    }

    // Ensure version matches
    // TODO: extract check
    const version = await this.contract.ethCall('VERSION');
    if (!this._getSupportedAgentVersions().includes(version)) {
      throw this.err(`Invalid version: ${version}`);
    }

    this.keeperId = parseInt(await this.contract.ethCall('workerKeeperIds', [this.keyAddress]));
    if (this.keeperId < 1) {
      throw this.err(`Worker address '${this.keyAddress}' is not assigned  to any keeper`);
    }

    const keyString = getEncryptedJson(this.keyAddress);
    if (!keyString) {
      throw this.err(`Empty JSON key for address ${this.keyAddress}`);
    }

    const label = `${this.keyAddress} worker key decryption time:`;
    console.time(label);
    try {
      this.workerSigner = await ethers.Wallet.fromEncryptedJson(keyString, this.keyPass);
    } catch (e) {
      throw this.err(`Error decrypting JSON key for address ${this.keyAddress}`, e);
    }
    console.timeLog(label);
    this.workerSigner.connect(this.getNetwork().getProvider());

    this.clog('Worker address:', this.workerSigner.address);

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
          this.clog('Flashbots wallet decryption error for the address:', this.network.getFlashbotsAddress(), e);
          process.exit(0);
        }
        if (wallet.address.toLowerCase() !== this.network.getFlashbotsAddress().toLowerCase()) {
          throw this.err('Flashbots address recovery error');
        }
        wallet.connect(this.network.getProvider());

        this.executor = new FlashbotsExecutor(
          this.network.getName(),
          this.network.getFlashbotsRpc(),
          this.network.getProvider(),
          this.workerSigner,
          wallet,
          this.contract,
        );
        break;
      case 'pga':
        this.executor = new PGAExecutor(
          this.network.getName(),
          this.network.getProvider(),
          this.workerSigner,
          this.contract,
        );
        break;
      default:
        throw this.err(`Invalid executor type: '${this.executorType}'. Only 'flashbots' and 'pga' are supported.`);
    }

    const keeperConfig = await this.contract.ethCall('getKeeper', [this.keeperId]);

    if (this.workerSigner.address != keeperConfig.worker) {
      throw this.err(
        `The worker address for the keeper #${this.keeperId} stored on chain (${keeperConfig.worker}) doesn't match the one specified in config (${this.workerSigner.address}).`,
      );
    }

    // Task #1
    const agentConfig = await this.contract.ethCall('getConfig');
    this.minKeeperCvp = agentConfig.minKeeperCvp_;
    if (keeperConfig.currentStake.lt(agentConfig.minKeeperCvp_)) {
      throw this.err(
        `The keeper's stake for agent '${this.address}' is insufficient: ${keeperConfig.currentStake.div(
          BIG_NUMBER_1E18,
        )} CVP (actual) < ${this.minKeeperCvp.div(BIG_NUMBER_1E18)} CVP (required).`,
      );
    }
    this.clog(`Keeper deposit: (current=${keeperConfig.currentStake},min=${this.minKeeperCvp})`);
    // TODO: track agent SetAgentParams
    // TODO: assert the keeper has enough CVP for a job
    // TODO: set event listener for the global contract change

    // this.workerNonce = await this.network.getProvider().getTransactionCount(this.workerSigner.address);
    await this.executor.init();

    await this._beforeResyncAllJobs();

    // Task #2
    const upTo = await this.resyncAllJobs();
    this.initializeListeners(upTo);
    // setTimeout(this.verifyLastExecutionAtLoop.bind(this), 3 * 60 * 1000);

    await this._afterInit();
    this.clog('✅ Agent initialization done!');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private newBlockEventHandler(blockTimestamp) {}

  public getJobOwnerBalance(address: string): BigNumber {
    if (!this.ownerBalances.has(address)) {
      throw this.err(`getJobOwnerBalance(): Address ${address} not tracked`);
    }
    return this.ownerBalances.get(address);
  }

  public getNetwork(): Network {
    return this.network;
  }

  public getAddress(): string {
    return this.address;
  }

  public getKeeperId(): number {
    return this.keeperId;
  }

  public getCfg(): number {
    return this.cfg;
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
    const latestBock = await this.network.getLatestBlockNumber();
    // 1. init jobs
    let newJobs = new Map<string, RandaoJob | LightJob>();
    newJobs = await this.source.getRegisteredJobs(this);

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
      const set = this.ownerJobs.get(owner);
      set.add(jobKeys[i]);
    }

    // 3. Load job owner balances
    this.ownerBalances = await this.source.getOwnersBalances(this, jobOwnersSet);
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

    const tmpMap = new Map();
    tmpMap.set(jobKey, job);
    await this.source.addLensFieldsToJob(tmpMap, this.address);

    // nullify credits

    if (!this.ownerJobs.has(owner)) {
      this.ownerJobs.set(owner, new Set());
    }
    const set = this.ownerJobs.get(owner);
    set.add(jobKey);

    const ownerBalances = await this.source.getOwnersBalances({ address: this.address }, new Set([owner]));

    this.ownerBalances.set(owner, ownerBalances.get(owner));
  }

  protected async startAllJobs() {
    for (const [, job] of this.jobs) {
      await job.watch();
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

  // Here only the `maxPriorityFeePerGas` is assigned.
  // The `maxFeePerGas` is assigned earlier during job.buildTx().
  protected async populateTxExtraFields(tx: ethers.UnsignedTransaction) {
    tx.chainId = this.network.getChainId();
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore (estimations will fail w/o this `from` assignment)
    tx.from = this.workerSigner.address;
    const maxPriorityFeePerGas = await this.network.getMaxPriorityFeePerGas();
    console.log({ maxPriorityFeePerGas, maxFeePerGas: tx.maxFeePerGas });
    tx.maxPriorityFeePerGas = String(BigInt(maxPriorityFeePerGas) * 2n);

    const maxPriorityFeePerGasBigInt = BigInt(tx.maxPriorityFeePerGas);
    const maxFeePerGasBigInt = BigInt(String(tx.maxFeePerGas));
    console.log({ maxPriorityFeePerGasBigInt, maxFeePerGasBigInt });
    if (maxPriorityFeePerGasBigInt > maxFeePerGasBigInt) {
      tx.maxPriorityFeePerGas = maxFeePerGasBigInt.toString(10);
    }
  }

  private async trySendExecuteEnvelope(envelope: TxEnvelope) {
    const { tx, jobKey /*, _ppmCompensation, _fixedCompensation, _creditsAvailable*/ } = envelope;
    if (tx.maxFeePerGas === 0) {
      this.clog(`Dropping tx due job gasPrice limit: (data=${tx.data})`);
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
    return this.executor.push(`other-tx-type/${nowMs()}`, envelope);
  }

  abstract _afterInitializeListeners(blockNumber: number);

  protected initializeListeners(blockNumber: number) {
    this.contract.on('DepositJobCredits', event => {
      const { jobKey, amount, fee } = event.args;

      this.clog(`'DepositJobCredits' event: (block=${event.blockNumber},jobKey=${jobKey},amount=${amount},fee=${fee})`);

      if (!this.jobs.has(jobKey)) {
        this.clog(`Ignoring DepositJobCredits event due the job missing: (jobKey=${jobKey})`);
        return;
      }

      if (this.jobs.get(jobKey).isInitializing()) {
        this.clog(`Ignoring DepositJobCredits event due still initializing: (jobKey=${jobKey})`);
        return;
      }

      const job = this.jobs.get(jobKey);
      job.applyJobCreditsDeposit(BigNumber.from(amount));
      job.watch();
    });

    this.contract.on('WithdrawJobCredits', event => {
      const { jobKey, amount } = event.args;

      this.clog(`'WithdrawJobCredits' event: (block=${event.blockNumber},jobKey=${jobKey},amount=${amount})`);

      const job = this.jobs.get(jobKey);
      job.applyJobCreditWithdrawal(BigNumber.from(amount));
      job.watch();
    });

    this.contract.on('DepositJobOwnerCredits', event => {
      const { jobOwner, amount, fee } = event.args;

      this.clog(
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
          const job = this.jobs.get(jobKey);
          if (!job.isInitializing()) {
            this.jobs.get(jobKey).watch();
          }
        }
      }
    });

    this.contract.on('WithdrawJobOwnerCredits', event => {
      const { jobOwner, amount } = event.args;

      this.clog(`'WithdrawJobOwnerCredits' event: (block=${event.blockNumber},jobOwner=${jobOwner},amount=${amount})`);

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

    this.contract.on('AcceptJobTransfer', event => {
      const { jobKey_, to_: ownerAfter } = event.args;

      this.clog(`'AcceptJobTransfer' event: (block=${event.blockNumber},jobKey_=${jobKey_},to_=${ownerAfter})`);

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

    this.contract.on('JobUpdate', event => {
      const { jobKey, maxBaseFeeGwei, rewardPct, fixedReward, jobMinCvp, intervalSeconds } = event.args;

      this.clog(
        `'JobUpdate' event: (block=${event.blockNumber},jobKey=${jobKey},maxBaseFeeGwei=${maxBaseFeeGwei},reardPct=${rewardPct},fixedReward=${fixedReward},jobMinCvp=${jobMinCvp},intervalSeconds=${intervalSeconds})`,
      );

      const job = this.jobs.get(jobKey);
      job.applyUpdate(maxBaseFeeGwei, rewardPct, fixedReward, jobMinCvp, intervalSeconds);
      job.watch();
    });

    this.contract.on('SetJobResolver', event => {
      const { jobKey, resolverAddress, resolverCalldata } = event.args;

      this.clog(
        `'SetJobResolver' event: (block=${event.blockNumber},jobKey=${jobKey},resolverAddress=${resolverAddress},useJobOwnerCredits_=${resolverCalldata})`,
      );

      const job = this.jobs.get(jobKey);
      job.applyResolver(resolverAddress, resolverCalldata);
      job.watch();
    });

    this.contract.on('SetJobConfig', async event => {
      const { jobKey, isActive_, useJobOwnerCredits_, assertResolverSelector_ } = event.args;

      this.clog(
        `'SetJobConfig' event: (block=${event.blockNumber},jobKey=${jobKey},isActive=${isActive_},useJobOwnerCredits_=${useJobOwnerCredits_},assertResolverSelector_=${assertResolverSelector_})`,
      );

      const job = this.jobs.get(jobKey);
      const binJob = await this.network.getJobRawBytes32(this.address, jobKey);
      job.applyBinJobData(binJob);
      job.watch();
    });

    this.contract.on('RegisterJob', async event => {
      const { jobKey, jobAddress, jobId, owner, params } = event.args;

      this.clog(
        `'RegisterJob' event: (block=${
          event.blockNumber
        },jobKey=${jobKey},jobAddress=${jobAddress},jobId=${jobId},owner=${owner},params=${JSON.stringify(params)})`,
      );

      await this.addJob(event);
    });

    this.contract.on('Execute', event => {
      const { jobKey, job: jobAddress, keeperId, gasUsed, baseFee, gasPrice, compensation, binJobAfter } = event.args;

      this.clog(
        `'Execute' event: (block=${
          event.blockNumber
        },jobKey=${jobKey},jobAddress=${jobAddress},keeperId=${keeperId.toNumber()},gasUsed=${gasUsed.toNumber()},baseFee=${baseFee.toNumber()}gwei,gasPrice=${gasPrice.toNumber()}wei,compensation=${
          compensation.toNumber() / 1e18
        }eth/${compensation.toNumber()}wei,binJobAfter=${binJobAfter})`,
      );

      const job = this.jobs.get(jobKey);
      job.applyBinJobData(binJobAfter);

      this._afterExecuteEvent(job);

      job.watch();
    });

    this.contract.on('SetAgentParams', event => {
      const { minKeeperCvp_, timeoutSeconds_, feePct_ } = event.args;

      this.clog(
        `'SetAgentParams' event: (block=${event.blockNumber},minKeeperCvp_=${minKeeperCvp_},timeoutSeconds_=${timeoutSeconds_},feePct_=${feePct_})`,
      );

      this.clog("'SetAgentParams' event requires the bot to be restarted");
      process.exit(0);
    });

    this._afterInitializeListeners(blockNumber);
  }
}
