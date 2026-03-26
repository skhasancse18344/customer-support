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

Wait for services to be healthy, then seed the database:

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
- **Background jobs** — BullMQ email worker with retry (3 attempts, exponential backoff)
- **Caching** — Redis caching for analytics with 1-hour TTL
- **Security headers** — Helmet.js defaults (HSTS, CSP, X-Frame-Options, etc.)

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
