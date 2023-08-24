import { ContractWrapper, Executor, TxEnvelope } from '../Types.js';
import { ethers, utils } from 'ethers';
import { AbstractExecutor } from './AbstractExecutor.js';
import { printSolidityCustomError } from './ExecutorUtils.js';
import logger from '../services/Logger.js';

export class PGAExecutor extends AbstractExecutor implements Executor {
  private toString(): string {
    return `(network: ${this.networkName}, signer: ${this.workerSigner.address})`;
  }

  protected clog(level: string, ...args: any[]) {
    logger.log(level, `PGAExecutor${this.toString()}: ${args.join(' ')}`);
  }

  protected err(...args: any[]): Error {
    return new Error(`PGAExecutorError${this.toString()}: ${args.join(' ')}`);
  }

  constructor(
    networkName: string,
    genericProvider: ethers.providers.BaseProvider,
    workerSigner: ethers.Wallet,
    agentContract: ContractWrapper,
  ) {
    super(agentContract);

    this.networkName = networkName;
    this.workerSigner = workerSigner;
    this.genericProvider = genericProvider;
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  public init() {
    if (!this.workerSigner) {
      throw this.err('Worker signer misconfigured');
    }
  }

  protected async process(envelope: TxEnvelope) {
    const { tx } = envelope;
    let gasLimitEstimation;
    try {
      gasLimitEstimation = await this.genericProvider.estimateGas(tx);
    } catch (e) {
      let txSimulation;
      try {
        txSimulation = await this.genericProvider.call(tx);
      } catch (e) {
        envelope.executorCallbacks.txEstimationFailed(e, tx.data as string);
        return;
      }
      printSolidityCustomError(this.clog.bind(this), this.agentContract.decodeError, txSimulation, tx.data as string);

      envelope.executorCallbacks.txEstimationFailed(e, tx.data as string);

      // force execute (only for debug)
      if (true) {
        // tx.gasLimit = 700_000;
        // const signedTx = await this.workerSigner.signTransaction(tx);
        // console.log(utils.parseTransaction(signedTx));
        // const res = await this.genericProvider.sendTransaction(signedTx);
        // console.log('Waiting for tx to be mined...');
        // const res2 = await res.wait(1);
        // console.log({res2});
      }
      return;
    } finally {
      tx.nonce = tx.nonce || (await this.genericProvider.getTransactionCount(this.workerSigner.address));
    }
    if (!gasLimitEstimation) {
      throw this.err(`gasLimitEstimation is not set: ${gasLimitEstimation}`);
    }
    tx.gasLimit = gasLimitEstimation.mul(40).div(10);

    this.clog('debug', `📝 Signing tx with calldata=${tx.data} ...`);
    const signedTx = await this.workerSigner.signTransaction(tx);

    const txHash = utils.parseTransaction(signedTx).hash;

    this.clog('debug', `Tx ${txHash}: 📮 Sending to the mempool...`);
    try {
      const sendRes = await this.genericProvider.sendTransaction(signedTx);
      this.clog('debug', `Tx ${txHash}: 🚬 Waiting for the tx to be mined...`);
      const res = await sendRes.wait(1);
      this.clog(
        'debug',
        `Tx ${txHash}: ⛓ Successfully mined in block #${res.blockNumber} with nonce ${tx.nonce}. The queue length is: ${this.queue.length}.`,
      );
    } catch (e) {
      envelope.executorCallbacks.txExecutionFailed(e, tx.data as string);
    }
    setTimeout(async () => {
      const { action } = await envelope.executorCallbacks.txNotMinedInBlock(tx);
      if (action === 'ignore') {
        return;
      }
      // TODO: resend or cancel tx (eth transfer) with a higher gas price (newMax, newPriority)
    }, 1000 * 60);
  }
}
