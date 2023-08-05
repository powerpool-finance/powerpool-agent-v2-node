import { AbstractSource } from './AbstractSource.js';
import { RandaoJob } from '../jobs/RandaoJob';
import { LightJob } from '../jobs/LightJob';
import { Network } from '../Network';
import { IAgent } from '../Types';
import { BigNumber } from 'ethers';
import { parseConfig } from '../Utils.js';

/**
 * This class used for fetching data directly from blockchain
 */
export class BlockchainSource extends AbstractSource {
  constructor(network: Network, agent: IAgent) {
    super(network, agent);
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
    const latestBock = this.network.getLatestBlockNumber();
    // TODO: check latestBlock not null
    const registerLogs = await this.agent.queryPastEvents('RegisterJob', context.fullSyncFrom, Number(latestBock));
    const newJobs = new Map<string, RandaoJob | LightJob>();
    for (const event of registerLogs) {
      newJobs.set(event.args.jobKey, context._buildNewJob(event));
    }

    // fetching additional fields from lens
    await this.addLensFieldsToJobs(newJobs);
    return newJobs;
  }

  /**
   * Gets job owner's balances from lens contract
   * @param context - agent context
   * @param jobOwnersSet - array of jobOwners addresses
   */
  async getOwnersBalances(context, jobOwnersSet: Set<string>): Promise<Map<string, BigNumber>> {
    const jobOwnersArray = Array.from(jobOwnersSet);
    const res = await this.network.queryLensOwnerBalances(context.address, jobOwnersArray);
    const jobOwnerBalances: Array<BigNumber> = res.results;
    const result = new Map<string, BigNumber>();
    for (let i = 0; i < jobOwnersArray.length; i++) {
      result.set(jobOwnersArray[i], jobOwnerBalances[i]);
    }
    return result;
  }

  /**
   * Fetch additional fields from lens contract and call apply job
   *
   * @param newJobs - jobs fetched from createJob event. Instance of RandaoJob | LightJob. Is Map structure.
   */
  private async addLensFieldsToJobs(newJobs: Map<string, RandaoJob | LightJob>) {
    const jobKeys = Array.from(newJobs.keys());
    const { results } = await this.network.queryLensJobs(this.agent.address, jobKeys);

    jobKeys.forEach((jobKey, index) => {
      const newJob = newJobs.get(jobKeys[index]);
      const lensJob = results[index];
      newJob.applyJob({
        ...lensJob,
        owner: lensJob.owner,
        config: parseConfig(BigNumber.from(lensJob.details.config)),
      });
    });
  }

  public async addLensFieldsToNewJob(newJob: RandaoJob | LightJob) {
    const tmpMap = new Map();
    tmpMap.set(newJob.getKey(), newJob);
    return this.addLensFieldsToJobs(tmpMap);
  }
}
