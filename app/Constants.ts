import { BigNumber } from 'ethers';
import { AgentHardcodedConfig, EnvConfigMapType } from './Types.js';

export const MIN_EXECUTION_GAS = 55_000;

export const DEFAULT_SYNC_FROM_CHAINS: { [network: string]: number } = {
  mainnet: 18533834,
  goerli: 10064335,
  rinkeby: 11096966,
  arbitrumOne: 157531675,
  base: 14835289,
  linea: 6897340,
};

export const AGENT_HARDCODED_CONFIGS: { [network: string]: { [agent: string]: AgentHardcodedConfig } } = {
  mainnet: {
    '0x00000000000f02BB0c9a0fE681b589F67Cf9a5EE': {
      deployedAt: 15665361,
      version: '2.2.0',
      strategy: 'light',
    },
    '0xc9ce4CdA5897707546F3904C0FfCC6e429bC4546': {
      deployedAt: 18533834,
      version: '2.3.0',
      strategy: 'randao',
    },
  },
  gnosis: {
    '0x071412e301C2087A4DAA055CF4aFa2683cE1e499': {
      deployedAt: 30393450,
      version: '2.3.0',
      strategy: 'randao',
    },
    '0x77E54beB5b23512F8dcBf617a7615A5614Ea9194': {
      deployedAt: 34054595,
      version: '2.5.0',
      strategy: 'randao',
    },
    '0x8ea807157e2905Ba866f609b5c09CCa78a48DEE9': {
      deployedAt: 34623754,
      version: '2.5.0',
      strategy: 'randao',
    },
  },
  arbitrumOne: {
    '0xad1e507f8A0cB1B91421F3bb86BBE29f001CbcC6': {
      deployedAt: 157531675,
      version: '2.3.0',
      strategy: 'randao',
    },
    '0x366354b65fbC1599bC67577E49556A1395791D06': {
      deployedAt: 213530652,
      version: '2.5.0',
      strategy: 'randao',
    },
    '0x29d7D44420ca2BFCaE2cB0c59ddc1227DCBEadEb': {
      deployedAt: 216885699,
      version: '2.5.0',
      strategy: 'randao',
    },
    '0x9fDB1462Edb170aEf47f052bA69a7fa64130D149': {
      deployedAt: 241395084,
      version: '2.5.0',
      strategy: 'randao',
    },
  },
  polygon: {
    '0x20D4029c783D5c9f47569940c656Af4189e53799': {
      deployedAt: 52818115,
      version: '2.3.0',
      strategy: 'randao',
    },
  },
  base: {
    '0x12e49CeDc34C4F455e0dfff7ec38cC535Cbd07C2': {
      deployedAt: 14835289,
      version: '2.3.0',
      strategy: 'randao',
    },
  },
  linea: {
    '0x20D4029c783D5c9f47569940c656Af4189e53799': {
      deployedAt: 6897340,
      version: '2.3.0',
      strategy: 'randao',
    },
    '0xF6335E70aBEb91451DcB7C33d973fdee0Da85b16': {
      deployedAt: 7941918,
      version: '2.3.0',
      strategy: 'randao',
    },
  },
  goerli: {
    '0x96cb9B293eB7695904B4Ea0FA73eB3650e07e8E4': {
      deployedAt: 7977609,
      version: '2.2.0',
      strategy: 'light',
    },
    '0x7C628262F1bA91c0A8ff309bE1DB0C5e4A63BF50': {
      deployedAt: 8481413,
      version: '2.3.0',
      strategy: 'randao',
    },
    '0xa45B8e6D417Aed09D59950B8E587fC99a00c74c3': {
      deployedAt: 8766880,
      version: '2.3.0',
      strategy: 'randao',
    },
    '0xc6420892469D344d207c701B64e578Df39Bf0918': {
      deployedAt: 8848050,
      version: '2.3.0',
      strategy: 'randao',
    },
    '0xCf52c088acB41e55eF30C70989AeA0e2521CBB23': {
      deployedAt: 10064335,
      version: '2.3.0',
      strategy: 'randao',
    },
  },
  sepolia: {
    '0xB1b973fB49DE8128664839E2C6cDFd5D8E0a8e28': {
      deployedAt: 3130882,
      version: '2.3.0',
      strategy: 'randao',
    },
    '0x43f033F7038BF02929dDA36d6aCfd7590683A8f4': {
      deployedAt: 3202169,
      version: '2.3.0',
      strategy: 'randao',
    },
    '0x4d9bC98452820FD96B2C31741e8C4DdcC795bEce': {
      deployedAt: 3311189,
      version: '2.3.0',
      strategy: 'randao',
    },
    '0xEEc54451B01963518aFd57ED715E31fcAf2228D2': {
      deployedAt: 3450952,
      version: '2.3.0',
      strategy: 'randao',
    },
    '0x69F32100FDca93fc0760D9d375579a41E7955eFF': {
      deployedAt: 3680463,
      version: '2.3.0',
      strategy: 'randao',
    },
    '0x910C4874260384eB0F068211d6EB04ff5C29441d': {
      deployedAt: 3680575,
      version: '2.3.0',
      strategy: 'randao',
    },
    '0x1bf75be3Fad196ec1cc9f7D93F24428183c322B8': {
      deployedAt: 3771734,
      version: '2.3.0',
      strategy: 'randao',
    },
    '0x5589032c6e49ECc4E65d16C0058d9FFde9175e4a': {
      deployedAt: 3825389,
      version: '2.3.0',
      strategy: 'randao',
    },
    '0x10DA4FbD913F193B7D19fE6357D281FD30b694bd': {
      deployedAt: 3870664,
      version: '2.3.0',
      strategy: 'randao',
    },
    '0xC83e56D572205671CE7725b1fEdC88670a1Fe308': {
      deployedAt: 3870655,
      version: '2.3.0',
      strategy: 'randao',
    },
    '0x70da71205aA6D70F4fdecb422D409e4BC31C809c': {
      deployedAt: 3877224,
      version: '2.3.0',
      strategy: 'randao',
    },
    '0xc8E864f12c337Bdf6294a3DCeE0E565D2B1B4d90': {
      deployedAt: 3917456,
      version: '2.3.0',
      strategy: 'randao',
    },
    '0x52D303bBc927eC2Fee6B5380A2d100FA49518B84': {
      deployedAt: 3917477,
      version: '2.3.0',
      strategy: 'randao',
    },
    '0xec344c76EF6cd1D329CB98CFa896ED9Badedb1CD': {
      deployedAt: 3917469,
      version: '2.3.0',
      strategy: 'randao',
    },
    '0x935a8a75CDAB2946cCC5BC4a282b3F2b03e29283': {
      deployedAt: 4159272,
      version: '2.3.0',
      strategy: 'randao',
    },
    '0xf4583fc017D82c3462944A5d7E7aD380e5bfAD74': {
      deployedAt: 4172470,
      version: '2.3.0',
      strategy: 'randao',
    },
    '0xbdE2Aed54521000DC033B67FB522034e0F93A7e5': {
      deployedAt: 4443031,
      version: '2.3.0',
      strategy: 'randao',
    },
  },
};

