import {
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AppsService,
  IAppsService,
} from '@waha/apps/app_sdk/services/IAppsService';
import { EngineBootstrap } from '@waha/core/abc/EngineBootstrap';
import { GowsEngineConfigService } from '@waha/core/config/GowsEngineConfigService';
import { WebJSEngineConfigService } from '@waha/core/config/WebJSEngineConfigService';
import { WhatsappSessionGoWSCore } from '@waha/core/engines/gows/session.gows.core';
import { WebhookConductor } from '@waha/core/integrations/webhooks/WebhookConductor';
import { MediaStorageFactory } from '@waha/core/media/MediaStorageFactory';
import { DefaultMap } from '@waha/utils/DefaultMap';
import { getPinoLogLevel, LoggerBuilder } from '@waha/utils/logging';
import { promiseTimeout, sleep } from '@waha/utils/promiseTimeout';
import { complete } from '@waha/utils/reactive/complete';
import { SwitchObservable } from '@waha/utils/reactive/SwitchObservable';
import { PinoLogger } from 'nestjs-pino';
import { Observable, retry, share } from 'rxjs';
import { map } from 'rxjs/operators';

import { WhatsappConfigService } from '../config.service';
import {
  WAHAEngine,
  WAHAEvents,
  WAHASessionStatus,
} from '../structures/enums.dto';
import {
  ProxyConfig,
  SessionConfig,
  SessionDetailedInfo,
  SessionDTO,
  SessionInfo,
} from '../structures/sessions.dto';
import { WebhookConfig } from '../structures/webhooks.config.dto';
import { populateSessionInfo, SessionManager } from './abc/manager.abc';
import { SessionParams, WhatsappSession } from './abc/session.abc';
import { EngineConfigService } from './config/EngineConfigService';
import { WhatsappSessionNoWebCore } from './engines/noweb/session.noweb.core';
import { WhatsappSessionWebJSCore } from './engines/webjs/session.webjs.core';
import { DOCS_URL } from './exceptions';
import { getProxyConfig } from './helpers.proxy';
import { MediaManager } from './media/MediaManager';
import { LocalSessionAuthRepository } from './storage/LocalSessionAuthRepository';
import { LocalSessionConfigRepository } from './storage/LocalSessionConfigRepository';
import { LocalStoreCore } from './storage/LocalStoreCore';
import { Sqlite3SessionWorkerRepository } from './storage/sqlite3/Sqlite3SessionWorkerRepository';

export class OnlyDefaultSessionIsAllowed extends UnprocessableEntityException {
  constructor(name: string) {
    const encoded = Buffer.from(name, 'utf-8').toString('base64');
    super(
      `WAHA Core support only 'default' session. You tried to access '${name}' session (base64: ${encoded}). ` +
        `If you want to run more then one WhatsApp account - please get WAHA PLUS version. Check this out: ${DOCS_URL}`,
    );
  }
}

enum DefaultSessionStatus {
  REMOVED = undefined,
  STOPPED = null,
}

interface SessionHealth {
  name: string;
  status: WAHASessionStatus;
  uptime: number;
  lastActivity: Date;
  messageCount: number;
  errorCount: number;
  restartCount: number;
}

@Injectable()
export class SessionManagerCore extends SessionManager implements OnModuleInit {
  SESSION_STOP_TIMEOUT = 3000;

  // Multi-session support
  private sessions: Map<string, WhatsappSession> = new Map();
  private sessionConfigs: Map<string, SessionConfig> = new Map();
  private sessionStatuses: Map<string, DefaultSessionStatus> = new Map();
  private sessionHealthMap: Map<string, SessionHealth> = new Map();

  protected readonly EngineClass: typeof WhatsappSession;
  protected events2: DefaultMap<WAHAEvents, SwitchObservable<any>>;
  protected readonly engineBootstrap: EngineBootstrap;

