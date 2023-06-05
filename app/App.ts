import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yamljs';

import { Config, AllNetworksConfig, Storage, AvailableNetworkNames, NetworkConfig, AgentConfig } from "./Types";
import { Network } from './Network.js';
import { nowTimeString } from './Utils.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function clog(...args: any) {
  console.log(`>>> ${nowTimeString()} >>> App:`, ...args);
}

class App {
  private networks: { [key: string]: object };
  private config: any;

  constructor() {

    this.networks = {};
    let config: Config;

    if (!process.env.NETWORK_NAME) {
      const configName = process.argv[2] ? process.argv[2].trim() : 'main';
      console.log(`Reading configuration from ./config/${configName}.yaml ...`);
      config = YAML.parse(fs.readFileSync(path.resolve(__dirname, `../config/${configName}.yaml`)).toString()) as Config;
    } else {
      console.log('NETWORK_NAME is found. Assuming configuration is don with ENV vars...');
      const networkName = process.env.NETWORK_NAME;
      const networkRpc = process.env.NETWORK_RPC;
      const agentAddress = process.env.AGENT_ADDRESS;
      const keeperAddress = process.env.KEEPER_ADDRESS;
      const keyPassword = process.env.KEYPASSWORD || '';
      const acceptMaxBaseFeeLimit = process.env.ACCEPT_MAX_BASE_FEE_LIMIT === 'true';
      const accrueReward = process.env.ACCRUE_REWARD === 'true';
      if (!networkRpc) {
        throw new Error('ENV Config: Missing NETWORK_RPC value');
      }
      if (!agentAddress) {
        throw new Error('ENV Config: Missing AGENT_ADDRESS value');
      }
      if (!keeperAddress) {
        throw new Error('ENV Config: Missing KEEPER_ADDRESS value');
      }
      if (!keyPassword) {
        throw new Error('ENV Config: Missing KEYPASSWORD value');
      }

      const agentConfig: AgentConfig = {
        accept_max_base_fee_limit: acceptMaxBaseFeeLimit,
        accrue_reward: accrueReward,
        executor: 'pga',
        keeper_address: keeperAddress,
        key_pass: keyPassword,
      };

      const netConfig: NetworkConfig = {
        rpc: process.env.NETWORK_RPC,
        agents: {
          [agentAddress]: agentConfig
        },
      };

      config = {
        networks: {
          enabled: [networkName],
          details: {
            [networkName]: netConfig
          }
        },
        observe: false
      }
    }

    console.log(config.networks);
    this.config = config;
  }

  async start() {
    // const config: Config = TOML.parse(fs.readFileSync(path.resolve(__dirname, '../config/main.toml')).toString()) as any;

    await this.initNetworks(this.config.networks);
  }

  async initNetworks(allNetworkConfigs: AllNetworksConfig) {
    clog('Network initialization start...');
    const inits = [];
    for (const [netName, netConfig] of Object.entries(allNetworkConfigs.details)) {
      if (allNetworkConfigs.enabled.includes(netName)) {
        const network = new Network(netName, netConfig);
        inits.push(network.init());
        this.networks[netName] = network;
      } else {
        clog('Skipping', netName, 'network...');
      }
    }
    clog('Waiting for all networks to be initialized...');
    try {
      await Promise.all(inits);
    } catch (e) {
      console.log(e);
      clog('Networks initialization failed');
      process.exit(1);
    }
    clog('Networks initialization done!');
  }
}

(async function() {
  console.log(`PowerPool Agent Node version: ${process.env.npm_package_version}`);
  const app = new App();
  await app.start();
})().catch(error => {
  console.error(error);
  process.exit(1)
});

process.on('unhandledRejection', function(reason, promise){
  console.log('Unhandled Rejection, reason:', reason);
});
