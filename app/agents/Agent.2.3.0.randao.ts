import { AbstractAgent } from './AbstractAgent.js';
import { getPPAgentV2_3_0_RandaoAbi } from '../services/AbiService.js';
import {
  EmptyTxNotMinedInBlockCallback,
  ExecutorCallbacks,
  IRandaoAgent,
  LensGetJobBytes32AndNextBlockSlasherIdResponse,
} from '../Types.js';
import { RandaoJob } from '../jobs/RandaoJob.js';
import { BI_10E15 } from '../Constants.js';
import { AbstractJob } from '../jobs/AbstractJob.js';

export class AgentRandao_2_3_0 extends AbstractAgent implements IRandaoAgent {
  private slashingEpochBlocks: number;
  private period1: number;
  private period2: number;
  private slashingFeeFixedCVP: number;
  private slashingFeeBps: number;

  private jobMinCreditsFinney: bigint;

  _getSupportedAgentVersions(): string[] {
    return ['2.3.0'];
  }
  async _beforeInit() {
    const ppAgentV2Abi = getPPAgentV2_3_0_RandaoAbi();
    this.contract = this.network.getContractWrapperFactory().build(this.address, ppAgentV2Abi);
  }

  protected async _beforeResyncAllJobs() {
    const rdConfig = await this.contract.ethCall('getRdConfig', []);
    this.slashingEpochBlocks = rdConfig.slashingEpochBlocks;
    this.period1 = rdConfig.period1;
    this.period2 = rdConfig.period2;
    this.slashingFeeFixedCVP = rdConfig.slashingFeeFixedCVP;
    this.slashingFeeBps = rdConfig.slashingFeeBps;
    this.jobMinCreditsFinney = BigInt(rdConfig.jobMinCreditsFinney);
  }

  protected _afterExecuteEvent(job: AbstractJob) {
    (job as RandaoJob).applyClearResolverTimeouts();
  }

  _buildNewJob(event): RandaoJob {
    return new RandaoJob(event, this);
  }

  public registerJobSlashingTimeout(jobKey: string, timestamp: number, callback: (calldata) => void) {
    this.network.registerTimeout(`${this.address}/${jobKey}/slashing`, timestamp, callback);
  }

  public async amINextSlasher(jobKey: string): Promise<boolean> {
    const {nextBlockSlasherId} = await this.getNetwork().getJobBytes32AndNextBlockSlasherId(this.address, jobKey)

    return nextBlockSlasherId === this.getKeeperId();
  }

  public async getJobBytes32AndNextBlockSlasherId(jobKey: string): Promise<LensGetJobBytes32AndNextBlockSlasherIdResponse> {
    return this.getNetwork().getJobBytes32AndNextBlockSlasherId(this.address, jobKey)
  }

  public unregisterJobSlashingTimeout(jobKey: string) {
    this.network.unregisterTimeout(`${this.address}/${jobKey}/slashing`);
  }

  public getPeriod1Duration(): number {
    if (typeof this.period1 !== 'number') {
      console.log({period1: this.period1});
      throw this.err('period1 is not a number')
    }

    return this.period1;
  }

  public getPeriod2Duration(): number {
    if (typeof this.period2 !== 'number') {
      throw this.err('period2 is not a number')
    }

    return this.period2;
  }

  public getJobMinCredits(): bigint {
    if (typeof this.jobMinCreditsFinney !== 'bigint') {
      throw this.err('period2 is not a bigint')
    }

    return this.jobMinCreditsFinney * BI_10E15;
  }

