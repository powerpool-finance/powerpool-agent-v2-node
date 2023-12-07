import { BigNumber } from 'ethers';
import { AgentHardcodedConfig } from './Types';

export const MIN_EXECUTION_GAS = 55_000;

export const DEFAULT_SYNC_FROM_CHAINS: { [network: string]: number } = {
  mainnet: 18533834,
  goerli: 10064335,
  rinkeby: 11096966,
  arbitrumOne: 157531675,
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
  },
  arbitrumOne: {
    '0xad1e507f8A0cB1B91421F3bb86BBE29f001CbcC6': {
      deployedAt: 157531675,
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
};

export const EXTERNAL_LENS_CONTRACTS_2_3_0: { [network: string]: string } = {
  mainnet: '0xbB8dAC006c8B6F67c4bc2563b64ed669Faa54F07',
  gnosis: '0x2b3d29dAa9F41c4171416Af3D66f5a2aE210616E', // v2
  goerli: '0x3DC4d2774377791aC6DA345f6f13734C9E314f86', // v2
  sepolia: '0x42a2D286Bac644CfdB4030d96b4f7b2ad9dFA998', // v2
  arbitrumOne: '0xad1e507f8A0cB1B91421F3bb86BBE29f001CbcC6', // v2
};

export const AVERAGE_BLOCK_TIME_SECONDS: { [network: string]: number } = {
  mainnet: 12,
  sepolia: 12,
  goerli: 12,
  gnosis: 5,
  testnet: 5,
  arbitrumOne: 0.25,
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
