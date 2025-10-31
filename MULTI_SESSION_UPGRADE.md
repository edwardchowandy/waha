# Multi-Session Upgrade Guide

## 🎉 What's New

This upgrade transforms WAHA Core from single-session to full multi-session support with advanced features previously available only in WAHA Plus.

### Features Implemented

- ✅ **Unlimited Sessions**: Run multiple WhatsApp accounts simultaneously
- ✅ **Session Persistence**: Sessions automatically restore after server restart
- ✅ **Worker Distribution**: Horizontal scaling with multiple WAHA instances
- ✅ **Health Monitoring**: Track session health, metrics, and performance
- ✅ **Prometheus Integration**: Export metrics for monitoring tools

---

## 🚀 Quick Start

### Creating Multiple Sessions

Previously, only the `default` session was allowed. Now you can create unlimited sessions:

```bash
# Create first session
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "whatsapp-sales",
    "start": true,
    "config": {}
  }'

# Create second session
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "whatsapp-support",
    "start": true,
    "config": {}
  }'

# Create third session
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "whatsapp-marketing",
    "start": true,
    "config": {}
  }'
```

### List All Sessions

```bash
curl http://localhost:3000/api/sessions?all=true
```

---

## 📦 Session Persistence

### How It Works

Sessions are now automatically saved to disk in `.sessions/<engine>/<session-name>/` with a `.waha.session.config.json` file.

### Auto-Restart on Server Reboot

Enable automatic session restart with environment variable:

```bash
# In your .env file
WHATSAPP_RESTART_ALL_SESSIONS=true
```

Now when you restart the server:
```bash
docker-compose restart
```

All previously created sessions will be automatically restored and started!

### Manual Session Management

```bash
# Stop a session (keeps config)
curl -X POST http://localhost:3000/api/sessions/whatsapp-sales/stop

# Restart a session
curl -X POST http://localhost:3000/api/sessions/whatsapp-sales/restart

# Delete session permanently
curl -X DELETE http://localhost:3000/api/sessions/whatsapp-sales
```

---

## 🔄 Worker-Based Distribution

### What is Worker Distribution?

Scale horizontally by running multiple WAHA instances (workers) that share sessions. Each session is assigned to a specific worker.

### Setup Multiple Workers

#### 1. Create `docker-compose.workers.yaml`

```yaml
version: '3'
services:
  # Dashboard/API Gateway (doesn't run sessions)
  waha-dashboard:
    image: your-modified-waha-core:latest
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      - WAHA_WORKER_ID=dashboard
      - WAHA_WORKER_RESTART_SESSIONS=false
    volumes:
      - ./sessions:/app/.sessions
      - ./media:/app/.media

  # Worker 1
  waha-worker-1:
    image: your-modified-waha-core:latest
    ports:
      - "127.0.0.1:3001:3000"
    environment:
      - WAHA_WORKER_ID=worker-1
      - WAHA_WORKER_RESTART_SESSIONS=true
      - WAHA_BASE_URL=http://localhost:3001
    volumes:
      - ./sessions:/app/.sessions
      - ./media:/app/.media

  # Worker 2
  waha-worker-2:
    image: your-modified-waha-core:latest
    ports:
      - "127.0.0.1:3002:3000"
    environment:
      - WAHA_WORKER_ID=worker-2
      - WAHA_WORKER_RESTART_SESSIONS=true
      - WAHA_BASE_URL=http://localhost:3002
    volumes:
      - ./sessions:/app/.sessions
      - ./media:/app/.media
```

#### 2. Start Workers

```bash
docker-compose -f docker-compose.workers.yaml up -d
```

#### 3. Create Sessions with Worker Assignment

Sessions are automatically assigned when created, but you can check assignments:

```bash
# View all workers and their sessions
curl http://localhost:3000/api/workers
```

Response:
```json
{
  "currentWorker": "dashboard",
  "workers": [
    {
      "workerId": "worker-1",
      "sessionCount": 5,
      "sessions": ["session1", "session2", "session3", "session4", "session5"]
    },
    {
      "workerId": "worker-2",
      "sessionCount": 3,
      "sessions": ["session6", "session7", "session8"]
    }
  ]
}
```

