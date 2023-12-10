import { BigNumber, ethers, Wallet } from 'ethers';
import sinon from 'sinon';
import { PGAExecutor } from '../../app/executors/PGAExecutor.js';
import { EthersContract } from '../../app/clients/EthersContract.js';
import { ContractWrapper, EmptyTxNotMinedInBlockCallback, TxEnvelope, UnsignedTransaction } from '../../app/Types.js';
import { assert } from 'chai';

const NonExpectedEstimationCallback = function (err) {
  assert.fail(`Estimation callback is not expected, but was called once with a message: ${err}.`);
};
const NonExpectedExecutionCallback = function (err) {
  assert.fail(`Execution callback is not expected, but was called once with a message: ${err}.`);
};

describe('PGAExecutor', () => {
  it('should process a single tx correctly', async () => {
    const ENCODED_TX =
      '0xf84c2a80834c4b408080801ba0fb6a369afc4c67f58feffd39340546331ae523d9bc9e68293ae0a705e500e1daa01ed0d3446841c4ad3678976690429192586ec24fb34446284174c48fa6eead07';

    const provider: ethers.providers.BaseProvider = sinon.createStubInstance(ethers.providers.BaseProvider);
    (provider.getTransactionCount as sinon.SinonStub).resolves(42);
    (provider.estimateGas as sinon.SinonStub).resolves(BigNumber.from(320_000));

    let sendTransactionCalled = false;
    provider.sendTransaction = async _encodedTx =>
      ({
        async wait(_) {
          sendTransactionCalled = true;
          assert.equal(_encodedTx, ENCODED_TX);
          return {};
        },
      } as any);
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
    assert.equal(sendTransactionCalled, true);
  });
});

export default null;
