// @ts-ignore
import sinon from 'sinon';
import { Network } from '../../app/Network.js';
import { App } from '../../app/App.js';
import { assert } from 'chai';
import { APP_CONFIG, NETWORK_CONFIG } from '../constants.js';
import { stubAgent, stubNetwork } from '../stubs.js';
import { QUERY_ALL_JOBS, QUERY_JOB_OWNERS, QUERY_META, SubgraphSource } from '../../app/dataSources/SubgraphSource.js';
import { toChecksummedAddress } from '../../app/Utils.js';
import {
  GOOD_RESOLVER_JOB_KEY,
  JOB_OWNERS_RESPONSE,
  SUBGRAPH_GOOD_RESOLVER_JOB_RESPONSE,
  SUBGRAPH_JOBS_RESPONSE,
} from '../responses.js';
import { CALLDATA_SOURCE, JobType } from '../../app/Types.js';
import { BI_10E18 } from '../../app/Constants.js';

describe('AgentRandao_2_3_0', () => {
  it('should initialize empty agent correctly', async () => {
    const app = new App(APP_CONFIG);

    const network = new Network('testnet', NETWORK_CONFIG, app);
    stubNetwork(network);
    const [agent] = network.getAgents();
    stubAgent(agent);

    await network.init();

    assert.equal(agent.getJobsCount().total, 0);
    assert.equal(agent.getCfg(), 0);
  });

  let app, network, agent;
  async function loadJobs(jobsResponse: any) {
    app = new App(APP_CONFIG);

    network = new Network('testnet', NETWORK_CONFIG, app);
    stubNetwork(network);

    let mock;
    sinon.stub(network, 'getAgentBlockchainDataSource').callsFake(function (a: any) {
      const subgraphUrl = 'stubSubgraphUrl';
      stubAgent(a);
      const dataSource = new SubgraphSource(network, a, subgraphUrl);

      mock = sinon.mock(dataSource);
      mock
        .expects('query')
        .twice()
        .withArgs(subgraphUrl, QUERY_META)
        .returns({
          _meta: { block: { number: 4000530 } },
        });
      mock.expects('query').once().withArgs(subgraphUrl, QUERY_ALL_JOBS).returns(jobsResponse);
      mock.expects('query').once().withArgs(subgraphUrl, QUERY_JOB_OWNERS).returns(JOB_OWNERS_RESPONSE);

      return dataSource;
    });

    await network.init();
    [agent] = network.getAgents();

    mock.verify();
  }

  describe('when initializing jobs using subgraph', () => {
    before(async () => {
      await loadJobs(SUBGRAPH_JOBS_RESPONSE);
    });

    after(async () => {
      network.stop();
    });

    it('should initialize jobs using subgraph', async () => {
      assert.equal(agent.getJobsCount().total, 10);
      assert.equal(agent.getJobsCount().interval, 3);
      assert.equal(agent.getJobsCount().resolver, 7);

      const netData = network.getStatusObjectForApi();
      const timeoutCallbacks = netData['timeoutCallbacks'];
      const resolverCallbacks = netData['resolverCallbacks'];

      assert.equal(Object.values(timeoutCallbacks).length, 4);
      assert.equal(Object.values(resolverCallbacks).length, 2);
    });
  });

  describe('loading jobs', () => {
    after(async () => {
      network.stop();
    });

    describe('with resolver', () => {
      it('should be done correctly', async () => {
        await loadJobs(SUBGRAPH_GOOD_RESOLVER_JOB_RESPONSE);
        const jobResp = SUBGRAPH_GOOD_RESOLVER_JOB_RESPONSE.jobs[0];

        const { timeoutCallbacks, resolverCallbacks } = network.getStatusObjectForApi();

        assert.equal(Object.values(timeoutCallbacks).length, 0);
        assert.equal(Object.values(resolverCallbacks).length, 1);

        const job = agent.getJob(GOOD_RESOLVER_JOB_KEY);
        assert.isTrue(job.isActive());
        assert.isFalse(job.isIntervalJob());
        assert.isTrue(job.isResolverJob());
        assert.equal(job.getKey(), GOOD_RESOLVER_JOB_KEY);
        assert.equal(job.getOwner(), toChecksummedAddress(jobResp.owner.id));
        assert.equal(job.getCreditsAvailable(), 3n * BI_10E18);
        assert.equal(job.creditsSourceIsJobOwner(), true);

        assert.equal(job.getJobCalldataSourceString(), 'Resolver');
        assert.equal(job.getJobType(), JobType.Resolver);
        assert.equal(job.getJobTypeString(), 'Resolver');

        const api = job.getStatusObjectForApi();
        assert.equal(api.key, GOOD_RESOLVER_JOB_KEY);
        assert.equal(api.key, jobResp.id);
        assert.equal(api.owner, toChecksummedAddress(jobResp.owner.id));
        assert.equal(api.id, jobResp.jobId);
        assert.equal(api.active, true);
        assert.equal(api.initializing, false);

        assert.deepEqual(api.type, JobType.Resolver);
        assert.deepEqual(api.calldataSource, 'Resolver');
        assert.deepEqual(api.creditsAvailableWei, 3000000000000000000n);
        assert.deepEqual(api.creditsAvailableEth, 3);
        assert.deepEqual(api.maxFeePerGasWei, 4n);
        assert.deepEqual(api.maxFeePerGasGwei, 4e-9);

        assert.deepEqual(api.jobLevelMinKeeperCvp.toString(), '10');
        assert.deepEqual(api.config.isActive, true);
        assert.deepEqual(api.config.useJobOwnerCredits, true);
        assert.deepEqual(api.config.assertResolverSelector, false);

        // It's not exist in subgraph thus not parsed correctly. But it is not used in the app anyway.
        // Probably should be removed to avoid confusion with a parsed config.
        assert.deepEqual(api.details.config, undefined);
        assert.deepEqual(api.details.selector, '0x3459b7ea');
        assert.deepEqual(api.details.credits.toString(), '15000000000000000000');

        // TODO: NOT OK
        assert.deepEqual(api.details.maxBaseFeeGwei, NaN);
        // This value is not used at all. Is here only for compatibility with a LightJobs.
        assert.deepEqual(api.details.rewardPct, NaN);
        // TODO: This value should be treated as maxKeeperCvp.
        assert.deepEqual(api.details.fixedReward, 10);

        assert.deepEqual(api.details.calldataSource, CALLDATA_SOURCE.RESOLVER);
        assert.deepEqual(api.details.intervalSeconds, 0);
        assert.deepEqual(api.details.lastExecutionAt, 0);

        // assert.deepEqual(
        //   api.resolver.resolverAddress,
        //   toChecksummedAddress('0x64a87c83440b446201c153e6f50c1fbf5edb5304'),
        // );
        assert.deepEqual(
          api.resolver.resolverCalldata,
          '0xe66dbb6d0000000000000000000000004123ac4b539bd6a56fcd514a52407660008ceb15',
        );

        // RANDAO FIELDS
        assert.deepEqual(api.jobRandaoFields.currentPeriod, 0);
        assert.deepEqual(api.jobRandaoFields.t1, 0);
        assert.deepEqual(api.jobRandaoFields.b1, 0n);
        assert.deepEqual(api.jobRandaoFields.tn, 0);
        assert.deepEqual(api.jobRandaoFields.bn, 0n);

        assert.deepEqual(api.jobRandaoFields.assignedKeeperIsMe, false);
        assert.deepEqual(api.jobRandaoFields.assignedKeeperId, 8);
        assert.deepEqual(api.jobRandaoFields.reservedSlasherId, 0);
        assert.deepEqual(api.jobRandaoFields.slashingPossibleAfter, 0);
        assert.deepEqual(api.jobRandaoFields.failedEstimationsInARow, 0);
        assert.deepEqual(api.jobRandaoFields.failedInitiateSlashingEstimationsInARow, 0);
        assert.deepEqual(api.jobRandaoFields.selfUnassignPending, false);
        assert.deepEqual(api.jobRandaoFields.initiateSlashingPending, false);
        assert.deepEqual(api.jobRandaoFields.canInitiateSlashingIn, 0);
      });
    });
  });
});

export default null;
