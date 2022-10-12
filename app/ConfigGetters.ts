import { AVERAGE_BLOCK_TIME_SECONDS, EXTERNAL_LENS_CONTRACTS, MULTICALL_CONTRACTS } from './Constants.js';

export function getMulticall2Address(networkName: string) {
  if (networkName in MULTICALL_CONTRACTS) {
    return MULTICALL_CONTRACTS[networkName];
  } else {
    throw new Error(`getMulticall2Address(): Network ${networkName} not configured.`)
  }
}

export function getExternalLensAddress(networkName: string) {
  if (networkName in EXTERNAL_LENS_CONTRACTS) {
    return EXTERNAL_LENS_CONTRACTS[networkName];
  } else {
    throw new Error(`getExternalLensAddress(): Network ${networkName} not configured.`)
  }
}

export function getAverageBlockTime(networkName: string) {
  if (networkName in AVERAGE_BLOCK_TIME_SECONDS) {
    return AVERAGE_BLOCK_TIME_SECONDS[networkName];
  } else {
    throw new Error(`getAverageBlockTime(): Network ${networkName} not configured.`)
  }
}
