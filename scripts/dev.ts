/**
 * Didar Gold Platform - Multi-Service Development Runner
 * Starts backend first, waits for a database-healthy API, then starts Vite.
 */

import { spawn, ChildProcess } from 'child_process';
import net from 'net';

const FRONTEND_PORT = process.env.FRONTEND_PORT || '3000';
const children: ChildProcess[] = [];
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
let shuttingDown = false;

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port, '0.0.0.0');
  });
}

async function main() {
  let backendPort = process.env.BACKEND_PORT ? Number(process.env.BACKEND_PORT) : 8000;

  const requestedPortAvailable = await isPortAvailable(backendPort);
  if (!requestedPortAvailable && backendPort === 8000) {
    console.warn('[Runner] Port 8000 is in use. Selecting port 8001 for Backend API.');
    backendPort = 8001;
  } else if (!requestedPortAvailable) {
    throw new Error(`Requested backend port ${backendPort} is already in use.`);
  }

  const backendPortStr = String(backendPort);
  const backendUrl = `http://127.0.0.1:${backendPortStr}`;

  console.log('------------------------------------------------------------');
  console.log('🚀 [Didar Gold] Starting Dual-Service Microarchitecture');
  console.log(`📡 Backend API Service: http://0.0.0.0:${backendPortStr}`);
  console.log(`💻 Frontend UI Service:  http://0.0.0.0:${FRONTEND_PORT}`);
  console.log(`🔗 API Base URL:         ${backendUrl}`);
  console.log('------------------------------------------------------------\n');

  function attachLogs(proc: ChildProcess, label: string, color: string) {
    proc.stdout?.on('data', (data) => {
      for (const line of data.toString().trim().split('\n')) {
        if (line) console.log(`\x1b[${color}m[${label}]\x1b[0m ${line}`);
      }
    });
    proc.stderr?.on('data', (data) => {
      for (const line of data.toString().trim().split('\n')) {
        if (line) console.error(`\x1b[31m[${label} ERR]\x1b[0m ${line}`);
      }
    });
  }

  function startBackend(): ChildProcess {
    const backendEnv = {
      ...process.env,
      PORT: backendPortStr,
      BACKEND_PORT: backendPortStr,
      NODE_ENV: process.env.NODE_ENV || 'development',
      CORS_ALLOWED_ORIGIN: process.env.CORS_ALLOWED_ORIGIN || `http://localhost:${FRONTEND_PORT}`,
    };

    const proc = spawn(npxCommand, ['tsx', 'server.ts'], {
      env: backendEnv,
      shell: false,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    attachLogs(proc, `BACKEND :${backendPortStr}`, '36');
    proc.on('exit', (code) => {
      console.log(`\x1b[33m[BACKEND :${backendPortStr}] Exited with code ${code}\x1b[0m`);
    });
    return proc;
  }

  function startFrontend(): ChildProcess {
    const frontendEnv = {
      ...process.env,
      FRONTEND_PORT,
      VITE_API_BASE_URL: backendUrl,
    };

    const proc = spawn(npxCommand, ['vite', '--port', FRONTEND_PORT, '--host', '0.0.0.0'], {
      env: frontendEnv,
      shell: false,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    attachLogs(proc, `FRONTEND:${FRONTEND_PORT}`, '32');
    proc.on('exit', (code) => {
      console.log(`\x1b[33m[FRONTEND:${FRONTEND_PORT}] Exited with code ${code}\x1b[0m`);
    });
    return proc;
  }

  async function waitForBackendDatabaseHealth(port: number, timeoutMs = 30000): Promise<void> {
    const start = Date.now();
    let lastState = 'unreachable';

    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`);
        const body: any = await res.json().catch(() => null);
        const appStatus = body?.status;
        const dbStatus = body?.database?.status;
        lastState = `http=${res.status}, app=${appStatus || 'unknown'}, db=${dbStatus || 'unknown'}`;

        const databaseHealthy = dbStatus === 'healthy' || dbStatus === 'connected';
        if (res.ok && appStatus === 'ok' && databaseHealthy) {
          console.log(
            `\x1b[32m[Runner] Backend + database confirmed healthy on port ${port}. Launching Frontend UI...\x1b[0m`
          );
          return;
        }

        if (appStatus === 'degraded' || dbStatus === 'error') {
          throw new Error(`Backend reported database failure (${lastState}).`);
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('database failure')) throw err;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(
      `Backend did not become database-healthy within ${timeoutMs}ms. Last observed state: ${lastState}. Frontend was not started.`
    );
  }

  const backendProc = startBackend();
  children.push(backendProc);

  await waitForBackendDatabaseHealth(backendPort);

  const frontendProc = startFrontend();
  children.push(frontendProc);
}

function cleanup(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  console.log(`\n🛑 [Didar Gold] Received ${signal}. Shutting down all services gracefully...`);

  for (const child of children) {
    if (child && !child.killed) {
      try {
        child.kill('SIGTERM');
      } catch {
        // Best-effort child shutdown.
      }
    }
  }

  const deadline = setTimeout(() => process.exit(exitCode), 2500);
  deadline.unref();
}

process.once('SIGINT', () => cleanup('SIGINT'));
process.once('SIGTERM', () => cleanup('SIGTERM'));

main().catch((err) => {
  console.error('[Didar Gold Runner] Fatal startup error:', err);
  cleanup('startup failure', 1);
});
