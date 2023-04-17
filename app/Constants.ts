import { BigNumber } from 'ethers';
import { AgentHardcodedConfig } from "./Types";

export const MIN_EXECUTION_GAS = 55_000;

export const DEFAULT_SYNC_FROM_CHAINS: { [network: string]: number } = {
  mainnet: 15665361,
  goerli: 7298263,
  rinkeby: 11096966,
}

export const AGENT_HARDCODED_CONFIGS: { [network: string]: {[agent: string]: AgentHardcodedConfig}} = {
  mainnet: {
    '0x00000000000f02BB0c9a0fE681b589F67Cf9a5EE': {
      deployedAt: 15665361,
      version: '2.2.0',
      strategy: 'light',
    }
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
    }
  }
}

export const MULTICALL_CONTRACTS: { [network: string]: string } = {
  mainnet: '0x5ba1e12693dc8f9c48aad8770482f4739beed696',
  goerli: '0x5ba1e12693dc8f9c48aad8770482f4739beed696',
  sepolia: '0x3BEDdA2f411409448e0033024d68f1cDb0EEDd7B'
}

export const EXTERNAL_LENS_CONTRACTS_2_2_0: { [network: string]: string } = {
  mainnet: '0x18d1e7b86dcea9e9c723eb25e0f2ba2a305acf88',
  goerli: '0xEAb11e3fF42FFb76f96df9e1F5b6f1AfAFc0C55A',
  sepolia: '0xbbDf835B2F1b6886911C0A6Be9E056D35a55bcac'
}

export const EXTERNAL_LENS_CONTRACTS_2_3_0: { [network: string]: string } = {
  mainnet: '',
  goerli: '0x09981814c70d5ee3e2e3aae152bfb933def6bf3e',
  sepolia: '0x3606422e94ea26E5eE2653AC0d137c2Bf8b232F8'
}

export const AVERAGE_BLOCK_TIME_SECONDS: { [network: string]: number } = {
  mainnet: 12,
  sepolia: 12,
  goerli: 12,
}

// export const FLAG_ACCEPT_MAX_BASE_FEE_LIMIT = 0x01;
// export const FLAG_ACCRUE_REWARD = 0x02;

export const BN_ZERO = BigNumber.from(0x0);
export const CFG_ACTIVE = BigNumber.from(0x01);
export const CFG_USE_JOB_OWNER_CREDITS = BigNumber.from(0x02);
export const CFG_ASSERT_RESOLVER_SELECTOR = BigNumber.from(0x04);
export const CFG_CHECK_KEEPER_MIN_CVP_DEPOSIT = BigNumber.from(0x08);
