import { Config, AllNetworksConfig, IAgent, AgentConfig } from './Types';
import { Network } from './Network.js';
import { toChecksummedAddress } from './Utils.js';
import { initApi } from './Api.js';
import { getAgentVersionAndType } from './ConfigGetters.js';
import { AgentRandao_2_3_0 } from './agents/Agent.2.3.0.randao.js';
import { AgentLight_2_2_0 } from './agents/Agent.2.2.0.light.js';
import { SubgraphSource } from './dataSources/SubgraphSource.js';
import { BlockchainSource } from './dataSources/BlockchainSource.js';
import logger, { updateSentryScope } from './services/Logger.js';

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
        const agents = this.buildAgents(netName, netConfig.agents);
        networks[netName] = new Network(netName, netConfig, this, agents);
      } else {
        logger.debug(`App: Skipping ${netName} network...`);
      }
    }

    return networks;
  }

  public buildAgents(networkName: string, agentsConfig: { [key: string]: AgentConfig }): IAgent[] {
    const agents = [];
    // TODO: get type & AgentConfig
    for (const [address, agentConfig] of Object.entries(agentsConfig)) {
      const checksummedAddress = toChecksummedAddress(address);
      let { version, strategy } = agentConfig;
      if (!version || !strategy) {
        [version, strategy] = getAgentVersionAndType(checksummedAddress, networkName);
      }
      let agent;

      if (version === '2.3.0' && strategy === 'randao') {
        agent = new AgentRandao_2_3_0(checksummedAddress, agentConfig, networkName);
      } else if (version === '2.2.0' && strategy === 'light') {
        agent = new AgentLight_2_2_0(checksummedAddress, agentConfig, networkName);
      } else {
        throw new Error(
          `App: Not supported agent version/strategy: network=${networkName},version=${version},strategy=${strategy}`,
        );
      }

      agents.push(agent);
    }
    return agents;
  }

  public async initNetworks(networks: { [netName: string]: Network }) {
    this.networks = networks;
    logger.debug('App: Network initialization start...');
    const inits = [];
    for (const network of Object.values(this.networks)) {
      inits.push(network.init());

      for (const agent of network.getAgents()) {
        let dataSource;
        // TODO: Add support for different agents. Now if there are multiple agents, the tags linked to the latest one.
        updateSentryScope(
          network.getName(),
          network.getFlashbotsRpc(),
          agent.address,
          agent.getKeyAddress(),
          agent.dataSourceType,
          agent.subgraphUrl,
        );
        if (agent.dataSourceType === 'subgraph') {
          dataSource = new SubgraphSource(network, agent, agent.subgraphUrl);
        } else if (agent.dataSourceType === 'blockchain') {
          dataSource = new BlockchainSource(network, agent);
        } else {
          throw new Error(`App: missing dataSource for agent ${agent.address}`);
        }
        await agent.init(network, dataSource);
      }
    }
    logger.debug('App: Waiting for all networks to be initialized...');
    try {
      await Promise.all(inits);
    } catch (e) {
      logger.error(`App: Networks initialization failed ${e}`);
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
    await this.stopApi();

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