### Load Balancer Setup (Optional)

For production, use nginx to load balance:

```nginx
# nginx.conf
upstream waha_workers {
    least_conn;
    server localhost:3001;
    server localhost:3002;
}

server {
    listen 3000;
    
    location / {
        proxy_pass http://waha_workers;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 📊 Health Monitoring

### Session Health Endpoint

Get detailed health information for any session:

```bash
curl http://localhost:3000/api/sessions/whatsapp-sales/health
```

Response:
```json
{
  "session": "whatsapp-sales",
  "status": "WORKING",
  "health": {
    "name": "whatsapp-sales",
    "status": "WORKING",
    "uptime": 3600000,
    "lastActivity": "2025-10-29T10:30:00.000Z",
    "messageCount": 1523,
    "errorCount": 2,
    "restartCount": 0
  },
  "engine": {
    "engine": "NOWEB",
    "version": "1.0.0"
  }
}
```

### Health Summary

Get overview of all sessions:

```bash
curl http://localhost:3000/api/health/summary
```

Response:
```json
{
  "total": 8,
  "working": 6,
  "starting": 1,
  "stopped": 0,
  "failed": 1,
  "sessions": [
    {
      "name": "session1",
      "status": "WORKING",
      "health": { ... }
    },
    ...
  ]
}
```

---

## 📈 Prometheus Metrics

### Metrics Endpoint

```bash
curl http://localhost:3000/api/metrics
```

Response (Prometheus format):
```
# HELP waha_sessions_total Total number of sessions
# TYPE waha_sessions_total gauge
waha_sessions_total 8

# HELP waha_sessions_running Running sessions
# TYPE waha_sessions_running gauge
waha_sessions_running 6

# HELP waha_sessions_failed Failed sessions
# TYPE waha_sessions_failed gauge
waha_sessions_failed 1

waha_session_messages_total{session="whatsapp-sales"} 1523
waha_session_errors_total{session="whatsapp-sales"} 2
waha_session_restarts_total{session="whatsapp-sales"} 0
waha_session_uptime_seconds{session="whatsapp-sales"} 3600
```

### Prometheus Configuration

Add to `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'waha'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/api/metrics'
    scrape_interval: 30s
```

### Grafana Dashboard

Import our Grafana dashboard template (create `grafana-dashboard.json`):

```json
{
  "dashboard": {
    "title": "WAHA Multi-Session Monitoring",
    "panels": [
      {
        "title": "Total Sessions",
        "targets": [
          {
            "expr": "waha_sessions_total"
          }
        ]
      },
      {
        "title": "Running Sessions",
        "targets": [
          {
            "expr": "waha_sessions_running"
          }
        ]
      },
      {
        "title": "Messages per Session",
        "targets": [
          {
            "expr": "rate(waha_session_messages_total[5m])"
          }
        ]
      }
    ]
  }
}
```

---

## 🔧 Configuration Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WHATSAPP_RESTART_ALL_SESSIONS` | `false` | Auto-restart all sessions on server boot |
| `WAHA_WORKER_ID` | `""` | Worker identifier for distribution (leave empty for standalone) |
| `WAHA_WORKER_RESTART_SESSIONS` | `true` | Whether worker should restart its assigned sessions |
| `WAHA_BASE_URL` | `http://localhost:3000` | Base URL for this WAHA instance |

### Session Config Example

```json
{
  "name": "my-session",
  "config": {
    "debug": false,
    "proxy": {
      "server": "http://proxy.example.com:8080",
      "username": "user",
      "password": "pass"
    },
    "webhooks": [
      {
        "url": "https://my-app.com/webhooks",
        "events": ["message", "message.any"],
        "hmac": {
          "key": "your-secret-key"
        }
      }
    ],
    "metadata": {
      "customer_id": "12345",
      "department": "sales"
    }
  }
}
```

---

## 🔒 Security Notes

### API Key Protection

All endpoints respect the existing API key authentication:

