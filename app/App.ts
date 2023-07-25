import { Config, AllNetworksConfig } from './Types';
import { Network } from './Network.js';
import { nowTimeString } from './Utils.js';
import { initApi } from './Api.js';

function clog(...args: any[]) {
  console.log(`>>> ${nowTimeString()} >>> App:`, ...args);
}

export class App {
  private readonly networks: { [key: string]: Network };
  private readonly config: Config;

  public unhandledExceptionsStrictMode = false;

  constructor(config: Config) {
    this.networks = {};

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
        this.unhandledExceptionsStrictMode = all;
        anyStrict = true;
      } else {
        config.strict.all = false;
        config.strict.basic = !!config.strict.basic;
        config.strict.unhandled = !!config.strict.unhandled;
        config.strict.estimations = !!config.strict.estimations || !!config.strict['estimation'];

        this.unhandledExceptionsStrictMode = !!config.strict.unhandled;

        anyStrict = config.strict.basic || config.strict.unhandled || config.strict.estimations;
      }
    } else {
      config.strict = { all: false };
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
