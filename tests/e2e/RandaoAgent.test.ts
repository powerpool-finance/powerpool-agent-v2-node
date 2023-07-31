import { AgentRandao_2_3_0 } from '../../app/agents/Agent.2.3.0.randao.js';
import { Network } from '../../app/Network.js';
import { App } from '../../app/App.js';
// @ts-ignore
import EventEmitter from 'events';
import { assert } from 'chai';
import { AGENT_ADDRESS, AGENT_CONFIG, APP_CONFIG, NETWORK_CONFIG } from '../constants.js';
import { stubAgent, stubNetwork } from '../stubs.js';

describe('AgentRandao_2_3_0', () => {
  it('should initialize empty agent correctly', async () => {
    const app = new App(APP_CONFIG);

    const agent = new AgentRandao_2_3_0(AGENT_ADDRESS, AGENT_CONFIG, 'testnet');
    stubAgent(agent);

    const network = new Network('testnet', NETWORK_CONFIG, app, [agent]);
    stubNetwork(network);

    await network.init();
    assert.equal(agent.getJobsCount().total, 0);
    assert.equal(agent.getCfg(), 0);
  });
});

export default null;
