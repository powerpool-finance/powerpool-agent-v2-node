import {
  ContractWrapper,
  ContractWrapperFactory,
  IAgent,
  LensGetJobBytes32AndNextBlockSlasherIdResponse,
  NetworkConfig,
  Resolver,
} from './Types.js';
import { bigintToHex, toChecksummedAddress } from './Utils.js';
import pIteration from 'p-iteration';
import { ethers } from 'ethers';
import EventEmitter from 'events';
import {
  getAgentVersionAndType,
  getAverageBlockTime,
  getDefaultNetworkConfig,
  getExternalLensAddress,
  getMulticall2Address,
  getResolverCallSkipBlocksNumber,
  setConfigDefaultValues,
} from './ConfigGetters.js';
import { getExternalLensAbi, getMulticall2Abi } from './services/AbiService.js';
import { EthersContractWrapperFactory } from './clients/EthersContractWrapperFactory.js';
import { App } from './App.js';
import logger, { updateSentryScope } from './services/Logger.js';
import ContractEventsEmitter from './services/ContractEventsEmitter.js';
import WebSocketProvider from './services/WebSocketProvider.js';
import { SubgraphSource } from './dataSources/SubgraphSource.js';
import { BlockchainSource } from './dataSources/BlockchainSource.js';
import { SubquerySource } from './dataSources/SubquerySource.js';
import { AgentRandao_2_3_0 } from './agents/Agent.2.3.0.randao.js';
import { AgentLight_2_2_0 } from './agents/Agent.2.2.0.light.js';
import axios from 'axios';
import { AbstractJob } from './jobs/AbstractJob';

interface ResolverJobWithCallback {
  lastSuccessBlock?: bigint;
  successCounter?: number;
  resolver: Resolver;
  callback: (calldata: string) => void;
}

interface TimeoutWithCallback {
  triggerCallbackAfter: number;
  callback: (blockNumber: number, blockTimestamp: number) => void;
}

export class Network {
  private initialized: boolean;
  private app: App;
  private readonly name: string;
  private readonly networkConfig: NetworkConfig;
  private readonly rpc: string;
  private readonly maxBlockDelay: number;
  private readonly maxNewBlockDelay: number;
  private chainId: number;
  private provider: ethers.providers.WebSocketProvider | undefined;
  private agents: IAgent[];
  private resolverJobData: { [key: string]: ResolverJobWithCallback };
  private timeoutData: { [key: string]: TimeoutWithCallback };
  private multicall: ContractWrapper | undefined;
  private externalLens: ContractWrapper | undefined;
  private averageBlockTimeSeconds: number;
  private externalLensAddress: string;
  private multicall2Address: string;
  private flashbotsAddress: string;
  private flashbotsPass: string;
  private flashbotsRpc: string;
  private contractWrapperFactory: ContractWrapperFactory;
  private newBlockEventEmitter: EventEmitter;
  private contractEventsEmitter: ContractEventsEmitter;

  private skipBlocksDivisor: number | null;
  private currentBlockDelay: number;
  private latestBaseFee: bigint;
  private agentsStartBlockNumber: bigint;
  private latestBlockNumber: bigint;
  private latestBlockTimestamp: bigint;

  private toString(): string {
    return `(name: ${this.name}, rpc: ${this.rpc})`;
  }

  private clog(level: string, ...args: any[]) {
    logger.log(level, `Network${this.toString()}: ${args.join(' ')}`);
  }

  private err(...args: any[]): Error {
    return new Error(`NetworkError${this.toString()}: ${args.join(' ')}`);
  }

