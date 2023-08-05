import { ContractWrapper, TxEnvelope } from '../Types.js';
import { ethers } from 'ethers';

export abstract class AbstractExecutor {
  protected networkName: string;
  protected agentContract: ContractWrapper;
  protected genericProvider: ethers.providers.BaseProvider;
  protected workerSigner: ethers.Wallet;

  // The currently executing tx key
  protected currentTxKey: string;
  // The currently executing tx envelope which is not stored in queueTxs anymore
  protected currentTxEnvelope: TxEnvelope;
  // An ordered queue of tx hashes.
  protected queue: string[];
  // Tx hash => TxEnvelope. All the queued txs except the current
  protected queueTxs: Map<string, TxEnvelope>;
  protected queueHandlerLock: boolean;

  protected constructor(agentContract: ContractWrapper) {
    this.agentContract = agentContract;
    this.queue = [];
    this.queueTxs = new Map();
  }

  protected abstract clog(...args: any[]);
  protected abstract err(...args: any[]);
  protected abstract process(tx: TxEnvelope);

  public getStatusObjectForApi(): any {
    return {
      currentTxKey: this.currentTxKey,
      currentTxEnvelope: this.currentTxEnvelope,
      queueHandlerLock: this.queueHandlerLock,
      queue: this.queue,
      queueTxs: Object.fromEntries(Array.from(this.queueTxs)),
    };
  }

  protected async processIfRequired() {
    if (this.queueHandlerLock) {
      this.clog('Queue handler is already launched');
      return;
    }

    this.queueLock();

    while (this.queue.length > 0) {
      this.currentTxKey = this.queue.shift();
      const tx = this.queueTxs.get(this.currentTxKey);
      this.currentTxEnvelope = tx;
      this.queueTxs.delete(this.currentTxKey);

      try {
        await this.process(tx);
      } catch (e) {
        this.clog('Error:', e);
      }

      this.currentTxKey = null;
      this.currentTxEnvelope = null;
    }

    this.unlockQueue();
  }

  // NOTICE: Use this function as a sync one unless you really want to wait for the tx be mined.
  public async push(key: string, envelope: TxEnvelope) {
    if (!this.genericProvider) {
      throw this.err('Generic Provider misconfigured');
    }
    if (!this.workerSigner) {
      throw this.err('Worker signer misconfigured');
    }
    if (!this.queueTxs.has(key)) {
      this.queue.push(key);
    }
    if (!envelope.executorCallbacks) {
      throw this.err('Missing envelope.executorCallbacks');
    }
    if (
      !envelope.executorCallbacks.txEstimationFailed ||
      typeof envelope.executorCallbacks.txEstimationFailed !== 'function'
    ) {
      throw this.err('Missing txEstimationFailed callback');
    }
    if (
      !envelope.executorCallbacks.txExecutionFailed ||
      typeof envelope.executorCallbacks.txExecutionFailed !== 'function'
    ) {
      throw this.err('Missing txExecutionFailed callback');
    }
    if (
      !envelope.executorCallbacks.txNotMinedInBlock ||
      typeof envelope.executorCallbacks.txNotMinedInBlock !== 'function'
    ) {
      throw this.err('Missing txNotMinedInBlock callback');
    }
    this.queueTxs.set(key, envelope);
    this.clog(`📥 Enqueueing ${JSON.stringify(envelope.tx)}. The total queue length is now ${this.queue.length}...`);

    // WARNING: async func call
    return this.processIfRequired();
  }

  protected queueLock() {
    if (this.queueHandlerLock) {
      throw this.err('The queue is already locked');
    }
    this.clog('🔐 Locking queue...');
    this.queueHandlerLock = true;
  }

  protected unlockQueue() {
    if (!this.queueHandlerLock) {
      throw this.err('The queue is NOT locked');
    }
    this.clog('🔓 Unlocking queue...');
    this.queueHandlerLock = false;
  }
}
