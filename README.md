# PowerPool Agent V2 Keeper Node

![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/powerpool-finance/powerpool-agent-v2-node/main.yml?branch=master)

The node monitors on-chain events and executes jobs when required.
This node is distributed as a Docker image and a DappNode package. However, you can also build it from the source by following the instructions.

Detailed instructions on how to setup a Keeper Node:
* <a href="https://github.com/powerpool-finance/powerpool-agent-v2-compose" target="_blank">Install Power Agent V2 using Docker</a>

## Official PPAgentV2 deployments

Main Sepolia testnet Power Agent V2 contract - <a href="https://sepolia.etherscan.io/address/0xc8E864f12c337Bdf6294a3DCeE0E565D2B1B4d90" target="_blank">0xc8E864f12c337Bdf6294a3DCeE0E565D2B1B4d90</a>.

Main Sepolia testnet Power Agent V2 subgraph - <a href="https://api.studio.thegraph.com/query/48711/ppv2r-sepolia-test-defibrain88/version/latest" target="_blank">api.studio.thegraph.com</a>.

To see active Power Agent V2 deployments, go to <a href="https://app.powerpool.finance/#/sepolia/ppv2/agents-contracts" target="_blank">app.powerpool.finance</a>.

### Signing up as a Keeper

To be a keeper, you need at least two keys. (1) One admin key for management and (2) another one for a worker. The management key function is to assign a worker's address and withdraw compensations or initial deposit. The worker key is needed for transaction signing by a bot. 

To sign as a Keeper you need to perform the following actions:

1. Go to <a href="https://app.powerpool.finance/#/sepolia/ppv2/agents-contracts" target="_blank">app.powerpool.finance</a>. Here, you can see all available Power Agent contracts for the selected network and click the `Create Keeper` button.
<img width="1683" alt="Screenshot" src="https://github.com/powerpool-finance/powerpool-agent-v2-compose/assets/69249251/c1229aab-ea11-4770-ad20-f9b593244b8c">
2. In the pop-up modal window, the Admin address will be set automatically to the connected wallet. Manually fill in the Worker address and the CVP stake amount, ensuring it's above the minimum level. Your CVP stake determines the compensation the Keeper receives and their ability to be assigned a job. Sign the approval transaction and then create a Keeper.
<img width="1689" alt="Screenshot 2023-08-25 at 19 57 28" src="https://github.com/powerpool-finance/powerpool-agent-v2-compose/assets/69249251/06e622c6-09a8-4db1-ac38-29993ac9aa12">
3. You will see all your created keepers in the My Keepers section.
<img width="1716" alt="Screenshot" src="https://github.com/powerpool-finance/powerpool-agent-v2-compose/assets/69249251/4cbe9c60-cca0-490f-9001-63e8c6ff4882">

### Setting up a node
* Clone this repository
  ```sh
  git clone https://github.com/powerpool-finance/powerpool-agent-v2-node.git
  cd powerpool-agent-v2-node
  ```
* Install dependencies
  ```sh
  yarn
  ```
* Build node
  ```sh
  yarn build
  ```
* Place a JSON file containing your worker key into the `./keys` folder. The filename is not critical, and you can choose it at your discretion. If you don't yet have a JSON key file, you can use the JSON key generator from this repository. The generator is written in JavaScript, so you'll need node.js installed to use it. Remember to install npm dependencies using `npm i` or `yarn`. To convert your raw private key to the JSON V3 format, use the following syntax:
  ```sh
  # node jsongen.js <your-private-key> <your-pass>
  node jsongen.js 0x0c38f1fb1b2d49ea6c6d255a6e50edf0a7a7fa217639281fe1b24a96efc16995 myPass
  ```
* Go into `config` folder and copy the main config template:

```sh
cd config && cp main.template.yaml main.yaml
```
* You can configure as many networks and agents as you need. However, at the current stage, it's highly recommended to use only one Network and Power Agent contract.
* Enter your WebSockets RPC node URI in `networks->details->{network_name}->rpc`. The example config might include some RPC nodes, either public ones or those maintained by PowerPool. However, we cannot guarantee that they will operate flawlessly with excellent uptime.
* For each Agent contract address (`networks->details->{network_name}->agents->{agent_address}`):
    * Choose  `pga` executor.
    * Put your Keeper worker address into `keeper_address`.
    * Put your Keeper worker json key password into `key_pass`.
    * If you wish to accrue rewards on your balance in the Power Agent contract (which could save a small amount of gas), set `accrue_reward` to `true`. If set to `false`, the compensation will be sent to the worker's address after each job execution. The default value is `false`.
    * Some jobs may have a limit set for the current network's `base_fee`. This can occur if a job owner isn't willing to provide compensation when the gas price surpasses the initial limit. For instance, if the current network's `base_fee` is 15 and the job's `maxBaseFee` is 10, a transaction sent for job execution with `accept_max_base_fee_limit` set to `false` and a gas value of 16 will revert. However, if you set `accept_max_base_fee_limit` to `true`, the transaction won't revert. Instead, your compensation will be calculated using `min(jobMaxBaseFee, networkFee) = min(10,15) = 10`.
* Please note that you cannot add more than one Keeper for a given agent contract on a single node. If you wish to set up more than one Keeper, we recommend setting up another node, preferably on a different host. Using different RPCs or even different regions are also good options.

* The main.yaml file should look like this:
```yaml
api: 8090
networks:
  data_source: network
  enabled:
    - sepolia
  details:
    sepolia:
      rpc: 'wss://sepolia-3.powerpool.finance'
      agents:
        '0xc8E864f12c337Bdf6294a3DCeE0E565D2B1B4d90':
          executor: pga
          keeper_worker_address: '0x840ccC99c425eDCAfebb0e7ccAC022CD15Fd49Ca'
          key_pass: 'Very%RealiablePassword292'
          accept_max_base_fee_limit: false
          accrue_reward: false

```
* Run node:
```sh
node dist/Cli.js
```
  
### App exit codes

0. Not an actual error, but some condition when it's better to restart an entire app. Used for some event handlers.
1. Critical errors. Should stop the app. For ex. worker address not found, can't resolve RPC, etc.
2. Non-critical errors. Should restart the app. For ex. hanged WS endpoint connection.
