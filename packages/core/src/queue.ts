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
 * FIFO queue that executes one task at a time.
 *
 * localSpentAt reservation: while a task that reserves VTXO ids is in flight,
 * those ids are marked reserved in this queue's store. coin selection
 * (selectCoins) skips reserved ids, so a second queued transfer cannot
 * double-spend the same VTXO before the first transfer commits.
 * On success the ids stay spent on the daemon; on failure they are released.
 */
export class TxQueue {
  private running = false;
  private readonly pending: Array<PendingTask> = [];
  private _processedCount = 0;
  private readonly reserved = new Map<string, number>();

  get processedCount(): number {
    return this._processedCount;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Vtxo ids currently reserved by an in-flight task. */
  get reservedIds(): readonly string[] {
    return [...this.reserved.keys()];
  }

  /** True when the given vtxo id is reserved by an in-flight task. */
  isReserved(id: string): boolean {
    return this.reserved.has(id);
  }

  enqueue<T>(task: QueuedTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ task, resolve, reject } as PendingTask);
      void this.drain();
    });
  }

  /**
   * Enqueue a task whose inputs must be reserved. vtxoIds are marked reserved
   * immediately (before the task runs) and released only if the task throws.
   */
  enqueueReserved<T>(vtxoIds: readonly string[], task: QueuedTask<T>): Promise<T> {
    const uniqueIds = [...new Set(vtxoIds)];
    if (uniqueIds.some(id => typeof id !== 'string' || id.length === 0)) {
      return Promise.reject(new Error('Reserved VTXO ids must be non-empty strings'));
    }
    if (uniqueIds.some(id => this.reserved.has(id))) {
      return Promise.reject(new Error('One or more VTXOs are already reserved'));
    }
    const now = Date.now();
    for (const id of uniqueIds) {
      this.reserved.set(id, now);
    }
    return this.enqueue({
      id: task.id,
      execute: async () => {
        try {
          const result = await task.execute();
          // Success: the daemon now marks these spent; drop local reservations.
          for (const id of uniqueIds) {
            this.reserved.delete(id);
          }
          return result;
        } catch (err) {
          for (const id of uniqueIds) {
            this.reserved.delete(id);
          }
          throw err;
        }
      },
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
