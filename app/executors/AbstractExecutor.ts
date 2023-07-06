import { ContractWrapper, TxEnvelope } from '../Types.js';
import { BigNumber, ethers } from 'ethers';

export abstract class AbstractExecutor {
  protected networkName: string;
  protected agentContract: ContractWrapper;
  protected genericProvider: ethers.providers.BaseProvider;
  protected workerSigner: ethers.Wallet;

  protected currentTxKey: string;
  protected currentTx: TxEnvelope;
  protected queue: string[];
  protected pendingTxs: Map<string, TxEnvelope>;
  protected queueKeys: object;
  protected queueHandlerLock: boolean;

  protected constructor(agentContract: ContractWrapper) {
    this.agentContract = agentContract;
    this.queue = [];
    this.queueKeys = {};
    this.pendingTxs = new Map();
  }

  protected abstract clog(...args: any[]);
  protected abstract err(...args: any[]);
  protected abstract process(tx: TxEnvelope);

  public getStatusObjectForApi(): object {
    return {
      currentTxKey: this.currentTxKey,
      currentTx: this.currentTx,
      queueHandlerLock: this.queueHandlerLock,
      queue: this.queue,
      queueKeys: this.queueKeys,
      pendingTxs: Object.fromEntries(Array.from(this.pendingTxs)),
    };
  }

  protected printSolidityCustomError(bytes: string, txCalldata: string): void {
    if (bytes.startsWith('0x4e487b71')) {
      const hexCode = ethers.utils.defaultAbiCoder.decode(['uint256'], `0x${bytes.substring(10)}`);
      this
        .clog(`⛔️ Ignoring a tx with a failed estimation, calldata=${txCalldata}. The reason is "Panic(${hexCode})". This error can happen in the following cases:
- Can't perform native token transfer within one of internal txs due insufficient funds;
- The calling method doesn't exist;

Check out here for more details on Panic(uint256) errors: https://docs.soliditylang.org/en/v0.8.19/control-structures.html#panic-via-assert-and-error-via-require.
`);
    } else if (bytes.startsWith('0x08c379a0')) {
      const msg = ethers.utils.defaultAbiCoder.decode(['string'], `0x${bytes.substring(10)}`);
      this.clog(`⛔️ Ignoring a tx with a failed estimation: (message="${msg}",calldata=${txCalldata})`);
    } else {
      try {
        const decoded = this.agentContract.decodeError(bytes);
        for (const [key, value] of Object.entries(decoded.args)) {
          if (BigNumber.isBigNumber(value)) {
            decoded.args[key] = value.toNumber();
          }
        }
        this.clog(
          `⛔️ Ignoring tx estimation reverted with '${decoded.name}' error and the following error arguments:`,
          decoded.args,
          `(calldata=${txCalldata})`,
        );
      } catch (_) {
        this.clog(`⛔️ Ignoring tx estimation failed with unknown error: (call=${txCalldata},response=${bytes})`);
      }
    }
  }

  protected async processIfRequired() {
    if (this.queueHandlerLock) {
      this.clog('Queue handler is already launched');
      return;
    }

    this.queueLock();

    while (this.queue.length > 0) {
      this.currentTxKey = this.queue.shift();
      const tx = this.pendingTxs.get(this.currentTxKey);
      this.currentTx = tx;
      this.pendingTxs.delete(this.currentTxKey);
      await this.process(tx);
      this.currentTxKey = null;
      this.currentTx = null;
    }

    this.unlockQueue();
  }

  public push(key: string, envelope: TxEnvelope) {
    if (!this.genericProvider) {
      throw this.err('Generic Provider misconfigured');
    }
    if (!this.workerSigner) {
      throw this.err('Worker signer misconfigured');
    }
    if (!this.pendingTxs.has(key)) {
      this.queue.push(key);
    }
    this.pendingTxs.set(key, envelope);
    this.clog(`📥 Enqueueing ${JSON.stringify(envelope.tx)}. The total queue length is now ${this.queue.length}...`);

    // WARNING: async func call
    this.processIfRequired();
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
