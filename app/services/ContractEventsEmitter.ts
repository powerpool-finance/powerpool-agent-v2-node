import QueueEmitter from './QueueEmitter.js';
import EventEmitter from 'events';
import { ContractWrapper } from '../Types.js';

export default class ContractEventsEmitter {
  blockLogsMode = false;
  contractEmitterByAddress = {};
  contractEventsByAddress = {};
  contractByAddress = {};
  eventByContractTopic = {};

  constructor(_blockLogsMode) {
    this.blockLogsMode = _blockLogsMode;
  }

  setBlockLogsMode(_blockLogsMode) {
    this.blockLogsMode = _blockLogsMode;
  }

  emitByContractAddress(address, eventName, value) {
    if (this.blockLogsMode) {
      return;
    }
    this.contractEmitterByAddress[address].emit(eventName, value);
  }

  emitByBlockLogs(logs) {
    if (!this.blockLogsMode) {
      return;
    }
    logs.forEach(l => {
      const address = l.address.toLowerCase();
      if (!this.contractEmitterByAddress[address]) {
        return;
      }
      const eventName = this.eventByContractTopic[address][l.topics[0]];
      if (!eventName) {
        return;
      }
      this.emitByContractAddress(address, eventName, this.contractByAddress[address].parseLog(l));
    });
  }

  on(contract: ContractWrapper, eventName, callback) {
    const address = contract.address.toLowerCase();
    if (!this.contractEmitterByAddress[address]) {
      this.contractByAddress[address] = contract;
      this.contractEmitterByAddress[address] = new QueueEmitter();
      this.contractEventsByAddress[address] = [];
      this.eventByContractTopic[address] = {};
      contract.on(eventName, value => {
        this.eventByContractTopic[address][contract.getTopicOfEvent(eventName)] = eventName;
        this.emitByContractAddress(address, eventName, value);
      });
    }
    this.contractEmitterByAddress[address].on(eventName, callback);
  }

  contractEmitter(contract): EventEmitter {
    return {
      on: (eventName, callback) => {
        this.on(contract, eventName, callback);
      },
    } as any;
  }
}
