import { Network } from '../Network';

/**
 * This class used for fetching data from subgraph
 */
export class SubgraphSource {
  private network: Network;
  constructor(network: Network) {
    this.network = network;
  }
}
