# Authentication & Authorization API Specification

The Collaborative Markdown Editor (CME) platform provides a pluggable Authentication (AuthN) and Authorization (AuthZ) subsystem supporting both standard browser sessions, Personal Access Tokens (PATs) for programmatic tools and AI agents, and delegated identity assertion from upstream reverse proxies.

---

## Authentication Strategies

### 1. Challenge-Based Authentication (Local Password Credentials)
* **Strategy Name:** `challenge`
* **Mechanism:** Plain-text passwords submitted to `POST /api/v1/auth/login` are verified against salted bcrypt (`$2b$`) password hashes stored in the PostgreSQL `users` table.
* **Token Issuance:** Upon successful verification, a cryptographically secure 256-bit random session token (64 hex characters) is generated using OpenSSL `RAND_bytes`. Its SHA-256 digest is stored in the `sessions` table.
* **Cookie Support:** Returns an `HttpOnly`, `SameSite=Lax` session cookie `cme_session=<token>` for seamless browser consumption.

### 2. Delegated Header-Based Authentication (Reverse Proxy / SSO)
* **Strategy Name:** `delegated`
* **Mechanism:** Upstream reverse proxies (e.g. Authelia, OAuth2-Proxy, Cloudflare Access, Tailscale, Nginx) terminate authentication and forward verified identity headers:
  * `X-Remote-User`: Username handle (configurable via `authn.delegated_header`).
  * `X-Remote-Email`: User email / display name (configurable via `authn.delegated_email_header`).
* **Just-In-Time (JIT) Provisioning:** If the user does not exist in the database, the backend automatically provisions a local user record in PostgreSQL with a disabled password hash (`!`).

---

## High-Level Administrator Privileges (AuthZ)

Superuser privileges bypass all document and directory ACLs. Administrator status is evaluated through pluggable strategies:

### 1. File-Based Admin Provider (`FileAdminProvider`)
* **Configuration:** `authz.admin_provider: "file"`, `authz.admin_file_path: "/etc/cme/admins.txt"`
* **File Formats Supported:**
  * **Line-delimited:** One username per line (comments `#` and whitespace ignored).
  * **CSV:** `username,is_admin` (e.g. `alice,true`).
* **Hot Reload:** Automatically detects file modification timestamp changes without daemon restart.

### 2. Command-Based Admin Provider (`CommandAdminProvider`)
* **Configuration:** `authz.admin_provider: "command"`, `authz.admin_command: "/usr/local/bin/check_admin.sh %USER%"`
* **Evaluation:** Executes script/binary with username substitution. Exit code `0` grants administrator status.
* **Security & Performance:** Rejects shell metacharacters to eliminate injection vulnerabilities and caches evaluation results in memory for a configurable TTL (default 60 seconds).

---

## Endpoints Summary

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/login` | Authenticate with username and password | No |
| `POST` | `/api/v1/auth/logout` | Invalidate current session and clear cookie | Yes |
| `GET` | `/api/v1/auth/me` | Fetch active user profile and effective teams | Yes |
| `POST` | `/api/v1/auth/tokens` | Issue a new Personal Access Token (PAT) | Yes (or credentials) |
| `GET` | `/api/v1/auth/tokens` | List active sessions and tokens for user | Yes |

---

## Detailed Endpoint Reference

### 1. `POST /api/v1/auth/login`
Authenticates a user via credentials, creates an active database session, and sets a session cookie.

#### Request Body
```json
{
  "username": "bob",
  "password": "password123"
}
```

#### Response (`HTTP 200 OK`)
```json
{
  "token": "613bba18e7b0eda46bb05fcf243b85e2b14bec54a06c8db39fd3894d288bff78",
  "expires_at": "2026-10-14T00:30:00Z",
  "user": {
    "id": "a5466d63-8b8f-4694-b1ed-33c31a687f16",
    "username": "bob",
    "display_name": "Bob Tester",
    "avatar_color": "#10b981",
    "is_admin": false
  }
}
```
**Headers:**
`Set-Cookie: cme_session=613bba...; Path=/; Max-Age=259200; HttpOnly; SameSite=Lax`

---

### 2. `POST /api/v1/auth/logout`
Revokes the session token from PostgreSQL and clears the client session cookie.

#### Request Headers
`Authorization: Bearer <token>` or `Cookie: cme_session=<token>`

#### Response (`HTTP 200 OK`)
```json
{
  "status": "logged_out"
}
```
**Headers:**
`Set-Cookie: cme_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=Lax`

---

### 3. `GET /api/v1/auth/me`
Resolves the current caller identity using Bearer token, Cookie, or Delegated header. Also queries PostgreSQL recursive CTEs to return all transitive team memberships.

#### Request Headers
```http
Authorization: Bearer <token>
# OR
Cookie: cme_session=<token>
# OR
X-Remote-User: alice_admin
X-Remote-Email: alice@cme.io
```

#### Response (`HTTP 200 OK`)
```json
{
  "user": {
    "id": "18f987ad-723f-42e1-a083-d3d63b2767a1",
    "username": "alice_admin",
    "display_name": "alice@cme.io",
    "avatar_color": "#3b82f6",
    "is_admin": true
  },
  "effective_teams": [
    "c8a14b03-5188-466d-a602-5ea59f772591",
    "0f89d41e-6275-4384-8848-18e3881ee25c"
  ]
}
```

#### Error Response (`HTTP 401 Unauthorized`)
```json
{
  "error": "Unauthorized",
  "message": "Authentication required"
}
```

---

### 4. `POST /api/v1/auth/tokens`
Issues a Personal Access Token (PAT). Can be called by an existing authenticated session or with challenge credentials in the JSON body.

#### Request Body
```json
{
  "username": "bob",
  "password": "password123",
  "ttl_hours": 720
}
```

#### Response (`HTTP 201 Created`)
```json
{
  "token": "49f05a9645ff737604d5e236ceaaee6c230c17ea174b01e389e821b03889146f",
  "expires_at": "2026-11-10T00:30:00Z",
  "user": {
    "id": "a5466d63-8b8f-4694-b1ed-33c31a687f16",
    "username": "bob",
    "display_name": "Bob Tester",
    "avatar_color": "#10b981",
    "is_admin": false
  }
}
```

---

### 5. `GET /api/v1/auth/tokens`
Lists all active unexpired tokens and sessions for the caller.

#### Request Headers
`Authorization: Bearer <token>`

#### Response (`HTTP 200 OK`)
```json
{
  "tokens": [
    {
      "token_hash": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      "created_at": "2026-10-11T00:20:00Z",
      "expires_at": "2026-11-10T00:20:00Z",
      "ip_address": "127.0.0.1",
      "user_agent": "curl/8.5.0"
    }
  ]
}
```