  constructor(
    config: WhatsappConfigService,
    private engineConfigService: EngineConfigService,
    private webjsEngineConfigService: WebJSEngineConfigService,
    gowsConfigService: GowsEngineConfigService,
    log: PinoLogger,
    private mediaStorageFactory: MediaStorageFactory,
    @Inject(AppsService)
    appsService: IAppsService,
  ) {
    super(log, config, gowsConfigService, appsService);
    const engineName = this.engineConfigService.getDefaultEngineName();
    this.EngineClass = this.getEngine(engineName);
    this.engineBootstrap = this.getEngineBootstrap(engineName);

    this.events2 = new DefaultMap<WAHAEvents, SwitchObservable<any>>(
      (key) =>
        new SwitchObservable((obs$) => {
          return obs$.pipe(retry(), share());
        }),
    );

    this.store = new LocalStoreCore(engineName.toLowerCase());
    this.sessionAuthRepository = new LocalSessionAuthRepository(this.store);
    this.sessionConfigRepository = new LocalSessionConfigRepository(this.store);
    
    // Initialize worker repository if worker ID is set
    if (this.config.workerId) {
      this.sessionWorkerRepository = new Sqlite3SessionWorkerRepository(
        this.store,
      );
      this.log.info(
        `Worker mode enabled with ID: ${this.config.workerId}`,
      );
    }
    
    this.clearStorage().catch((error) => {
      this.log.error({ error }, 'Error while clearing storage');
    });
  }

  protected getEngine(engine: WAHAEngine): typeof WhatsappSession {
    if (engine === WAHAEngine.WEBJS) {
      return WhatsappSessionWebJSCore;
    } else if (engine === WAHAEngine.NOWEB) {
      return WhatsappSessionNoWebCore;
    } else if (engine === WAHAEngine.GOWS) {
      return WhatsappSessionGoWSCore;
    } else {
      throw new NotFoundException(`Unknown whatsapp engine '${engine}'.`);
    }
  }

  async beforeApplicationShutdown(signal?: string) {
    // Stop all running sessions
    const sessionNames = Array.from(this.sessions.keys());
    for (const name of sessionNames) {
      await this.stop(name, true);
    }
    this.stopEvents();
    await this.engineBootstrap.shutdown();
  }

  async onApplicationBootstrap() {
    await this.engineBootstrap.bootstrap();
    await this.restorePersistedSessions();
    this.startPredefinedSessions();
  }

  private async clearStorage() {
    const storage = await this.mediaStorageFactory.build(
      'all',
      this.log.logger.child({ name: 'Storage' }),
    );
    await storage.purge();
  }

  //
  // API Methods
  //
  async exists(name: string): Promise<boolean> {
    return (
      this.sessions.has(name) ||
      this.sessionStatuses.has(name) ||
      (await this.sessionConfigRepository.exists(name))
    );
  }

  isRunning(name: string): boolean {
    return this.sessions.has(name);
  }

  async upsert(name: string, config?: SessionConfig): Promise<void> {
    if (config) {
      this.sessionConfigs.set(name, config);
      await this.sessionConfigRepository.saveConfig(name, config);
    }
    // Mark as exists but not started
    if (!this.sessions.has(name)) {
      this.sessionStatuses.set(name, DefaultSessionStatus.STOPPED);
    }
  }

  async start(name: string): Promise<SessionDTO> {
    if (this.sessions.has(name)) {
      throw new UnprocessableEntityException(
        `Session '${name}' is already started.`,
      );
    }
    this.log.info({ session: name }, `Starting session...`);
    const sessionConfig = this.sessionConfigs.get(name);
    const logger = this.log.logger.child({ session: name });
    logger.level = getPinoLogLevel(sessionConfig?.debug);
    const loggerBuilder: LoggerBuilder = logger;

    const storage = await this.mediaStorageFactory.build(
      name,
      loggerBuilder.child({ name: 'Storage' }),
    );
    await storage.init();
    const mediaManager = new MediaManager(
      storage,
      this.config.mimetypes,
      loggerBuilder.child({ name: 'MediaManager' }),
    );

    const webhook = new WebhookConductor(loggerBuilder);
    const proxyConfig = this.getProxyConfig(name);
    const sessionParams: SessionParams = {
      name,
      mediaManager,
      loggerBuilder,
      printQR: this.engineConfigService.shouldPrintQR,
      sessionStore: this.store,
      proxyConfig: proxyConfig,
      sessionConfig: sessionConfig,
      ignore: this.ignoreChatsConfig(sessionConfig),
    };
    if (this.EngineClass === WhatsappSessionWebJSCore) {
      sessionParams.engineConfig = this.webjsEngineConfigService.getConfig();
    } else if (this.EngineClass === WhatsappSessionGoWSCore) {
      sessionParams.engineConfig = this.gowsConfigService.getConfig();
    }
    await this.sessionAuthRepository.init(name);
    // @ts-ignore
    const session = new this.EngineClass(sessionParams);
    this.sessions.set(name, session);
    this.sessionStatuses.delete(name);
    this.updateSession(name, session);
    this.subscribeToSessionEvents(name, session);

    // configure webhooks
    const webhooks = this.getWebhooks(name);
    webhook.configure(session, webhooks);

    // Apps
    await this.appsService.beforeSessionStart(session, this.store);

    // start session
    await session.start();
    logger.info('Session has been started.');

    // Apps
    await this.appsService.afterSessionStart(session, this.store);

    return {
      name: session.name,
      status: session.status,
      config: session.sessionConfig,
    };
  }

