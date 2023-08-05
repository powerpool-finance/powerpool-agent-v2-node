import { ErrorWrapper } from '../Types';
import { BigNumber, ethers } from 'ethers';

export function printSolidityCustomError(
  consoleLog: (...string) => void,
  decodeError: (response: string) => ErrorWrapper,
  bytes: string,
  txCalldata: string,
): void {
  if (bytes.startsWith('0x4e487b71')) {
    const hexCode = ethers.utils.defaultAbiCoder.decode(['uint256'], `0x${bytes.substring(10)}`);
    consoleLog(
      'error',
      `⛔️ Ignoring a tx with a failed estimation, calldata=${txCalldata}. The reason is "Panic(${hexCode})". This error can happen in the following cases:
- Can't perform native token transfer within one of internal txs due insufficient funds;
- The calling method doesn't exist;

Check out here for more details on Panic(uint256) errors: https://docs.soliditylang.org/en/v0.8.19/control-structures.html#panic-via-assert-and-error-via-require.
`,
    );
  } else if (bytes.startsWith('0x08c379a0')) {
    const msg = ethers.utils.defaultAbiCoder.decode(['string'], `0x${bytes.substring(10)}`);
    consoleLog('debug', `⛔️ Ignoring a tx with a failed estimation: (message="${msg}",calldata=${txCalldata})`);
  } else {
    try {
      const { args, name } = decodeError(bytes);
      for (const [key, value] of Object.entries(args)) {
        if (BigNumber.isBigNumber(value)) {
          args[key] = value.toNumber();
        }
      }
      consoleLog(
        'debug',
        `⛔️ Ignoring tx estimation reverted with '${name}' error and the following error arguments:`,
        args,
        `(calldata=${txCalldata})`,
      );
    } catch (_) {
      consoleLog(
        'debug',
        `⛔️ Ignoring tx estimation failed with unknown error: (call=${txCalldata},response=${bytes})`,
      );
    }
  }
}
