# User & Team Administration Engine (REST API & `cme-admin` CLI)

The Collaborative Markdown Editor (CME) platform provides administrative user and team management capabilities, accessible programmatically via guarded REST endpoints and out-of-band via the native `cme-admin` command-line utility.

---

## Architecture & Security Model

1. **Authorization Guard:** All `/api/v1/admin/*` endpoints strictly require an authenticated session or Bearer token where `is_admin == true`.
   * Unauthenticated requests are rejected with `401 Unauthorized`.
   * Authenticated requests from non-admin users are rejected with `403 Forbidden`.
2. **Directed Acyclic Graph (DAG) Integrity:** Team inheritance is modeled as a multi-parent DAG in PostgreSQL. Any attempt to introduce circular dependencies or self-parenting links is rejected with `400 Bad Request` (`"Circular DAG inheritance or self-parenting detected"`).
3. **Password Security:** Plain-text passwords are encrypted using salted bcrypt (`$2b$`) before storage in the database.

---

## REST Endpoints Summary

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/admin/users` | List all registered user accounts | Admin |
| `POST` | `/api/v1/admin/users` | Register a new user account | Admin |
| `GET` | `/api/v1/admin/users/:id` | Retrieve user details by ID or username | Admin |
| `PUT` | `/api/v1/admin/users/:id` | Update user display name, avatar, or role | Admin |
| `DELETE` | `/api/v1/admin/users/:id` | Permanently delete a user account | Admin |
| `GET` | `/api/v1/admin/teams` | List all teams | Admin |
| `POST` | `/api/v1/admin/teams` | Create a new team | Admin |
| `GET` | `/api/v1/admin/teams/:id` | Retrieve team details by ID or name | Admin |
| `PUT` | `/api/v1/admin/teams/:id` | Update team name or description | Admin |
| `DELETE` | `/api/v1/admin/teams/:id` | Permanently delete a team | Admin |
| `GET` | `/api/v1/admin/teams/:id/members` | List members in a team | Admin |
| `POST` | `/api/v1/admin/teams/:id/members` | Add user to team or update role (`member`, `lead`) | Admin |
| `DELETE` | `/api/v1/admin/teams/:id/members/:user_id` | Remove user from team | Admin |
| `GET` | `/api/v1/admin/teams/:id/parents` | List direct parent teams in DAG | Admin |
| `POST` | `/api/v1/admin/teams/:id/parents` | Link parent team to child team in DAG | Admin |
| `DELETE` | `/api/v1/admin/teams/:id/parents/:parent_id` | Unlink parent team from child team | Admin |

---

## Detailed REST Endpoint Reference

### 1. User Management

#### `GET /api/v1/admin/users`
Returns all registered user accounts without password hashes.

##### Response `200 OK`
```json
[
  {
    "id": "9ef1a67e-3105-415e-9273-739aef4c7775",
    "username": "alice",
    "display_name": "Alice Administrator",
    "avatar_color": "#10b981",
    "is_admin": true,
    "created_at": "2026-10-11 08:00:00+00",
    "updated_at": "2026-10-11 08:00:00+00"
  }
]
```

#### `POST /api/v1/admin/users`
Creates a new user account with encrypted password credentials.

##### Request Body
```json
{
  "username": "bob",
  "password": "secure_password",
  "display_name": "Bob Developer",
  "avatar_color": "#3b82f6",
  "is_admin": false
}
```

##### Responses
* `201 Created`: User created successfully.
* `400 Bad Request`: Missing username or password.
* `409 Conflict`: Username already exists.

#### `GET /api/v1/admin/users/:id`
Retrieves user account by UUID or username.

##### Responses
* `200 OK`: User record.
* `404 Not Found`: User does not exist.

#### `PUT /api/v1/admin/users/:id`
Updates user profile fields, administrative privilege, or resets password.

##### Request Body
```json
{
  "display_name": "Bob Senior Developer",
  "avatar_color": "#ef4444",
  "is_admin": true,
  "password": "optional_new_password"
}
```

##### Responses
* `200 OK`: Updated user record.
* `404 Not Found`: User does not exist.

#### `DELETE /api/v1/admin/users/:id`
Deletes a user account. Cascades to team memberships and sessions.

##### Responses
* `200 OK`: `{"status": "deleted"}`.
* `404 Not Found`: User does not exist.

---

### 2. Team Management & DAG Hierarchy

#### `GET /api/v1/admin/teams`
Lists all registered teams.

#### `POST /api/v1/admin/teams`
Registers a new team.

##### Request Body
```json
{
  "name": "backend-team",
  "description": "Core Backend & Infrastructure"
}
```

##### Responses
* `201 Created`: Team created successfully.
* `409 Conflict`: Team name already exists.

#### `POST /api/v1/admin/teams/:id/members`
Assigns a user to a team or updates their role.

##### Request Body
```json
{
  "user_id": "9ef1a67e-3105-415e-9273-739aef4c7775",
  "role": "lead"
}
```
*(Accepts either `user_id` or `username`, and `role: "member" | "lead"`)*.

##### Responses
* `200 OK`: `{"status": "member_added"}`.
* `400 Bad Request`: Invalid role.
* `404 Not Found`: Team or user not found.

#### `POST /api/v1/admin/teams/:id/parents`
Links a parent team in the DAG hierarchy to establish permission inheritance.

##### Request Body
```json
{
  "parent_id": "c04156ef-30b9-4ab1-90a1-5765349ade74"
}
```
*(Accepts either `parent_id` or `parent_name`)*.

##### DAG Cycle Detection
Before inserting into `team_parents`, the engine executes a recursive Common Table Expression (CTE) query to determine if the target parent team is already reachable as a descendant of the child team:

```sql
WITH RECURSIVE descendants AS (
    SELECT child_team_id AS team_id FROM team_parents WHERE parent_team_id = $1::uuid
    UNION
    SELECT tp.child_team_id
    FROM team_parents tp
    JOIN descendants d ON tp.parent_team_id = d.team_id
)
SELECT 1 FROM descendants WHERE team_id = $2::uuid;
```

##### Responses
* `200 OK`: `{"status": "parent_linked"}`.
* `400 Bad Request`: Circular DAG inheritance or self-parenting detected (`{"error": "Circular DAG inheritance or self-parenting detected"}`).
* `404 Not Found`: Team or parent team not found.

---

## `cme-admin` CLI Reference

The `cme-admin` standalone binary is installed at `bin/cme-admin`. It performs offline and administrative tasks against PostgreSQL.

```
Collaborative Markdown Editor (CME) v0.1.0 - Administration CLI (cme-admin)

