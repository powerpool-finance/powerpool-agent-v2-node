import { Config, AllNetworksConfig } from './Types';
import { Network } from './Network.js';
import { initApi } from './Api.js';
import logger from './services/Logger.js';

export class App {
  private networks: { [key: string]: Network };
  private readonly config: Config;
  private stopApi: () => void;
  private version;

  public unhandledExceptionsStrictMode = false;

  constructor(config: Config) {
    this.version = config.version;
    this.networks = {};

    if (!!config.api) {
      let port = 8099;
      if (typeof config.api === 'number') {
        port = config.api;
      }
      this.stopApi = initApi(this, port);
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
      logger.warn('App: WARNING: "basic" and "estimations" strict mode options are not supported yet.');
      logger.warn(`App: Strict mode enabled: ${JSON.stringify({ strictMode: config.strict })}`);
    }

    this.config = config;
  }

  public getVersion() {
    return this.version;
  }

  public async start() {
    const networks = this.buildNetworks(this.config.networks);
    await this.initNetworks(networks);
  }

  public buildNetworks(allNetworkConfigs: AllNetworksConfig): { [netName: string]: Network } {
    const networks: { [netName: string]: Network } = {};

    for (const [netName, netConfig] of Object.entries(allNetworkConfigs.details)) {
      if (allNetworkConfigs.enabled.includes(netName)) {
        networks[netName] = new Network(netName, netConfig, this);
      } else {
        logger.debug(`App: Skipping ${netName} network...`);
      }
    }

    return networks;
  }

  public async initNetworks(networks: { [netName: string]: Network }) {
    this.networks = networks;
    logger.debug('App: Network initialization start...');
    for (const network of Object.values(this.networks)) {
      await network.init().catch(e => {
        logger.error(`App: Network ${network.getName()} initialization failed ${e}`);
      });
    }
    if (!Object.values(this.networks).some(n => !!n.getChainId())) {
      logger.error('App: Networks initialization failed');
      process.exit(1);
    }
    logger.info('App: Networks initialization done!');
  }

  public async stop() {
    logger.warn('App: Stopping the app...');
    if (this.networks) {
      for (const network of Object.values(this.networks)) {
        network.stop();
      }
      this.networks = null;
    }
    // await this.stopApi();

    logger.warn('App: The App has stopped successfully...');
  }

  public exitIfStrictTopic(topic) {
    if (this.isStrict(topic)) {
      logger.warn(`App: Exiting the app due to a strict mode for topic "${topic}"...`);
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
