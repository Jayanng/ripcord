import { describe, it, expect } from 'vitest';
import { TxQueue, type QueuedTask } from '../src/queue.js';

describe('TxQueue', () => {
  it('executes tasks in FIFO order', async () => {
    const queue = new TxQueue();
    const order: string[] = [];

    const makeTask = (id: string, delayMs: number): QueuedTask<string> => ({
      id,
      execute: async () => {
        await new Promise(r => setTimeout(r, delayMs));
        order.push(id);
        return id;
      },
    });

    // Enqueue 3 tasks with varying delays. FIFO means they run sequentially
    // regardless of individual execution time.
    const p1 = queue.enqueue(makeTask('first', 20));
    const p2 = queue.enqueue(makeTask('second', 5));
    const p3 = queue.enqueue(makeTask('third', 10));

    const results = await Promise.all([p1, p2, p3]);

    expect(results).toEqual(['first', 'second', 'third']);
    expect(order).toEqual(['first', 'second', 'third']);
    expect(queue.processedCount).toBe(3);
    expect(queue.pendingCount).toBe(0);
  });

  it('serializes concurrent tasks (no parallel execution)', async () => {
    const queue = new TxQueue();
    let concurrentCount = 0;
    let maxConcurrent = 0;

    const makeTask = (id: string): QueuedTask<string> => ({
      id,
      execute: async () => {
        concurrentCount++;
        if (concurrentCount > maxConcurrent) maxConcurrent = concurrentCount;
        await new Promise(r => setTimeout(r, 10));
        concurrentCount--;
        return id;
      },
    });

    // Enqueue 5 tasks simultaneously
    const promises = Array.from({ length: 5 }, (_, i) =>
      queue.enqueue(makeTask(`task-${i}`))
    );

    await Promise.all(promises);

    // Single-writer guarantee: never more than 1 task executing at once
    expect(maxConcurrent).toBe(1);
    expect(queue.processedCount).toBe(5);
  });

  it('propagates errors without breaking the queue', async () => {
    const queue = new TxQueue();
    const completed: string[] = [];

    const failTask: QueuedTask<string> = {
      id: 'fail',
      execute: async () => { throw new Error('intentional failure'); },
    };

    const okTask: QueuedTask<string> = {
      id: 'ok',
      execute: async () => { completed.push('ok'); return 'ok'; },
    };

    // First task fails, second should still run
    const p1 = queue.enqueue(failTask);
    const p2 = queue.enqueue(okTask);

    await expect(p1).rejects.toThrow('intentional failure');
    const result = await p2;

    expect(result).toBe('ok');
    expect(completed).toEqual(['ok']);
    expect(queue.processedCount).toBe(2);
  });

  it('starts empty with zero counts', () => {
    const queue = new TxQueue();
    expect(queue.processedCount).toBe(0);
    expect(queue.pendingCount).toBe(0);
  });

  it('handles a single task correctly', async () => {
    const queue = new TxQueue();
    const result = await queue.enqueue({
      id: 'solo',
      execute: async () => 42,
    });
    expect(result).toBe(42);
    expect(queue.processedCount).toBe(1);
    expect(queue.pendingCount).toBe(0);
  });
});

