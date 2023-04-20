import { Network } from '../Network';

/**
 * This class used for fetching data directly from blockchain
 */
export class BlockchainSource {
  private network: Network;
  constructor(network: Network) {
    this.network = network;
  }
}
