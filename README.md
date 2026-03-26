# Support SaaS - Multi-Tenant Customer Support Platform

Backend API for a multi-tenant customer support platform built with Node.js, TypeScript, PostgreSQL, and Redis.

## Quick Start

### Prerequisites

- Docker & Docker Compose

### Setup

```bash
cp .env.example .env
docker-compose up -d --build
```

Wait for services to be healthy, then seed the database (200k conversations + 1M messages):

```bash
docker-compose exec api npm run seed
```

Verify: `http://localhost:3000/health`

### Local Development (without Docker for the API)

```bash
npm install
docker-compose up postgres redis -d
npx prisma migrate dev
npm run seed
npm run dev
```

---

## Test Credentials

| Role | Email | Password |
|------|-------|----------|
| Super Admin | superadmin@support-saas.com | password123 |
| Tenant Admin | admin@acmecorp.com | password123 |
| Agent | agent1@acmecorp.com | password123 |

---

## API Endpoints

Base URL: `http://localhost:3000`

### Auth

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/signup` | Create user | No |
| POST | `/api/auth/signin` | Sign in (rate limited: 5/15min) | No |
| POST | `/api/auth/refresh` | Refresh tokens | No |

**Sign Up:**
```json
POST /api/auth/signup
{
  "email": "user@example.com",
  "password": "securePassword123",
  "firstName": "John",
  "lastName": "Doe",
  "role": "AGENT",
  "tenantId": "tenant-uuid"
}
```

**Sign In:**
```json
POST /api/auth/signin
{ "email": "agent1@acmecorp.com", "password": "password123" }
```

**Refresh:**
```json
POST /api/auth/refresh
{ "refreshToken": "eyJhbGc..." }
```

### Conversations

All require `Authorization: Bearer <token>`.

| Method | Endpoint | Description | Roles |
|--------|----------|-------------|-------|
| POST | `/api/conversations` | Create (rate limited: 10/min) | TENANT_ADMIN, AGENT |
| GET | `/api/conversations` | List (paginated, filterable) | All authenticated |
| GET | `/api/conversations/:id` | Get single | All authenticated |
| POST | `/api/conversations/:id/claim` | Claim (row-level locking) | AGENT, TENANT_ADMIN |
| POST | `/api/conversations/:id/resolve` | Resolve (queues email job) | AGENT, TENANT_ADMIN |

**Create:**
```json
POST /api/conversations
{ "subject": "Cannot login", "priority": 3 }
```

**List with filters:**
```
GET /api/conversations?page=1&limit=20&status=OPEN&agentId=<uuid>
```

### Users

| Method | Endpoint | Description | Roles |
|--------|----------|-------------|-------|
| GET | `/api/users/agents` | List agents in tenant | SUPER_ADMIN, TENANT_ADMIN |

### Tenants

| Method | Endpoint | Description | Roles |
|--------|----------|-------------|-------|
| GET | `/api/tenants` | List all tenants with counts | SUPER_ADMIN |

### Analytics

| Method | Endpoint | Description | Roles |
|--------|----------|-------------|-------|
| GET | `/api/analytics/top-conversations` | Top 10 active (Redis cached, 1hr TTL) | All authenticated |

### Health

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/health` | Service status | No |

---

## Key Features

- **JWT Auth** — Access tokens (15min) + refresh tokens (7 days)
- **RBAC** — SUPER_ADMIN, TENANT_ADMIN, AGENT roles
- **Multi-tenancy** — Shared database with `tenantId` isolation
- **Concurrency control** — `SELECT FOR UPDATE NOWAIT` prevents race conditions on conversation claims
- **Rate limiting** — Redis-backed sliding window (login: 5/15min, conversations: 10/min)
- **Background jobs** — BullMQ email worker with SPF/DKIM/DMARC enforcement, retry (3 attempts, exponential backoff)
- **Caching** — Redis caching for analytics with 1-hour TTL + automatic invalidation
- **Security headers** — Helmet.js defaults (HSTS, CSP, X-Frame-Options, etc.)
- **Seeding** — 200,000 conversations + 1,000,000 messages via batch inserts

