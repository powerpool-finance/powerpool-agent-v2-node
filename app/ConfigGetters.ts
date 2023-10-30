import {
  AGENT_HARDCODED_CONFIGS,
  AVERAGE_BLOCK_TIME_SECONDS,
  EXTERNAL_LENS_CONTRACTS_2_3_0,
  MULTICALL_CONTRACTS,
} from './Constants.js';
import { AgentHardcodedConfig, Strategy } from './Types';

export function getMulticall2Address(networkName: string) {
  if (networkName in MULTICALL_CONTRACTS) {
    return MULTICALL_CONTRACTS[networkName];
  } else {
    throw new Error(`ConfigGetters.getMulticall2Address(): Network ${networkName} not configured.`);
  }
}

// TODO: support version and strategy, define it in configs
export function getExternalLensAddress(networkName: string, _version: string, _strategy: string) {
  if (networkName in EXTERNAL_LENS_CONTRACTS_2_3_0) {
    return EXTERNAL_LENS_CONTRACTS_2_3_0[networkName];
  } else {
    throw new Error(`ConfigGetters.getExternalLensAddress(): Network ${networkName} not configured.`);
  }
}

export function getAgentVersionAndType(agentAddress: string, networkName: string): [string, Strategy] {
  const agentConfig = getAgentConfig(agentAddress, networkName);
  return [agentConfig.version, agentConfig.strategy];
}

export function getAgentDefaultSyncFrom(agentAddress: string, networkName: string): number {
  const agentConfig = getAgentConfig(agentAddress, networkName);
  return agentConfig.deployedAt;
}

export function getAgentDefaultSyncFromSafe(agentAddress: string, networkName: string): number | null {
  try {
    const agentConfig = getAgentConfig(agentAddress, networkName);
    return agentConfig.deployedAt;
  } catch (e) {
    return null;
  }
}

export function getAgentConfig(agentAddress: string, networkName: string): AgentHardcodedConfig {
  if (networkName in AGENT_HARDCODED_CONFIGS) {
    const network = AGENT_HARDCODED_CONFIGS[networkName];
    if (agentAddress in network) {
      return network[agentAddress];
    } else {
      throw new Error(
        `ConfigGetters.getAgentConfig(): Agent ${agentAddress} is not configured in the network ${networkName}.`,
      );
    }
  } else {
    throw new Error(`ConfigGetters.getAgentConfig(): Network ${networkName} not configured.`);
  }
}

export function getAverageBlockTime(networkName: string) {
  if (networkName in AVERAGE_BLOCK_TIME_SECONDS) {
    return AVERAGE_BLOCK_TIME_SECONDS[networkName];
  } else {
    throw new Error(`ConfigGetters.getAverageBlockTime(): Network ${networkName} not configured.`);
  }
}

export function getDefaultExecutorConfig() {
  return {
    tx_resend_or_drop_after_blocks: 5,
    tx_resend_max_gas_price_gwei: 1000,
    tx_resend_max_attempts: 5,
    gas_price_priority_add_gwei: 2,
  };
}

export function getDefaultNetworkConfig() {
  return {
    max_block_delay: 60,
    max_new_block_delay: 10,
    resolve_min_success_count: 3,
  };
}

export function setConfigDefaultValues(config, defaultValues) {
  Object.keys(defaultValues).forEach(name => {
    if (typeof config[name] === 'undefined') {
      config[name] = defaultValues[name];
    }
  });
}
