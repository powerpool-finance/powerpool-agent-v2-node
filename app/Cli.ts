import { App } from './App.js';
import YAML from 'yamljs';
import fs from 'fs';
import path, { dirname } from 'path';
import { AgentConfig, Config, NetworkConfig } from './Types.js';
import { fileURLToPath } from 'url';
import logger from './services/Logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let app: App;

(async function () {
  logger.info(`PowerPool Agent Node version: ${process.env.npm_package_version}`);

  let config: Config;

  if (!process.env.NETWORK_NAME) {
    const configName = process.argv[2] ? process.argv[2].trim() : 'main';
    logger.info(`CLI: Reading configuration from ./config/${configName}.yaml ...`);
    config = YAML.parse(fs.readFileSync(path.resolve(__dirname, `../config/${configName}.yaml`)).toString()) as Config;
  } else {
    logger.info('CLI: NETWORK_NAME is found. Assuming configuration is done with ENV vars...');
    const networkName = process.env.NETWORK_NAME;
    const networkRpc = process.env.NETWORK_RPC;
    const agentAddress = process.env.AGENT_ADDRESS;
    const dataSource = process.env.DATA_SOURCE;
    const subgraphUrl = process.env.SUBGRAPH_URL;
    const keeperAddress = process.env.KEEPER_WORKER_ADDRESS;
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
    if (dataSource === 'subgraph' && !subgraphUrl) {
      throw new Error('ENV CONFIG: On order to use subgraph as data source, you must define GRAPH_URL');
    }
    const agentConfig: AgentConfig = {
      strategy: undefined,
      accept_max_base_fee_limit: acceptMaxBaseFeeLimit,
      accrue_reward: accrueReward,
      executor: 'pga',
      executor_config: {
        tx_resend_or_drop_after_blocks: process.env.TX_RESEND_OR_DROP_AFTER_BLOCKS
          ? parseInt(process.env.TX_RESEND_OR_DROP_AFTER_BLOCKS)
          : undefined,
        tx_resend_max_gas_price_gwei: process.env.TX_RESEND_MAX_GAS_PRICE
          ? parseFloat(process.env.TX_RESEND_MAX_GAS_PRICE)
          : undefined,
        tx_resend_max_attempts: process.env.TX_RESEND_MAX_ATTEMPTS
          ? parseInt(process.env.TX_RESEND_MAX_ATTEMPTS)
          : undefined,
      },
      keeper_worker_address: keeperAddress,
      key_pass: keyPassword,
      data_source: dataSource,
      subgraph_url: subgraphUrl,
    };

    const netConfig: NetworkConfig = {
      rpc: process.env.NETWORK_RPC,
      max_block_delay: parseInt(process.env.NETWORK_MAX_BLOCK_DELAY || '60'),
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

  app = new App(config);
  await app.start();
})().catch(error => {
  logger.error(error);
  logger.info('CLI: Unexpected error. Stopping the app with a code (1).');
  process.exit(1);
});

process.on('unhandledRejection', function (error: Error, _promise) {
  const msg = `Unhandled Rejection, reason: ${error}`;
  logger.error(error.stack);

  if (app && app.unhandledExceptionsStrictMode) {
    logger.info('CLI: Stopping the app with a code (1) since the "unhandledExceptionsStrictMode" is ON.');
    process.exit(1);
  }

  logger.error(msg);
});

process.on('SIGINT', async function () {
  console.log('CLI: Caught interrupt signal');
  await app?.stop();

  process.exit(1);
});