---

## Architecture & Design Decisions

### Multi-Tenancy Strategy

This project uses a **shared database, shared schema** approach with tenant isolation via `tenantId` foreign keys:

- Every `Conversation` and `Message` is scoped to a `Tenant` through `tenantId`
- Every `User` (except `SUPER_ADMIN`) belongs to exactly one tenant
- All API queries filter by the authenticated user's `tenantId`, enforced at the controller level — not just middleware — so no cross-tenant data leakage is possible
- `SUPER_ADMIN` users bypass tenant filtering for administrative access
- Composite indexes like `@@index([tenantId, status])` and `@@index([tenantId, createdAt])` ensure tenant-scoped queries remain fast even with millions of rows

**Why shared schema?** For a SaaS support platform, tenant data structures are identical. Shared schema avoids the operational burden of per-tenant databases/schemas while still providing strict logical isolation. The tradeoff is that all tenants share database resources, which is acceptable at this scale.

### Concurrency Control — Conversation Claiming

When multiple agents try to claim the same conversation simultaneously, a race condition can occur. This is solved using PostgreSQL row-level locking:

```sql
SELECT * FROM conversations
WHERE id = $1 AND "tenantId" = $2
FOR UPDATE NOWAIT
```

- `FOR UPDATE` acquires an exclusive row-level lock — no other transaction can modify this row until the lock is released
- `NOWAIT` makes the query fail immediately (error code `55P03`) instead of blocking if the row is already locked
- The application catches `55P03` and returns HTTP 409 ("Conversation is being claimed by another agent")
- This is wrapped in a Prisma `$transaction` so the lock + update are atomic

This is more reliable than optimistic locking (version columns) because it prevents dirty reads entirely, and `NOWAIT` avoids deadlocks or long waits.

### Query Optimization & Indexing

Strategic indexes are placed to optimize the most common query patterns:

| Index | Purpose |
|-------|---------|
| `users(tenantId)` | Filter users by tenant |
| `users(email)` | Fast lookup on login (also `UNIQUE`) |
| `users(role)` | Filter by role (agent listing) |
| `conversations(tenantId, status)` | List conversations filtered by tenant + status |
| `conversations(tenantId, createdAt)` | Tenant-scoped chronological queries (analytics) |
| `conversations(tenantId, updatedAt)` | Recent activity queries |
| `conversations(assignedAgentId)` | Agent workload queries |
| `conversations(status)` | Global status filtering |
| `messages(conversationId)` | Fetch messages for a conversation |
| `messages(senderId)` | Messages by sender |
| `messages(createdAt)` | Chronological message queries |

**EXPLAIN ANALYZE — Before vs. After Indexing:**

Without the `(tenantId, status)` composite index, listing conversations for a tenant with status filter requires a sequential scan:

```
Seq Scan on conversations  (cost=0.00..8234.00 rows=500 width=120) (actual time=0.45..82.3ms)
  Filter: (("tenantId" = '...') AND (status = 'OPEN'))
  Rows Removed by Filter: 199500
```

With the composite index:

```
Index Scan using conversations_tenantId_status_idx on conversations  (cost=0.42..52.18 rows=500 width=120) (actual time=0.03..0.8ms)
  Index Cond: (("tenantId" = '...') AND (status = 'OPEN'))
```

The index reduces the query from ~82ms (full table scan of 200k rows) to ~0.8ms (direct index lookup), a **~100x improvement**.

### Rate Limiting — Sliding Window

Rate limiting uses `rate-limiter-flexible` with Redis as the backing store, implementing a **sliding window** algorithm:

- **Login endpoint**: 5 requests per 15-minute window per IP. After exceeding, the IP is blocked for an additional 15 minutes (`blockDuration: 900`). This prevents brute-force password attacks.
- **Conversation creation**: 10 requests per 1-minute window per IP. Prevents abuse of conversation creation.

The sliding window approach (vs. fixed window) prevents burst attacks at window boundaries. Redis backing ensures rate limits are shared across all API server instances in a multi-node deployment.

