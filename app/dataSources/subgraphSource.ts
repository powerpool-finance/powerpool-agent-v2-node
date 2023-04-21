import { AbstractSource } from './AbstractSource.js';
import { RandaoJob } from '../jobs/RandaoJob';
import { LightJob } from '../jobs/LightJob';
import axios from 'axios';
import { Network } from '../Network';
import { ContractWrapper } from '../Types';

/**
 * This class used for fetching data from subgraph
 */
export class SubgraphSource extends AbstractSource {
  // config: number;
  // selector: string;
  // credits: BigNumber;
  // maxBaseFeeGwei: number;
  // rewardPct: number;
  // fixedReward: number;
  // calldataSource: number;
  // intervalSeconds: number;
  // lastExecutionAt: number;

  private jobsQuery: string;

  private _meta: string;

  constructor(network: Network, contract: ContractWrapper) {
    super(network, contract);
    this._meta = `
      block {
        number
      }
    `
    this.jobsQuery = `id
      active
      credits
      jobAddress
      intervalSeconds
      maxBaseFeeGwei
      assertResolverSelector
      useJobOwnerCredits
      lastExecutionAt
      fixedReward
      minKeeperCVP
      rewardPct
      totalCompensations
      executionCount
      calldataSource
      preDefinedCalldata,
      resolverAddress
      resolverCalldata
      jobSelector
      pendingOwner {
        id
      }
      assignedKeeperId {
        id
      }
    `;
  }

  /**
   * A query builder for requests.
   * It's using axios because "fetch" is bad at error handling (all error codes except network error is 200).
   * @param endpoint
   * @param query
   */
  query(endpoint, query) {
    return axios.post(endpoint, { query }).then(res => res.data.data);
  }

  /**
   * Checking if our graph is existing and synced
   */
  async isGraphOk(): Promise<boolean> {
    if (!this.network.graphUrl) this.err('"GraphUrl" is required for "subgraph" source type. Check your network config.');
    try {
      const [latestBock, { _meta }] = await Promise.all([
        this.network.getLatestBlockNumber(),
        this.query(this.network.graphUrl, `{
          _meta {
            ${this._meta}
          }
      }`)
      ])

      const isSynced = latestBock - _meta.block.number <= 10; // Our graph is desynced if its behind for more than 10 blocks
      if (!isSynced) this.err('Graph is not synced. Please sync it manually or try another graph.');
      return isSynced;
    } catch (e) {
      this.err('Graph is not responding. ', e);
      return false;
    }
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
    await this.isGraphOk();
    const newJobs = new Map<string, RandaoJob | LightJob>();
    return newJobs;
  }
}
