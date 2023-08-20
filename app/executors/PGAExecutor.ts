import { ContractWrapper, Executor, ExecutorConfig, TxEnvelope } from '../Types.js';
import { ethers, utils } from 'ethers';
import { AbstractExecutor } from './AbstractExecutor.js';
import { printSolidityCustomError } from './ExecutorUtils.js';
import logger from '../services/Logger.js';
import { prepareTx } from '../Utils.js';

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
    executorConfig: ExecutorConfig,
  ) {
    super(agentContract);

    this.networkName = networkName;
    this.workerSigner = workerSigner;
    this.genericProvider = genericProvider;
    this.executorConfig = executorConfig;
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  public init() {
    if (!this.workerSigner) {
      throw this.err('Worker signer misconfigured');
    }
  }

  protected async process(envelope: TxEnvelope) {
    return new Promise((resolve, reject) =>
      this.processCallback(envelope, (res, err) => (err ? reject(err) : resolve(res))),
    );
  }

  protected async processCallback(envelope: TxEnvelope, callback, count = 0) {
    const { tx } = envelope;
    console.log('process', tx);
    let gasLimitEstimation;
    try {
      gasLimitEstimation = await this.genericProvider.estimateGas(prepareTx(tx));
      console.log('gasLimitEstimation', gasLimitEstimation);
    } catch (e) {
      console.log('estimateGas e', e);
      let txSimulation;
      try {
        txSimulation = await this.genericProvider.call(prepareTx(tx));
        console.log('txSimulation', txSimulation);
      } catch (e) {
        envelope.executorCallbacks.txEstimationFailed(e, tx.data as string);
        return;
      }
      printSolidityCustomError(this.clog.bind(this), this.agentContract.decodeError, txSimulation, tx.data as string);

      // This callback could trigger an error which will be caught by unhandledExceptionHandler
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
    console.log('tx', prepareTx(tx));

    this.clog('debug', `📝 Signing tx with calldata=${tx.data} ...`);
    const signedTx = await this.workerSigner.signTransaction(prepareTx(tx));

    const txHash = utils.parseTransaction(signedTx).hash;

    const eConfig = this.executorConfig || {};
    if (eConfig.tx_not_mined_timeout) {
      setTimeout(async () => {
        if (count > eConfig.tx_resend_max_attempts) {
          return callback(null, new Error('Tx not mined, max attempts: ' + txHash));
        }
        const { action, newMax, newPriority } = await envelope.executorCallbacks.txNotMinedInBlock(tx, txHash);
        console.log('action', action);
        if (action === 'ignore') {
          return callback(null, new Error('Tx not mined, ignore: ' + txHash));
        }
        if (newMax + newPriority > BigInt(eConfig.tx_resend_max_gas_price_gwei) * 1000000000n) {
          return callback(null, new Error('Tx not mined, max gas price: ' + txHash));
        }
        envelope.tx.maxFeePerGas = newMax;
        envelope.tx.maxPriorityFeePerGas = newPriority;
        if (action === 'cancel') {
          envelope.tx.to = this.workerSigner.address;
          envelope.tx.data = '0x';
        }
        if (action === 'replace' || action === 'cancel') {
          return this.processCallback(envelope, callback, ++count);
        }
      }, eConfig.tx_not_mined_timeout * 1000);
    }

    this.clog('debug', `Tx ${txHash}: 📮 Sending to the mempool...`);
    try {
      const sendRes = await this.genericProvider.sendTransaction(signedTx);
      this.clog('debug', `Tx ${txHash}: 🚬 Waiting for the tx to be mined...`);
      const res = await sendRes.wait(1);
      callback(res);
      this.clog(
        'debug',
        `Tx ${txHash}: ⛓ Successfully mined in block #${res.blockNumber} with nonce ${tx.nonce}. The queue length is: ${this.queue.length}.`,
      );
    } catch (e) {
      // This callback could trigger an error which will be caught by unhandledExceptionHandler
      envelope.executorCallbacks.txExecutionFailed(e, tx.data as string);
    }
  }
}
