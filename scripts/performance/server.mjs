/** Production app in an isolated process; external sampler reports CPU/RSS and event-loop stalls. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
const { createApp } = await import(pathToFileURL(resolve('dist/server/app.js')).href);
const { app } = await createApp({ databasePath: process.argv[2], password: process.argv[3] });
await app.listen({ host: '127.0.0.1', port: 0 });
process.send({ url: `http://127.0.0.1:${app.server.address().port}` });
const lag = monitorEventLoopDelay({ resolution: 10 });
lag.enable();
let previousCpu = process.cpuUsage();
let previousTime = performance.now();
const sampler = setInterval(() => {
  const now = performance.now();
  const cpu = process.cpuUsage();
  process.send({
    resource: {
      at: Date.now(),
      rssMB: process.memoryUsage().rss / 1048576,
      cpuPercent:
        (cpu.user + cpu.system - previousCpu.user - previousCpu.system) / (now - previousTime) / 10,
      loopP99Ms: lag.percentile(99) / 1e6,
      loopMaxMs: lag.max / 1e6,
    },
  });
  previousCpu = cpu;
  previousTime = now;
  lag.reset();
}, 1000);
process.on('SIGTERM', () => {
  clearInterval(sampler);
  lag.disable();
  void app.close().then(() => process.exit(0));
});
