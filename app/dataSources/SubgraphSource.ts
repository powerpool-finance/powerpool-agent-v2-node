import axios from 'axios';
import { AbstractSource } from './AbstractSource.js';
import { BlockchainSource } from './BlockchainSource.js';
import { RandaoJob } from '../jobs/RandaoJob';
import { LightJob } from '../jobs/LightJob';
import { Network } from '../Network';
import { IAgent, SourceMetadata } from '../Types';
import { BigNumber, utils } from 'ethers';
import { toChecksummedAddress } from '../Utils.js';
import logger from '../services/Logger.js';
import { getMaxBlocksSubgraphDelay } from '../ConfigGetters.js';

const JOBS_FIELDS = `id
    active
    jobAddress
    jobId
    assertResolverSelector
    credits
    calldataSource
    fixedReward
    jobSelector
    lastExecutionAt
    minKeeperCVP
    preDefinedCalldata
    intervalSeconds
    resolverAddress
    resolverCalldata
    useJobOwnerCredits
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
export const QUERY_ALL_JOBS = `{
  jobs(first: 1000) {
    ${JOBS_FIELDS}
  }
}`;

export const QUERY_META = `{
  _meta {
    block {
      number
    }
  }
}`;

export const QUERY_JOB_OWNERS = `{
  jobOwners(first: 1000) {
    id
    credits
  }
}`;

/**
 * This class used for fetching data from subgraph
 */
export class SubgraphSource extends AbstractSource {
  protected blockchainSource: BlockchainSource;
  protected readonly subgraphUrl: string;

  protected toString(): string {
    return `(url: ${this.subgraphUrl})`;
  }

  protected clog(level: string, ...args: unknown[]) {
    logger.log(level, `SubgraphDataSource${this.toString()}: ${args.join(' ')}`);
  }

  protected err(...args: unknown[]): Error {
    return new Error(`SubgraphDataSourceError${this.toString()}: ${args.join(' ')}`);
  }

  constructor(network: Network, agent: IAgent, graphUrl: string) {
    super(network, agent);
    this.type = 'subgraph';
    this.subgraphUrl = graphUrl;

    this.blockchainSource = new BlockchainSource(network, agent);
  }

  /**
   * A query builder for requests.
   * It's using axios because "fetch" is bad at error handling (all error codes except network error is 200).
   * @param endpoint
   * @param query
   */
  async query(endpoint, query) {
    const res = await axios.post(endpoint, { query });
    if (res.data.errors) {
      let locations = '';
      if ('locations' in res.data.errors[0]) {
        locations = `Locations: ${JSON.stringify(res.data.errors[0].locations)}. `;
      }
      throw new Error(`Subgraph query error: ${res.data.errors[0].message}. ${locations}Executed query:\n${query}\n`);
    }
    return res.data.data;
  }

  /**
   * Checking if our graph is existing and synced
   */
  async getGraphStatus(): Promise<SourceMetadata> {
    try {
      const { diff, nodeBlockNumber, sourceBlockNumber } = await this.getBlocksDelay();
      const isSynced = diff <= getMaxBlocksSubgraphDelay(this.network.getName()); // Our graph is desynced if its behind for more than 10 blocks
      if (!isSynced) {
        this.clog('error', `Subgraph is ${diff} blocks behind.`);
      }
      return { isSynced, diff, nodeBlockNumber, sourceBlockNumber };
    } catch (e) {
      this.clog('error', 'Graph meta query error:', e);
      return { isSynced: false, diff: null, nodeBlockNumber: null, sourceBlockNumber: null };
    }
  }

  async getBlocksDelay(): Promise<{ diff: bigint; nodeBlockNumber: bigint; sourceBlockNumber: bigint }> {
    const [latestBock, { _meta }] = await Promise.all([
      this.network.getLatestBlockNumber(),
      this.query(this.subgraphUrl, QUERY_META),
    ]);
    return {
      diff: latestBock - BigInt(_meta.block.number),
      nodeBlockNumber: latestBock,
      sourceBlockNumber: latestBock,
    };
  }

  async queryJobs() {
    return this.query(this.subgraphUrl, QUERY_ALL_JOBS).then(res => res.jobs);
  }

  async queryJob(jobKey) {
    return this.query(
      this.subgraphUrl,
      `{
        jobs(where: { id: "${jobKey}" }) {
            ${JOBS_FIELDS}
          }
        }`,
    ).then(res => res.jobs[0]);
  }

  async getJob(context, jobKey): Promise<RandaoJob | LightJob> {
    return this.queryJob(jobKey).then(job => this.buildJob(context, job));
  }

  buildJob(context, job) {
    const newJob = context._buildNewJob({
      name: 'RegisterJob',
      args: {
        jobAddress: job.jobAddress,
        jobId: BigNumber.from(job.jobId),
        jobKey: job.id,
      },
    });
    const lensJob = this.addLensFieldsToJobs(job);
    newJob.applyJob({
      ...lensJob,
      owner: lensJob.owner,
      config: lensJob.config,
    });
    return newJob;
  }

  /**
   * Getting a list of jobs from subgraph and initialise job.
   * Returns Map structure which key is jobKey and value is instance of RandaoJob or LightJob. Await is required.
   *
   * @param context - agent caller context. This can be Agent.2.2.0.light or Agent.2.3.0.randao
   *
   * @return Promise<Map<string, RandaoJob | LightJob>>
   */
  async getRegisteredJobs(context): Promise<{ data: Map<string, RandaoJob | LightJob>; meta: SourceMetadata }> {
    let newJobs = new Map<string, RandaoJob | LightJob>();
    const graphStatus = await this.getGraphStatus();
    if (!graphStatus.isSynced) {
      this.clog('warn', 'Subgraph is not ok, falling back to the blockchain datasource.');
      ({ data: newJobs } = await this.blockchainSource.getRegisteredJobs(context));
      return { data: newJobs, meta: graphStatus };
    }
    try {
      const jobs = await this.queryJobs();
      jobs.forEach(job => {
        newJobs.set(job.id, this.buildJob(context, job));
      });
    } catch (e) {
      throw this.err(e);
    }
    return { data: newJobs, meta: graphStatus };
  }

  /**
   * here we can populate job with full graph data, as if we made a request to getJobs lens method.
   * But we already hale all the data
   * @param graphData
   */
  protected addLensFieldsToJobs(graphData) {
    const lensFields: any = {};
    // setting an owner
    lensFields.owner = utils.getAddress(this._checkNullAddress(graphData.owner, true, 'id'));
    // if job is about to get transferred setting future owner address. Otherwise, null address
    lensFields.pendingTransfer = this._checkNullAddress(graphData.pendingOwner, true, 'id');
    // transfer min cvp into bigNumber as it's returned in big number when getting data from blockchain. Data consistency.
    lensFields.jobLevelMinKeeperCvp = BigNumber.from(graphData.minKeeperCVP);
    // From graph zero predefinedcalldata is returned as null, but from blockchain its 0x
    lensFields.preDefinedCalldata = this._checkNullAddress(graphData.preDefinedCalldata);

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
    };
    // with subgraphSource you don't need to use parseConfig. You can create config field right here.
    lensFields.config = {
      isActive: graphData.active,
      useJobOwnerCredits: graphData.useJobOwnerCredits,
      assertResolverSelector: graphData.assertResolverSelector,
      checkKeeperMinCvpDeposit: +graphData.minKeeperCVP > 0,
    };
    return lensFields;
  }

  public async addLensFieldsToOneJob(newJob: LightJob | RandaoJob) {
    return this.blockchainSource.addLensFieldsToOneJob(newJob);
  }

  async queryJobOwners() {
    return this.query(this.subgraphUrl, QUERY_JOB_OWNERS).then(res => res.jobOwners);
  }

  /**
   * Gets job owner's balances from subgraph
   * @param context - agent context
   * @param jobOwnersSet - array of jobOwners addresses
   */
  public async getOwnersBalances(
    context,
    jobOwnersSet: Set<string>,
  ): Promise<{ data: Map<string, BigNumber>; meta: SourceMetadata }> {
    let result = new Map<string, BigNumber>(),
      graphStatus;
    try {
      graphStatus = await this.getGraphStatus();
      if (!graphStatus.isSynced) {
        this.clog('warn', 'Subgraph is not ok, falling back to the blockchain datasource.');
        ({ data: result } = await this.blockchainSource.getOwnersBalances(context, jobOwnersSet));
        return { data: result, meta: graphStatus };
      }

      const jobOwners = await this.queryJobOwners();
      jobOwners.forEach(JobOwner => {
        result.set(toChecksummedAddress(JobOwner.id), BigNumber.from(JobOwner.credits));
      });
    } catch (e) {
      throw this.err(e);
    }
    return { data: result, meta: graphStatus };
  }
}
