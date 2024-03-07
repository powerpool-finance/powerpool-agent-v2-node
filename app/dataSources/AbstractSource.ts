import { Network } from '../Network';
import { IAgent, IDataSource, SourceMetadata } from '../Types';
import { RandaoJob } from '../jobs/RandaoJob';
import { LightJob } from '../jobs/LightJob';
import { BigNumber } from 'ethers';

export abstract class AbstractSource implements IDataSource {
  protected type: string;
  protected network: Network;
  protected agent: IAgent;

  protected constructor(network: Network, agent: IAgent) {
    this.network = network;
    this.agent = agent;

    if (!this.agent) {
      throw this._err('Missing agent argument');
    }

    if (!this.network) {
      throw this._err('Missing network argument');
    }
  }

  /**
   * An error handler. All it's doing is format errors text
   * @param args
   * @protected
   */
  private _err(...args: unknown[]): Error {
    return new Error(`AbstractDataSourceError${this.toString()}: ${args.join(' ')}`);
  }

  abstract getRegisteredJobs(_context): Promise<{ data: Map<string, RandaoJob | LightJob>; meta: SourceMetadata }>;
  abstract getJob(_context, jobKey): Promise<RandaoJob | LightJob>;
  abstract getOwnersBalances(
    context,
    jobOwnersSet: Set<string>,
  ): Promise<{ data: Map<string, BigNumber>; meta: SourceMetadata }>;
  abstract addLensFieldsToOneJob(newJobs: RandaoJob | LightJob): void;

  /**
   * Helps handle null addresses. If value is null it returns a null address
   * @param value - value to check for null
   * @param longVersion - If longer version of null address is required: 0x -> 0x0000000000000000000000000000000000000000
   * @param objectKey - If value is an object that can turn to null. Here you can pass key of that object which should be returned otherwise
   */
  protected _checkNullAddress(value, longVersion = false, objectKey = ''): string {
    if (typeof value !== 'undefined' && value === null) {
      return longVersion ? '0x0000000000000000000000000000000000000000' : '0x';
    } else {
      return objectKey ? value[objectKey] : value;
    }
  }

  public getType(): string {
    return this.type;
  }

  async getBlocksDelay(): Promise<{ diff: bigint; nodeBlockNumber: bigint; sourceBlockNumber: bigint }> {
    return null;
  }
}
