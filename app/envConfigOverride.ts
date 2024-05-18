import { ethers } from 'ethers';
import { Config, EnvValueType } from './Types.js';
import { AGENT_HARDCODED_CONFIGS, ENV_CONFIG_MAP } from './Constants.js';
import { addSentryToLogger } from './services/Logger.js';

export function overrideConfigWithEnvVariables(config: Config, version: string): void {
  let networkName = getCurrentValueFromConfig('networks.enabled[0]', config);
  const newNetworkName = process.env.NETWORK_NAME;

  if (newNetworkName && !(newNetworkName in AGENT_HARDCODED_CONFIGS)) {
    console.error(`Error: Network name '${newNetworkName}' is not valid.`);
    process.exit(1);
  }

  if (newNetworkName && newNetworkName !== networkName) {
    config.networks.enabled[0] = newNetworkName;
    if (config.networks.details[networkName]) {
      config.networks.details[newNetworkName] = { ...config.networks.details[networkName] };
      delete config.networks.details[networkName];
    }
    networkName = newNetworkName;
  }

  const newAgentAddress = process.env.AGENT_ADDRESS;
  if (newAgentAddress && !isEthereumAddress(newAgentAddress)) {
    console.error(`Error: AGENT_ADDRESS '${newAgentAddress}' is not a valid Ethereum address.`);
    process.exit(1);
  }

  let agentAddress = getCurrentValueFromConfig(`networks.details.${networkName}.agents`, config);
  agentAddress = agentAddress ? Object.keys(agentAddress)[0] : null;

  if (newAgentAddress && newAgentAddress !== agentAddress) {
    if (agentAddress && config.networks.details[networkName].agents[agentAddress]) {
      config.networks.details[networkName].agents[newAgentAddress] = {
        ...config.networks.details[networkName].agents[agentAddress],
      };
      delete config.networks.details[networkName].agents[agentAddress];
      agentAddress = newAgentAddress;
    }
  }

  const sentryDsn = getCurrentValueFromConfig('sentry', config);
  const newSentryDsn = process.env.SENTRY_DSN;

  if (newSentryDsn) {
    addSentryToLogger(newSentryDsn, version, 'env_vars');
  } else if (sentryDsn) {
    addSentryToLogger(sentryDsn, version, 'yaml_file');
  }

  Object.keys(ENV_CONFIG_MAP).forEach(envKey => {
    if (envKey === 'NETWORK_NAME' || envKey === 'AGENT_ADDRESS') {
      return;
    }

    const envValue = process.env[envKey];
    if (envValue !== undefined) {
      try {
        const { path, type, validValues } = ENV_CONFIG_MAP[envKey];
        const pathTemplate = path.replace('${NETWORK_NAME}', networkName).replace('${AGENT_ADDRESS}', agentAddress);
        const expandedPath = expandPathTemplate(pathTemplate, config);
        setConfigValue(config, expandedPath, envValue, type, validValues);
      } catch (error) {
        console.error(error.message);
        process.exit(1);
      }
    }
  });
}

function getCurrentValueFromConfig(keyPath: string, config: Config): any {
  const keys = keyPath
    .replace(/\[|\]\.?/g, '.')
    .split('.')
    .filter(key => key !== '');
  let currentConfigPart = config;

  for (const key of keys) {
    if (typeof currentConfigPart !== 'object' || currentConfigPart === null || !(key in currentConfigPart)) {
      return undefined;
    }
    currentConfigPart = currentConfigPart[key];
  }

  return currentConfigPart;
}

function expandPathTemplate(template: string, config: Config): string {
  const expandedTemplate = template.replace(/\$\{([^}]+)\}/g, (_, key) => {
    return (process.env[key] ? process.env[key] : getCurrentValueFromConfig(key, config)) || `$\{${key}\}`;
  });
  return expandedTemplate;
}

function setConfigValue(
  config: Config,
  path: string,
  value: string,
  type: EnvValueType,
  validValues: string[] = [],
): void {
  const keys = path.split('.').reduce((acc, key) => {
    if (key.includes('[')) {
      acc.push(
        ...key
          .replace(/\[|\]/g, '.')
          .split('.')
          .filter(k => k),
      );
    } else {
      acc.push(key);
    }
    return acc;
  }, []);

  let current = config;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const nextKey = keys[i + 1];
    if (current[key] === undefined) {
      current[key] = /^\d+$/.test(nextKey) ? [] : {};
    }
    current = current[key];
  }

  const finalKey = keys[keys.length - 1];
  const parsedValue = parseValue(value, type, validValues);

  if (/^\d+$/.test(finalKey) && Array.isArray(current)) {
    current[parseInt(finalKey, 10)] = parsedValue;
  } else {
    current[finalKey] = parsedValue;
  }
}

function parseValue(value: string, expectedType: EnvValueType, validValues: string[] = []): string | number | boolean {
  if (validValues.length > 0 && !validValues.includes(value)) {
    throw new Error(`Invalid value: ${value}. Expected one of: ${validValues.join(', ')}`);
  }

  switch (expectedType) {
    case 'string':
      return value;

    case 'number':
      const numberValue = Number(value);
      if (isNaN(numberValue)) {
        throw new Error(`Expected a numeric value, received: ${value}`);
      }
      return numberValue;

    case 'boolean':
      if (value === 'true') return true;
      if (value === 'false') return false;
      throw new Error(`Expected a boolean value, received: ${value}`);

    case 'address':
      if (isEthereumAddress(value)) {
        return value;
      }
      throw new Error(`Expected an Ethereum address, received: ${value}`);

    default:
      throw new Error(`Unknown data type: ${expectedType}`);
  }
}

function isEthereumAddress(address: string): boolean {
  return ethers.utils.isAddress(address);
}
