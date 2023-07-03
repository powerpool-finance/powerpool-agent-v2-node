import { ContractWrapper, Executor, TxEnvelope } from '../Types.js';
import { ethers, utils } from 'ethers';
import { nowTimeString } from '../Utils.js';
import { AbstractExecutor } from './AbstractExecutor.js';
export class PGAExecutor extends AbstractExecutor implements Executor {
  private toString(): string {
    return `(network: ${this.networkName})`;
  }

  protected clog(...args: any[]) {
    console.log(`>>> ${nowTimeString()} >>> PGAExecutor${this.toString()}:`, ...args);
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
  public init() {}

  public push(key: string, envelope: TxEnvelope) {
    if (!this.workerSigner) {
      throw this.err('Worker signer misconfigured');
    }
    super.push(key, envelope);
  }

  protected async process(envelope: TxEnvelope) {
    const { tx } = envelope;
    let gasLimitEstimation;
    try {
      gasLimitEstimation = await this.genericProvider.estimateGas(tx);
    } catch (_) {
      const txSimulation = await this.genericProvider.call(tx);
      this.printSolidityCustomError(txSimulation, tx.data as string);

      // This callback could trigger an error which will be caught by unhandledExceptionHandler
      envelope.executorCallbacks.txEstimationFailed(tx.data as string);

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
      tx.nonce = await this.genericProvider.getTransactionCount(this.workerSigner.address);
    }
    tx.gasLimit = gasLimitEstimation.mul(40).div(10);

    this.clog(`📝 Signing tx with calldata=${tx.data} ...`);
    const signedTx = await this.workerSigner.signTransaction(tx);

    const txHash = utils.parseTransaction(signedTx).hash;

    this.clog(`Tx ${txHash}: 📮 Sending to the mempool...`);
    try {
      const sendRes = await this.genericProvider.sendTransaction(signedTx);
      this.clog(`Tx ${txHash}: 🚬 Waiting for the tx to be mined...`);
      const res = await sendRes.wait(1);
      this.clog(
        `Tx ${txHash}: ⛓ Successfully mined in block #${res.blockNumber} with nonce ${tx.nonce}. The queue length is: ${this.queue.length}.`,
      );
    } catch (e) {
      // This callback could trigger an error which will be caught by unhandledExceptionHandler
      envelope.executorCallbacks.txExecutionFailed(tx.data as string);
    }
    // TODO: setTimeout with .call(tx), send cancel tx (eth transfer) with a higher gas price
  }
}