  private updateSession(name: string, session?: WhatsappSession) {
    if (!session) {
      // Clean up events for this session
      return;
    }
    // Create events observable specific to this session
    for (const eventName in WAHAEvents) {
      const event = WAHAEvents[eventName];
      const stream$ = session
        .getEventObservable(event)
        .pipe(map(populateSessionInfo(event, session)));
      this.events2.get(event).switch(stream$);
    }
  }

  getSessionEvent(session: string, event: WAHAEvents): Observable<any> {
    return this.events2.get(event);
  }

  async stop(name: string, silent: boolean): Promise<void> {
    if (!this.isRunning(name)) {
      this.log.debug({ session: name }, `Session is not running.`);
      return;
    }

    this.log.info({ session: name }, `Stopping session...`);
    try {
      const session = this.getSession(name);
      await session.stop();
    } catch (err) {
      this.log.warn(`Error while stopping session '${name}'`);
      if (!silent) {
        throw err;
      }
    }
    this.log.info({ session: name }, `Session has been stopped.`);
    this.sessions.delete(name);
    this.sessionStatuses.set(name, DefaultSessionStatus.STOPPED);
    this.updateSession(name);
    await sleep(this.SESSION_STOP_TIMEOUT);
  }

  async unpair(name: string) {
    const session = this.sessions.get(name);
    if (!session) {
      return;
    }

    this.log.info({ session: name }, 'Unpairing the device from account...');
    await session.unpair().catch((err) => {
      this.log.warn(`Error while unpairing from device: ${err}`);
    });
    await sleep(1000);
  }

  async logout(name: string): Promise<void> {
    await this.sessionAuthRepository.clean(name);
  }

  async delete(name: string): Promise<void> {
    this.sessions.delete(name);
    this.sessionStatuses.set(name, DefaultSessionStatus.REMOVED);
    this.sessionConfigs.delete(name);
    await this.sessionConfigRepository.deleteConfig(name);
    this.updateSession(name);
  }

  /**
   * Combine per session and global webhooks
   */
  private getWebhooks(name: string) {
    let webhooks: WebhookConfig[] = [];
    const sessionConfig = this.sessionConfigs.get(name);
    if (sessionConfig?.webhooks) {
      webhooks = webhooks.concat(sessionConfig.webhooks);
    }
    const globalWebhookConfig = this.config.getWebhookConfig();
    if (globalWebhookConfig) {
      webhooks.push(globalWebhookConfig);
    }
    return webhooks;
  }

  /**
   * Get either session's or global proxy if defined
   */
  protected getProxyConfig(name: string): ProxyConfig | undefined {
    const sessionConfig = this.sessionConfigs.get(name);
    if (sessionConfig?.proxy) {
      return sessionConfig.proxy;
    }
    const session = this.sessions.get(name);
    if (!session) {
      return undefined;
    }
    const sessionsObj = Object.fromEntries(this.sessions);
    return getProxyConfig(this.config, sessionsObj, name);
  }

  getSession(name: string): WhatsappSession {
    const session = this.sessions.get(name);
    if (!session) {
      throw new NotFoundException(
        `We didn't find a session with name '${name}'.\n` +
          `Please start it first by using POST /api/sessions/${name}/start request`,
      );
    }
    return session;
  }

  async getSessions(all: boolean): Promise<SessionInfo[]> {
    const result: SessionInfo[] = [];

    // Add running sessions
    for (const [name, session] of this.sessions.entries()) {
      const me = session.getSessionMeInfo();
      result.push({
        name: session.name,
        status: session.status,
        config: session.sessionConfig,
        me: me,
      });
    }

    // Add stopped/removed sessions if 'all' is requested
    if (all) {
      for (const [name, status] of this.sessionStatuses.entries()) {
        if (status === DefaultSessionStatus.REMOVED) {
          continue; // Skip removed sessions
        }
        const config = this.sessionConfigs.get(name);
        result.push({
          name: name,
          status: WAHASessionStatus.STOPPED,
          config: config,
          me: null,
        });
      }
    }

    return result;
  }

