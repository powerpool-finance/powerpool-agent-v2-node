import {
  ClientWrapper,
  ContractWrapper,
  ContractWrapperFactory,
  IAgent,
  LensGetJobBytes32AndNextBlockSlasherIdResponse,
  NetworkConfig,
  Resolver,
} from './Types.js';
import { ethers } from 'ethers';
import {
  getAgentVersionAndType,
  getAverageBlockTime,
  getExternalLensAddress,
  getMulticall2Address,
} from './ConfigGetters.js';
import { getExternalLensAbi, getMulticall2Abi } from './services/AbiService.js';
import { nowMs, nowS, nowTimeString, toChecksummedAddress } from './Utils.js';
import { EthersContractWrapperFactory } from './clients/EthersContractWrapperFactory.js';
import EventEmitter from 'events';
import { AgentRandao_2_3_0 } from './agents/Agent.2.3.0.randao.js';
import { AgentLight_2_2_0 } from './agents/Agent.2.2.0.light.js';

interface ResolverJobWithCallback {
  resolver: Resolver;
  callback: (calldata: string) => void;
}

interface TimeoutWithCallback {
  triggerCallbackAfter: number;
  callback: (blockNumber: number, blockTimestamp: number) => void;
}

export class Network {
  source: string;
  graphUrl: string;
  private name: string;
  private networkConfig: NetworkConfig;
  private rpc: string;
  private chainId: number;
  private client: ClientWrapper | undefined;
  private provider: ethers.providers.WebSocketProvider | undefined;
  private agents: IAgent[];
  private resolverJobData: { [key: string]: ResolverJobWithCallback };
  private timeoutData: { [key: string]: TimeoutWithCallback };
  private multicall: ContractWrapper | undefined;
  private externalLens: ContractWrapper | undefined;
  private averageBlockTimeSeconds: number;
  private flashbotsAddress: string;
  private flashbotsPass: string;
  private flashbotsRpc: string;
  private newBlockNotifications: Map<number, Set<string>>;
  private contractWrapperFactory: ContractWrapperFactory;
  private newBlockEventEmitter: EventEmitter;

  private latestBaseFee: bigint;
  private latestBlockNumber: bigint;
  private latestBlockTimestamp: bigint;

  private toString(): string {
    return `(name: ${this.name}, rpc: ${this.rpc})`;
  }

  private clog(...args: any[]) {
    console.log(`>>> ${nowTimeString()} >>> Network${this.toString()}:`, ...args);
  }

  private err(...args: any[]): Error {
    return new Error(`NetworkError${this.toString()}: ${args.join(' ')}`);
  }

  constructor(name: string, networkConfig: NetworkConfig) {
    this.contractWrapperFactory = new EthersContractWrapperFactory([networkConfig.rpc], networkConfig.ws_timeout);
    this.name = name;
    this.rpc = networkConfig.rpc;
    this.graphUrl = networkConfig.graphUrl;
    this.networkConfig = networkConfig;

    this.flashbotsRpc = networkConfig?.flashbots?.rpc;
    this.flashbotsAddress = networkConfig?.flashbots?.address;
    this.flashbotsPass = networkConfig?.flashbots?.pass;

    this.averageBlockTimeSeconds = getAverageBlockTime(name);
    this.newBlockEventEmitter = new EventEmitter();

    if (networkConfig.source) {
      this.source = networkConfig.source;
    } else {
      this.source = 'blockchain';
    }

    this.newBlockNotifications = new Map();

    if (!this.rpc && !this.rpc.startsWith('ws')) {
      throw this.err(
        `Only WebSockets RPC endpoints are supported. The current value for '${this.getName()}' is '${this.rpc}'.`,
      );
    }

    this.resolverJobData = {};
    this.timeoutData = {};
    this.agents = [];

    // TODO: get type & AgentConfig
    for (const [address, agentConfig] of Object.entries(this.networkConfig.agents)) {
      const checksummedAddress = toChecksummedAddress(address);
      const [version, strategy] = getAgentVersionAndType(checksummedAddress, this.name);
      let agent;

      if (version === '2.3.0' && strategy === 'randao') {
        agent = new AgentRandao_2_3_0(checksummedAddress, agentConfig, this);
      } else if (version === '2.2.0' && strategy === 'light') {
        agent = new AgentLight_2_2_0(checksummedAddress, agentConfig, this);
      } else {
        throw this.err(`Not supported agent version/strategy: version=${version},strategy=${strategy}`);
      }

      this.agents.push(agent);
    }
  }

