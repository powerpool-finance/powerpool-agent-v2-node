import { AbstractSource } from './AbstractSource.js';
import { RandaoJob } from '../jobs/RandaoJob';
import { LightJob } from '../jobs/LightJob';
import { Network } from '../Network';
import { ContractWrapper } from '../Types';
import { BigNumber } from 'ethers';

/**
 * This class used for fetching data directly from blockchain
 */
export class BlockchainSource extends AbstractSource {

  constructor(network: Network, contract: ContractWrapper) {
    super(network, contract);
    this.type = 'blockchain';
  }
  /**
   * Getting a RegisterJob events and initialise a job.
   * Returns Map structure which key is jobKey and value is instance of RandaoJob or LightJob. Await is required.
   *
   * @param context - agent caller context. This can be Agent.2.2.0.light or Agent.2.3.0.randao
   *
   * @return Promise<Map<string, RandaoJob | LightJob>>
   */
  async getRegisteredJobs(context): Promise<Map<string, RandaoJob | LightJob>> {
    const latestBock = await this.network.getLatestBlockNumber();
    const registerLogs = await this.contract.getPastEvents('RegisterJob', context.fullSyncFrom, latestBock)
    const newJobs = new Map<string, RandaoJob | LightJob>();
    for (const event of registerLogs) {
      newJobs.set(event.args.jobKey, context._buildNewJob(event));
    }
    return newJobs;
  }

  /**
   * Gets job owner's balances from lens contract
   * @param context - agent context
   * @param jobOwnersSet - array of jobOwners addresses
   */
  async getOwnersBalances(context, jobOwnersSet: Set<string>): Promise<Map<string, BigNumber>> {
    const jobOwnersArray = Array.from(jobOwnersSet);
    const res = await this.network.getExternalLensContract().ethCall('getOwnerBalances', [context.address, jobOwnersArray]);
    const jobOwnerBalances: Array<BigNumber> = res.results;
    const result = new Map<string, BigNumber>()
    for (let i = 0; i < jobOwnersArray.length; i++) {
      result.set(jobOwnersArray[i], jobOwnerBalances[i]);
    }
    return result;
  }
}
