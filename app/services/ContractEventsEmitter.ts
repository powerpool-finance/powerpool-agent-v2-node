import QueueEmitter from './QueueEmitter.js';
import EventEmitter from 'events';
import { ContractWrapper } from '../Types.js';
import { ethers } from 'ethers';

export default class ContractEventsEmitter {
  provider: ethers.providers.WebSocketProvider | undefined;
  blockLogsMode = false;
  contractEmitterByAddress = {};
  contractEventsByAddress = {};
  contractByAddress = {};
  eventByContractTopic = {};

  contractEmitterCount = {};
  emitByBlockCount = {};

  lastBlockNumber = null;

  constructor(_blockLogsMode) {
    this.setBlockLogsMode(_blockLogsMode);
  }

  setProvider(_provider) {
    this.provider = _provider;
    console.log('[ContractEventsEmitter] setProvider');
  }

  setBlockLogsMode(_blockLogsMode) {
    this.blockLogsMode = _blockLogsMode;
    console.log('[ContractEventsEmitter] setBlockLogsMode', _blockLogsMode);
  }

  emitByContractAddress(address, eventName, value) {
    if (!this.lastBlockNumber || value.blockNumber >= this.lastBlockNumber) {
      this.contractEmitterByAddress[address].emit(eventName, value);
      this.lastBlockNumber = value.blockNumber;
    }
  }

  async emitByBlockQuery(queryObj) {
    console.log('[ContractEventsEmitter] emitByBlockQuery ( queryObj:', queryObj, ')');
    const logs = await this.provider.getLogs(queryObj).catch(e => {
      console.warn('⚠️  [ContractEventsEmitter] provider.getLogs error, return empty array:', e.message);
      return [];
    });
    return this.emitByBlockLogs(logs);
  }

  emitByBlockLogs(logs, forceEmit = false) {
    if (!this.blockLogsMode && !forceEmit) {
      return;
    }
    console.log('[ContractEventsEmitter] emitByBlockLogs ( logs.length:', logs.length, ')');
    let blockNumber;
    const contractAddresses = {};
    logs.forEach(l => {
      const address = l.address.toLowerCase();
      if (!this.contractEmitterByAddress[address]) {
        return;
      }
      const eventName = this.eventByContractTopic[address][l.topics[0]];
      if (!eventName) {
        console.log(
          '[ContractEventsEmitter] ' + blockNumber + ' event name not found ( topic:',
          l.topics[0],
          'address:',
          address,
          ')',
        );
        return;
      }
      if (!this.emitByBlockCount[address]) {
        this.emitByBlockCount[address] = {};
      }
      if (!this.contractEmitterCount[address]) {
        this.contractEmitterCount[address] = {};
      }
      contractAddresses[address] = true;
      blockNumber = l.blockNumber;
      this.emitByBlockCount[address][blockNumber] = (this.emitByBlockCount[address][blockNumber] || 0) + 1;
      this.emitByContractAddress(address, eventName, this.contractByAddress[address].parseLog(l));
    });

    Object.keys(contractAddresses).forEach(address => {
      if (blockNumber && this.emitByBlockCount[address] && this.contractEmitterCount[address]) {
        const diff = this.emitByBlockCount[address][blockNumber] - this.contractEmitterCount[address][blockNumber];
        console.log(
          '[ContractEventsEmitter] ' + blockNumber + ' block logs count ( query:',
          this.emitByBlockCount[address][blockNumber],
          'websocket:',
          this.contractEmitterCount[address][blockNumber],
          ')',
        );
        if (diff != 0) {
          console.log(`❗️ ${blockNumber} Block Events Mismatch Error! Diff: ${diff}`);
        }
        delete this.emitByBlockCount[address][blockNumber];
        delete this.contractEmitterCount[address][blockNumber];
      }
    });
  }

  on(contract: ContractWrapper, eventName, callback) {
    const address = contract.address.toLowerCase();
    if (!this.contractEmitterByAddress[address]) {
      this.contractByAddress[address] = contract;
      this.contractEmitterByAddress[address] = new QueueEmitter();
      this.contractEventsByAddress[address] = [];
      this.eventByContractTopic[address] = {};
    }
    const eventTopic = contract.getTopicOfEvent(eventName);
    if (!this.eventByContractTopic[address][eventTopic]) {
      this.eventByContractTopic[address][eventTopic] = eventName;
      contract.on(eventName, value => {
        const { blockNumber } = value;
        this.contractEmitterCount[address][blockNumber] = (this.contractEmitterCount[address][blockNumber] || 0) + 1;
        delete this.contractEmitterCount[address][blockNumber - 1];
        if (this.blockLogsMode) {
          return;
        }
        this.emitByContractAddress(address, eventName, value);
      });
    }
    this.contractEmitterByAddress[address].on(eventName, callback);
  }

  contractEmitter(contract): EventEmitter {
    const address = contract.address.toLowerCase();
    if (!this.contractEmitterCount[address]) {
      this.contractEmitterCount[address] = {};
    }
    return {
      on: (eventName, callback) => {
        this.on(contract, eventName, callback);
      },
    } as any;
  }
}
