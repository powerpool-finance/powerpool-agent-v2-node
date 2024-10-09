import { App } from './App.js';
import YAML from 'yamljs';
import fs from 'fs';
import path, { dirname } from 'path';
import { Config } from './Types.js';
import { overrideConfigWithEnvVariables } from './envConfigOverride.js';
import { fileURLToPath } from 'url';
import logger from './services/Logger.js';
import { getVersion } from './services/GitCommit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let app: App;

(async function () {
  const version = await getVersion(__dirname);
  console.log(`PowerPool Agent Node version: ${version}`);

  let config: Config, configPath: string;

  try {
    configPath = process.env.CONFIG_PATH || path.resolve(__dirname, '../config/main.yaml');
    logger.info(`CLI: Reading configuration from ${configPath} ...`);
    config = YAML.parse(fs.readFileSync(configPath).toString()) as Config;
  } catch (error) {
    logger.warn(`CLI: Configuration file ${configPath} not found. Using default/env configuration.`);
    config = {} as Config;
  }

  overrideConfigWithEnvVariables(config, version);

  config.version = version;

  app = new App(config);
  await app.start();
})().catch(error => {
  logger.error(error.stack);
  setTimeout(() => {
    logger.warn('CLI: Unexpected error. Stopping the app with a code (1).');
    process.exit(1);
  }, 2000);
});

process.on('unhandledRejection', function (e: Error, _promise) {
  if (app && app.unhandledExceptionsStrictMode) {
    setTimeout(() => {
      logger.warn('CLI: Stopping the app with a code (1) since the "unhandledExceptionsStrictMode" is ON. Error: ', e);
      process.exit(1);
    }, 2000);
  }
});

process.on('SIGINT', async function () {
  console.log('CLI: Caught interrupt signal');
  await app?.stop();

  process.exit(1);
});