  private async fetchEngineInfo(name: string) {
    const session = this.sessions.get(name);
    // Get engine info
    let engineInfo = {};
    if (session) {
      try {
        engineInfo = await promiseTimeout(1000, session.getEngineInfo());
      } catch (error) {
        this.log.debug(
          { session: session.name, error: `${error}` },
          'Can not get engine info',
        );
      }
    }
    const engine = {
      engine: session?.engine,
      ...engineInfo,
    };
    return engine;
  }

  async getSessionInfo(name: string): Promise<SessionDetailedInfo | null> {
    const sessions = await this.getSessions(true);
    const session = sessions.find((s) => s.name === name);
    if (!session) {
      return null;
    }
    const engine = await this.fetchEngineInfo(name);
    return { ...session, engine: engine };
  }

  protected stopEvents() {
    complete(this.events2);
  }

  async onModuleInit() {
    await this.init();
  }

  async init() {
    await this.store.init();
    const knex = this.store.getWAHADatabase();
    await this.appsService.migrate(knex);
    
    // Initialize worker repository
    if (this.sessionWorkerRepository) {
      await this.sessionWorkerRepository.init();
    }
  }

  /**
   * Restore persisted sessions from storage
   */
  private async restorePersistedSessions() {
    this.log.info('Restoring persisted sessions...');

    try {
      // Get all session names from disk
      let sessionNames = await this.sessionConfigRepository.getAllConfigs();

      // Filter by worker if workerId is set
      if (this.config.workerId && this.sessionWorkerRepository) {
        const workerSessions =
          await this.sessionWorkerRepository.getSessionsByWorker(
            this.config.workerId,
          );
        sessionNames = sessionNames.filter((name) =>
          workerSessions.includes(name),
        );
        this.log.info(
          `Worker ${this.config.workerId} has ${sessionNames.length} assigned session(s)`,
        );
      }

      const shouldAutoRestart = this.config.shouldRestartAllSessions;

      for (const name of sessionNames) {
        const config = await this.sessionConfigRepository.getConfig(name);
        if (config) {
          this.sessionConfigs.set(name, config);
          this.sessionStatuses.set(name, DefaultSessionStatus.STOPPED);
          this.log.info({ session: name }, 'Session restored from storage');

          // Auto-start if flag is enabled
          if (shouldAutoRestart) {
            this.withLock(name, async () => {
              await this.start(name).catch((err) => {
                this.log.error(
                  { session: name, error: err },
                  'Failed to auto-restart',
                );
              });
            });
          }
        }
      }

      this.log.info(`Restored ${sessionNames.length} session(s)`);
    } catch (error) {
      this.log.error({ error }, 'Error while restoring persisted sessions');
    }
  }

  /**
   * Subscribe to session events for health tracking
   */
  private subscribeToSessionEvents(name: string, session: WhatsappSession) {
    // Initialize health tracking for this session
    this.sessionHealthMap.set(name, {
      name,
      status: session.status,
      uptime: Date.now(),
      lastActivity: new Date(),
      messageCount: 0,
      errorCount: 0,
      restartCount: 0,
    });

    // Track all events
    for (const eventName in WAHAEvents) {
      const event = WAHAEvents[eventName];
      session.getEventObservable(event).subscribe(() => {
        this.trackSessionHealth(name, event);
      });
    }
  }

  /**
   * Track session health metrics
   */
  private trackSessionHealth(name: string, event: string) {
    const health = this.sessionHealthMap.get(name);
    if (!health) {
      return;
    }

    if (event.includes('message')) {
      health.messageCount++;
    }
    if (event === WAHAEvents.SESSION_STATUS) {
      const session = this.sessions.get(name);
      if (session?.status === WAHASessionStatus.FAILED) {
        health.errorCount++;
      }
    }

    health.lastActivity = new Date();
    this.sessionHealthMap.set(name, health);
  }

  /**
   * Get session health information
   */
  getSessionHealth(name: string): SessionHealth | null {
    const health = this.sessionHealthMap.get(name);
    if (!health) {
      return null;
    }

    // Calculate uptime
    const now = Date.now();
    health.uptime = now - health.uptime;

    return health;
  }
}
