import { ethers } from 'ethers';
import { ContractWrapper, ContractWrapperFactory } from '../Types.js';
import { EthersContract } from './EthersContract.js';
import { Fragment } from '@ethersproject/abi/src.ts/fragments';
import logger from '../services/Logger.js';
import {Network} from "../Network";

export class EthersContractWrapperFactory implements ContractWrapperFactory {
  private readonly primaryEndpoint: string;
  private readonly wsCallTimeout: number;
  private provider: ethers.providers.BaseProvider;

  // constructor(wsRpcEndpoints: string[], wsTimeout) {
  //   if (wsRpcEndpoints.length === 0) {
  //     throw new Error('EthersClient: missing endpoint list');
  //   }
  //   const [primaryEndpoint] = wsRpcEndpoints;
  //   this.primaryEndpoint = primaryEndpoint;
  constructor(network: Network, wsTimeout) {
    this.primaryEndpoint = network.getRpc();
    this.wsCallTimeout = wsTimeout;
    this.clog('info', 'Contract factory initialized');
    //this.provider = new ethers.providers.WebSocketProvider(primaryEndpoint);
    this.provider=network.getProvider(); 
  }

  private toString(): string {
    return `EthersClient: (rpc=${this.primaryEndpoint})`;
  }

  private clog(level: string, ...args) {
    //logger.log(level, `EthersContractFactory${this.toString()}:`, ...args);
    logger.log(level, `EthersContractFactory${this.toString()}: ${args.join(' ')}`);
  }

  private err(...args): Error {
    return new Error(`NetworkError${this.toString()}: ${args.join(' ')}`);
  }

  public async getLatestBlockNumber(): Promise<number> {
    return this.getDefaultProvider().getBlockNumber();
  }

  public getDefaultProvider(): ethers.providers.BaseProvider {
    if (!this.provider) {
      throw this.err('Provider not initialized');
    }
    return this.provider;
  }

  public build(addressOrName: string, contractInterface: ReadonlyArray<Fragment>): ContractWrapper {
    const providers = new Map<string, ethers.providers.BaseProvider>();
    providers.set(this.primaryEndpoint, this.getDefaultProvider());
    return new EthersContract(addressOrName, contractInterface, this.primaryEndpoint, providers, this.wsCallTimeout);
  }

  public stop() {
    if (this.provider) {
      this.provider.removeAllListeners();
      this.provider = null;
    }
  }
}
