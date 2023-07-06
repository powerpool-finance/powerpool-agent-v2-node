import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yamljs';

import { Config, AllNetworksConfig, NetworkConfig, AgentConfig } from './Types';
import { Network } from './Network.js';
import { nowTimeString } from './Utils.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { initApi } from './Api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function clog(...args: any[]) {
  console.log(`>>> ${nowTimeString()} >>> App:`, ...args);
}

let unhandledExceptionsStrictMode = false;

export class App {
  private readonly networks: { [key: string]: Network };
  private readonly config: Config;

  constructor() {
    this.networks = {};
    let config: Config;

    if (!process.env.NETWORK_NAME) {
      const configName = process.argv[2] ? process.argv[2].trim() : 'main';
      console.log(`Reading configuration from ./config/${configName}.yaml ...`);
      config = YAML.parse(
        fs.readFileSync(path.resolve(__dirname, `../config/${configName}.yaml`)).toString(),
      ) as Config;
    } else {
      console.log('NETWORK_NAME is found. Assuming configuration is done with ENV vars...');
      const networkName = process.env.NETWORK_NAME;
      const networkRpc = process.env.NETWORK_RPC;
      const agentAddress = process.env.AGENT_ADDRESS;
      const dataSource = process.env.DATA_SOURCE;
      const graphUrl = process.env.GRAPH_URL;
      const keeperAddress = process.env.KEEPER_ADDRESS;
      const keyPassword = process.env.KEYPASSWORD || '';
      const acceptMaxBaseFeeLimit = process.env.ACCEPT_MAX_BASE_FEE_LIMIT === 'true';
      const accrueReward = process.env.ACCRUE_REWARD === 'true';
      const api = process.env.API_SERVER === 'true';
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
      if (dataSource === 'subgraph' && !graphUrl) {
        throw new Error('ENV CONFIG: On order to use subgraph as data source, you must define GRAPH_URL');
      }
      const agentConfig: AgentConfig = {
        accept_max_base_fee_limit: acceptMaxBaseFeeLimit,
        accrue_reward: accrueReward,
        executor: 'pga',
        keeper_address: keeperAddress,
        key_pass: keyPassword,
        data_source: dataSource,
        graph_url: graphUrl,
      };

      const netConfig: NetworkConfig = {
        rpc: process.env.NETWORK_RPC,
        agents: {
          [agentAddress]: agentConfig,
        },
      };

      config = {
        api,
        strict: {
          all: false,
        },
        networks: {
          enabled: [networkName],
          details: {
            [networkName]: netConfig,
          },
        },
        observe: false,
      };
    }

    if (!!config.api) {
      let port = 8099;
      if (typeof config.api === 'number') {
        port = config.api;
      }
      initApi(this, port);
    }

    // Override all
    let anyStrict = false;
    if (config.strict) {
      if (typeof config.strict !== 'object') {
        config.strict = { all: false };
      }

      if (typeof config.strict.all !== 'undefined' && typeof config.strict.all !== 'boolean') {
        throw new Error(
          `Invalid config.strict.all type: (type=${typeof config.strict.all},value=${
            config.strict.all
          }). Set a boolean value or remove it.`,
        );
      }

      if (config.strict.all === true) {
        const all = !!config.strict.all;
        config.strict.basic = all;
        config.strict.unhandled = all;
        config.strict.estimations = all;
        unhandledExceptionsStrictMode = all;
        anyStrict = true;
      } else {
        config.strict.basic = !!config.strict.basic;
        config.strict.unhandled = !!config.strict.unhandled;
        config.strict.estimations = !!config.strict.estimations || !!config.strict['estimation'];

        unhandledExceptionsStrictMode = !!config.strict.unhandled;

        anyStrict = config.strict.basic || config.strict.unhandled || config.strict.estimations;
      }
    }

    if (anyStrict) {
      console.log({ strictMode: config.strict });
      console.log('WARNING: "basic" and "estimations" strict mode options are not supported yet.');
    }

    console.log(config.networks);
    this.config = config;
  }

  public async start() {
    // const config: Config = TOML.parse(fs.readFileSync(path.resolve(__dirname, '../config/main.toml')).toString()) as any;

    await this.initNetworks(this.config.networks);
  }

  private async initNetworks(allNetworkConfigs: AllNetworksConfig) {
    clog('Network initialization start...');
    const inits = [];
    for (const [netName, netConfig] of Object.entries(allNetworkConfigs.details)) {
      if (allNetworkConfigs.enabled.includes(netName)) {
        const network = new Network(netName, netConfig, this);
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

  public exitIfStrictTopic(topic) {
    if (this.isStrict(topic)) {
      console.log(`Exiting the app due to a strict mode for topic "${topic}"...`);
      process.exit(1);
    }
  }

  public getNetworkList(): string[] {
    return Object.keys(this.networks);
  }

  public getConfig(): object {
    return this.config;
  }

  public getNetwork(networkName): Network {
    return this.networks[networkName];
  }

  public isStrict(topic = 'basic'): boolean {
    if (this.config.strict.all) {
      return true;
    }
    if (!!this.config.strict[topic]) {
      return true;
    }
    return false;
  }
}

(async function () {
  console.log(`PowerPool Agent Node version: ${process.env.npm_package_version}`);
  const app = new App();
  await app.start();
})().catch(error => {
  console.error(error);
  console.log('App.ts: Unexpected error. Stopping the app with a code (1).');
  process.exit(1);
});

process.on('unhandledRejection', function (error: Error, _promise) {
  const msg = `Unhandled Rejection, reason: ${error}`;
  console.log(error.stack);

  if (unhandledExceptionsStrictMode) {
    console.log('Stopping the app with a code (1) since the "unhandledExceptionsStrictMode" is ON.');
    process.exit(1);
  }

  console.log(msg);
});
