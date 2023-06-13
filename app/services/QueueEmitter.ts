import EventEmitter from 'events';

export class QueueEmitter extends EventEmitter {
  protected queue: [string, unknown[]][];
  constructor() {
    super();
    this.queue = [];
  }

  emit(event: string, ...args): boolean {
    this.queue.push([event, args]);

    if (this.queue.length === 1) this.processQueue();

    return true;
  }

  processQueue() {
    if (!this.queue.length) return;

    const [event, args] = this.queue[0];

    super.emit(event, ...args, () => {
      this.queue.shift();
      this.processQueue();
    });
  }
}
