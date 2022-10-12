import { ethers } from 'ethers';
import { nowTimeString } from '../Utils.js';
import { ContractWrapper, ErrorWrapper, WrapperListener } from '../Types.js';

export class Web3Contract implements ContractWrapper {
  private primaryEndpoint: string;
  private provider: ethers.providers.BaseProvider;
  private contract: ethers.Contract;

  private address: string;

  private attempts = 3;
  private attemptTimeoutSeconds = 1;

  constructor(addressOrName: string, contractInterface: ethers.ContractInterface, signerOrProvider?: any) {
    this.address = addressOrName;
    // this.contract = new (addressOrName, contractInterface, signerOrProvider);
  }

  private toString(): string {
    return `EthersContract: (rpc=${this.primaryEndpoint})`;
  }

  private clog(...args) {
    console.log(`>>> ${nowTimeString()} >>> Network${this.toString()}:`, ...args);
  }

  private err(...args): Error {
    return new Error(`NetworkError${this.toString()}: ${args.join(' ')}`);
  }

  public getNativeContract(): ethers.Contract {
    return this.contract;
  }

  public getDefaultProvider(): ethers.providers.BaseProvider {
    if (!this.provider) {
      throw this.err('Provider not initialized');
    }
    return this.provider;
  }

  public ethCall(method: string, args: any[], overrides: object): any {
    if (!(method in this.contract)) {
      throw this.err(`Contract ${this.address} doesn't have method '${method}' in the provided abi.`)
    }
    let errorCounter = this.attempts;

    do {
      try {
        return this.contract[method](...args, overrides);
      } catch (e) {
        this.clog(`Error querying method '${method}' with arguments ${JSON.stringify(args)} and overrides ${overrides}: ${e}`);
      }
    } while (errorCounter-- > 0)
  }

  decodeError(response: string): ErrorWrapper {
    return undefined;
  }

  ethCallStatic(method: string, args?: any[], overrides?: object): Promise<any> {
    return Promise.resolve(undefined);
  }

  getPastEvents(eventName: string, from: number, to: number): Promise<any[]> {
    return Promise.resolve([]);
  }

  on(eventName: string, eventEmittedCallback: WrapperListener): ContractWrapper {
    return undefined;
  }
}
