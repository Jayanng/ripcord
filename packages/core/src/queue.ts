/**
 * Single-writer FIFO transaction queue.
 * Prevents VTXO double-spend collisions in a non-nonce environment
 * by serializing all mutation operations.
 */

export interface QueuedTask<T> {
  readonly id: string;
  readonly execute: () => Promise<T>;
}

interface PendingTask<T = unknown> {
  readonly task: QueuedTask<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (err: unknown) => void;
}

/**
 * FIFO queue that executes one task at a time. Tasks are marked with
 * localSpentAt before broadcast and released on failure.
 */
export class TxQueue {
  private running = false;
  private readonly pending: Array<PendingTask> = [];
  private _processedCount = 0;

  get processedCount(): number {
    return this._processedCount;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  enqueue<T>(task: QueuedTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ task, resolve, reject } as PendingTask);
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;

    while (this.pending.length > 0) {
      const item = this.pending.shift()!;
      try {
        const result = await item.task.execute();
        this._processedCount++;
        item.resolve(result);
      } catch (err) {
        this._processedCount++;
        item.reject(err);
      }
    }

    this.running = false;
  }
}
