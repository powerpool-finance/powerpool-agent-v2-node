# PowerPool Agent V2 Keeper Node

![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/powerpool-finance/powerpool-agent-v2-node/main.yml?branch=master)

The node monitors on-chain events and executes jobs when required.
his node is distributed as a Docker image and a DappNode package. However, you can also build it from the source by following the instructions below.

Detailed instructions on how to setup a Keeper Node:
* <a href="https://docs.powerpool.finance/powerpool-and-poweragent-network/powerpool-overview/poweragent-installation-guide" target="_blank">Install Power Agent V2 using DAppNode</a>
* <a href="https://github.com/powerpool-finance/powerpool-agent-v2-compose" target="_blank">Install Power Agent V2 using Docker</a>

## Official PPAgentV2 deployments

Main Sepolia testnet Power Agent V2 contract - <a href="https://sepolia.etherscan.io/address/0xf4583fc017D82c3462944A5d7E7aD380e5bfAD74" target="_blank">0xf4583fc017D82c3462944A5d7E7aD380e5bfAD74</a>.

Main Sepolia testnet Power Agent V2 subgraph - <a href="https://api.studio.thegraph.com/query/44364/ppav2-rd-sepolia-b11/version/latest" target="_blank">api.studio.thegraph.com</a>.

To see active Power Agent V2 deployments, go to <a href="https://app.powerpool.finance/#/sepolia/ppv2/agents-contracts" target="_blank">app.powerpool.finance</a>.

## Creating a Keeper and setting up a node from the source code

### Signing up as a Keeper

To be a keeper, you need at least two keys. (1) One admin key for management and (2) another one for a worker. The management key function is to assign a worker's address and withdraw compensations or initial deposit. The worker key is needed for transaction signing by a bot. 

To sign as a Keeper you need to perform the following actions:

### 1. Open Power Agent dApp
Go to <a href="https://app.powerpool.finance/#/sepolia/ppv2/agents-contracts" target="_blank">app.powerpool.finance</a>. Here, you can see all available Power Agent contracts for the selected network and click the `Create Keeper` button.
<img width="1683" alt="Screenshot" src="https://github.com/powerpool-finance/powerpool-agent-v2-compose/assets/69249251/c1229aab-ea11-4770-ad20-f9b593244b8c">
### 2. Create your Keeper
In the pop-up modal window, the Admin address will be set automatically to the connected wallet. Manually fill in the Worker address and the CVP stake amount, ensuring it's above the minimum level. Your CVP stake determines the compensation the Keeper receives and their ability to be assigned a job. Sign the approval transaction and then create a Keeper.
<img width="1689" alt="Screenshot 2023-08-25 at 19 57 28" src="https://github.com/powerpool-finance/powerpool-agent-v2-compose/assets/69249251/06e622c6-09a8-4db1-ac38-29993ac9aa12">
### 3. Check My Keepers
You will see all your created keepers in the My Keepers section.

<img width="1716" alt="Screenshot" src="https://github.com/powerpool-finance/powerpool-agent-v2-compose/assets/69249251/4cbe9c60-cca0-490f-9001-63e8c6ff4882">

### Setting up a node from the source code
* Install Node.js version 18.
* Clone this repository:

  ```sh
  git clone https://github.com/powerpool-finance/powerpool-agent-v2-node.git
  cd powerpool-agent-v2-node
  ```

* Install dependencies and build Power Agent node:

  ```sh
  yarn && yarn build
  ```
* Place a JSON file containing your worker key into the `./keys` folder. You can choose any filename. If you don't yet have a JSON key file, you can use the JSON key generator from this repository. To convert your raw private key to the JSON V3 format, use the following syntax:

  ```sh
  # node jsongen.js <your-private-key> <your-pass>
  node jsongen.js 0x0c38f1fb1b2d49ea6c6d255a6e50edf0a7a7fa217639281fe1b24a96efc16995 myPass
  ```

* Copy the main config template:

```sh
cp config/main.template.yaml main.yaml
```
* Edit `main.yaml` using nano, vim or any other editor. 
* You can edit `main.yaml` file and add as many networks and agents as you need. However, at the current stage, it's highly recommended to use only one Network and Power Agent contract.
* Enter your WebSockets RPC node URI in `networks->details->{network_name}->rpc`. The example config might include some RPC nodes, either public ones or those maintained by PowerPool. However, we cannot guarantee that they will operate flawlessly with excellent uptime. To achieve better uptime, it is highly recommended to use your own personal RPC.

* For each Agent contract address (`networks->details->{network_name}->agents->{agent_address}`):
    * Choose  `pga` executor.
    * Put your Keeper worker address into `keeper_address`.
    * Put your Keeper worker json key password into `key_pass`.
    * If you wish to accrue rewards on your balance in the Power Agent contract (which could save a small amount of gas), set `accrue_reward` to `true`. If set to `false`, the compensation will be sent to the worker's address after each job execution. The default value is `false`.
* Please note that you cannot add more than one Keeper for a given agent contract on a single node. If you wish to set up more than one Keeper, we recommend setting up another node, preferably on a different host. Using different RPCs or even different regions are also good options.

* The main.yaml file should look like this example:

```yaml
networks:
  enabled:
    - sepolia
  details:
    sepolia:
      rpc: 'wss://sepolia-1.powerpool.finance'
      agents:
        '0xf4583fc017D82c3462944A5d7E7aD380e5bfAD74':
          # data_source: subgraph
          # subgraph_url: https://api.studio.thegraph.com/query/44364/ppav2-rd-sepolia-b11/version/latest
          executor: pga
          keeper_worker_address: '0x840ccC99c425eDCAfebb0e7ccAC022CD15Fd49Ca'
          key_pass: 'Very%ReliablePassword292'
          accrue_reward: false

```

* To start the node and ensure that everything is okay:
```sh
node dist/Cli.js
```
* To start the node in background using pm2:
```sh
yarn add global pm2
pm2 start dist/Cli.js --name power-agent
pm2 startup && pm2 save
```

* There is an alternative way to start the node by using only environment variables instead of a config file:
```sh
NETWORK_NAME='sepolia' NETWORK_RPC='wss://sepolia-1.powerpool.finance' AGENT_ADDRESS='0xf4583fc017D82c3462944A5d7E7aD380e5bfAD74' KEEPER_WORKER_ADDRESS='0x840ccC99c425eDCAfebb0e7ccAC022CD15Fd49Ca' KEYPASSWORD='Very%ReliablePassword292' node dist/Cli.js
```
* Full list of environment variables:
  * `NETWORK_NAME` - Name of the network (e.g., sepolia, goerli, gnosis, ethereum, etc.)
  * `NETWORK_RPC` - Provided RPC URL
  * `AGENT_ADDRESS` - Power Agent smart contract address
  * `KEEPER_WORKER_ADDRESS` - Your Worker address
  * `KEYPASSWORD` - Password for your keyfile
  * `DATA_SOURCE` - Currently only 'subgraph'. If not provided, the node will use events.
  * `SUBGRAPH_URL` - URL for the subgraph (e.g., `https://api.studio.thegraph.com/query/44364/ppav2-rd-sepolia-b11/version/latest`). Should be provided if `DATA_SOURCE='subgraph'`.

  * `ACCRUE_REWARD` - If provided, will be set to `true`
  
### App exit codes

0. Not an actual error, but some condition when it's better to restart an entire app. Used for some event handlers.
1. Critical errors. Should stop the app. For ex. worker address not found, can't resolve RPC, etc.
2. Non-critical errors. Should restart the app. For ex. hanged WS endpoint connection.

### Privacy
The Power Agent node sends basic, anonymous data about transactions to the backend for debugging. This data includes gas price and when the transaction was sent and added to the block. No IP addresses are recorded.