```bash
# Set API key
export WHATSAPP_API_KEY=your-secret-key

# Use in requests
curl -H "X-Api-Key: your-secret-key" \
  http://localhost:3000/api/sessions
```

### Worker Communication

When using multiple workers, ensure they share the same:
- `.sessions` directory (volume mount)
- Database (SQLite file in `.sessions`)
- API key configuration

---

## 🐛 Troubleshooting

### Session Not Restoring After Restart

**Problem**: Sessions don't auto-start after server restart

**Solution**:
```bash
# Check if environment variable is set
echo $WHATSAPP_RESTART_ALL_SESSIONS

# Should output: true
# If not, add to .env file:
WHATSAPP_RESTART_ALL_SESSIONS=true
```

### Worker Not Picking Up Sessions

**Problem**: Worker shows 0 assigned sessions

**Solution**:
```bash
# Check worker ID is set
curl http://localhost:3001/api/workers

# Manually assign session to worker (from dashboard)
curl -X POST http://localhost:3000/api/sessions/mysession \
  -H "Content-Type: application/json" \
  -d '{"config": {}}'
```

The session will be automatically assigned when created.

### High Memory Usage

**Problem**: Running many sessions causes high memory

**Solution**:
- Distribute sessions across multiple workers
- Increase Docker memory limits
- Consider using NOWEB engine (lower memory footprint)

```yaml
# docker-compose.yaml
services:
  waha:
    deploy:
      resources:
        limits:
          memory: 4G
```

---

## 📚 API Reference

### New Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sessions/:session/health` | Get session health metrics |
| GET | `/api/workers` | List all workers and assignments |
| GET | `/api/metrics` | Prometheus metrics |
| GET | `/api/health/summary` | Health summary of all sessions |

### Modified Endpoints

All session endpoints now support any session name (not just `default`):

- `POST /api/sessions` - Create any session
- `GET /api/sessions/:session` - Get any session
- `POST /api/sessions/:session/start` - Start any session
- `POST /api/sessions/:session/stop` - Stop any session
- `DELETE /api/sessions/:session` - Delete any session

---

## 🎓 Migration Guide

### From Single Session (Old)

**Before:**
```bash
# Only 'default' session worked
curl -X POST http://localhost:3000/api/sessions/start
```

**After:**
```bash
# Create named sessions
curl -X POST http://localhost:3000/api/sessions \
  -d '{"name": "my-session", "start": true}'
```

### Backwards Compatibility

The `default` session still works for backwards compatibility:

```bash
# This still works
curl -X POST http://localhost:3000/api/default/start
```

---

## 🚦 Performance Tips

### Optimal Session Distribution

- **Small scale (1-10 sessions)**: Single instance is fine
- **Medium scale (10-50 sessions)**: 2-3 workers
- **Large scale (50+ sessions)**: 5+ workers with load balancer

### Resource Requirements per Session

- **WEBJS**: ~200-300MB RAM per session
- **NOWEB**: ~100-150MB RAM per session
- **GOWS**: ~80-120MB RAM per session

### Best Practices

1. **Session Naming**: Use descriptive names like `customer-{id}` or `dept-{name}`
2. **Worker Distribution**: Distribute evenly (use least-conn in nginx)
3. **Monitoring**: Set up Prometheus + Grafana for production
4. **Backups**: `.sessions` directory contains all session data - back it up!
5. **Cleanup**: Regularly delete unused sessions to free resources

---

## 📝 Changelog

### v1.0.0 - Multi-Session Upgrade

**Breaking Changes:**
- None! Fully backwards compatible

**New Features:**
- Multi-session support (unlimited sessions)
- Session persistence and auto-restore
- Worker-based distribution
- Health monitoring endpoints
- Prometheus metrics export
- Session health tracking

**Bug Fixes:**
- Fixed session cleanup on shutdown
- Improved error handling for session operations

---

## 🆘 Support

For issues or questions:

1. Check this documentation
2. Review the troubleshooting section
3. Check GitHub issues
4. Open a new issue with logs and configuration

---

## 📄 License

This upgrade maintains the same license as WAHA Core.

---

**Happy Multi-Session WhatsApping! 🎉📱**

