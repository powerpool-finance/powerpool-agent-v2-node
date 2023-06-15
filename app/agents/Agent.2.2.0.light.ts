import { AbstractAgent } from './AbstractAgent.js';
import { getPPAgentV2_3_0_RandaoAbi } from '../services/AbiService.js';
import { LightJob } from '../jobs/LightJob.js';

export class AgentLight_2_2_0 extends AbstractAgent {
  // jobKey => keeper
  private assignedKeepers: Map<string, number>;

  // jobKeys

  _getSupportedAgentVersions(): string[] {
    return ['2.2.0'];
  }

  async _beforeInit() {
    const ppAgentV2Abi = getPPAgentV2_3_0_RandaoAbi();
    this.contract = this.network.getContractWrapperFactory().build(this.address, ppAgentV2Abi);
  }

  _buildNewJob(event): LightJob {
    return new LightJob(event, this);
  }

  public registerIntervalJobSlashing(jobKey: string, timestamp: number, callback: (calldata) => void) {
    this.network.registerTimeout(`${this.address}/${jobKey}/slashing`, timestamp, callback);
  }

  public unregisterIntervalJobSlashing(jobKey: string) {
    this.network.unregisterTimeout(`${this.address}/${jobKey}/slashing`);
  }

  async _tormSlashCurrent() {
    // TODO: walk thorugh jobs, try slash execute
  }

  _afterInitializeListeners(/*blockNumber: number*/) {
    this.contract.on('KeeperJobLock', () => {
      // const {jobKey, resolverAddress, resolverCalldata} = event.args;
      //
      // this.clog(`'SetJobResolver' event: (block=${event.blockNumber
      // },jobKey=${jobKey
      // },resolverAddress=${resolverAddress
      // },useJobOwnerCredits_=${resolverCalldata})`);
      //
      // const job = this.jobs.get(jobKey);
      // job.applyResolver(resolverAddress, resolverCalldata);
      // job.watch();
    });

    this.contract.on('KeeperJobUnlock', () => {});

    this.contract.on('JobKeeperUnassigned', () => {});
  }
}
