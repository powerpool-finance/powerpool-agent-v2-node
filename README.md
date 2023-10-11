# PowerPool Agent V2 Keeper Node

![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/powerpool-finance/powerpool-agent-v2-node/main.yml?branch=master)

The node monitors on-chain events and executes jobs when required.
This node is distributed as a Docker image and a DappNode package. However, you can also build it from the source by following the instructions below.

Detailed instructions on how to setup a Keeper Node:
* <a href="https://docs.powerpool.finance/powerpool-and-poweragent-network/powerpool-overview/poweragent-installation-guide" target="_blank">Install Power Agent V2 using DAppNode</a>
* <a href="https://github.com/powerpool-finance/powerpool-agent-v2-compose" target="_blank">Install Power Agent V2 using Docker</a>

## Official PPAgentV2 deployments

- Sepolia test contracts:
  - Sepolia testnet Power Agent V2 Proxy contract - <a href="https://sepolia.etherscan.io/address/0xbdE2Aed54521000DC033B67FB522034e0F93A7e5" target="_blank">0xbdE2Aed54521000DC033B67FB522034e0F93A7e5</a>.
  - Sepolia testnet Power Agent V2 Implementation contract - <a href="https://sepolia.etherscan.io/address/0x4dea5ec11e1eb6ff7fa62eed2fa72a1ae2934e89" target="_blank">0x4dea5ec11e1eb6ff7fa62eed2fa72a1ae2934e89</a>.
  - Sepolia testnet Power Agent V2 Lens contract - <a href="https://sepolia.etherscan.io/address/0x937991108511f1850bd476b9ab56433afde7c92a" target="_blank">0x937991108511f1850bd476b9ab56433afde7c92a</a>.
  - Sepolia testnet Power Agent V2 subgraph - <a href="https://api.studio.thegraph.com/query/48711/ppav2-rd-sepolia-b12-ui/version/latest">api.studio.thegraph.com</a>.

- Gnosis chain test contracts:
  - Gnosis chain test Power Agent V2 Proxy contract - <a href="https://gnosisscan.io/address/0x071412e301C2087A4DAA055CF4aFa2683cE1e499" target="_blank">0x071412e301C2087A4DAA055CF4aFa2683cE1e499</a>.
  - Gnosis chain test Power Agent V2 Implementation contract - <a href="https://gnosisscan.io/address/0xda80ff51aafe84bb9463b09a3fc54f3819324692" target="_blank">0xda80ff51aafe84bb9463b09a3fc54f3819324692</a>.
  - Gnosis chain Power Agent V2 Lens contract - <a href="https://gnosisscan.io/address/0x2b3d29daa9f41c4171416af3d66f5a2ae210616e">0x2b3d29daa9f41c4171416af3d66f5a2ae210616e</a>.
  - Gnosis chain test Power Agent V2 subgraph - <a href="https://api.studio.thegraph.com/query/48711/ppav2-rd-gnosis-b12-ui/version/latest">api.studio.thegraph.com</a>.

To see active Power Agent V2 deployments, go to <a href="https://app.powerpool.finance/#/sepolia/ppv2/agents-contracts" target="_blank">app.powerpool.finance</a>.

## Creating a Keeper and setting up a node from the source code

### Signing up as a Keeper

To be a keeper, you need at least two keys. (1) One admin key for management and (2) another one for a worker. The management key function is to assign a worker's address and withdraw compensations or initial deposit. The worker key is needed for transaction signing by a node. 

To sign as a Keeper you need to perform the following actions:

#### 1. Open Power Agent dApp
Go to <a href="https://app.powerpool.finance/#/sepolia/ppv2/agents-contracts" target="_blank">app.powerpool.finance</a>. Here, you can see all available Power Agent contracts for the selected network and click the `Create Keeper` button.
<img width="1713" alt="Screenshot 2023-10-10 at 13 38 21" src="https://github.com/powerpool-finance/powerpool-agent-v2-node/assets/69249251/0cb6b280-85a2-475c-9953-69cd0d4cba49">
#### 2. Create your Keeper
In the pop-up modal window, the Admin address will be set automatically to the connected wallet. Manually fill in the Worker address and the CVP stake amount, ensuring it's above the minimum level. Your CVP stake determines the compensation the Keeper receives and their ability to be assigned a job. Sign the approval transaction and then create a Keeper.
<img width="1715" alt="Screenshot 2023-10-10 at 13 39 45" src="https://github.com/powerpool-finance/powerpool-agent-v2-node/assets/69249251/3d454889-3915-4ad7-9757-163e50c2e886">
#### 3. Check My Keepers
You will see all your created keepers in the My Keepers section. 
⚠️ Attention! You have created a Keeper that is not active. Please do not activate it now.
<img width="1712" alt="Screenshot 2023-10-10 at 13 18 27" src="https://github.com/powerpool-finance/powerpool-agent-v2-node/assets/69249251/3c025888-e04b-4bc5-b146-fe87b3afb152">
### Setting up a Power Agent node from the source code
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

