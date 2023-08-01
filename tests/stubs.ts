import sinon from 'sinon';
import { Network } from '../app/Network';
import { IAgent } from '../app/Types';
// @ts-ignore
import EventEmitter from 'events';
import { BigNumber } from 'ethers';
import { KEEPER_WORKER_ADDRESS } from './constants.js';

export function stubNetwork(network: Network) {
  sinon.stub(network, 'initProvider').callsFake(function () {
    // JUST IGNORE
  });
  sinon.stub(network, 'queryLatestBlock').callsFake(function () {
    return {
      baseFeePerGas: 2,
      number: 123,
      timestamp: 456,
    };
  });
  sinon.stub(network, 'queryNetworkId').callsFake(function () {
    return 42;
  });
  sinon.stub(network, 'queryLensJobs').callsFake(function () {
    return [];
  });
  sinon.stub(network, 'queryLensOwnerBalances').callsFake(function () {
    return [];
  });
}

export function stubAgent(agent: IAgent) {
  sinon.stub(agent, 'on').callsFake(function (eventName: string, callback: () => void) {
    if (!this.stubEventEmitter) {
      this.stubEventEmitter = new EventEmitter();
    }
    this.stubEventEmitter.on(eventName, callback);
  });
  sinon.stub(agent, '_beforeInit').callsFake(function () {
    this.contract = 'contractStub';
  });
  sinon.stub(agent, 'initKeeperWorkerKey').callsFake(function () {
    this.workerSigner = {
      address: KEEPER_WORKER_ADDRESS,
    };
  });
  sinon.stub(agent, 'encodeABI').callsFake(function () {
    return 'Stub:encodedABI';
  });
  sinon.stub(agent, 'queryContractVersion').callsFake(function () {
    return '2.3.0';
  });
  sinon.stub(agent, 'queryKeeperId').callsFake(function () {
    return '3';
  });
  sinon.stub(agent, 'queryKeeperDetails').callsFake(function () {
    return {
      currentStake: BigNumber.from('0x3635c9adc5dea00000'),
      isActive: true,
      worker: KEEPER_WORKER_ADDRESS,
    };
  });
  sinon.stub(agent, 'queryAgentConfig').callsFake(function () {
    return {
      minKeeperCvp_: BigNumber.from('0x3635c9adc5dea00000'),
      pendingWithdrawalTimeoutSeconds_: BigNumber.from('0x0e10'),
      feeTotal_: BigNumber.from('0x00'),
      feePpm_: BigNumber.from('0x00'),
      lastKeeperId_: BigNumber.from('0x05'),
    };
  });
  sinon.stub(agent, 'queryAgentRdConfig').callsFake(function () {
    return {
      slashingEpochBlocks: 10,
      period1: 90,
      period2: 120,
      slashingFeeFixedCVP: 50,
      slashingFeeBps: 300,
      jobMinCreditsFinney: 10,
      agentMaxCvpStake: 5000,
      jobCompensationMultiplierBps: 11000,
      stakeDivisor: 50000000,
      keeperActivationTimeoutHours: 1,
    };
  });
  sinon.stub(agent, 'queryPastEvents').callsFake(function () {
    return [];
  });
}
