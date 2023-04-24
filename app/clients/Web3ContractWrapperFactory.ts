import { ContractWrapper, ContractWrapperFactory } from '../Types.js';
import { Web3Contract } from './Web3Contract.js';
import { nowTimeString } from '../Utils.js';
import { Fragment } from '@ethersproject/abi/src.ts/fragments';
import Web3 from 'web3';
import { WebsocketProvider } from 'web3-core';
import { ethers } from "ethers";
import { EthersContract } from "./EthersContract";

export class Web3ContractWrapperFactory implements ContractWrapperFactory {
  private readonly primaryEndpoint: string;
  private readonly web3: Web3;
  private readonly provider: WebsocketProvider;

  constructor(wsRpcEndpoints: string[]) {
    if (wsRpcEndpoints.length === 0) {
      throw new Error('EthersClient: missing endpoint list');
    }
    const [primaryEndpoint,] = wsRpcEndpoints;
    this.primaryEndpoint = primaryEndpoint;
    this.provider = new Web3.providers.WebsocketProvider(this.primaryEndpoint);
    this.web3 = new Web3(this.provider);
  }

  private toString(): string {
    return `EthersClient: (rpc=${this.primaryEndpoint})`;
  }

  private clog(...args) {
    console.log(`>>> ${nowTimeString()} >>> Network${this.toString()}:`, ...args);
  }

  private err(...args): Error {
    return new Error(`NetworkError${this.toString()}: ${args.join(' ')}`);
  }

  public async getLatestBlockNumber(): Promise<number> {
    return this.getWeb3().eth.getBlockNumber();
  }

  public getDefaultProvider(): WebsocketProvider {
    if (!this.provider) {
      throw this.err('Provider not initialized');
    }
    return this.provider;
  }

  public getWeb3(): Web3 {
    if (!this.web3) {
      throw this.err('Web3 not initialized');
    }
    return this.web3;
  }

  build(
    addressOrName: string,
    contractInterface: ReadonlyArray<Fragment>,
  ): ContractWrapper {
    return new Web3Contract(addressOrName, contractInterface, this.getWeb3());
  }
}