export const MULTICALL_CONTRACTS: { [network: string]: string } = {
  mainnet: '0x5ba1e12693dc8f9c48aad8770482f4739beed696',
  goerli: '0x5ba1e12693dc8f9c48aad8770482f4739beed696',
  gnosis: '0xe79dfe2f36afa066dd501fd9c89a3e7d5843c0c2',
  sepolia: '0x3BEDdA2f411409448e0033024d68f1cDb0EEDd7B',
  arbitrumOne: '0x842ec2c7d803033edf55e478f461fc547bc54eb2',
  polygon: '0xed386fe855c1eff2f843b910923dd8846e45c5a4',
  base: '0xedf6d2a16e8081f777eb623eeb4411466556af3d',
  linea: '0xa217f01e0b0e93508e131a44c4dbfc1db22adbd5',
};

export const EXTERNAL_LENS_CONTRACTS_2_3_0: { [network: string]: string } = {
  mainnet: '0xbB8dAC006c8B6F67c4bc2563b64ed669Faa54F07',
  gnosis: '0x2b3d29dAa9F41c4171416Af3D66f5a2aE210616E', // v2
  goerli: '0x3DC4d2774377791aC6DA345f6f13734C9E314f86', // v2
  sepolia: '0x42a2D286Bac644CfdB4030d96b4f7b2ad9dFA998', // v2
  arbitrumOne: '0xa1be5a9d961aae6c6895e1579ce470e708e7cedb', // v2
  polygon: '0xB712Ab1263fd2D992E39Df1CF3F81EA9BB83e548',
  base: '0xa217F01E0b0E93508E131a44C4dBfc1db22ADBD5',
  linea: '0x0D8879056cC1dfA4998B6f5c75c7ea4d8e939223',
};

export const AVERAGE_BLOCK_TIME_SECONDS: { [network: string]: number } = {
  mainnet: 12,
  sepolia: 12,
  goerli: 12,
  gnosis: 5,
  testnet: 5,
  arbitrumOne: 0.25,
  polygon: 2,
  base: 2,
  linea: 2,
};