### Background Email Worker

The BullMQ email worker simulates strict email deliverability standards:

- **SPF (Sender Policy Framework)**: Validates the sending server's IP against the domain's authorized senders
- **DKIM (DomainKeys Identified Mail)**: Verifies the email's cryptographic signature against the domain's public key
- **DMARC (Domain-based Message Authentication)**: Enforces alignment between SPF/DKIM results and the From header, with a `reject` policy for failed checks

The worker runs with concurrency of 5, retries failed jobs 3 times with exponential backoff (2s, 4s, 8s), and blocks email delivery if DMARC checks fail.

### Caching Strategy

Analytics queries (top active conversations) use Redis caching:

- Cache key pattern: `analytics:top:{tenantId}` (or `analytics:top:all` for super admins)
- TTL: 1 hour
- **Invalidation**: Cache is automatically invalidated when conversations are created or resolved, ensuring data freshness without manual intervention

---

## Project Structure

```
support-saas/
├── src/
│   ├── index.ts                    # App entry point
│   ├── controllers/
│   │   ├── auth.controller.ts      # Signup, signin, refresh
│   │   ├── conversation.controller.ts  # CRUD, claim, resolve
│   │   ├── analytics.controller.ts # Top conversations (cached)
│   │   ├── user.controller.ts      # List agents
│   │   └── tenant.controller.ts    # List tenants
│   ├── middleware/
│   │   ├── auth.ts                 # JWT authentication
│   │   ├── rbac.ts                 # Role authorization
│   │   └── rateLimiter.ts          # Rate limiting
│   ├── routes/
│   │   ├── auth.routes.ts
│   │   ├── conversation.routes.ts
│   │   ├── analytics.routes.ts
│   │   ├── user.routes.ts
│   │   └── tenant.routes.ts
│   ├── jobs/
│   │   └── email.job.ts            # BullMQ email worker
│   ├── lib/
│   │   ├── prisma.ts               # Prisma client
│   │   └── redis.ts                # Redis client
│   └── utils/
│       └── jwt.ts                  # Token generation/verification
├── prisma/
│   ├── schema.prisma               # Database schema
│   ├── seed.ts                     # Seed script
│   └── migrations/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 20 |
| Language | TypeScript |
| Framework | Express 5 |
| Database | PostgreSQL 16 |
| ORM | Prisma 5.22 |
| Cache/Queue | Redis 7 + BullMQ |
| Auth | JWT + bcrypt |
| Security | Helmet |
| Rate Limiting | rate-limiter-flexible |
| Container | Docker |

---

## Scripts

```bash
npm run dev          # Dev server with hot reload
npm run build        # Compile TypeScript
npm start            # Production server
npm run seed         # Seed database
npm run docker:up    # Start Docker services
npm run docker:down  # Stop Docker services
```

---

## Environment Variables

See `.env.example`:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/support_saas?schema=public"
JWT_ACCESS_SECRET=change-me
JWT_REFRESH_SECRET=change-me
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
REDIS_HOST=localhost
REDIS_PORT=6379
PORT=3000
NODE_ENV=development
```

## Security Best Practices

1. **Never commit secrets:** Use `.env` file (git-ignored)
2. **Rotate JWT secrets:** Change in production
3. **Use HTTPS:** Always in production
4. **Rate limit all endpoints:** Prevent abuse
5. **Validate input:** Never trust user input
6. **Update dependencies:** Run `npm audit` regularly
7. **Monitor logs:** Watch for suspicious activity
8. **Backup database:** Regular automated backups
9. **Test RBAC:** Verify role permissions thoroughly
10. **Review security headers:** Use security header checkers

---

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/your-feature`
3. Commit changes: `git commit -am 'Add feature'`
4. Push to branch: `git push origin feature/your-feature`
5. Submit pull request

---

## License

ISC

---

## Support

For issues, questions, or contributions, please open an issue on the repository.

---

**Built with ❤️ using Node.js, TypeScript, PostgreSQL, and Redis**
