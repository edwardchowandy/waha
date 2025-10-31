# 🚀 Deployment Checklist

## Pre-Deployment

### Code Verification
- [ ] All files modified without syntax errors
- [ ] New files created successfully
- [ ] Import statements are correct
- [ ] TypeScript compilation passes

### Build & Test
```bash
# 1. Install dependencies
yarn install

# 2. Build project
yarn build

# 3. Run tests (if available)
yarn test

# 4. Check linting
yarn lint
```

### Environment Setup
- [ ] `.env` file configured
- [ ] Environment variables set:
  ```bash
  # Optional: Enable auto-restart
  WHATSAPP_RESTART_ALL_SESSIONS=true
  
  # Optional: Worker mode
  WAHA_WORKER_ID=worker-1
  WAHA_WORKER_RESTART_SESSIONS=true
  ```

---

## Docker Deployment

### Build Container
```bash
# Build image
docker build -t waha-multi-session:latest .

# Or with docker-compose
docker-compose build
```

### Start Services
```bash
# Start WAHA
docker-compose up -d

# Check logs
docker-compose logs -f waha

# Verify it's running
curl http://localhost:3000/api/sessions
```

### Verify Deployment
```bash
# 1. Health check
curl http://localhost:3000/ping

# 2. Create test session
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"name": "test-session"}'

# 3. List sessions
curl http://localhost:3000/api/sessions?all=true

# 4. Check health endpoint
curl http://localhost:3000/api/health/summary

# 5. Check metrics
curl http://localhost:3000/api/metrics | head -20
```

---

## Post-Deployment

### Functional Tests
- [ ] Create multiple sessions
- [ ] Start a session
- [ ] Stop a session
- [ ] Delete a session
- [ ] Restart server and verify sessions restore
- [ ] Check health endpoints
- [ ] Verify metrics endpoint

### Performance Tests
- [ ] Create 5 sessions simultaneously
- [ ] Monitor memory usage: `docker stats waha`
- [ ] Check response times
- [ ] Verify no memory leaks after 1 hour

### Monitoring Setup
```bash
# Optional: Setup Prometheus
docker run -d --name prometheus \
  -p 9090:9090 \
  -v /path/to/prometheus.yml:/etc/prometheus/prometheus.yml \
  prom/prometheus

# Add to prometheus.yml:
# scrape_configs:
#   - job_name: 'waha'
#     static_configs:
#       - targets: ['host.docker.internal:3000']
#     metrics_path: '/api/metrics'
```

---

## Rollback Plan

If issues occur:

```bash
# 1. Stop services
docker-compose down

# 2. Restore backup (if needed)
mv .sessions.backup .sessions

# 3. Checkout previous version
git stash
git checkout <previous-commit>

# 4. Rebuild and start
docker-compose build
docker-compose up -d
```

---

## Files Changed Summary

### Modified Files
1. `src/core/manager.core.ts` - Core multi-session logic
2. `src/core/app.module.core.ts` - Controller registration

### New Files
1. `src/api/sessions.health.controller.ts` - Health & monitoring endpoints
2. `MULTI_SESSION_UPGRADE.md` - User documentation
3. `TECHNICAL_CHANGES.md` - Developer documentation
4. `examples/multi-session-demo.sh` - Demo script
5. `IMPLEMENTATION_SUMMARY.md` - Project summary
6. `DEPLOYMENT_CHECKLIST.md` - This file

---

## Quick Commands Reference

### Session Management
```bash
# Create session
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"name": "my-session", "start": true}'

# List sessions
curl http://localhost:3000/api/sessions?all=true

# Start session
curl -X POST http://localhost:3000/api/sessions/my-session/start

# Stop session
curl -X POST http://localhost:3000/api/sessions/my-session/stop

# Delete session
curl -X DELETE http://localhost:3000/api/sessions/my-session
```

### Monitoring
```bash
# Health check
curl http://localhost:3000/api/sessions/my-session/health

# Health summary
curl http://localhost:3000/api/health/summary

# Metrics
curl http://localhost:3000/api/metrics

# Workers
curl http://localhost:3000/api/workers
```

---

## Troubleshooting

