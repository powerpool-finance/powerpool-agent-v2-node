import { ContractWrapper, Executor, ExecutorConfig, TxEnvelope, UnsignedTransaction } from '../Types.js';
import { ethers, utils } from 'ethers';
import { AbstractExecutor } from './AbstractExecutor.js';
import { printSolidityCustomError } from './ExecutorUtils.js';
import logger from '../services/Logger.js';
import { prepareTx, weiValueToGwei, jsonStringify } from '../Utils.js';
import axios from 'axios';
import { Network } from '../Network';

export class PGAExecutor extends AbstractExecutor implements Executor {
  private toString(): string {
    return `(network: ${this.network.getName()}, signer: ${this.workerSigner.address})`;
  }

  protected clog(level: string, ...args: any[]) {
    logger.log(level, `PGAExecutor${this.toString()}: ${args.join(' ')}`);
  }

  protected err(...args: any[]): Error {
    return new Error(`PGAExecutorError${this.toString()}: ${args.join(' ')}`);
  }

  constructor(
    network: Network,
    workerSigner: ethers.Wallet,
    agentContract: ContractWrapper,
    executorConfig: ExecutorConfig,
  ) {
    super(agentContract);

    this.network = network;
    this.genericProvider = network.getProvider();
    this.workerSigner = workerSigner;
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
      this.processCallback(envelope, (err, res) => (err ? reject(err) : resolve(res))),
    );
  }

  protected async processCallback(envelope: TxEnvelope, callback, resendCount = 1, prevTxHash = null) {
    const { tx } = envelope;

    this.clog('debug', `📩 Starting to process tx with calldata=${tx.data} ...`);
    let gasLimitEstimation;
    try {
      gasLimitEstimation = await this.genericProvider.estimateGas(prepareTx(tx));
    } catch (e) {
      let txSimulation;
      try {
        txSimulation = await this.genericProvider.call(prepareTx(tx));
      } catch (e) {
        envelope.executorCallbacks.txEstimationFailed(e, tx.data as string);
        return callback(this.err(`gasLimitEstimation failed with error: ${e.message}`));
      }
      printSolidityCustomError(
        this.clog.bind(this),
        this.agentContract.decodeError.bind(this.agentContract),
        txSimulation,
        tx.data as string,
      );

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
      return callback();
    } finally {
      tx.nonce = tx.nonce || (await this.genericProvider.getTransactionCount(this.workerSigner.address));
    }
    if (!gasLimitEstimation) {
      return callback(this.err(`gasLimitEstimation is not set: ${gasLimitEstimation}`));
    }
    tx.gasLimit = gasLimitEstimation.mul(40).div(10);

    this.clog('debug', `📝 Signing tx with calldata=${tx.data} ...`);
    const signedTx = await this.workerSigner.signTransaction(prepareTx(tx));

    const txHash = utils.parseTransaction(signedTx).hash;
    let res;

    const eConfig = this.executorConfig || {};
    if (eConfig.tx_resend_or_drop_after_blocks) {
      waitForResendTransaction.call(this);
    }

    this.clog('debug', `Tx ${txHash}: 📮 Sending to the mempool...`);
    try {
      this.sendTransactionLog(tx, txHash, resendCount, 'sign', prevTxHash).catch(() => {});
      const sendRes = await this.genericProvider.sendTransaction(signedTx);
      this.clog('debug', `Tx ${txHash}: 🚬 Waiting for the tx to be mined...`);
      res = await sendRes.wait(1);
      envelope.executorCallbacks.txExecutionSuccess(res, tx.data as string);
      this.sendTransactionLog(tx, txHash, resendCount, 'confirm', prevTxHash).catch(() => {});
      callback(null, res);
      this.clog(
        'debug',
        `Tx ${txHash}: ⛓ Successfully mined in block #${res.blockNumber} with nonce ${tx.nonce}. The queue length is: ${this.queue.length}.`,
      );
    } catch (e) {
      envelope.executorCallbacks.txExecutionFailed(e, tx.data as string);
      callback();
    }

    function waitForResendTransaction() {
      const resend = async () => {
        if (res) {
          return;
        }
        if (resendCount >= eConfig.tx_resend_max_attempts) {
          envelope.executorCallbacks.txExecutionFailed(
            this.err('Tx not mined, max attempts: ' + txHash),
            tx.data as string,
          );
          return callback();
        }
        const { action, newMax, newPriority } = await envelope.executorCallbacks.txNotMinedInBlock(tx, txHash);
        if (action === 'ignore') {
          // envelope.executorCallbacks.txExecutionFailed(this.err('Tx not mined, ignore: ' + txHash), tx.data as string);
          return callback();
        }
        if (newMax > BigInt(eConfig.tx_resend_max_gas_price_gwei) * 1000000000n) {
          envelope.executorCallbacks.txExecutionFailed(
            this.err('Tx not mined, max gas price: ' + txHash),
            tx.data as string,
          );
          return callback();
        }
        envelope.tx.maxFeePerGas = newMax;
        envelope.tx.maxPriorityFeePerGas = newPriority;
        if (action === 'cancel') {
          envelope.tx.to = this.workerSigner.address;
          envelope.tx.data = '0x';
        }
        if (action === 'replace' || action === 'cancel') {
          return this.processCallback(envelope, callback, ++resendCount, txHash);
        }
      };

      let blocksPast = 0;
      const onNewBlock = () => {
        blocksPast++;
        if (blocksPast >= eConfig.tx_resend_or_drop_after_blocks) {
          this.genericProvider.off('block', onNewBlock);
          resend();
        }
      };
      this.genericProvider.on('block', onNewBlock);
    }
  }

  protected async sendTransactionLog(
    transaction: UnsignedTransaction,
    txHash,
    resendCount,
    action = 'sign',
    prevTxHash = null,
  ) {
    const networkStatusObj = this.network.getStatusObjectForApi();
    const agent = networkStatusObj['agents'].filter(a => a.address.toLowerCase() === transaction.to.toLowerCase())[0];
    const types = {
      Mail: [
        { name: 'transactionJson', type: 'string' },
        { name: 'metadataJson', type: 'string' },
      ],
    };
    let timeData = {};
    if (action === 'sign') {
      timeData = {
        signedAt: new Date(),
        signedAtBlock: parseInt(this.network.getLatestBlockNumber().toString()),
        signedAtBlockDateTime: new Date(parseInt(this.network.getLatestBlockTimestamp().toString()) * 1000),
      };
    } else if (action === 'confirm') {
      timeData = {
        confirmedAt: new Date(),
        confirmedAtBlock: parseInt(this.network.getLatestBlockNumber().toString()),
        confirmedAtBlockDateTime: new Date(parseInt(this.network.getLatestBlockTimestamp().toString()) * 1000),
      };
    }
    const chainId = networkStatusObj['chainId'];
    const txData = {
      transactionJson: jsonStringify(prepareTx(transaction)),
      metadataJson: jsonStringify({
        appEnv: process.env.APP_ENV,
        appVersion: this.network.getAppVersion(),
        baseFeeGwei: weiValueToGwei(networkStatusObj['baseFee']),
        maxPriorityFeeGwei: weiValueToGwei(BigInt(await this.network.getMaxPriorityFeePerGas().catch(() => 0))),
        keeperId: agent ? agent.keeperId : null,
        rpc: networkStatusObj['rpc'],
        rpcClient: await this.network.getClientVersion(),
        resendCount,
        chainId,
        txHash,
        prevTxHash,
        ...timeData,
      }),
    };
    const signature = await this.workerSigner._signTypedData({}, types, txData);
    const txLogEndpoint = process.env.TX_LOG_ENDPOINT || 'https://tx-log.powerpool.finance'; // TODO: add ${chainId}.
    return axios.post(`${txLogEndpoint}/log-transaction`, { txData, signature, signatureVersion: 1 });
  }
}
