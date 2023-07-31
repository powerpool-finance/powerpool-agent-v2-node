import { AgentConfig, Config, NetworkConfig } from '../app/Types';

export const AGENT_ADDRESS = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export const KEEPER_WORKER_ADDRESS = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

export const AGENT_CONFIG: AgentConfig = {
  executor: 'pga',
  keeper_worker_address: KEEPER_WORKER_ADDRESS,
  key_pass: 'buzz',
  strategy: 'randao',
  version: '2.3.0',
};
export const NETWORK_CONFIG: NetworkConfig = {
  rpc: 'http://foo.bar',
  external_lens: '0x0000000000000000000000000000000000000001',
  multicall2: '0x0000000000000000000000000000000000000002',
  agents: {
    [AGENT_ADDRESS]: AGENT_CONFIG,
  },
};
export const APP_CONFIG: Config = {
  networks: {
    enabled: ['testnet'],
    details: {
      testnet: NETWORK_CONFIG,
    },
  },
  strict: undefined,
};
