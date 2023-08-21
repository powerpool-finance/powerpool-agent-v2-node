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

  protected async processCallback(envelope: TxEnvelope, callback, count = 1) {
    const { tx } = envelope;
    let gasLimitEstimation;
    try {
      gasLimitEstimation = await this.genericProvider.estimateGas(prepareTx(tx));
    } catch (e) {
      let txSimulation;
      try {
        txSimulation = await this.genericProvider.call(prepareTx(tx));
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
      return callback(null);
    } finally {
      tx.nonce = tx.nonce || (await this.genericProvider.getTransactionCount(this.workerSigner.address));
    }
    if (!gasLimitEstimation) {
      return callback(null, this.err(`gasLimitEstimation is not set: ${gasLimitEstimation}`));
    }
    tx.gasLimit = gasLimitEstimation.mul(40).div(10);

    this.clog('debug', `📝 Signing tx with calldata=${tx.data} ...`);
    const signedTx = await this.workerSigner.signTransaction(prepareTx(tx));

    const txHash = utils.parseTransaction(signedTx).hash;
    let res;

    const eConfig = this.executorConfig || {};
    if (eConfig.tx_not_mined_blocks) {
      waitForResendTransaction.call(this);
    }

    this.clog('debug', `Tx ${txHash}: 📮 Sending to the mempool...`);
    try {
      const sendRes = await this.genericProvider.sendTransaction(signedTx);
      this.clog('debug', `Tx ${txHash}: 🚬 Waiting for the tx to be mined...`);
      res = await sendRes.wait(1);
      callback(res);
      this.clog(
        'debug',
        `Tx ${txHash}: ⛓ Successfully mined in block #${res.blockNumber} with nonce ${tx.nonce}. The queue length is: ${this.queue.length}.`,
      );
    } catch (e) {
      // This callback could trigger an error which will be caught by unhandledExceptionHandler
      envelope.executorCallbacks.txExecutionFailed(e, tx.data as string);
      callback(null);
    }

    function waitForResendTransaction() {
      const resend = async () => {
        if (res) {
          return;
        }
        if (count >= eConfig.tx_resend_max_attempts) {
          envelope.executorCallbacks.txExecutionFailed(
            this.err('Tx not mined, max attempts: ' + txHash),
            tx.data as string,
          );
          return callback(null);
        }
        const { action, newMax, newPriority } = await envelope.executorCallbacks.txNotMinedInBlock(tx, txHash);
        if (action === 'ignore') {
          envelope.executorCallbacks.txExecutionFailed(this.err('Tx not mined, ignore: ' + txHash), tx.data as string);
          return callback(null);
        }
        if (newMax + newPriority > BigInt(eConfig.tx_resend_max_gas_price_gwei) * 1000000000n) {
          envelope.executorCallbacks.txExecutionFailed(
            this.err('Tx not mined, max gas price: ' + txHash),
            tx.data as string,
          );
          return callback(null);
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
      };

      let blocksPast = 0;
      const onNewBlock = () => {
        blocksPast++;
        if (blocksPast >= eConfig.tx_not_mined_blocks) {
          this.genericProvider.off('block', onNewBlock);
          resend();
        }
      };
      this.genericProvider.on('block', onNewBlock);
    }
  }
}
