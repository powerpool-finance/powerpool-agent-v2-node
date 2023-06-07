import { Network } from '../Network';
import { ContractWrapper } from '../Types';
import { RandaoJob } from '../jobs/RandaoJob';
import { LightJob } from '../jobs/LightJob';

export abstract class AbstractSource {
  type: string;
  network: Network;
  contract: ContractWrapper;

  constructor(network: Network, contract: ContractWrapper) {
    this.network = network;
    this.contract = contract;

    if (!this.contract) {
      throw this.err('Contract is not initialized');
    }

    if (!this.network) {
      throw this.err('network is not initialized');
    }
  }

  /**
   * An error handler. All it's doing is format errors text
   * @param args
   * @protected
   */
  protected err(...args: any[]): void {
    console.error(`SourceError${this.toString()}: ${args.join(' ')}`);
  }

  async getRegisteredJobs(context): Promise<Map<string, RandaoJob | LightJob>> {
    return new Map<string, RandaoJob | LightJob>();
  }

  /**
   * Helps handle null addresses. If value is null it returns a null address
   * @param value - value to check for null
   * @param longVersion - If longer version of null address is required: 0x -> 0x0000000000000000000000000000000000000000
   * @param objectKey - If value is an object that can turn to null. Here you can pass key of that object which should be returned otherwise
   */
  _checkNullAddress(value, longVersion = false, objectKey = ''): string {
    if (typeof value !== 'undefined' && value === null) {
      return longVersion ? '0x0000000000000000000000000000000000000000' : '0x'
    } else {
      return objectKey ? value[objectKey] : value;
    }
  }
}
