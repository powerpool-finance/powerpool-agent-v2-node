import { ethers } from 'ethers';
import { ContractWrapper, ContractWrapperFactory } from '../Types.js';
import { EthersContract } from './EthersContract.js';
import { Fragment } from '@ethersproject/abi/src.ts/fragments';
import logger from '../services/Logger.js';
import { Network } from '../Network';

export class EthersContractWrapperFactory implements ContractWrapperFactory {
  private readonly wsCallTimeout: number;
  private readonly network: Network;

  constructor(network: Network, wsTimeout) {
    this.wsCallTimeout = wsTimeout;
    this.network = network;
    this.clog('info', 'Contract factory initialized');
  }

  private toString(): string {
    return `EthersClient: (rpc=${this.network.getRpc()})`;
  }

  private clog(level: string, ...args) {
    logger.log(level, `EthersContractFactory${this.toString()}: ${args.join(' ')}`);
  }

  private err(...args): Error {
    return new Error(`NetworkError${this.toString()}: ${args.join(' ')}`);
  }

  public async getLatestBlockNumber(): Promise<number> {
    return this.getDefaultProvider().getBlockNumber();
  }

  public getDefaultProvider(): ethers.providers.BaseProvider {
    if (!this.network.getProvider()) {
      throw this.err('Provider not initialized');
    }
    return this.network.getProvider();
  }

  public build(addressOrName: string, contractInterface: ReadonlyArray<Fragment>): ContractWrapper {
    return new EthersContract(addressOrName, contractInterface, this.network, this.wsCallTimeout);
  }

  public stop() {
    // if (this.network.getProvider()) {
    //   this.network.getProvider().removeAllListeners();
    // }
  }
}
