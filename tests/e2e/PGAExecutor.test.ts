import { BigNumber, ethers, Wallet } from 'ethers';
import sinon from 'sinon';
import { PGAExecutor } from '../../app/executors/PGAExecutor.js';
import { EthersContract } from '../../app/clients/EthersContract.js';
import { ContractWrapper, EmptyTxNotMinedInBlockCallback, TxEnvelope, UnsignedTransaction } from '../../app/Types.js';
import { assert } from 'chai';
import { sleep } from '../../app/Utils.js';

const NonExpectedEstimationCallback = function (err) {
  assert.fail(`Estimation callback is not expected, but was called once with a message: ${err}.`);
};
const NonExpectedExecutionCallback = function (err) {
  assert.fail(`Execution callback is not expected, but was called once with a message: ${err}.`);
};

describe('PGAExecutor', () => {
  it('should process a single tx correctly', async () => {
    const ENCODED_TX =
      '0xf84c2a80831388008080801ba04c76f1b62dae2bfcdb35b20f3757b68fc911983d2dbc1ec6e17f05acf42a8646a0424123b0c215bb96fec206a9ac0022b3a241800f13e5c6eb21afc4fc4169bbd7';

    const provider: ethers.providers.BaseProvider = sinon.createStubInstance(ethers.providers.BaseProvider);
    (provider.getTransactionCount as sinon.SinonStub).resolves(42);
    (provider.estimateGas as sinon.SinonStub).resolves(BigNumber.from(320_000));

    const providerSendTransactionResult = {
      async wait() {
        return sleep(0);
      },
    };
    const sendTransactionMock = sinon.mock(provider);
    (provider.sendTransaction as sinon.SinonStub).restore();
    sendTransactionMock.expects('sendTransaction').once().withArgs(ENCODED_TX).resolves(providerSendTransactionResult);

    const privateKey = '0x0123456789012345678901234567890123456789012345678901234567890123';
    const workerSigner: ethers.Wallet = new Wallet(privateKey);
    const agentContract: ContractWrapper = sinon.createStubInstance(EthersContract);

    const executor = new PGAExecutor(
      {
        getName: () => 'testnet',
        getProvider: () => provider,
      } as any,
      workerSigner,
      agentContract,
      {},
    );
    executor.init();

    const tx: UnsignedTransaction = {
      chainId: 0,
      data: '0x',
      gasLimit: 100000n,
      nonce: undefined,
      value: 0n,
    };
    // const executionFailedMock = sinon.mock();
    const envelope: TxEnvelope = {
      jobKey: 'buzz',
      tx,
      executorCallbacks: {
        txEstimationFailed: NonExpectedEstimationCallback,
        txExecutionFailed: NonExpectedExecutionCallback,
        txExecutionSuccess: (_, __) => {},
        txNotMinedInBlock: EmptyTxNotMinedInBlockCallback,
      },
    };
    // NO AWAIT THUS THE INTERNAL QUEUE LOOP IS NOT LAUNCHED UNTIL THE END OF THIS FUNCTION
    await executor.push('foo', envelope);
    const status = executor.getStatusObjectForApi();

    assert.equal(status.lastTxKey, 'foo');
    assert.typeOf(status.lastTxKey, 'string');
    assert.equal(status.lastTxEnvelope.jobKey, 'buzz');
    assert.equal(status.currentTxKey, null);
    assert.equal(status.currentTxEnvelope, null);
    assert.equal(status.queueHandlerLock, false);
    assert.equal(status.queue.length, 0);

    sendTransactionMock.verify();
  });
});

export default null;