  constructor(name: string, networkConfig: NetworkConfig, app: App) {
    this.initialized = false;
    this.app = app;
    this.name = name;
    setConfigDefaultValues(networkConfig, getDefaultNetworkConfig(name));
    this.rpc = networkConfig.rpc;
    this.maxBlockDelay = networkConfig.max_block_delay;
    this.maxNewBlockDelay = networkConfig.max_new_block_delay;
    this.networkConfig = networkConfig;
    this.agents = this.buildAgents();

    this.flashbotsRpc = networkConfig?.flashbots?.rpc;
    this.flashbotsAddress = networkConfig?.flashbots?.address;
    this.flashbotsPass = networkConfig?.flashbots?.pass;

    this.averageBlockTimeSeconds = networkConfig.average_block_time || getAverageBlockTime(name);
    this.externalLensAddress = networkConfig.external_lens || getExternalLensAddress(name, null, null);
    this.multicall2Address = networkConfig.multicall2 || getMulticall2Address(name);
    this.newBlockEventEmitter = new EventEmitter();
    this.contractEventsEmitter = new ContractEventsEmitter(networkConfig.block_logs_mode);
    this.skipBlocksDivisor = getResolverCallSkipBlocksNumber(name);
    if (this.skipBlocksDivisor) {
      this.clog(
        'info',
        `Resolver skip block activated. Jobs resolvers will be executed each ${this.skipBlocksDivisor} blocks.`,
      );
    }

    if (!this.rpc && !this.rpc.startsWith('ws')) {
      throw this.err(
        `Only WebSockets RPC endpoints are supported. The current value for '${this.getName()}' is '${this.rpc}'.`,
      );
    }

    this.resolverJobData = {};
    this.timeoutData = {};
  }

  public nowS(): number {
    return Math.floor(+new Date() / 1000);
  }

  public nowMs(): number {
    return +new Date();
  }

  public exitIfStrictTopic(topic) {
    this.app.exitIfStrictTopic(topic);
  }

  public getRpc() {
    return this.rpc;
  }

