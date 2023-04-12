import { AbstractAgent } from './AbstractAgent.js';
import { getPPAgentV2_3_0_RandaoAbi } from '../services/AbiService.js';
import { IRandaoAgent } from '../Types';
import { RandaoJob } from '../jobs/RandaoJob.js';

export class AgentRandao_2_3_0 extends AbstractAgent implements IRandaoAgent {
  // jobKeys
  private myJobs: Set<string>
  private slashingEpochBlocks: number;
  private period1: number;
  private period2: number;
  private slashingFeeFixedCVP: number;
  private slashingFeeBps: number;

  private jobMinCredits: number;

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
    this.jobMinCredits = rdConfig.jobMinCredits;
  }

  _buildNewJob(event): RandaoJob {
    return new RandaoJob(event, this);
  }

  public registerIntervalJobSlashing(jobKey: string, timestamp: number, callback: (calldata) => void) {
    this.network.registerTimeout(`${this.address}/${jobKey}/slashing`, timestamp, callback);
  }

  public unregisterIntervalJobSlashing(jobKey: string) {
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

  _afterInitializeListeners() {
    this.contract.on('JobKeeperChanged', (event) => {
      const {keeperFrom, keeperTo, jobKey} = event.args;

      this.clog(`'JobKeeperChanged' event 🔈: (block=${event.blockNumber
      },jobKey=${jobKey
      },keeperFrom=${keeperFrom
      },keeperTo=${keeperTo})`);

      const job = this.jobs.get(jobKey) as RandaoJob;
      job.applyKeeperAssigned(parseInt(keeperTo));
      job.watch();
    });
  }
}
