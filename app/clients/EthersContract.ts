import { ethers } from 'ethers';
import { buildSignature, buildAbiSelector, nowTimeString, sleep } from '../Utils.js';
import { ContractWrapper, ErrorWrapper, EventWrapper, WrapperListener } from '../Types.js';
import { Result, Fragment, ErrorFragment, FunctionFragment, EventFragment } from 'ethers/lib/utils.js';

// DANGER: DOES NOT support method override
export class EthersContract implements ContractWrapper {
  private readonly contract: ethers.Contract;
  private readonly address: string;

  private readonly attempts = 3;
  private readonly attemptTimeoutSeconds = 1;

  private readonly primaryEndpoint: string;
  private readonly providers: Map<string, ethers.providers.BaseProvider>;

  private readonly abiFunctionOutputKeys: Map<string, Array<string>>;
  private readonly abiEventKeys: Map<string, Array<string>>;
  // map<selector, ErrorFragment>
  private readonly abiErrorFragments: Map<string, ErrorFragment>;

  constructor(
    addressOrName: string,
    contractInterface: ReadonlyArray<Fragment>,
    primaryEndpoint: string,
    providers: Map<string, ethers.providers.BaseProvider>,
  ) {
    this.address = addressOrName;
    this.contract = new ethers.Contract(addressOrName, contractInterface, providers.get(primaryEndpoint));
    this.primaryEndpoint = primaryEndpoint;
    this.providers = providers;
    this.abiFunctionOutputKeys = new Map();
    this.abiEventKeys = new Map();
    this.abiErrorFragments = new Map();

    for (const obj of contractInterface) {
      switch (obj.type) {
        case 'function':
          this.abiFunctionOutputKeys.set(obj.name, (FunctionFragment.fromObject(obj).outputs || []).map(v => {
            return v.name;
          }));
          break;
        case 'event':
          this.abiEventKeys.set(obj.name, (obj as EventFragment).inputs.map(v => v.name));
          break;
        default:
          break;
      }
    }
  }
  public decodeError(response: string): ErrorWrapper {
    const decoded = this.contract.interface.parseError(response);
    return {
      name: decoded.name,
      signature: decoded.signature,
      args: filterFunctionResultObject(decoded.args)
    };
  }

  private toString(): string {
    return `EthersContract: (rpc=${this.primaryEndpoint})`;
  }

  private clog(...args: any[]) {
    console.log(`>>> ${nowTimeString()} >>> Network${this.toString()}:`, ...args);
  }

  private err(...args: any[]): Error {
    return new Error(`NetworkError${this.toString()}: ${args.join(' ')}`);
  }

  public getNativeContract(): ethers.Contract {
    return this.contract;
  }

  public getDefaultProvider(): ethers.providers.BaseProvider {
    if (!this.providers) {
      throw this.err('Provider not initialized');
    }
    return this.providers.get(this.primaryEndpoint);
  }

  public async ethCallStatic(method: string, args = [], overrides = {}): Promise<any> {
    return this.ethCall(method, args, overrides, true);
  }

  public async ethCall(method: string, args = [], overrides = {}, callStatic = false): Promise<any> {
    if (!(method in this.contract)) {
      throw this.err(`Contract ${this.address} doesn't have method '${method}' in the provided abi.`)
    }
    let errorCounter = this.attempts;

    do {
      try {
        let res;
        if (callStatic) {
          res = await this.contract.callStatic[method](...args);
        } else {
          res = await this.contract[method](...args);
        }
        return filterFunctionResultObject(res);
      } catch (e) {
        this.clog(`Error querying method '${method}' with arguments ${JSON.stringify(args)} and overrides ${JSON.stringify(overrides)}:
${e.message}: ${Error().stack}`);
        await sleep(this.attemptTimeoutSeconds * 1000);
      }
    } while (errorCounter-- > 0)
  }

  public async getPastEvents(eventName: string, from: number, to: number): Promise<EventWrapper[]> {
    const registerJobFilter = this.contract.filters[eventName]();
    const vals = await this.contract.queryFilter(registerJobFilter, from, to);
    return vals.map(event => {
      if (event.removed) {
        throw this.err('Removed events are not supported yet:', event);
      }
      return {
        name: event.event,
        args: filterFunctionResultObject(event.args),
        blockNumber: event.blockNumber,
        blockHash: event.blockHash,
        nativeEvent: {}
      };
    });
  }

  public on(eventName: string, eventEmittedCallback: WrapperListener): ContractWrapper {
    this.contract.on(eventName, (...args) => {
      const event = args[args.length - 1];
      const onlyFields = filterFunctionResultObject(event.args);
      eventEmittedCallback({
        name: eventName,
        args: onlyFields,
        blockNumber: event.blockNumber,
        blockHash: event.blockHash,
        nativeEvent: {}
      });
    });
    return this;
  }

}

function filterFunctionResultObject(res: Result): { [key: string ]: any } {
  if (!Array.isArray(res)) {
    return res;
  }

  const filteredResult = {};

  if (res.length === 0) {
    return {};
  } if (res.length === 1) {
    return [filterFunctionResultObject(res['0'])];
  } else if (res.length > 1) {
    // For a fake array the object keys length is twice bigger than its length
    const isRealArray = Array.isArray(res) && Object.keys(res).length === res.length;
    // if is a real array, it's items could be an unfiltered object
    if (isRealArray) {
      return res.map(v => filterFunctionResultObject(v));
    } else { // else it is a fake object
      let i = 0;
      for (const field in res) {
        if (i++ < res.length) {
          continue;
        }
        if (Array.isArray(res[field])) {
          filteredResult[field] = filterFunctionResultObject(res[field]);
        } else {
          filteredResult[field] = res[field];
        }
      }
    }
  }

  return filteredResult;
}
