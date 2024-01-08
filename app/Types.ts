import { BigNumber, ethers } from 'ethers';
import { Network } from './Network';
import { Contract } from 'web3-eth-contract';
import { WebsocketProvider } from 'web3-core';
import { RandaoJob } from './jobs/RandaoJob';
import { LightJob } from './jobs/LightJob';
import { BytesLike } from '@ethersproject/bytes';
import { AccessListish } from '@ethersproject/transactions/src.ts/index';
import { AbstractJob } from './jobs/AbstractJob';

export type AvailableNetworkNames = 'mainnet' | 'bsc' | 'polygon' | 'goerli';
export type ExecutorType = 'flashbots' | 'pga';
export type Strategy = 'randao' | 'light';
export type DataSourceType = 'blockchain' | 'subgraph' | 'subquery';

export enum CALLDATA_SOURCE {
  SELECTOR,
  PRE_DEFINED_CALLDATA,
  RESOLVER,
}

export interface ExecutorConfig {
  tx_resend_or_drop_after_blocks?: number;
  tx_resend_max_gas_price_gwei?: number;
  tx_resend_max_attempts?: number;
  gas_price_priority_add_gwei?: number;
}

export interface AgentConfig {
  keeper_worker_address: string;
  key_pass: string;
  executor: ExecutorType;
  executor_config?: ExecutorConfig;
  accept_max_base_fee_limit?: boolean;
  accrue_reward?: boolean;
  deployed_at?: number;
  data_source?: string;
  subgraph_url?: string;
  version?: string;
  strategy?: Strategy;
}

export interface UnsignedTransaction {
  to?: string;
  nonce?: number;

  gasLimit?: bigint;
  gasPrice?: bigint;

  data?: BytesLike;
  value?: bigint;
  chainId?: number;

  // Typed-Transaction features
  type?: number | null;

  // EIP-2930; Type 1 & EIP-1559; Type 2
  accessList?: AccessListish;

  // EIP-1559; Type 2
  maxPriorityFeePerGas?: bigint;
  maxFeePerGas?: bigint;
}

export interface NetworkConfig {
  rpc: string;
  ws_timeout?: number;
  max_block_delay?: number;
  max_new_block_delay?: number;
  resolve_min_success_count?: number;
  block_logs_mode?: boolean;
  flashbots?: {
    rpc: string;
    address: string;
    pass: string;
  };
  max_priority_fee_per_gas?: number;
  agents: { [key: string]: AgentConfig };
  average_block_time?: number;
  external_lens?: string;
  multicall2?: string;
}

export interface SourceConfig {
  graphUrl: string;
  dataSource: string;
}

export interface AllNetworksConfig {
  enabled: string[];
  details: { [key: string]: NetworkConfig };
}

export interface StrictModeConfig {
  all?: boolean;
  basic?: boolean;
  unhandled?: boolean;
  estimations?: boolean;
}

export interface Config {
  version?: string;
  observe?: boolean;
  api?: boolean | number;
  sentry?: string;
  strict: StrictModeConfig;
  networks: AllNetworksConfig;
}

export interface GetJobResponse {
  owner: string;
  pendingTransfer: string;
  jobLevelMinKeeperCvp: BigNumber;
  details: JobDetails;
  preDefinedCalldata: string;
  resolver: Resolver;
  randaoData?: {
    jobNextKeeperId: number;
    jobReservedSlasherId: number;
    jobSlashingPossibleAfter: number;
    jobCreatedAt: number;
  };
  config: ParsedJobConfig;
}

export interface GraphJob {
  id: string;
  active: boolean;
  jobAddress: string;
  jobId: string;
  assertResolverSelector: boolean;
  credits: string;
  depositCount: string;
  calldataSource: string;
  fixedReward: string;
  executionCount: string;
  jobSelector: string;
  lastExecutionAt: string;
  maxBaseFeeGwei: string;
  minKeeperCVP: string;
  resolverAddress: string | null;
  resolverCalldata: string | null;
  rewardPct: string;
  totalCompensations: string;
  totalExpenses: string;
  totalProfit: string;
  useJobOwnerCredits: boolean;
  withdrawalCount: string;
  jobCreatedAt: string;
  intervalSeconds: string;
  jobNextKeeperId: string;
  jobReservedSlasherId: string;
  jobSlashingPossibleAfter: string;
  preDefinedCalldata: string;
  owner: {
    id: string;
  } | null;
  pendingOwner: {
    id: string;
  } | null;
  name: string;
  args: { [key: string]: any };
}

