import axios from 'axios';
import { AbstractSource } from './AbstractSource.js';
import { BlockchainSource } from './blockchainSource.js';
import { RandaoJob } from '../jobs/RandaoJob';
import { LightJob } from '../jobs/LightJob';
import { AbstractJob } from '../jobs/AbstractJob';
import { Network } from '../Network';
import { ContractWrapper, GraphJob } from '../Types';
import { BigNumber } from 'ethers';

/**
 * This class used for fetching data from subgraph
 */
export class SubgraphSource extends AbstractSource {
  private queries: { [name: string]: string }
  private blockchainSource: BlockchainSource;
  private jobs: GraphJob[]; // for data consistency a whole data collection from graph should not pollute job instances so here we store graph data

  constructor(network: Network, contract: ContractWrapper) {
    super(network, contract);
    this.type = 'subgraph'

    this.queries = {};
    this.queries._meta = `
      block {
        number
      }
    `
    this.queries.jobsQuery = `
      id
      active
      jobAddress
      jobId
      assertResolverSelector
      credits
      depositCount
      calldataSource
      fixedReward
      executionCount
      jobSelector
      lastExecutionAt
      maxBaseFeeGwei
      minKeeperCVP
      preDefinedCalldata
      intervalSeconds
      resolverAddress
      resolverCalldata
      rewardPct
      totalCompensations
      totalExpenses
      totalProfit
      useJobOwnerCredits
      withdrawalCount
      owner {
        id
      }
      pendingOwner {
        id
      }
      jobCreatedAt
      jobNextKeeperId
      jobReservedSlasherId
      jobSlashingPossibleAfter
    `;

    this.queries.jobOwnersQuery = `
      id
      credits
    `;

    this.blockchainSource = new BlockchainSource(network, contract);
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
            ${this.queries._meta}
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
   * Getting a list of jobs from subgraph and initialise job.
   * Returns Map structure which key is jobKey and value is instance of RandaoJob or LightJob. Await is required.
   *
   * @param context - agent caller context. This can be Agent.2.2.0.light or Agent.2.3.0.randao
   *
   * @return Promise<Map<string, RandaoJob | LightJob>>
   */
  async getRegisteredJobs(context): Promise<Map<string, RandaoJob | LightJob>> {
    let newJobs = new Map<string, RandaoJob | LightJob>();
    const graphIsFine = await this.isGraphOk();
    if (!graphIsFine) {
      newJobs = await this.blockchainSource.getRegisteredJobs(context);
      return newJobs;
    }
    try {
      const { jobs } = await this.query(this.network.graphUrl, `{
          jobs {
            ${this.queries.jobsQuery}
          }
      }`)
      jobs.forEach(job => {
        // const buildAndInitJob = this.addLensFieldsToJob(context._buildNewJob({
        //   name: 'RegisterJob',
        //   jobAddress: job.jobAddress,
        //   jobId: job.jobId,
        //   id: job.id,
        // }), job)
        newJobs.set(job.id, context._buildNewJob({
          name: 'RegisterJob',
          jobAddress: job.jobAddress,
          jobId: job.jobId,
          id: job.id,
        }));
      });
      this.jobs = jobs;
    } catch (e) {
      this.err(e);
    }
    return newJobs;
  }

  /**
   * here we can populate job with full graph data, as if we made a request to getJobs lens method.
   * But we already hale all the data
   * @param initJob - job initial fields
   */
  addLensFieldsToJob(initJob) {
    const graphData = this.jobs.find(job => job.id === initJob.key) as GraphJob;
    const lensFields: any = {};
    // setting an owner
    lensFields.owner = this._checkNullAddress(graphData.owner, true, 'id')
    // if job is about to get transferred setting future owner address. Otherwise, null address
    lensFields.pendingTransfer = this._checkNullAddress(graphData.pendingOwner, true, 'id')
    // transfer min cvp into bigNumber as it's returned in big number when getting data from blockchain. Data consistency.
    lensFields.jobLevelMinKeeperCvp = BigNumber.from(graphData.minKeeperCVP);
    // From graph zero predefinedcalldata is returned as null, but from blockchain its 0x
    lensFields.preDefinedCalldata = this._checkNullAddress(graphData.preDefinedCalldata)

    // setting a resolver field
    lensFields.resolver = {
      resolverCalldata: this._checkNullAddress(graphData.resolverCalldata),
      resolverAddress: this._checkNullAddress(graphData.resolverAddress, true),
    };
    // setting randao data
    lensFields.randaoData = {
      jobNextKeeperId: BigNumber.from(graphData.jobNextKeeperId),
      jobReservedSlasherId: BigNumber.from(graphData.jobReservedSlasherId),
      jobSlashingPossibleAfter: BigNumber.from(graphData.jobSlashingPossibleAfter),
      jobCreatedAt: BigNumber.from(graphData.jobCreatedAt),
    };
    // setting details
    lensFields.details = {
      selector: graphData.jobSelector,
      credits: BigNumber.from(graphData.credits),
      maxBaseFeeGwei: parseInt(graphData.maxBaseFeeGwei),
      rewardPct: parseInt(graphData.rewardPct),
      fixedReward: parseInt(graphData.fixedReward),
      calldataSource: parseInt(graphData.calldataSource),
      intervalSeconds: parseInt(graphData.intervalSeconds),
      lastExecutionAt: parseInt(graphData.lastExecutionAt),
      config: {
        active: graphData.active,
        useJobOwnerCredits: graphData.useJobOwnerCredits,
        assertResolverSelector: graphData.assertResolverSelector,
        minKeeperCVP: graphData.minKeeperCVP,
      }
    };
    return lensFields;
  }

  /**
   * Gets job owner's balances from subgraph
   * @param context - agent context
   * @param jobOwnersSet - array of jobOwners addresses
   */
  async getOwnersBalances(context, jobOwnersSet: Set<string>): Promise<Map<string, BigNumber>> {
    let result = new Map<string, BigNumber>();
    try {
      const graphIsFine = await this.isGraphOk();
      if (!graphIsFine) {
        result = await this.blockchainSource.getOwnersBalances(context, jobOwnersSet);
        return result;
      }

      const { jobOwners } = await this.query(this.network.graphUrl, `{
          jobOwners {
            ${this.queries.jobOwnersQuery}
          }
      }`)
      jobOwners.forEach(JobOwner => {
        if (jobOwnersSet.has(JobOwner.id.toLowerCase())) { // we only need job owners which have jobs
          result.set(JobOwner.id, BigNumber.from(JobOwner.credits));
        }
      })
    } catch (e) {
      this.err(e);
    }
    return result;
  }
}
