import { BigNumber, ethers } from 'ethers';

export type AvailableNetworkNames = 'mainnet' | 'arbitrum' | 'bsc'  | 'polygon' | 'goerli' | 'rinkeby';
export type ExecutorType = 'flashbots' | 'pga';

export enum CALLDATA_SOURCE {
  SELECTOR,
  PRE_DEFINED_CALLDATA,
  RESOLVER
}

export interface AgentConfig {
  rewards_contract: string;
  rewards_check_interval_minutes: number;
  keeper_address: string;
  key_pass: string;
  executor: ExecutorType;
  accept_max_base_fee_limit?: boolean;
  accrue_reward?: boolean;
  deployed_at?: number;
}

export interface NetworkConfig {
  rpc: string;
  flashbots: {
    rpc: string;
    address: string;
    pass: string;
  }
  max_priority_fee_per_gas?: number;
  agents: { [key: string]: AgentConfig };
}

export interface AllNetworksConfig {
  enabled: string[];
  details: { [key: string]: NetworkConfig };
}

export interface Config {
  observe: boolean;
  networks: AllNetworksConfig;
}

export interface Storage {
}

export interface GetJobResponse {
  owner: string;
  pendingTransfer: string;
  jobLevelMinKeeperCvp: BigNumber;
  details: JobDetails;
  preDefinedCalldata: string;
  resolver: Resolver;
}

export interface JobDetails {
  config: number;
  selector: string;
  credits: BigNumber;
  maxBaseFeeGwei: number;
  rewardPct: number;
  fixedReward: number;
  calldataSource: number;
  intervalSeconds: number;
  lastExecutionAt: number;
}

export interface RegisterJobEventParams {
  jobSelector: string;
  useJobOwnerCredits: boolean;
  assertResolverSelector: boolean;
  maxBaseFeeGwei: number;
  rewardPct: number;
  fixedReward: number;
  jobMinCvp: BigNumber;
  calldataSource: number;
  intervalSeconds: number;
}

export interface RegisterJobEventArgs {
  jobKey: string;
  jobAddress: string;
  jobId: BigNumber;
  owner: string;
  params: RegisterJobEventParams;
}

export interface UpdateJobEventArgs {
  jobKey: string;
  maxBaseFeeGwei: number;
  rewardPct: number;
  fixedReward: number;
  jobMinCvp: BigNumber;
  intervalSeconds: number;
}

export interface SetResolverEventArgs {
  jobKey: string;
  resolverAddress: string;
  resolverCalldata: string;
}

export interface Resolver {
  resolverAddress: string;
  resolverCalldata: string;
}

export interface Executor {
  // The calldata starting with 0x00000000{address}{jobId}
  init();
  push(key: string, tx: ethers.UnsignedTransaction);
}

export interface ClientWrapper {
  getDefaultProvider(): ethers.providers.BaseProvider;
}

export interface ContractWrapperFactory {
  getDefaultProvider(): ethers.providers.BaseProvider;
  getLatestBlockNumber(): Promise<number>;
  build(
    addressOrName: string,
    contractInterface: ethers.ContractInterface
  ): ContractWrapper;
}

export interface ErrorWrapper {
  name: string;
  signature: string;
  args: { [name: string]: any };
}

export interface ContractWrapper {
  decodeError(response: string): ErrorWrapper;
  getNativeContract(): ethers.Contract;
  getDefaultProvider(): ethers.providers.BaseProvider;
  ethCall(method: string, args?: any[], overrides?: object, callStatic?: boolean): Promise<any>;
  ethCallStatic(method: string, args?: any[], overrides?: object): Promise<any>;
  getPastEvents(eventName: string, from: number, to: number): Promise<any[]>;
  on(eventName: string, eventEmittedCallback: WrapperListener): ContractWrapper;
}

export interface EventWrapper {
  name: string;
  args: { [key: string]: any };
  blockNumber: number;
  blockHash: string;
  nativeEvent: any;
}

export type WrapperListener = (event: EventWrapper) => void;

export enum JobType {
  SelectorOrPDCalldata,
  Resolver,
  IntervalResolver
}

export interface ParsedJobConfig {
  isActive: boolean;
  useJobOwnerCredits: boolean;
  assertResolverSelector: boolean;
  checkKeeperMinCvpDeposit: boolean;
}

// Only values that could be changed during
export interface ParsedRawJob {
  lastExecutionAt: number;
  intervalSeconds: number;
  calldataSource: number;
  fixedReward: number;
  rewardPct: number;
  maxBaseFeeGwei: number;
  nativeCredits: BigNumber;
  selector: string;
  config: string;
}

export interface TxEnvelope {
  jobKey: string;
  tx: ethers.UnsignedTransaction;
  creditsAvailable: BigNumber;
  fixedCompensation: BigNumber;
  ppmCompensation: number;
  minTimestamp?: number;
}
