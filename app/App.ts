import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yamljs';

import { Config, AllNetworksConfig, Storage, AvailableNetworkNames } from "./Types";
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
    const configName = process.argv[2] ? process.argv[2].trim() : 'main';

    this.networks = {};
    const config: Config = YAML.parse(fs.readFileSync(path.resolve(__dirname, `../config/${configName}.yaml`)).toString());

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
})();

process.on('unhandledRejection', function(reason, promise){
  console.log('Unhandled Rejection at:', promise, 'reason:', reason);
});
