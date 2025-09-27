// Processes items concurrently with a limited pool size to prevent overwhelming the system
// Uses a worker pool pattern to maintain optimal concurrency
export async function processWithPool<T, R>(
  items: T[],
  concurrencyLimit: number,
  processor: (item: T) => Promise<R>,
  onProgress?: () => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let _completed = 0;

  return new Promise((resolve) => {
    let runningCount = 0;
    let nextIndex = 0;

    function processNext() {
      if (nextIndex >= items.length) {
        if (runningCount === 0) resolve(results.filter(Boolean));
        return;
      }

      const currentIndex = nextIndex++;
      const item = items[currentIndex];

      runningCount++;

      processor(item as T)
        .then((result) => {
          results[currentIndex] = result;
          if (onProgress) onProgress();
          _completed++;
        })
        .catch((err) => {
          console.error(`Error processing item: ${err.message}`);
        })
        .finally(() => {
          runningCount--;
          processNext();
        });
    }

    const initialBatch = Math.min(concurrencyLimit, items.length);
    for (let i = 0; i < initialBatch; i++) {
      processNext();
    }
  });
}
