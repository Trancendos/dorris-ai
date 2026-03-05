# Dorris AI

Financial Chief and autonomous mailbox for the Trancendos 24-agent mesh. Manages budgets, transactions, cost optimization, and zero-cost compliance across all departments in the ecosystem.

## Overview

Dorris Fontaine is the CFO of the Trancendos Industry 6.0 architecture. She enforces the **zero-cost mandate** — the architectural principle that all Trancendos services must operate at $0 cost using open-source, self-hosted, and free-tier services only. Every financial decision flows through Dorris: budget checks, approval workflows, transaction recording, cost optimization, and real-time compliance monitoring.

**Migrated from:** `agents/pillars/DorrisFontaine.ts`

**Personality:** Meticulous, Frugal, Analytical, Risk-Averse, Detail-Oriented

## Architecture

```
dorris-ai/
├── src/
│   ├── finance/
│   │   ├── budget-manager.ts      # Budget tracking, approvals, zero-cost compliance
│   │   └── transaction-ledger.ts  # Double-entry ledger, reports, anomaly detection
│   ├── mailbox/
│   │   └── mailbox.ts             # Autonomous message routing + intent classification
│   ├── api/
│   │   └── server.ts              # REST API — 27 endpoints
│   ├── utils/
│   │   └── logger.ts              # Pino structured logging
│   └── index.ts                   # Bootstrap + periodic monitoring
├── package.json
├── tsconfig.json
└── README.md
```

## Zero-Cost Mandate

The Trancendos architecture targets **$0 operational cost**. Dorris enforces this through:

1. **Zero-cost budgets** — all 8 default departments have `zeroCostTarget: true` and `allocated: $0`
2. **Automatic rejection** — any expense request against a zero-cost department is immediately rejected
3. **Real-time alerts** — zero-cost violations trigger `critical` priority alerts
4. **Compliance scoring** — `zeroCostCompliance` (0-100) reported on every snapshot and health check
5. **Optimization reports** — violations surface as `critical` priority recommendations

## Key Components

### Budget Manager

Tracks 8 default departments, all zero-cost:

| Department | Category | Zero-Cost Target |
|------------|----------|-----------------|
| infrastructure | infrastructure | ✅ |
| development | development | ✅ |
| operations | operations | ✅ |
| security | security | ✅ |
| ai_services | ai_services | ✅ |
| data_storage | data_storage | ✅ |
| networking | networking | ✅ |
| tooling | tooling | ✅ |

Budget status lifecycle: `healthy → warning (70%) → critical (90%) → exceeded (100%+)`

Approval workflow:
- Amount = $0 → `auto_approved` immediately
- Amount > $0 in zero-cost dept → `rejected` immediately
- Amount > $0 in non-zero-cost dept → `pending` for manual review

### Transaction Ledger

Double-entry accounting with full audit trail:

```typescript
// Record a transaction
const tx = transactionLedger.record({
  type: 'expense',
  amount: 0,                    // Zero-cost mandate
  department: 'infrastructure',
  category: 'infrastructure',
  description: 'GitHub Actions CI/CD (free tier)',
  tags: ['ci', 'free-tier'],
  createdBy: 'cornelius-ai',
});

// Query transactions
const expenses = transactionLedger.queryTransactions({
  type: 'expense',
  department: 'infrastructure',
  since: new Date('2024-01-01'),
  limit: 50,
});

// Generate financial report
const report = transactionLedger.generateReport({
  start: new Date('2024-01-01'),
  end: new Date('2024-01-31'),
});
```

Anomaly detection (4 types):
- `large_amount` — any expense over $100
- `zero_cost_violation` — any expense in a zero-cost department
- `rapid_succession` — 5+ transactions in 60 seconds
- `duplicate` — same amount/department/description within 5 minutes

### Autonomous Mailbox

Intent-based message routing with priority queue:

