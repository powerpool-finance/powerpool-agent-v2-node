import { SubgraphSource } from './SubgraphSource.js';
import { Network } from '../Network.js';
import { IAgent } from '../Types.js';

export const QUERY_ALL_JOBS = `{
  jobs(first: 1000) {
  nodes {
    id
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
  }
  }
}`;

export const QUERY_META = `{
  _metadata {
    lastProcessedHeight
  }
}`;

export const QUERY_JOB_OWNERS = `{
  jobOwners {
    nodes {
      id
      credits
    }
  }
}`;

export class SubquerySource extends SubgraphSource {
  constructor(network: Network, agent: IAgent, graphUrl: string) {
    super(network, agent, graphUrl);
  }

  async getBlocksDelay(): Promise<{ diff: bigint; nodeBlockNumber: bigint; sourceBlockNumber: bigint }> {
    const [latestBock, { _metadata }] = await Promise.all([
      this.network.queryLatestBlock().then(b => BigInt(b.number.toString())),
      this.query(this.subgraphUrl, QUERY_META),
    ]);
    return {
      diff: latestBock - BigInt(_metadata.lastProcessedHeight),
      nodeBlockNumber: latestBock,
      sourceBlockNumber: latestBock,
    };
  }

  async queryJobs() {
    return this.query(this.subgraphUrl, QUERY_ALL_JOBS).then(res => res.jobs.nodes);
  }

  async queryJobOwners() {
    return this.query(this.subgraphUrl, QUERY_JOB_OWNERS).then(res => res.jobOwners.nodes);
  }
}
