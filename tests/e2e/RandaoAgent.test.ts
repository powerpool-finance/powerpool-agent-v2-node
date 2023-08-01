import sinon from 'sinon';
import { AgentRandao_2_3_0 } from '../../app/agents/Agent.2.3.0.randao.js';
import { Network } from '../../app/Network.js';
import { App } from '../../app/App.js';
// @ts-ignore
import EventEmitter from 'events';
import { assert } from 'chai';
import { AGENT_ADDRESS, AGENT_CONFIG, APP_CONFIG, NETWORK_CONFIG } from '../constants.js';
import { stubAgent, stubNetwork } from '../stubs.js';
import { QUERY_ALL_JOBS, QUERY_JOB_OWNERS, QUERY_META, SubgraphSource } from '../../app/dataSources/SubgraphSource.js';
import { BlockchainSource } from '../../app/dataSources/BlockchainSource.js';
import { JOB_OWNERS_RESPONSE, SUBGRAPH_JOBS_RESPONSE } from '../responses.js';

describe('AgentRandao_2_3_0', () => {
  it('should initialize empty agent correctly', async () => {
    const app = new App(APP_CONFIG);

    const agent = new AgentRandao_2_3_0(AGENT_ADDRESS, AGENT_CONFIG, 'testnet');
    stubAgent(agent);

    const network = new Network('testnet', NETWORK_CONFIG, app, [agent]);
    stubNetwork(network);

    await network.init();
    const dataSource = new BlockchainSource(network, agent);
    await agent.init(network, dataSource);

    assert.equal(agent.getJobsCount().total, 0);
    assert.equal(agent.getCfg(), 0);
  });

  it('should initialize using subgraph', async () => {
    const app = new App(APP_CONFIG);

    const agent = new AgentRandao_2_3_0(AGENT_ADDRESS, AGENT_CONFIG, 'testnet');
    stubAgent(agent);

    const network = new Network('testnet', NETWORK_CONFIG, app, [agent]);
    stubNetwork(network);

    const subgraphUrl = 'stubSubgraphUrl';
    const dataSource = new SubgraphSource(network, agent, subgraphUrl);
    await network.init();

    const mock = sinon.mock(dataSource);
    mock
      .expects('query')
      .twice()
      .withArgs(subgraphUrl, QUERY_META)
      .returns({
        _meta: { block: { number: 4000530 } },
      });
    mock.expects('query').once().withArgs(subgraphUrl, QUERY_ALL_JOBS).returns(SUBGRAPH_JOBS_RESPONSE);
    mock.expects('query').once().withArgs(subgraphUrl, QUERY_JOB_OWNERS).returns(JOB_OWNERS_RESPONSE);
    await agent.init(network, dataSource);

    mock.verify();

    assert.equal(agent.getJobsCount().total, 3);
    assert.equal(agent.getJobsCount().interval, 3);
    assert.equal(agent.getJobsCount().resolver, 0);
  });
});

export default null;