Usage: cme-admin [--db <connstring>] <command> <action> [options]

Global Options:
  --db <connstring>       PostgreSQL connection URL (or CME_DATABASE_URL env)
  -h, --help              Display this help message

Commands:
  user list               List all registered users
  user get <user_or_id>   View details of a user
  user create             Create a new user account
                          --username <name> --password <pass> [--display-name <name>] [--avatar <#hex>] [--admin]
  user set-admin          Grant or revoke system admin privilege
                          --username <name> [--revoke]
  user reset-password     Update user password
                          --username <name> --password <pass>
  user delete             Delete a user account
                          --username <name>

  team list               List all teams
  team get <team_or_id>   View details of a team
  team create             Create a new team
                          --name <name> [--description <desc>]
  team delete             Delete a team
                          --team <name_or_id>
  team add-member         Add a user to a team
                          --team <team> --user <user> [--role member|lead]
  team remove-member      Remove a user from a team
                          --team <team> --user <user>
  team list-members       List all members in a team
                          --team <team>
  team add-parent         Link parent team in DAG hierarchy
                          --team <child_team> --parent <parent_team>
  team remove-parent      Unlink parent team from DAG hierarchy
                          --team <child_team> --parent <parent_team>
  team list-parents       List direct parent teams
                          --team <child_team>
```

### Example CLI Workflows

```bash
# 1. Provision an initial system administrator
./build/bin/cme-admin user create --username dev_alice --password "SecretPass123" --display-name "Alice Dev" --admin

# 2. Create organization and teams
./build/bin/cme-admin team create --name "engineering-org" --description "Engineering Department"
./build/bin/cme-admin team create --name "backend-team" --description "Backend Squad"

# 3. Configure DAG inheritance (backend-team inherits from engineering-org)
./build/bin/cme-admin team add-parent --team "backend-team" --parent "engineering-org"

# 4. Assign member as lead
./build/bin/cme-admin team add-member --team "backend-team" --user dev_alice --role lead

# 5. List memberships
./build/bin/cme-admin team list-members --team "backend-team"
```
