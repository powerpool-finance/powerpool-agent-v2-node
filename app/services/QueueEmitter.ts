export default class QueueEmitter {
  listenersByName = {};
  callbacksToExecute = [];
  executeInProcess = false;

  async emit(name, value) {
    (this.listenersByName[name] || []).forEach(callback => {
      this.callbacksToExecute.push({ name, value, callback });
    });
    this.execute();
  }
  async execute() {
    if (this.executeInProcess) {
      return;
    }
    this.executeInProcess = true;
    while (this.callbacksToExecute.length) {
      const c = this.callbacksToExecute.shift();
      try {
        await c.callback(c.value);
      } catch (e) {
        console.error('QueueEmitter.execute error', JSON.stringify(c), e);
      }
    }
    this.executeInProcess = false;
  }
  on(name, callback) {
    this.listenersByName[name] = this.listenersByName[name] || [];
    this.listenersByName[name].push(callback);
  }
}
