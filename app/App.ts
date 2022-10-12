import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yamljs';

import { Config, AllNetworksConfig, Storage } from './Types';
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
    const config: Config = YAML.parse(fs.readFileSync(path.resolve(__dirname, '../config/main.yaml')).toString());

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
    await Promise.all(inits);
    clog('Networks initialization done!');
  }
}

(async function() {
  const app = new App();
  await app.start();
})();

process.on('unhandledRejection', function(reason, promise){
  console.log('Unhandled Rejection at:', promise, 'reason:', reason);
});
