import YAML from 'yamljs';
import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const files = fs.readdirSync(path.resolve(__dirname, '../../keys'));
const v3Objects = {};
for (const file of files) {
  if (!file.startsWith('.')) {
    const _path = path.resolve(__dirname, `../../keys/${file}`);
    const string = fs.readFileSync(_path).toString();
    let data = JSON.parse(string);
    if (typeof data === 'string' && data.includes('version')) {
      data = JSON.parse(data);
    }
    if ('address' in data && data.address.length === 40) {
      v3Objects[`0x${data.address}`] = JSON.stringify(data);
    } else {
      throw new Error(`KeysService: Invalid key object in file ${_path}`);
    }
  }
}

export function getEncryptedJson(address: string): string {
  address = address.toLowerCase();
  if (!(address in v3Objects)) {
    throw new Error(
      `KeysService: missing '${address}' in json key files. Available addresses are: ${JSON.stringify(
        Object.keys(v3Objects),
      )}`,
    );
  }
  return v3Objects[address];
}

interface NetworkConfig {
  flashbots?: string;
  agents: { [key: string]: string };
}

let keysConfig: { [key: string]: NetworkConfig };

function getNetworkConfig(networkName: string): NetworkConfig {
  if (!keysConfig) {
    keysConfig = YAML.parse(fs.readFileSync(path.resolve(__dirname, '../../config/workers.yaml')).toString());
  }

  if (!(networkName in keysConfig)) {
    throw new Error(`WorkerKeysService: Network '${networkName} config missing.`);
  }

  return keysConfig[networkName];
}

export function getWorkerKey(networkName: string, agentAddress: string): string {
  const networkConfig = getNetworkConfig(networkName);
  if (!('agents' in networkConfig) || !(agentAddress in networkConfig.agents)) {
    throw new Error(`WorkerKeysService: Agent '${agentAddress} config missing in '${networkName}' network.`);
  }

  const privateKey = networkConfig.agents[agentAddress];
  if (typeof privateKey !== 'string' || (privateKey.length != 64 && privateKey.length != 66)) {
    throw new Error(
      `WorkerKeysService: Invalid worker private key for (network: ${networkName}, agent '${agentAddress}').`,
    );
  }

  return privateKey;
}

export function getFlashbotsSignerKey(networkName: string): string {
  const privateKey = getNetworkConfig(networkName).flashbots;
  if (typeof privateKey !== 'string' || (privateKey.length != 64 && privateKey.length != 66)) {
    throw new Error(`WorkerKeysService: Invalid flashbots signer private key for (network: ${networkName}).`);
  }

  return privateKey;
}