### Build Fails
```bash
# Clean and rebuild
rm -rf node_modules dist
yarn install
yarn build
```

### Sessions Not Persisting
```bash
# Check storage directory
ls -la .sessions/

# Check permissions
chmod -R 755 .sessions/

# Check volume mount in docker-compose.yaml
# volumes:
#   - ./sessions:/app/.sessions
```

### High Memory Usage
```bash
# Check container stats
docker stats waha

# Reduce session count or use workers
# Set resource limits in docker-compose.yaml:
# deploy:
#   resources:
#     limits:
#       memory: 2G
```

### Workers Not Working
```bash
# Verify worker ID is set
docker-compose exec waha env | grep WAHA_WORKER_ID

# Check worker database
docker-compose exec waha sqlite3 .sessions/noweb/waha.sqlite3 \
  "SELECT * FROM session_worker;"
```

---

## Support Contacts

- **Documentation**: See MULTI_SESSION_UPGRADE.md
- **Technical Details**: See TECHNICAL_CHANGES.md  
- **Issues**: Check GitHub issues
- **Questions**: Review FAQ in documentation

---

## Success Criteria

Deployment is successful when:
- ✅ All endpoints respond
- ✅ Can create multiple sessions
- ✅ Sessions persist after restart
- ✅ Health endpoints return data
- ✅ Metrics endpoint works
- ✅ No memory leaks observed
- ✅ Response times acceptable

---

## Next Steps After Deployment

1. **Monitor for 24 hours**
   - Watch logs: `docker-compose logs -f`
   - Monitor resources: `docker stats`
   - Check health: `curl localhost:3000/api/health/summary`

2. **Create Actual Sessions**
   - Replace test sessions with real ones
   - Configure webhooks
   - Setup proper metadata

3. **Setup Production Monitoring**
   - Configure Prometheus scraping
   - Create Grafana dashboards
   - Set up alerts

4. **Implement Backups**
   - Backup `.sessions` directory daily
   - Test restore procedure
   - Document backup strategy

5. **Scale if Needed**
   - Add more workers for 50+ sessions
   - Setup load balancer
   - Test worker failover

---

## Production Readiness Checklist

### Infrastructure
- [ ] SSL/TLS configured (if exposed to internet)
- [ ] Firewall rules configured
- [ ] Resource limits set
- [ ] Volume backups enabled
- [ ] Logging aggregation configured

### Security
- [ ] API key authentication enabled
- [ ] Strong API key generated
- [ ] Network access restricted
- [ ] Container running as non-root (check Dockerfile)
- [ ] Secrets not in version control

### Monitoring
- [ ] Health checks configured
- [ ] Prometheus scraping setup
- [ ] Grafana dashboards created
- [ ] Alerts configured
- [ ] Log monitoring setup

### Operations
- [ ] Backup procedure documented
- [ ] Restore procedure tested
- [ ] Rollback plan documented
- [ ] On-call rotation defined
- [ ] Runbook created

---

## Validation Tests

Run these tests after deployment:

```bash
#!/bin/bash
# validation-tests.sh

echo "Running validation tests..."

# Test 1: Ping
echo "Test 1: Ping endpoint"
curl -f http://localhost:3000/ping || exit 1

# Test 2: Create session
echo "Test 2: Create session"
curl -f -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"name": "validation-test"}' || exit 1

# Test 3: List sessions
echo "Test 3: List sessions"
curl -f http://localhost:3000/api/sessions?all=true || exit 1

# Test 4: Health summary
echo "Test 4: Health summary"
curl -f http://localhost:3000/api/health/summary || exit 1

# Test 5: Metrics
echo "Test 5: Metrics endpoint"
curl -f http://localhost:3000/api/metrics || exit 1

# Test 6: Delete session
echo "Test 6: Delete session"
curl -f -X DELETE http://localhost:3000/api/sessions/validation-test || exit 1

echo "All validation tests passed! ✅"
```

Make it executable and run:
```bash
chmod +x validation-tests.sh
./validation-tests.sh
```

---

**Deployment Status: Ready to Deploy! 🚀**

All code changes are complete and ready for deployment. Follow this checklist to ensure a smooth rollout.