  public getAppVersion() {
    return this.app.getVersion();
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

  public getAgents(): IAgent[] {
    return this.agents;
  }

  public getAgent(agentAddress: string): IAgent {
    for (const agent of this.agents) {
      if (agent.address === agentAddress) {
        return agent;
      }
    }
    return null;
  }

  // TODO: throttle node requests
  public async getMaxPriorityFeePerGas(): Promise<number> {
    return this.provider.send('eth_maxPriorityFeePerGas', []);
  }

  public async getFeeData() {
    return this.provider.getFeeData();
  }

  public async getClientVersion(): Promise<string> {
    return this.provider.send('web3_clientVersion', []).catch(() => 'unknown');
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

  public getBaseFee(): bigint {
    return this.latestBaseFee;
  }

  public getLatestBlockNumber(): bigint {
    return this.latestBlockNumber;
  }

  public getLatestBlockTimestamp(): bigint {
    return this.latestBlockTimestamp;
  }

  public getStatusObjectForApi(): object {
    const agents = this.agents.map((agent: IAgent) => {
      return {
        address: agent.address,
        keeperId: agent.getKeeperId(),
        workerAddress: agent.getKeyAddress(),
        executorType: agent.executorType,
        jobs: agent.getJobsCount(),
      };
    });
    const timeoutCallbacks = {};
    const nowSeconds = this.nowS();
    for (const [key, jobData] of Object.entries(this.timeoutData)) {
      timeoutCallbacks[key] = {
        callbackAt: jobData.triggerCallbackAfter,
        callbackIn: jobData.triggerCallbackAfter - nowSeconds,
      };
    }

    return {
      name: this.name,
      rpc: this.rpc,
      maxBlockDelay: this.maxBlockDelay,
      chainId: this.chainId,
      baseFee: this.getBaseFee(),
      latestBlockNumber: this.getLatestBlockNumber(),
      latestBlockTimestamp: this.getLatestBlockTimestamp(),
      getAverageBlockTime: this.averageBlockTimeSeconds,
      addresses: {
        externalLens: this.externalLensAddress,
        multicall: this.multicall2Address,
      },
      agents,
      timeoutCallbacks,
      resolverCallbacks: this.resolverJobData,
    };
  }

  private buildAgents(): IAgent[] {
    const agents = [];
    // TODO: get type & AgentConfig
    for (const [address, agentConfig] of Object.entries(this.networkConfig.agents)) {
      const checksummedAddress = toChecksummedAddress(address);
      let { version, strategy } = agentConfig;
      if (!version || !strategy) {
        [version, strategy] = getAgentVersionAndType(checksummedAddress, this.name);
      }
      let agent;

      if (version.startsWith('2.') && strategy === 'randao') {
        agent = new AgentRandao_2_3_0(checksummedAddress, agentConfig, this.name);
      } else if (version.startsWith('2.') && strategy === 'light') {
        agent = new AgentLight_2_2_0(checksummedAddress, agentConfig, this.name);
      } else {
        throw new Error(
          `App: Not supported agent version/strategy: network=${this.name},version=${version},strategy=${strategy}`,
        );
      }

      agents.push(agent);
    }
    return agents;
  }

  private initProvider() {
    this.provider = new WebSocketProvider(this.rpc);
    this.fixProvider(this.provider);
    this.clog('info', `Ws connection ${this.rpc} established`);

    this.contractWrapperFactory = new EthersContractWrapperFactory(this, this.networkConfig.ws_timeout);
    this.multicall = this.contractWrapperFactory.build(this.multicall2Address, getMulticall2Abi());
    // TODO: initialize this after we know agent version and strategy
    this.externalLens = this.contractWrapperFactory.build(this.externalLensAddress, getExternalLensAbi());
    this.provider.on('block', this._onNewBlockCallbackSkipWrapper.bind(this));
    this.provider.on('reconnect', this._resyncAgents.bind(this));
  }

  private fixProvider(provider) {
    const originalSubscribe = provider._subscribe.bind(provider);
    provider._subscribe = (tag: string, param: Array<any>, processFunc: (result: any) => void) => {
      return originalSubscribe(tag, param, (result: any) => {
        try {
          processFunc(result);
        } catch (e) {
          this.clog('error', `Provider subscribe process error ${e.message}`);
        }
      });
    };

    if (provider.websocket && provider.websocket.onmessage) {
      const originalOnMessage = provider.websocket.onmessage.bind(provider);
      provider.websocket.onmessage = (messageEvent: { data: string }) => {
        if (messageEvent.data) {
          const originalData = messageEvent.data;
          messageEvent.data.split(/\}\{/).forEach(chunk => {
            chunk = chunk.trim();
            if (chunk[chunk.length - 1] !== '}') {
              chunk += '}';
            }
            if (chunk[0] !== '{') {
              chunk = '{' + chunk;
            }
            try {
              const data = JSON.parse(chunk);
              if (!data.id && !data.method && data.result && data.result.length && data.result[0].logIndex) {
                // TODO: remove on fixing this case in Ethermint
                this.contractEventsEmitter.emitByBlockLogs(data.result, true);
              }
              // TODO: handle canceled requests?
              // if (data.error && data.error.message === 'Request was canceled due to enabled timeout.') {
              //   return;
              // }
              messageEvent.data = chunk;
              if (messageEvent.data.includes('Request was canceled due to enabled timeout.')) {
                console.log('messageEvent.data', messageEvent.data);
              }
              originalOnMessage(messageEvent);
            } catch (e) {
              this.clog(
                'error',
                `fixProvider json parsing error: ${e.message}, JSON: ${chunk}, Original message: ${originalData}`,
              );
            }
          });
        }
      };
    }
  }

  public async init() {
    if (this.initialized) {
      throw this.err('Already initialized');
    }
    this.initialized = true;

    if (this.agents.length === 0) {
      this.clog('warning', `Ignoring '${this.getName()}' network setup as it has no agents configured.`);
      return;
    }

    await this.initProvider();

    try {
      const latestBlock = await this.queryLatestBlock();

      this.latestBaseFee = BigInt(latestBlock.baseFeePerGas.toString());
      this.latestBlockNumber = BigInt(latestBlock.number.toString());
      this.latestBlockTimestamp = BigInt(latestBlock.timestamp.toString());
    } catch (e) {
      throw this.err(`Can't init '${this.getName()}' using '${this.rpc}': ${e}`);
    }

    this.chainId = await this.queryNetworkId();

    this.clog(
      'info',
      `The network '${this.getName()}' has been initialized. The last block number: ${this.latestBlockNumber}`,
    );

    await this.initAgents();

    if (this.agentsStartBlockNumber < this.latestBlockNumber) {
      let startBlockNumber = Number(this.agentsStartBlockNumber);
      let diff = Number(this.latestBlockNumber) - startBlockNumber;
      this.latestBlockNumber = this.agentsStartBlockNumber;
      this.contractEventsEmitter.setBlockLogsMode(true);
      this.clog('info', `Sync diff between sources: ${diff}. Start fetching this blocks manually...`);

      const step = 10;
      do {
        const count = diff > step ? step : diff;
        const before = this.nowMs();
        const blocks = await pIteration.map(Array.from(Array(Number(count)).keys()), n => {
          return this.queryBlock(startBlockNumber + n + 1);
        });

        blocks.forEach(block => this._handleNewBlock(block, before));

        if (this.contractEventsEmitter.blockLogsMode) {
          this.contractEventsEmitter.emitByBlockLogs(
            await this.provider.getLogs({
              fromBlock: Number(this.agentsStartBlockNumber) + 1,
              toBlock: Number(this.agentsStartBlockNumber) + count,
            }),
          );
        }

        startBlockNumber += count;
        diff = parseInt(await this.queryLatestBlock().then(b => b.number.toString())) - startBlockNumber;
      } while (diff > step);

      this.contractEventsEmitter.setBlockLogsMode(false);
    }
  }

  private async initAgents() {
    let lowBlockNumber;
    for (const agent of this.getAgents()) {
      let dataSource;
      // TODO: Add support for different agents. Now if there are multiple agents, the tags linked to the latest one.
      updateSentryScope(
        this.getName(),
        this.getFlashbotsRpc(),
        agent.address,
        agent.getKeyAddress(),
        agent.dataSourceType,
        agent.subgraphUrl,
      );
      if (agent.dataSourceType === 'subgraph') {
        dataSource = this.getAgentSubgraphDataSource(agent);
      } else if (agent.dataSourceType === 'subquery') {
        dataSource = this.getAgentSubqueryDataSource(agent);
      } else if (agent.dataSourceType === 'blockchain') {
        dataSource = this.getAgentBlockchainDataSource(agent);
      } else {
        throw new Error(`App: missing dataSource for agent ${agent.address}`);
      }
      const syncBlockNumber = await agent.init(this, dataSource);
      lowBlockNumber = !lowBlockNumber || syncBlockNumber < lowBlockNumber ? syncBlockNumber : lowBlockNumber;
    }
    this.agentsStartBlockNumber = lowBlockNumber;
  }

  private async _resyncAgents() {
    this.clog('info', `Resync agents on network: '${this.getName()}'`);
    for (const agent of this.getAgents()) {
      await agent.checkStatusAndResyncAllJobs();
    }
  }

  public getAgentSubgraphDataSource(agent) {
    return new SubgraphSource(this, agent, agent.subgraphUrl);
  }

  public getAgentSubqueryDataSource(agent) {
    return new SubquerySource(this, agent, agent.subgraphUrl);
  }

  public getAgentBlockchainDataSource(agent) {
    return new BlockchainSource(this, agent);
  }

  public stop() {
    this.provider?.removeAllListeners();
    this.contractWrapperFactory?.stop();
    // this.provider = null;
    // this.agents = null;
  }

  private async _onNewBlockCallbackSkipWrapper(blockNumber) {
    if (this.skipBlocksDivisor !== null && Number(blockNumber) % this.skipBlocksDivisor !== 0) {
      return;
    }
    await this._onNewBlockCallback(blockNumber);
  }

  private async _onNewBlockCallback(blockNumber) {
    blockNumber = BigInt(blockNumber.toString());
    const before = this.nowMs();

    const oldLatestBlockNumber = this.latestBlockNumber;
    if (this.latestBlockNumber && blockNumber <= this.latestBlockNumber) {
      return null;
    }
    this.latestBlockNumber = blockNumber;

    const block = await this.queryBlock(blockNumber);
    if (!block) {
      this.latestBlockNumber = oldLatestBlockNumber;
      setTimeout(() => {
        this._onNewBlockCallback(blockNumber);
      }, 1000);
      this.clog('error', `⚠️ Block not found (number=${blockNumber},before=${before},nowMs=${this.nowMs()})`);
      return null;
    }

    this._handleNewBlock(block, before);
    this._walkThroughTheJobs(block.number, block.timestamp);

    if (this.contractEventsEmitter.blockLogsMode) {
      const fromBlock = bigintToHex(blockNumber);
      this.contractEventsEmitter.emitByBlockLogs(await this.provider.getLogs({ fromBlock, toBlock: fromBlock }));
    }

    setTimeout(async () => {
      if (this.latestBlockNumber > blockNumber) {
        return;
      }
      this.contractEventsEmitter.setBlockLogsMode(true);
      this.newBlockEventEmitter.emit('newBlockDelay', blockNumber);
      this.clog(
        'error',
        `⏲ New block timeout: (number=${blockNumber},before=${before},nowMs=${this.nowMs()},maxNewBlockDelay=${
          this.maxNewBlockDelay
        })`,
      );
      let block;
      do {
        block = await this._onNewBlockCallback(++blockNumber);
      } while (block);
    }, this.maxNewBlockDelay * 1000);

    return block;
  }

  private _handleNewBlock(block, before) {
    const fetchBlockDelay = this.nowMs() - before;
    if (process.env.NODE_ENV !== 'test') {
      this.clog(
        'info',
        `🧱 New block: (number=${block.number},timestamp=${block.timestamp},hash=${block.hash},txCount=${block.transactions.length},baseFee=${block.baseFeePerGas},fetchDelayMs=${fetchBlockDelay})`,
      );
    }
    this.latestBaseFee = BigInt(block.baseFeePerGas.toString());
    this.latestBlockTimestamp = BigInt(block.timestamp.toString());
    this.currentBlockDelay = this.nowS() - parseInt(block.timestamp.toString());

    this.newBlockEventEmitter.emit('newBlock', block.timestamp, block.number);
  }

  public isBlockDelayAboveMax() {
    return this.currentBlockDelay && this.currentBlockDelay > this.maxBlockDelay;
  }

  public blockDelay() {
    return this.currentBlockDelay;
  }

  public getMaxNewBlockDelay() {
    return this.maxNewBlockDelay;
  }

  public getNewBlockEventEmitter(): EventEmitter {
    return this.newBlockEventEmitter;
  }

  public getContractEventEmitter(contract: ContractWrapper): EventEmitter {
    return this.contractEventsEmitter.contractEmitter(contract);
  }

  private _walkThroughTheJobs(blockNumber: number, blockTimestamp: number) {
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

    this.clog('debug', `Block ${blockNumber} interval callbacks triggered: ${callbacksCalled}`);
  }

  private async callResolversAndTriggerCallbacks(blockNumber: number) {
    // TODO: split calls in chunks
    // TODO: protect from handlers queueing on the networks with < 3s block time
    const resolversToCall = [];
    const callbacks = [];
    for (const [jobKey, jobData] of Object.entries(this.resolverJobData)) {
      callbacks.push(jobData.callback);
      resolversToCall.push({
        jobKey,
        target: jobData.resolver.resolverAddress,
        callData: jobData.resolver.resolverCalldata,
      });
      // TODO: let this.provider to be executed when making chunk requests;
    }
    if (callbacks.length === 0) {
      this.clog('debug', 'CallResolvers: no resolvers to call');
      return;
    }

    this.clog('debug', `CallResolvers: Polling ${resolversToCall.length} resolvers...`);
    const results = await this.queryPollResolvers(false, resolversToCall, this.agents[0].getWorkerSignerAddress());
    let jobsToExecute = 0;

    for (let i = 0; i < results.length; i++) {
      const decoded = results[i].success
        ? ethers.utils.defaultAbiCoder.decode(['bool', 'bytes'], results[i].returnData)
        : [false];
      const { jobKey } = resolversToCall[i];
      const job = this.resolverJobData[jobKey];
      if (this.latestBlockNumber > job.lastSuccessBlock) {
        job.lastSuccessBlock = decoded[0] ? this.latestBlockNumber : 0n;
        job.successCounter = decoded[0] ? job.successCounter + 1 : 0;
      }
      if (decoded[0] && job.successCounter >= this.networkConfig.resolve_min_success_count) {
        const agent = this.getAgent(jobKey.split('/')[0]);
        const job = await agent.getJob(jobKey.split('/')[1]);
        if (job.isOffchainJob()) {
          try {
            callbacks[i](blockNumber, await this.getOffchainResolveCalldata(job, decoded[1]));
            jobsToExecute += 1;
          } catch (e) {
            this.clog('error', e.message);
          }
        } else {
          callbacks[i](blockNumber, decoded[1]);
          jobsToExecute += 1;
        }
      }
    }

    this.clog(
      'debug',
      `Block ${blockNumber} resolver estimation results: (resolversToCall=${resolversToCall.length},jobsToExecute=${jobsToExecute})`,
    );
  }

  private async getOffchainResolveCalldata(job: AbstractJob, resolverCalldata) {
    const offchainServiceEndpoint = process.env.OFFCHAIN_SERVICE_ENDPOINT || 'http://offchain-service/';
    const params = job.getOffchainResolveParams();
    return axios
      .post(`${offchainServiceEndpoint}/offchain-resolve/${params['resolverAddress']}`, {
        resolverCalldata,
        ...params,
      })
      .then(r => r.data.resultCalldata);
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

  public registerTimeout(key: string, triggerCallbackAfter: number, callback: (blockTimestamp: number) => void) {
    this._validateKeyLength(key, 'interval');
    this._validateKeyNotInMap(key, this.timeoutData, 'interval');
    this.clog(
      'debug',
      'SET Timeout',
      key,
      `at: ${triggerCallbackAfter}`,
      `now: ${this.nowS()}, in: ${triggerCallbackAfter - this.nowS()}`,
    );
    this.timeoutData[key] = {
      triggerCallbackAfter,
      callback,
    };
  }

  public unregisterTimeout(key: string) {
    this.clog('debug', 'UNSET Timeout', key);
    this._validateKeyLength(key, 'interval');
    delete this.timeoutData[key];
  }

  public registerResolver(key: string, resolver: Resolver, callback: (calldata: string) => void) {
    this._validateKeyLength(key, 'resolver');
    this._validateKeyNotInMap(key, this.resolverJobData, 'resolver');
    this.resolverJobData[key] = {
      resolver,
      callback,
      lastSuccessBlock: 0n,
      successCounter: 0,
    };
  }

  public unregisterResolver(key: string) {
    this._validateKeyLength(key, 'resolver');
    delete this.resolverJobData[key];
  }

  // public async queryGasPrice(): Promise<number> {
  //   return (await this.provider.getGasPrice()).toNumber();
  // }

  public async queryBlock(number): Promise<ethers.providers.Block> {
    return this.provider.getBlock(parseInt(number.toString())).catch(e => {
      this.clog('error', `queryBlock error: ${e.message}`);
      return null;
    });
  }

  public async queryLatestBlock(): Promise<ethers.providers.Block> {
    return this.provider.getBlock('latest');
  }

  public async queryNetworkId(): Promise<number> {
    return (await this.provider.getNetwork()).chainId;
  }

  public async queryPollResolvers(bl: boolean, resolversToCall: any[], from: string): Promise<any> {
    return this.multicall.ethCallStatic('tryAggregate', [false, resolversToCall], { from });
  }

  public async queryLensJobsRawBytes32(agent: string, jobKey: string): Promise<string> {
    const res = await this.externalLens.ethCall('getJobsRawBytes32', [agent, [jobKey]]);
    return res.results[0];
  }

  public async queryLensJobs(agent: string, jobKeys: string[]): Promise<any> {
    return this.externalLens.ethCall('getJobs', [agent, jobKeys]);
  }

  public async queryLensOwnerBalances(agent: string, owners: string[]): Promise<any> {
    return this.externalLens.ethCall('getOwnerBalances', [agent, owners]);
  }

  public async queryLensJobBytes32AndNextBlockSlasherId(
    agent: string,
    jobKey: string,
  ): Promise<LensGetJobBytes32AndNextBlockSlasherIdResponse> {
    const res = await this.externalLens.ethCall('getJobBytes32AndNextBlockSlasherId', [agent, jobKey]);
    return { binJob: res.binJob, nextBlockSlasherId: res.nextBlockSlasherId.toNumber() };
  }
}