```typescript
// Send a message to Dorris
const message = mailbox.receive({
  from: 'cornelius-ai',
  subject: 'Budget check for new service',
  payload: {
    action: 'check_budget',
    department: 'infrastructure',
    amount: 0,
  },
});

// Response available after processing
const processed = mailbox.getMessage(message.id);
console.log(processed.response.data);
// { approved: true, remaining: 0, reason: 'Budget available' }
```

Supported intents (auto-classified from payload or subject):

| Intent | Trigger |
|--------|---------|
| `check_budget` | `action: 'check_budget'` or subject contains "budget" |
| `record_transaction` | `action: 'record_transaction'` or "transaction"/"expense" |
| `request_approval` | `action: 'request_approval'` or "approval"/"approve" |
| `optimize_costs` | `action: 'optimize_costs'` or "optim" |
| `generate_report` | `action: 'generate_report'` or "report" |
| `get_snapshot` | `action: 'get_snapshot'` or "snapshot"/"summary" |
| `reverse_transaction` | `action: 'reverse_transaction'` or "reverse"/"refund" |
| `get_stats` | `action: 'get_stats'` or "stats"/"metrics" |

Priority queue order: `critical → urgent → high → normal → low`

## API Reference

### Budget Endpoints

```
GET    /api/v1/budgets
POST   /api/v1/budgets
GET    /api/v1/budgets/:id
PUT    /api/v1/budgets/:id
POST   /api/v1/budgets/:id/check
GET    /api/v1/budgets/:id/alerts
POST   /api/v1/budgets/:id/alerts/:alertId/acknowledge
```

**Check budget:**
```json
POST /api/v1/budgets/infrastructure/check
{ "amount": 50 }

Response:
{
  "approved": false,
  "remaining": 0,
  "reason": "Zero-cost mandate: infrastructure must not incur costs"
}
```

### Approval Endpoints

```
GET    /api/v1/approvals?status=pending
POST   /api/v1/approvals
POST   /api/v1/approvals/:id/approve
POST   /api/v1/approvals/:id/reject
```

### Transaction Endpoints

```
GET    /api/v1/transactions
POST   /api/v1/transactions
GET    /api/v1/transactions/:id
POST   /api/v1/transactions/:id/reverse
GET    /api/v1/transactions/ledger
GET    /api/v1/transactions/accounts
```

### Report Endpoints

```
GET    /api/v1/reports
POST   /api/v1/reports
POST   /api/v1/optimize
```

### Snapshot & Mailbox

```
GET    /api/v1/snapshot
GET    /api/v1/mailbox
POST   /api/v1/mailbox
GET    /api/v1/mailbox/:id
GET    /api/v1/mailbox/stats
```

### System

```
GET    /health
GET    /metrics
```

**Health response:**
```json
{
  "status": "healthy",
  "service": "dorris-ai",
  "zeroCostCompliance": 100,
  "budgets": 8,
  "transactions": 0,
  "pendingApprovals": 0
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3005` | HTTP server port |
| `HOST` | `0.0.0.0` | HTTP server host |
| `NODE_ENV` | `development` | Environment |
| `LOG_LEVEL` | `info` | Pino log level |
| `ALERT_CHECK_INTERVAL_MS` | `60000` | Budget alert check interval |
| `REPORT_INTERVAL_MS` | `3600000` | Periodic report interval (1 hour) |

## Getting Started

```bash
# Install dependencies
npm install

# Development (hot reload)
npm run dev

# Build
npm run build

# Production
npm start
```

## Integration with Agent Mesh

Dorris AI runs on port `3005` by default. Agents interact with Dorris via:

1. **Direct REST API** — for synchronous budget checks and transaction recording
2. **Mailbox** — for asynchronous financial requests with intent-based routing

All agents should check budget availability before incurring any cost:
```
POST /api/v1/budgets/:department/check
{ "amount": <requested_amount> }
```

If `approved: false` and the zero-cost mandate is in effect, the operation must be cancelled or replaced with a free alternative.

---

*Part of the Trancendos Industry 6.0 / 2060 Standard architecture.*
*Migrated from the Trancendos monorepo — Wave 2 primary agents.*
*"Every penny accounted for." — Dorris Fontaine*