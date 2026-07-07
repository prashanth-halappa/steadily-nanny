/**
 * JobMetrics — tracks performance metrics during job execution (peak memory,
 * DB query count).
 */
interface JobMetricsData {
  peakMemoryMb: number;
  dbQueryCount: number;
}

export class JobMetrics {
  private startMemoryMb = 0;
  private peakMemoryMb = 0;
  private queryCount = 0;
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  start(): void {
    this.queryCount = 0;
    this.startMemoryMb = this.getCurrentMemoryMb();
    this.peakMemoryMb = this.startMemoryMb;

    // Sample memory every 100ms to catch peak usage.
    this.checkInterval = setInterval(() => {
      const currentMb = this.getCurrentMemoryMb();
      if (currentMb > this.peakMemoryMb) {
        this.peakMemoryMb = currentMb;
      }
    }, 100);
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    const currentMb = this.getCurrentMemoryMb();
    if (currentMb > this.peakMemoryMb) {
      this.peakMemoryMb = currentMb;
    }
  }

  trackQuery(): void {
    this.queryCount++;
  }

  getMetrics(): JobMetricsData {
    this.stop();
    return {
      peakMemoryMb: Math.round(this.peakMemoryMb * 100) / 100,
      dbQueryCount: this.queryCount,
    };
  }

  private getCurrentMemoryMb(): number {
    return process.memoryUsage().heapUsed / 1024 / 1024;
  }
}

/** A simple metrics tracker without interval sampling. */
export function createSimpleMetrics(): {
  trackQuery: () => void;
  getMetrics: () => JobMetricsData;
} {
  let queryCount = 0;
  const startMemoryMb = process.memoryUsage().heapUsed / 1024 / 1024;

  return {
    trackQuery: () => {
      queryCount++;
    },
    getMetrics: () => {
      const endMemoryMb = process.memoryUsage().heapUsed / 1024 / 1024;
      return {
        peakMemoryMb:
          Math.round(Math.max(startMemoryMb, endMemoryMb) * 100) / 100,
        dbQueryCount: queryCount,
      };
    },
  };
}
