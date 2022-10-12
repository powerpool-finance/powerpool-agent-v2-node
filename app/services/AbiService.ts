import * as fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const abis: { [key: string]: ethers.ContractInterface } = {};

export function getExternalLensAbi(): ethers.ContractInterface {
  return getAbi('PPAgentV2ExternalLens');
}

export function getMulticall2Abi(): ethers.ContractInterface {
  return getAbi('Multicall2');
}

export function getPPAgentV2Abi(): ethers.ContractInterface {
  return getAbi('PPAgentV2')
}

export function getAgentRewardsAbi(): ethers.ContractInterface {
  return getAbi('AgentRewards')
}

export function getAbi(name): ethers.ContractInterface {
  if (!(name in abis)) {
    abis[name] = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../artifacts/${name}.json`)).toString()).abi as ethers.ContractInterface;
  }
  return abis[name];
}
