import { ClientWrapper, ContractWrapper, ContractWrapperFactory, NetworkConfig, Resolver } from './Types.js';
import { Agent } from './Agent.js';
import {ethers, providers} from 'ethers';
import { getAverageBlockTime, getExternalLensAddress, getMulticall2Address } from './ConfigGetters.js';
import { getExternalLensAbi, getMulticall2Abi } from './services/AbiService.js';
import { nowMs, nowTimeString } from './Utils.js';
import { EthersContractWrapperFactory } from './clients/EthersContractWrapperFactory.js';
import EventEmitter from 'events';

interface ResolverJobWithCallback {
  resolver: Resolver;
  callback: (calldata: string) => void;
}

export class Network {
  private name: string;
  private networkConfig: NetworkConfig;
  private rpc: string;
  private chainId: number;
  private client: ClientWrapper | undefined;
  private provider: ethers.providers.WebSocketProvider | undefined;
  private agents: Agent[];
  private resolverJobData: { [key: string]: ResolverJobWithCallback };
  private multicall: ContractWrapper| undefined;
  private externalLens: ContractWrapper| undefined;
  private averageBlockTimeSeconds: number;
  private flashbotsAddress: string;
  private flashbotsPass: string;
  private flashbotsRpc: string;
  private newBlockNotifications: Map<number, Set<string>>;
  private contractWrapperFactory: ContractWrapperFactory;
  private newBlockEventEmitter: EventEmitter;

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
    this.contractWrapperFactory = new EthersContractWrapperFactory([networkConfig.rpc]);
    this.name = name;
    this.rpc = networkConfig.rpc;
    this.networkConfig = networkConfig;
    this.flashbotsRpc = networkConfig.flashbots.rpc;
    this.flashbotsAddress = networkConfig.flashbots.address;
    this.flashbotsPass = networkConfig.flashbots.pass;
    this.averageBlockTimeSeconds = getAverageBlockTime(name);
    this.newBlockEventEmitter = new EventEmitter();

    this.newBlockNotifications = new Map();

    if (!this.rpc && !this.rpc.startsWith('ws')) {
      throw this.err(
        `Only WebSockets RPC endpoints are supported. The current value for '${this.getName()}' is '${this.rpc}'.`
      )
    }

    this.resolverJobData = {};
    this.agents = [];
    for (const [address, agentConfig] of Object.entries(this.networkConfig.agents)) {
      const agent = new Agent(address, agentConfig, this);
      this.agents.push(agent);
    }
  }

  public getContractWrapperFactory(): ContractWrapperFactory {
    return this.contractWrapperFactory;
  }

  public getAverageBlockTimeSeconds(): number {
    return this.averageBlockTimeSeconds;
  }

  public async getLatestBlockNumber(): Promise<number> {
    return this.contractWrapperFactory.getLatestBlockNumber();
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

  public async init() {
    if (this.agents.length === 0) {
      this.clog(`Ignoring '${this.getName()}' network setup as it has no agents configured.`);
      return;
    }

    this.provider = new ethers.providers.WebSocketProvider(this.rpc);
    this.multicall = this.contractWrapperFactory.build(getMulticall2Address(this.name), getMulticall2Abi());
    this.externalLens = this.contractWrapperFactory.build(getExternalLensAddress(this.name), getExternalLensAbi());

    try {
      const lastBlock = await this.provider.getBlockNumber();
      this.clog(`The network '${this.getName()}' has been initialized. The last block number: ${lastBlock}`);
    } catch (e) {
      throw this.err(`Can't init '${this.getName()}' using '${this.rpc}': ${e}`);
    }

    this.chainId = (await this.provider.getNetwork()).chainId;

    for (const agent of this.agents) {
      await agent.init();
    }

    this.provider.on('block', async blockNumber => {
      const before = nowMs();
      const block = await this.provider.getBlock(blockNumber);
      const fetchBlockDelay = nowMs() - before;

      this.newBlockEventEmitter.emit('newBlock', block.timestamp);

      if (this.newBlockNotifications.has(blockNumber)) {
        const emittedBlockHashes = this.newBlockNotifications.get(blockNumber);
        if (emittedBlockHashes && !emittedBlockHashes.has(block.hash)) {
          emittedBlockHashes.add(block.hash);
          this.callAllResolvers(blockNumber);
        }
      } else {
        this.newBlockNotifications.set(blockNumber, new Set([block.hash]));
        this.callAllResolvers(blockNumber);
      }

      this.clog(`🧱 New block: (number=${blockNumber},timestamp=${block.timestamp},hash=${block.hash
      },txCount=${block.transactions.length},fetchDelayMs=${fetchBlockDelay})`);
    });
    this.clog('✅ Network initialization done!')
  }

  public getNewBlockEventEmitter(): EventEmitter {
    return this.newBlockEventEmitter;
  }

  private async callAllResolvers(blockNumber: number) {
    // TODO: split calls in chunks
    // TODO: protect from handlers queueing on the networks with < 3s block time
    const resolversToCall = [];
    const callbacks = [];
    for (const [, jobData] of Object.entries(this.resolverJobData)) {
      callbacks.push(jobData.callback);
      resolversToCall.push({
        target: jobData.resolver.resolverAddress,
        callData: jobData.resolver.resolverCalldata
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
          callbacks[i](decoded[1]);
          jobsToExecute += 1;
        }
      }
    }

    this.clog(`Block ${blockNumber} resolver estimation results: (resolversToCall=${resolversToCall.length
      },jobsToExecute=${jobsToExecute})`);
  }

  public registerResolver(key: string, resolver: Resolver, callback: (calldata: string) => void) {
    if (key.length < 3) {
      throw this.err(`Invalid key: ${key}`);
    }
    if (this.resolverJobData[key]) {
      throw this.err(`Key already exists: ${key}`);
    }
    this.resolverJobData[key] = {
      resolver,
      callback
    };
  }

  public unregisterResolver(key: string) {
    if (key.length < 3) {
      throw this.err(`Invalid key: ${key}`);
    }
    if (!this.resolverJobData[key]) {
      return;
      // throw this.err(`Key doesn't exist: ${key}`);
    }
    delete this.resolverJobData[key];
  }
}
