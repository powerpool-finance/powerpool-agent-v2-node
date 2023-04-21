import { Network } from '../Network';
import { ContractWrapper } from '../Types';
import { RandaoJob } from '../jobs/RandaoJob';
import { LightJob } from '../jobs/LightJob';

export abstract class AbstractSource {
  type: string;
  network: Network;
  contract: ContractWrapper;

  constructor(network: Network, contract: ContractWrapper) {
    this.type = 'blockchain';
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
  protected err(...args: any[]): Error {
    return new Error(`SourceError${this.toString()}: ${args.join(' ')}`);
  }

  async getRegisteredJobs(context): Promise<Map<string, RandaoJob | LightJob>> {
    return new Map<string, RandaoJob | LightJob>();
  }
}
