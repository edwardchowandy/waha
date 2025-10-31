import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { SessionManager } from '@waha/core/abc/manager.abc';
import { WAHASessionStatus } from '@waha/structures/enums.dto';

@ApiSecurity('api_key')
@Controller('api/sessions')
@ApiTags('🖥️ Sessions')
export class SessionsHealthController {
  constructor(private manager: SessionManager) {}

  @Get(':session/health')
  @ApiOperation({
    summary: 'Get session health information',
    description: 'Returns detailed health metrics for a specific session',
  })
  async getSessionHealth(@Param('session') name: string) {
    const session = this.manager.getSession(name);
    const health = (this.manager as any).getSessionHealth(name);

    return {
      session: name,
      status: session.status,
      health: health,
      engine: await session.getEngineInfo().catch(() => ({})),
    };
  }
}

@ApiSecurity('api_key')
@Controller('api')
@ApiTags('📊 Monitoring')
export class MonitoringController {
  constructor(private manager: SessionManager) {}

  @Get('workers')
  @ApiOperation({
    summary: 'List all workers and their sessions',
    description: 'Returns information about all workers and their assigned sessions',
  })
  async getWorkers(): Promise<any> {
    const sessionWorkerRepository = (this.manager as any)
      .sessionWorkerRepository;

    if (!sessionWorkerRepository) {
      return {
        currentWorker: this.manager.workerId || 'none',
        workers: [],
        message: 'Worker distribution not enabled',
      };
    }

    const allAssignments = await sessionWorkerRepository.getAll();

    // Group by worker
    const workerMap = new Map<string, string[]>();
    for (const assignment of allAssignments) {
      if (!workerMap.has(assignment.worker)) {
        workerMap.set(assignment.worker, []);
      }
      workerMap.get(assignment.worker).push(assignment.id);
    }

    return {
      currentWorker: this.manager.workerId || 'none',
      workers: Array.from(workerMap.entries()).map(([worker, sessions]) => ({
        workerId: worker,
        sessionCount: sessions.length,
        sessions: sessions,
      })),
    };
  }

  @Get('metrics')
  @ApiOperation({
    summary: 'Get Prometheus-style metrics',
    description: 'Returns metrics in Prometheus text format',
  })
  async getMetrics(): Promise<string> {
    const sessions = await this.manager.getSessions(true);

    let metrics = '';
    metrics += '# HELP waha_sessions_total Total number of sessions\n';
    metrics += '# TYPE waha_sessions_total gauge\n';
    metrics += `waha_sessions_total ${sessions.length}\n\n`;

    metrics += '# HELP waha_sessions_running Running sessions\n';
    metrics += '# TYPE waha_sessions_running gauge\n';
    const running = sessions.filter(
      (s) => s.status === WAHASessionStatus.WORKING,
    ).length;
    metrics += `waha_sessions_running ${running}\n\n`;

    const failed = sessions.filter(
      (s) => s.status === WAHASessionStatus.FAILED,
    ).length;
    metrics += '# HELP waha_sessions_failed Failed sessions\n';
    metrics += '# TYPE waha_sessions_failed gauge\n';
    metrics += `waha_sessions_failed ${failed}\n\n`;

    // Per-session metrics
    for (const session of sessions) {
      const health = (this.manager as any).getSessionHealth(session.name);
      if (health) {
        metrics += `waha_session_messages_total{session="${session.name}"} ${health.messageCount}\n`;
        metrics += `waha_session_errors_total{session="${session.name}"} ${health.errorCount}\n`;
        metrics += `waha_session_restarts_total{session="${session.name}"} ${health.restartCount}\n`;
        metrics += `waha_session_uptime_seconds{session="${session.name}"} ${Math.floor(health.uptime / 1000)}\n`;
      }
    }

    return metrics;
  }

  @Get('health/summary')
  @ApiOperation({
    summary: 'Get health summary of all sessions',
    description: 'Returns a summary of health status for all sessions',
  })
  async getHealthSummary() {
    const sessions = await this.manager.getSessions(true);
    const healthData = [];

    for (const session of sessions) {
      const health = (this.manager as any).getSessionHealth(session.name);
      healthData.push({
        name: session.name,
        status: session.status,
        health: health,
      });
    }

    const summary = {
      total: sessions.length,
      working: sessions.filter((s) => s.status === WAHASessionStatus.WORKING)
        .length,
      starting: sessions.filter((s) => s.status === WAHASessionStatus.STARTING)
        .length,
      stopped: sessions.filter((s) => s.status === WAHASessionStatus.STOPPED)
        .length,
      failed: sessions.filter((s) => s.status === WAHASessionStatus.FAILED)
        .length,
      sessions: healthData,
    };

    return summary;
  }
}

