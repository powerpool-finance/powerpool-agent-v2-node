import { ethers } from 'ethers';
import { sleep, filterFunctionResultObject } from '../Utils.js';
import { ContractWrapper, ErrorWrapper, EventWrapper, TxDataWrapper, WrapperListener } from '../Types.js';
import { Fragment, ErrorFragment, FunctionFragment, EventFragment } from 'ethers/lib/utils.js';
import logger from '../services/Logger.js';
import QueueEmitter from '../services/QueueEmitter.js';

// DANGER: DOES NOT support method override
export class EthersContract implements ContractWrapper {
  private readonly contract: ethers.Contract;
  public readonly address: string;
  private readonly wsCallTimeout: number;

  private readonly attempts = 3;
  private readonly attemptTimeoutSeconds = 1;

  private readonly primaryEndpoint: string;
  private readonly providers: Map<string, ethers.providers.BaseProvider>;

  private readonly abiFunctionOutputKeys: Map<string, Array<string>>;
  private readonly abiEventKeys: Map<string, Array<string>>;
  private readonly abiEvents: Map<string, any>;
  private readonly abiEventByTopic: Map<string, any>;

  // map<selector, ErrorFragment>
  private readonly abiErrorFragments: Map<string, ErrorFragment>;
  private readonly eventEmitter: QueueEmitter;

  constructor(
    addressOrName: string,
    contractInterface: ReadonlyArray<Fragment>,
    primaryEndpoint: string,
    providers: Map<string, ethers.providers.BaseProvider>,
    wsCallTimeout: number,
  ) {
    this.address = addressOrName;
    this.contract = new ethers.Contract(addressOrName, contractInterface, providers.get(primaryEndpoint));
    this.primaryEndpoint = primaryEndpoint;
    this.providers = providers;
    this.abiFunctionOutputKeys = new Map();
    this.abiEventKeys = new Map();
    this.abiEvents = new Map();
    this.abiEventByTopic = new Map();
    this.abiErrorFragments = new Map();
    this.eventEmitter = new QueueEmitter();

    // Setting connection timeout
    if (wsCallTimeout) this.wsCallTimeout = wsCallTimeout;
    else this.wsCallTimeout = 15000;

    for (const obj of contractInterface) {
      switch (obj.type) {
        case 'function':
          this.abiFunctionOutputKeys.set(
            obj.name,
            (FunctionFragment.fromObject(obj).outputs || []).map(v => {
              return v.name;
            }),
          );
          break;
        case 'event':
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          obj.signature = this.contract.interface.getEventTopic(obj.name);
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          this.abiEventByTopic.set(obj.signature, obj);

          this.abiEventKeys.set(
            obj.name,
            (obj as EventFragment).inputs.map(v => v.name),
          );
          this.abiEvents.set(obj.name, obj);
          break;
        default:
          break;
      }
    }

    providers.get(primaryEndpoint).on(
      {
        address: this.address,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        fromBlock: 'latest',
      },
      async log => {
        await this.processLog(log);
      },
    );
  }

  public parseLog(log) {
    const parsedLogs = this.contract.interface.parseLog(log);
    return Object.assign(log, parsedLogs);
  }

  private async processLog(log) {
    const topic0 = log.topics[0];
    if (this.abiEventByTopic.has(topic0)) {
      const abiEvent = this.abiEventByTopic.get(topic0);
      this.eventEmitter.emit(abiEvent.name, this.parseLog(log));
    } else {
      throw this.err('EthersContract: event missing from abi', JSON.stringify(log));
    }
  }
  public decodeError(response: string): ErrorWrapper {
    const decoded = this.contract.interface.parseError(response);
    return {
      name: decoded.name,
      signature: decoded.signature,
      args: filterFunctionResultObject(decoded.args, true),
    };
  }
  public decodeTxData(data: string): TxDataWrapper {
    const decoded = this.contract.interface.parseTransaction({ data });
    return {
      name: decoded.name,
      signature: decoded.signature,
      args: filterFunctionResultObject(decoded.args),
    };
  }

  private toString(): string {
    return `EthersContract: (rpc=${this.primaryEndpoint})`;
  }

  private clog(level: string, ...args: any[]) {
    logger.log(level, `EthersContract${this.toString()}: ${args.join(' ')}`);
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

  public encodeABI(method: string, args = []): string {
    if (!(method in this.contract)) {
      throw this.err(`Contract ${this.address} doesn't have method '${method}' in the provided abi.`);
    }
    return this.contract.interface.encodeFunctionData(method, args);
  }

  public async ethCallStatic(method: string, args = [], overrides = {}): Promise<any> {
    return this.ethCall(method, args, overrides, true);
  }

  public async ethCall(method: string, args = [], overrides = {}, callStatic = false): Promise<any> {
    if (!(method in this.contract)) {
      throw this.err(`Contract ${this.address} doesn't have method '${method}' in the provided abi.`);
    }

    let timeout,
      tries = 0;
    do {
      const res = await new Promise(async (resolve, reject) => {
        let callRes;
        timeout = setTimeout(() => {
          reject(
            new Error(
              `${Math.round(new Date().getTime() / 1000)}: Call execution took more than ` +
                `${Math.ceil(this.wsCallTimeout / 1000)} seconds: ` +
                `method=${method},args=${JSON.stringify(args)}.`,
            ),
          );
        }, this.wsCallTimeout);

        if (callStatic) {
          callRes = await this.contract.callStatic[method](...args);
        } else {
          callRes = await this.contract[method](...args);
        }
        resolve(filterFunctionResultObject(callRes));
      }).catch(async e => {
        if (e.message && e.message.includes('Call execution took more than')) {
          this.clog('error', `${e.message} (attempt=${tries}/${this.attempts})`);
        } else {
          this.clog(
            'error',
            `Error executing a ethCall(): (attempt=${tries}/${this.attempts}): ` +
              `querying method '${method}' with arguments ${JSON.stringify(args)} and overrides ` +
              `${JSON.stringify(overrides)}: ${e.message}: ${Error().stack}`,
          );
        }
        await sleep(this.attemptTimeoutSeconds * 1000);
        if (tries >= this.attempts) {
          throw e;
        }
      });

      clearTimeout(timeout);
      if (res) {
        return res;
      }
    } while (tries++ < this.attempts);
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
        logIndex: event.logIndex,
        blockNumber: event.blockNumber,
        blockHash: event.blockHash,
        nativeEvent: {},
      };
    });
  }

  public on(eventNameOrNames: string | string[], eventEmittedCallback: WrapperListener): ContractWrapper {
    let eventNameList;
    if (typeof eventNameOrNames === 'string') {
      eventNameList = [eventNameOrNames];
    } else {
      eventNameList = eventNameOrNames;
    }

    for (const eventName of eventNameList) {
      this.eventEmitter.on(eventName, async event => {
        logger.log('debug', `Event Emitted ⚽️⚽️⚽️${event.transactionHash} ${event.logIndex} ${eventName}`);
        const onlyFields = filterFunctionResultObject(event.args);
        return eventEmittedCallback({
          name: eventName,
          args: onlyFields,
          logIndex: event.logIndex,
          blockNumber: event.blockNumber,
          blockHash: event.blockHash,
          nativeEvent: {},
        });
      });
    }
    return this;
  }

  public getTopicOfEvent(eventName) {
    return this.abiEvents.get(eventName).signature;
  }

  public getAbiEventsByLogs() {
    return this.abiEventByTopic;
  }
}