* The main.yaml file should look like this example for Sepolia:

```yaml
networks:
  enabled:
    - sepolia
  details:
    sepolia:
      rpc: 'wss://sepolia-1.powerpool.finance'
      agents:
        '0xbdE2Aed54521000DC033B67FB522034e0F93A7e5':
          # data_source: subgraph
          # subgraph_url: https://api.studio.thegraph.com/query/48711/ppav2-rd-sepolia-b12-ui/version/latest
          executor: pga
          keeper_worker_address: '0x840ccC99c425eDCAfebb0e7ccAC022CD15Fd49Ca'
          key_pass: 'Very%ReliablePassword292'
          accrue_reward: false

```
* The main.yaml file should look like this example for Gnosis chain:

```yaml
networks:
  enabled:
    - gnosis
  details:
    gnosis:
      rpc: 'wss://gnosis-1.powerpool.finance'
      agents:
        '0x071412e301C2087A4DAA055CF4aFa2683cE1e499':
          # data_source: subgraph
          # subgraph_url: https://api.studio.thegraph.com/query/48711/ppav2-rd-gnosis-b12-ui/version/latest
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
NETWORK_NAME='sepolia' NETWORK_RPC='wss://sepolia-1.powerpool.finance' AGENT_ADDRESS='0xbdE2Aed54521000DC033B67FB522034e0F93A7e5' KEEPER_WORKER_ADDRESS='0x840ccC99c425eDCAfebb0e7ccAC022CD15Fd49Ca' KEYPASSWORD='Very%ReliablePassword292' node dist/Cli.js
```
* Full list of environment variables:
  * `NETWORK_NAME` - Name of the network (e.g., sepolia, goerli, gnosis, ethereum, etc.)
  * `NETWORK_RPC` - Provided RPC URL
  * `AGENT_ADDRESS` - Power Agent smart contract address
  * `KEEPER_WORKER_ADDRESS` - Your Worker address
  * `KEYPASSWORD` - Password for your keyfile
  * `DATA_SOURCE` - Currently only 'subgraph'. If not provided, the node will use events.
  * `SUBGRAPH_URL` - URL for the subgraph (e.g., `https://api.studio.thegraph.com/query/48711/ppav2-rd-sepolia-b12-ui/version/latest`). Should be provided if `DATA_SOURCE='subgraph'`.

  * `ACCRUE_REWARD` - If provided, will be set to `true`

Eventually, you will see the following logs in the console. Pay attention: your keeper is still disabled, so you cannot execute jobs.
<img width="1095" alt="Screenshot 2023-10-10 at 13 28 12" src="https://github.com/powerpool-finance/powerpool-agent-v2-node/assets/69249251/afd2f985-5a1e-4ac2-941a-c50b89a7ccc3">

### Activate Keeper
Go back to https://app.powerpool.finance/#/sepolia/ppv2/my-keepers, click the 'Complete' button, and then sign the transaction.
<img width="1716" alt="Screenshot 2023-10-10 at 13 29 22" src="https://github.com/powerpool-finance/powerpool-agent-v2-node/assets/69249251/b673c84d-5350-433e-ac57-c22d586f425a">
In the console, you will see that the Keeper was successfully activated. Congratulations!
<img width="1098" alt="Screenshot 2023-10-10 at 13 29 51" src="https://github.com/powerpool-finance/powerpool-agent-v2-node/assets/69249251/12673b78-e034-4f10-94b8-b21392499fa7">


## Build Docker image from sources
```sh
docker buildx build -t power-agent-node:latest .
```
## App exit codes

0. Not an actual error, but some condition when it's better to restart an entire app. Used for some event handlers.
1. Critical errors. Should stop the app. For ex. worker address not found, can't resolve RPC, etc.
2. Non-critical errors. Should restart the app. For ex. hanged WS endpoint connection.

## Privacy
The Power Agent node sends basic, anonymous data about transactions to the backend for debugging. This data includes gas price and when the transaction was sent and added to the block. No IP addresses are recorded.