// If specified, resolver should be called each X blocks, otherwise it will be
// called each new block
export const RESOLVER_CALL_EACH_BLOCKS: { [network: string]: number } = {
  arbitrumOne: 10,
};

export const ENV_CONFIG_MAP: { [key: string]: EnvConfigMapType } = {
  SENTRY_DSN: { path: 'sentry', type: 'string' },
  NETWORK_NAME: { path: 'networks.enabled[0]', type: 'string' },
  NETWORK_RPC: { path: 'networks.details.${NETWORK_NAME}.rpc', type: 'string' },
  NETWORK_MAX_BLOCK_DELAY: { path: 'networks.details.${NETWORK_NAME}.max_block_delay', type: 'number' },
  NETWORK_MAX_NEW_BLOCK_DELAY: { path: 'networks.details.${NETWORK_NAME}.max_new_block_delay', type: 'number' },
  NETWORK_MIN_SUCCESS_RESOLVE: { path: 'networks.details.${NETWORK_NAME}.resolve_min_success_count', type: 'number' },
  NETWORK_BLOCK_LOGS_MODE: { path: 'networks.details.${NETWORK_NAME}.block_logs_mode', type: 'boolean' },
  AGENT_ADDRESS: { path: 'networks.details.${NETWORK_NAME}.agents.${AGENT_ADDRESS}', type: 'address' },
  DATA_SOURCE: {
    path: 'networks.details.${NETWORK_NAME}.agents.${AGENT_ADDRESS}.data_source',
    type: 'string',
    validValues: ['blockchain', 'subgraph', 'subquery'],
  },
  SUBGRAPH_URL: { path: 'networks.details.${NETWORK_NAME}.agents.${AGENT_ADDRESS}.subgraph_url', type: 'string' },
  KEEPER_WORKER_ADDRESS: {
    path: 'networks.details.${NETWORK_NAME}.agents.${AGENT_ADDRESS}.keeper_worker_address',
    type: 'address',
  },
  KEYPASSWORD: { path: 'networks.details.${NETWORK_NAME}.agents.${AGENT_ADDRESS}.key_pass', type: 'string' },
  ACCEPT_MAX_BASE_FEE_LIMIT: {
    path: 'networks.details.${NETWORK_NAME}.agents.${AGENT_ADDRESS}.accept_max_base_fee_limit',
    type: 'boolean',
  },
  ACCRUE_REWARD: { path: 'networks.details.${NETWORK_NAME}.agents.${AGENT_ADDRESS}.accrue_reward', type: 'boolean' },
  TX_RESEND_OR_DROP_AFTER_BLOCKS: {
    path: 'networks.details.${NETWORK_NAME}.agents.${AGENT_ADDRESS}.executor_config.tx_resend_or_drop_after_blocks',
    type: 'number',
  },
  TX_RESEND_MAX_GAS_PRICE: {
    path: 'networks.details.${NETWORK_NAME}.agents.${AGENT_ADDRESS}.executor_config.tx_resend_max_gas_price_gwei',
    type: 'number',
  },
  TX_RESEND_MAX_ATTEMPTS: {
    path: 'networks.details.${NETWORK_NAME}.agents.${AGENT_ADDRESS}.executor_config.tx_resend_max_attempts',
    type: 'number',
  },
  GAS_PRICE_ADD_GWEI: {
    path: 'networks.details.${NETWORK_NAME}.agents.${AGENT_ADDRESS}.executor_config.gas_price_priority_add_gwei',
    type: 'number',
  },
};

// export const FLAG_ACCEPT_MAX_BASE_FEE_LIMIT = 0x01;
// export const FLAG_ACCRUE_REWARD = 0x02;

export const BN_ZERO = BigNumber.from(0x0);
export const BI_ZERO = BigInt(0);
export const BN_10E9 = BigNumber.from('1000000000');
export const BI_10E9 = BigInt('1000000000');
export const BI_10E15 = BigInt(10) ** BigInt(15);
export const BI_10E18 = BigInt(10) ** BigInt(18);
export const CFG_ACTIVE = BigNumber.from(0x01);
export const CFG_USE_JOB_OWNER_CREDITS = BigNumber.from(0x02);
export const CFG_ASSERT_RESOLVER_SELECTOR = BigNumber.from(0x04);
export const CFG_CHECK_KEEPER_MIN_CVP_DEPOSIT = BigNumber.from(0x08);
export const CFG_CALL_RESOLVER_BEFORE_EXECUTE = BigNumber.from(0x10);