export interface LensGetJobBytes32AndNextBlockSlasherIdResponse {
  binJob: string;
  nextBlockSlasherId: number;
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

export interface GraphJobConfigInterface {
  active: boolean;
  useJobOwnerCredits: boolean;
  assertResolverSelector: boolean;
  minKeeperCVP: string;
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
  getStatusObjectForApi(): object;
  init();
  push(key: string, tx: TxEnvelope);
  sendBlockDelayLog(agent: IAgent, delay, blockNumber);
  sendNewBlockDelayLog(agent: IAgent, delay, blockNumber);
  sendAddBlacklistedJob(agent: IAgent, jobKey, errMessage);
}

export interface ClientWrapper {
  getDefaultProvider(): ethers.providers.BaseProvider | object;
}

export interface ContractWrapperFactory {
  getDefaultProvider(): ethers.providers.BaseProvider | object;
  getLatestBlockNumber(): Promise<number>;
  build(addressOrName: string, contractInterface: ethers.ContractInterface): ContractWrapper;
  stop();
}

export interface ErrorWrapper {
  name: string;
  signature: string;
  args: { [name: string]: any };
}
export interface TxDataWrapper {
  name: string;
  signature: string;
  args: { [name: string]: any };
}

export interface ContractWrapper {
  readonly address: string;
  decodeError(response: string): ErrorWrapper;
  decodeTxData(data: string): TxDataWrapper;
  getNativeContract(): ethers.Contract | Contract;
  getDefaultProvider(): ethers.providers.BaseProvider | WebsocketProvider;
  ethCall(method: string, args?: any[], overrides?: object, callStatic?: boolean): Promise<any>;
  ethCallStatic(method: string, args?: any[], overrides?: object): Promise<any>;
  getPastEvents(eventName: string, from: number, to: number): Promise<any[]>;
  on(eventNameOrNames: string | string[], eventEmittedCallback: WrapperListener): ContractWrapper;
  encodeABI(method: string, args?: any[]): string;
  getTopicOfEvent(eventName): string;
  parseLog(log): any;
}

export interface EventWrapper {
  name: string;
  args: { [key: string]: any };
  logIndex: number;

  blockNumber: number;
  blockHash: string;
  nativeEvent: object;
}

export type WrapperListener = (event: EventWrapper) => void;

export enum JobType {
  Interval,
  Resolver,
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

export interface TxGasUpdate {
  action: 'ignore' | 'replace' | 'cancel';
  newMax?: bigint;
  newPriority?: bigint;
}

export interface TxEnvelope {
  jobKey: string;
  tx: UnsignedTransaction;
  executorCallbacks: ExecutorCallbacks;
}

export interface ExecutorCallbacks {
  txEstimationFailed: (error, txData) => void;
  txExecutionFailed: (error, txData) => void;
  txExecutionSuccess: (receipt, txData) => void;
  txNotMinedInBlock: (tx: UnsignedTransaction, txHash: string) => Promise<TxGasUpdate>;
}

export function EmptyTxNotMinedInBlockCallback(_: UnsignedTransaction): Promise<TxGasUpdate> {
  return null;
}

export interface AgentHardcodedConfig {
  deployedAt: number;
  version: string;
  strategy: Strategy;
  subgraph?: string;
}

export interface IRandaoAgent extends IAgent {
  registerJobSlashingTimeout(jobKey: string, timestamp: number, callback: (calldata) => void);
  unregisterJobSlashingTimeout(jobKey: string);
  amINextSlasher(jobKey: string): Promise<boolean>;
  getJobBytes32AndNextBlockSlasherId(jobKey: string): Promise<LensGetJobBytes32AndNextBlockSlasherIdResponse>;
  getPeriod1Duration(): number;
  getPeriod2Duration(): number;
  getJobMinCredits(): bigint;
  selfUnassignFromJob(jobKey: string): void;
  initiateKeeperSlashing(
    jobAddress: string,
    jobId: number,
    jobKey: string,
    jobCalldata: string,
    executorCallbacks: ExecutorCallbacks,
  ): void;
  isTxDataOfJobInitiateSlashing(data, jobAddress, jobId): boolean;
}

export interface IDataSource {
  getType(): string;
  getBlocksDelay(): Promise<{ diff: bigint; nodeBlockNumber: bigint; sourceBlockNumber: bigint }>;
  getRegisteredJobs(_context): Promise<{ data: Map<string, RandaoJob | LightJob>; meta: SourceMetadata }>;
  getOwnersBalances(
    context,
    jobOwnersSet: Set<string>,
  ): Promise<{ data: Map<string, BigNumber>; meta: SourceMetadata }>;
  addLensFieldsToOneJob(newJobs: RandaoJob | LightJob): void;
}

export interface SourceMetadata {
  isSynced: boolean;
  diff: bigint;
  nodeBlockNumber: bigint;
  sourceBlockNumber: bigint;
}

export interface IAgent {
  readonly executorType: ExecutorType;
  readonly address: string;
  readonly keeperId: number;
  readonly subgraphUrl: string;
  readonly dataSourceType: DataSourceType;

  getNetwork(): Network;

  getAddress(): string;

  getKeyAddress(): string;

  getKeeperId(): number;

  getCfg(): number;

  isJobBlacklisted(jobKey: string): boolean;

  getStatusObjectForApi(): object;

  getJobsCount(): { total: number; interval: number; resolver: number };

  // METHODS
  init(network: Network, dataSource: IDataSource): void;

  registerIntervalJobExecution(jobKey: string, timestamp: number, callback: (calldata) => void);

  unregisterIntervalJobExecution(jobKey: string);

  registerResolver(jobKey: string, resolver: Resolver, callback: (calldata) => void);

  unregisterResolver(jobKey: string): void;

  getJobOwnerBalance(address: string): BigNumber;

  sendTxEnvelope(envelope: TxEnvelope);

  exitIfStrictTopic(topic): void;

  addJobToBlacklist(jobKey, errMessage);

  getIsAgentUp(): boolean;

  getBaseFeePerGas(): bigint;

  queryPastEvents(eventName: string, from: number, to: number): Promise<any>;

  buildTx(calldata: string): Promise<UnsignedTransaction>;

  txNotMinedInBlock(tx: UnsignedTransaction, txHash: string): Promise<TxGasUpdate>;

  txExecutionFailed(err, txData): any;

  txEstimationFailed(err, txData): any;

  updateJob(jobObj: AbstractJob): Promise<any>;

  nowS(): number;

  nowMs(): number;
}
