import { BigNumber, ethers } from 'ethers';
import { Network } from './Network';
import { Contract } from 'web3-eth-contract';
import { WebsocketProvider } from 'web3-core';

export type AvailableNetworkNames = 'mainnet' | 'bsc'  | 'polygon' | 'goerli';
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
  source: string,
  graphUrl: string,
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
  randaoData: {
    jobNextKeeperId: number,
    jobReservedSlasherId: number,
    jobSlashingPossibleAfter: number,
    jobCreatedAt: number
  };
}

export interface GraphJob {
  id: string,
  active: boolean,
  jobAddress: string,
  jobId: string,
  assertResolverSelector: boolean,
  credits: string,
  depositCount: string,
  calldataSource: string,
  fixedReward: string,
  executionCount: string,
  jobSelector: string,
  lastExecutionAt: string,
  maxBaseFeeGwei: string,
  minKeeperCVP: string,
  resolverAddress: string | null,
  resolverCalldata: string | null,
  rewardPct: string,
  totalCompensations: string,
  totalExpenses: string,
  totalProfit: string,
  useJobOwnerCredits: boolean,
  withdrawalCount: string,
  name: string,
  args: { [key: string]: any },
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
  id: string;
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
  getDefaultProvider(): ethers.providers.BaseProvider | object;
}

export interface ContractWrapperFactory {
  getDefaultProvider(): ethers.providers.BaseProvider | object;
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
  getNativeContract(): ethers.Contract | Contract;
  getDefaultProvider(): ethers.providers.BaseProvider | WebsocketProvider;
  ethCall(method: string, args?: any[], overrides?: object, callStatic?: boolean): Promise<any>;
  ethCallStatic(method: string, args?: any[], overrides?: object): Promise<any>;
  getPastEvents(eventName: string, from: number, to: number): Promise<any[]>;
  on(eventName: string, eventEmittedCallback: WrapperListener): ContractWrapper;
}

export interface EventWrapper {
  name: string;
  args: { [key: string]: any };
  logIndex: number;

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

export interface AgentHardcodedConfig {
  deployedAt: number;
  version: string;
  strategy: string;
  subgraph?: string;
}

export interface IRandaoAgent extends IAgent {
  registerIntervalJobSlashing(jobKey: string, timestamp: number, callback: (calldata) => void);
  unregisterIntervalJobSlashing(jobKey: string);
  getPeriod1Duration(): number;
  getPeriod2Duration(): number;
}

export interface IAgent {
  getNetwork(): Network;

  getAddress(): string;

  getKeeperId(): number;

  getCfg(): number;

  // METHODS
  init(): void;

  registerIntervalJobExecution(jobKey: string, timestamp: number, callback: (calldata) => void);

  unregisterIntervalJobExecution(jobKey: string);

  registerResolver(jobKey: string, resolver: Resolver, callback: (calldata) => void);

  unregisterResolver(jobKey: string): void;

  getJobOwnerBalance(address: string): BigNumber;

  sendOrEnqueueTxEnvelope(envelope: TxEnvelope);
}