  async selfUnassignFromJob(jobKey: string) {
    this.clog('Executing Self-Unassign');
    const calldata = this.contract.encodeABI('releaseJob', [jobKey]);
    const tx = {
      to: this.getAddress(),

      data: calldata,

      // Typed-Transaction features
      type: 2,

      // EIP-1559; Type 2
      maxFeePerGas: (this.network.getBaseFee() * 2n).toString()
    };
    await this.populateTxExtraFields(tx);
    const txEstimationFailed = (error): void => {
      this.clog('Self-Unassign transaction estimation failed:', error);
    };
    const txExecutionFailed = (error): void => {
      this.clog('Self-Unassign reverted (while the estimation was ok):', error);
    };
    const envelope = {
      executorCallbacks: {
        txEstimationFailed,
        txExecutionFailed,
        txNotMinedInBlock: EmptyTxNotMinedInBlockCallback,
      },
      jobKey,
      tx,
      creditsAvailable: BigInt(0),
      fixedCompensation: BigInt(0),
      ppmCompensation: 0,
      minTimestamp: 0
    };
    await this._sendNonExecuteTransaction(envelope);
  }

  async initiateSlashing(jobAddress: string, jobId: number, jobKey: string, executorCallbacks: ExecutorCallbacks) {
    // jobAddress, jobId, myKeeperId, useResolver, jobCalldata
    const calldata = this.contract.encodeABI('initiateSlashing',
      [jobAddress, jobId, this.getKeeperId(), true, '0x']
    );
    const tx = {
      to: this.getAddress(),

      data: calldata,

      // Typed-Transaction features
      type: 2,

      // EIP-1559; Type 2
      maxFeePerGas: (this.network.getBaseFee() * 2n).toString()
    };
    await this.populateTxExtraFields(tx);
    const envelope = {
      executorCallbacks,
      jobKey,
      tx,
      creditsAvailable: BigInt(0),
      fixedCompensation: BigInt(0),
      ppmCompensation: 0,
      minTimestamp: 0
    };
    await this._sendNonExecuteTransaction(envelope);
  }

  _afterInitializeListeners() {
    this.contract.on('JobKeeperChanged', async (event) => {
      const {keeperFrom, keeperTo, jobKey} = event.args;

      this.clog(`'JobKeeperChanged' event 🔈: (block=${event.blockNumber
      },jobKey=${jobKey
      },keeperFrom=${keeperFrom
      },keeperTo=${keeperTo})`);

      const job = this.jobs.get(jobKey) as RandaoJob;
      const shouldUpdateBinJob = job.applyKeeperAssigned(parseInt(keeperTo));
      if (shouldUpdateBinJob) {
        const binJob = await this.network.getJobRawBytes32(this.address, jobKey);
        this.clog('Updating binJob to', binJob);
        job.applyBinJobData(binJob);
      }
      job.watch();
    });

    this.contract.on('SetRdConfig', (event) => {
      this.clog(`'SetRdConfig' event 🔈: (block=${event.blockNumber}. Restarting all the jobs...`);

      this.startAllJobs();
    });

    this.contract.on('InitiateSlashing', (event) => {
      const {jobKey, jobSlashingPossibleAfter, slasherKeeperId, useResolver} = event.args;

      this.clog(`'InitiateSlashing' event 🔈: (block=${event.blockNumber
      },jobKey=${jobKey
      },jobSlashingPossibleAfter=${jobSlashingPossibleAfter
      },slasherKeeperId=${slasherKeeperId
      },useResolver=${useResolver})`);

      const job = this.jobs.get(jobKey) as RandaoJob;
      job.applyInitiateSlashing(jobSlashingPossibleAfter, slasherKeeperId);
    });

    this.contract.on('SlashIntervalJob', (event) => {
      const {jobKey, expectedKeeperId, actualKeeperId, fixedSlashAmount, dynamicSlashAmount,
        slashAmountMissing} = event.args;

      this.clog(`'SlashIntervalJob' event 🔈: (block=${event.blockNumber
      },jobKey=${jobKey
      },expectedKeeperId=${expectedKeeperId
      },actualKeeperId=${actualKeeperId
      },fixedSlashAmount=${fixedSlashAmount
      },dynamicSlashAmount=${dynamicSlashAmount
      },slashAmountMissing=${slashAmountMissing})`);

      const job = this.jobs.get(jobKey) as RandaoJob;
      // WARNING: incorrect name
      job.applySlashIntervalJob();
    });
  }
}
