import { AbstractAgent } from './AbstractAgent.js';
import { getPPAgentV2_3_0_RandaoAbi } from '../services/AbiService.js';
import { LightJob } from '../jobs/LightJob.js';

// TODO: use acceptMaxBaseFeeLimit logic in constructor
// if ('accept_max_base_fee_limit' in agentConfig) {
//   this.acceptMaxBaseFeeLimit = !!agentConfig.accept_max_base_fee_limit;
//   if (this.acceptMaxBaseFeeLimit) {
//     this.keeperConfig = this.keeperConfig | FLAG_ACCEPT_MAX_BASE_FEE_LIMIT;
//   }
// } else {
//   this.acceptMaxBaseFeeLimit = false;
// }

export class AgentLight_2_2_0 extends AbstractAgent {
  // jobKey => keeper
  private assignedKeepers: Map<string, number>;

  _isVersionSupported(version): boolean {
    return version.startsWith('2.');
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