  public getContractWrapperFactory(): ContractWrapperFactory {
    return this.contractWrapperFactory;
  }

  public getAverageBlockTimeSeconds(): number {
    return this.averageBlockTimeSeconds;
  }

  public getName(): string {
    return this.name;
  }

  public getChainId(): number {
    return this.chainId;
  }

  // TODO: throttle node requests
  public async getMaxPriorityFeePerGas(): Promise<number> {
    return this.provider.send('eth_maxPriorityFeePerGas', []);
  }

  public getFlashbotsRpc(): string {
    return this.flashbotsRpc;
  }

  public getFlashbotsAddress(): string {
    return this.flashbotsAddress;
  }

  public getFlashbotsPass(): string {
    return this.flashbotsPass;
  }

  public getExternalLensContract(): ContractWrapper {
    return this.externalLens;
  }

  public getProvider(): ethers.providers.WebSocketProvider {
    return this.provider;
  }

  public async queryGasPrice(): Promise<number> {
    return (await this.provider.getGasPrice()).toNumber();
  }

  public getBaseFee(): bigint {
    return this.latestBaseFee;
  }

  public getLatestBlockNumber(): bigint {
    return this.latestBlockNumber;
  }

  public getLatestBlockTimestamp(): bigint {
    return this.latestBlockTimestamp;
  }

  public async getJobRawBytes32(agent: string, jobKey: string): Promise<string> {
    const res = await this.externalLens.ethCall('getJobsRawBytes32', [agent, [jobKey]]);
    return res.results[0];
  }

  public async getJobBytes32AndNextBlockSlasherId(
    agent: string,
    jobKey: string,
  ): Promise<LensGetJobBytes32AndNextBlockSlasherIdResponse> {
    const res = await this.externalLens.ethCall('getJobBytes32AndNextBlockSlasherId', [agent, jobKey]);
    return { binJob: res.binJob, nextBlockSlasherId: res.nextBlockSlasherId.toNumber() };
  }

  public async init() {
    if (this.agents.length === 0) {
      this.clog(`Ignoring '${this.getName()}' network setup as it has no agents configured.`);
      return;
    }

    this.provider = new ethers.providers.WebSocketProvider(this.rpc);
    this.multicall = this.contractWrapperFactory.build(getMulticall2Address(this.name), getMulticall2Abi());
    // TODO: initialize this after we know agent version and strategy
    this.externalLens = this.contractWrapperFactory.build(
      getExternalLensAddress(this.name, null, null),
      getExternalLensAbi(),
    );

    try {
      const lastBlock = await this.provider.getBlockNumber();
      this.clog(`The network '${this.getName()}' has been initialized. The last block number: ${lastBlock}`);
    } catch (e) {
      throw this.err(`Can't init '${this.getName()}' using '${this.rpc}': ${e}`);
    }

    this.chainId = (await this.provider.getNetwork()).chainId;

    const latestBlock = await this.provider.getBlock('latest');
    this.latestBaseFee = BigInt(latestBlock.baseFeePerGas.toString());
    this.latestBlockNumber = BigInt(latestBlock.number.toString());
    this.latestBlockTimestamp = BigInt(latestBlock.timestamp.toString());

    for (const agent of this.agents) {
      await agent.init();
    }

    this.provider.on('block', async blockNumber => {
      const before = nowMs();
      const block = await this.provider.getBlock(blockNumber);
      const fetchBlockDelay = nowMs() - before;

      this.latestBaseFee = BigInt(block.baseFeePerGas.toString());
      this.latestBlockNumber = BigInt(block.number.toString());
      this.latestBlockTimestamp = BigInt(block.timestamp.toString());

      this.newBlockEventEmitter.emit('newBlock', block.timestamp);

      if (this.newBlockNotifications.has(blockNumber)) {
        const emittedBlockHashes = this.newBlockNotifications.get(blockNumber);
        if (emittedBlockHashes && !emittedBlockHashes.has(block.hash)) {
          emittedBlockHashes.add(block.hash);
          this.walkThroughTheJobs(blockNumber, block.timestamp);
        }
      } else {
        this.newBlockNotifications.set(blockNumber, new Set([block.hash]));
        this.walkThroughTheJobs(blockNumber, block.timestamp);
      }
      this.clog(
        `🧱 New block: (number=${blockNumber},timestamp=${block.timestamp},hash=${block.hash},txCount=${block.transactions.length},baseFee=${block.baseFeePerGas},fetchDelayMs=${fetchBlockDelay})`,
      );
    });
    this.clog('✅ Network initialization done!');
  }

