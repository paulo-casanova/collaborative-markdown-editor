# Health Probe API Specification (`GET /api/v1/health`)

The health check endpoint provides real-time operational status, database connectivity, storage capacity, and system latency metrics for orchestrators (Kubernetes liveness/readiness probes, AWS ALB health checks, and Docker container healthchecks).

## Endpoint Overview

* **Path:** `/api/v1/health`
* **Method:** `GET`
* **Authentication:** None (Public / Unauthenticated)
* **Default Port:** `8080` (or configured `--port`)

---

## Response Status Codes

| HTTP Status | Description | Condition |
| :--- | :--- | :--- |
| `200 OK` | System Healthy | Both PostgreSQL and POSIX storage are operational and responding. |
| `503 Service Unavailable` | System Degraded | PostgreSQL connection failed or storage is unwritable / disk full. |

---

## Response Schema (`application/json`)

```json
{
  "status": "healthy",
  "version": "0.1.0",
  "uptime_seconds": 12,
  "database": {
    "status": "connected",
    "latency_ms": 0.78
  },
  "storage": {
    "status": "writable",
    "free_bytes": 107374182400
  },
  "active_collab_rooms": 0
}
```

### Field Definitions

* `status` (`string`): Overall system operational status: `"healthy"` or `"degraded"`.
* `version` (`string`): Application semantic version string.
* `uptime_seconds` (`integer`): Number of seconds elapsed since server startup.
* `database` (`object`):
  * `status` (`string`): `"connected"`, `"disconnected"`, or `"unavailable"`.
  * `latency_ms` (`number`): Round-trip execution latency of a lightweight `SELECT 1;` query.
* `storage` (`object`):
  * `status` (`string`): `"writable"` or `"error"`.
  * `free_bytes` (`integer`): Available disk space on the storage filesystem mount.
* `active_collab_rooms` (`integer`): Number of active collaborative document rooms currently loaded in memory.

---

## Usage Examples

### Manual Query via cURL
```bash
curl -i http://localhost:8080/api/v1/health
```

### Dockerfile Healthcheck Probe
```dockerfile
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/api/v1/health || exit 1
```
