import { BigNumber } from 'ethers';

export const MIN_EXECUTION_GAS = 50_000;

export const DEFAULT_SYNC_FROM_CHAINS: { [network: string]: number } = {
  mainnet: 15665361,
  goerli: 7298263,
  rinkeby: 11096966,
}

export const DEFAULT_SYNC_FROM_CONTRACTS: { [network: string]: {[agent: string]: number}} = {
  mainnet: {
    '0x00000000000f02BB0c9a0fE681b589F67Cf9a5EE': 15665361
  },
  goerli: {
    '0x9C6964145BCD66f64333EdEe49e74A333E0819A9': 7298263
  },
  rinkeby: {
    '0xc9c976B484A1745553a1034140c1BE6eaAF14454': 11096966
  }
}

export const MULTICALL_CONTRACTS: { [network: string]: string } = {
  mainnet: '0x5ba1e12693dc8f9c48aad8770482f4739beed696',
  kovan: '0x5ba1e12693dc8f9c48aad8770482f4739beed696',
  rinkeby: '0x5ba1e12693dc8f9c48aad8770482f4739beed696',
  goerli: '0x5ba1e12693dc8f9c48aad8770482f4739beed696',
  ropsten: '0x5ba1e12693dc8f9c48aad8770482f4739beed696'
}

export const EXTERNAL_LENS_CONTRACTS: { [network: string]: string } = {
  mainnet: '0x18d1e7b86dcea9e9c723eb25e0f2ba2a305acf88',
  goerli: '0xEAb11e3fF42FFb76f96df9e1F5b6f1AfAFc0C55A',
  rinkeby: '0xc01Dfc6927848ca169fD73DA32a9C41C196E1900'
}

export const AVERAGE_BLOCK_TIME_SECONDS: { [network: string]: number } = {
  mainnet: 13,
  rinkeby: 15,
  goerli: 15,
}

// export const FLAG_ACCEPT_MAX_BASE_FEE_LIMIT = 0x01;
// export const FLAG_ACCRUE_REWARD = 0x02;

export const BN_ZERO = BigNumber.from(0x0);
export const CFG_ACTIVE = BigNumber.from(0x01);
export const CFG_USE_JOB_OWNER_CREDITS = BigNumber.from(0x02);
export const CFG_ASSERT_RESOLVER_SELECTOR = BigNumber.from(0x04);
export const CFG_CHECK_KEEPER_MIN_CVP_DEPOSIT = BigNumber.from(0x08);