  public getNewBlockEventEmitter(): EventEmitter {
    return this.newBlockEventEmitter;
  }

  private async walkThroughTheJobs(blockNumber: number, blockTimestamp: number) {
    this.triggerIntervalCallbacks(blockNumber, blockTimestamp);
    this.callResolversAndTriggerCallbacks(blockNumber);
  }

  private async triggerIntervalCallbacks(blockNumber: number, blockTimestamp: number) {
    let callbacksCalled = 0;

    for (const [, jobData] of Object.entries(this.timeoutData)) {
      if (jobData.triggerCallbackAfter <= blockTimestamp) {
        // NOTICE: The callbacks are async, but we don't wait until the executions are finished
        jobData.callback(blockNumber, blockTimestamp);
        callbacksCalled++;
      }
    }

    this.clog(`Block ${blockNumber} interval callbacks triggered: ${callbacksCalled}`);
  }

  private async callResolversAndTriggerCallbacks(blockNumber: number) {
    // TODO: split calls in chunks
    // TODO: protect from handlers queueing on the networks with < 3s block time
    const resolversToCall = [];
    const callbacks = [];
    for (const [, jobData] of Object.entries(this.resolverJobData)) {
      callbacks.push(jobData.callback);
      resolversToCall.push({
        target: jobData.resolver.resolverAddress,
        callData: jobData.resolver.resolverCalldata,
      });
      // TODO: let this.provider to be executed when making chunk requests;
    }
    if (callbacks.length === 0) {
      return;
    }

    const results = await this.multicall.ethCallStatic('tryAggregate', [false, resolversToCall]);
    let jobsToExecute = 0;

    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      // Multicall-level success
      if (res.success) {
        const decoded = ethers.utils.defaultAbiCoder.decode(['bool', 'bytes'], res.returnData);
        if (decoded[0]) {
          callbacks[i](blockNumber, decoded[1]);
          jobsToExecute += 1;
        }
      }
    }

    this.clog(
      `Block ${blockNumber} resolver estimation results: (resolversToCall=${resolversToCall.length},jobsToExecute=${jobsToExecute})`,
    );
  }

  private _validateKeyLength(key: string, type: string): void {
    if (key.length < 3) {
      throw this.err(`Invalid callback key length: type=${type},key=${key}`);
    }
  }

  private _validateKeyNotInMap(key: string, map: { [key: string]: object }, type: string): void {
    if (map[key]) {
      throw this.err(`Callback key already exists: type=${type},key=${key}`);
    }
  }

  private _validateKeyInMap(key: string, map: { [key: string]: object }, type: string): void {
    if (!map[key]) {
      throw this.err(`Callback key already exists: type=${type},key=${key}`);
    }
  }

  public registerTimeout(key: string, triggerCallbackAfter: number, callback: (blockTimestamp: number) => void) {
    this._validateKeyLength(key, 'interval');
    this._validateKeyNotInMap(key, this.timeoutData, 'interval');
    this.clog('SET Timeout', key, `at: ${triggerCallbackAfter}`, `now: ${nowS()}`);
    this.timeoutData[key] = {
      triggerCallbackAfter,
      callback,
    };
  }

  public unregisterTimeout(key: string) {
    this.clog('UNSET Timeout', key);
    this._validateKeyLength(key, 'interval');
    delete this.timeoutData[key];
  }

  public registerResolver(key: string, resolver: Resolver, callback: (calldata: string) => void) {
    this._validateKeyLength(key, 'resolver');
    this._validateKeyNotInMap(key, this.resolverJobData, 'resolver');
    this.resolverJobData[key] = {
      resolver,
      callback,
    };
  }

  public unregisterResolver(key: string) {
    this._validateKeyLength(key, 'resolver');
    delete this.resolverJobData[key];
  }
}
