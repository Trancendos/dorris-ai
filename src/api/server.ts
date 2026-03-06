/**
 * Dorris AI — REST API Server
 *
 * Exposes Dorris's financial governance, budget management,
 * transaction ledger, and mailbox capabilities as a REST API.
 *
 * Endpoints:
 *   GET    /api/v1/budgets                    — List all budgets
 *   POST   /api/v1/budgets                    — Create budget
 *   GET    /api/v1/budgets/:id                — Get budget
 *   PUT    /api/v1/budgets/:id                — Update budget
 *   POST   /api/v1/budgets/:id/check          — Check budget availability
 *   GET    /api/v1/budgets/:id/alerts         — Get budget alerts
 *   POST   /api/v1/budgets/:id/alerts/:alertId/acknowledge — Acknowledge alert
 *
 *   GET    /api/v1/approvals                  — List approval requests
 *   POST   /api/v1/approvals                  — Request approval
 *   POST   /api/v1/approvals/:id/approve      — Approve request
 *   POST   /api/v1/approvals/:id/reject       — Reject request
 *
 *   GET    /api/v1/transactions               — Query transactions
 *   POST   /api/v1/transactions               — Record transaction
 *   GET    /api/v1/transactions/:id           — Get transaction
 *   POST   /api/v1/transactions/:id/reverse   — Reverse transaction
 *   GET    /api/v1/transactions/ledger        — Get ledger entries
 *   GET    /api/v1/transactions/accounts      — Get account summaries
 *
 *   GET    /api/v1/reports                    — List reports
 *   POST   /api/v1/reports                    — Generate report
 *   POST   /api/v1/optimize                   — Generate optimization report
 *
 *   GET    /api/v1/snapshot                   — Financial snapshot
 *   GET    /api/v1/mailbox                    — List mailbox messages
 *   POST   /api/v1/mailbox                    — Send message to Dorris
 *   GET    /api/v1/mailbox/:id                — Get message + response
 *
 *   GET    /health                            — Health check
 *   GET    /metrics                           — Service metrics
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { logger } from '../utils/logger';
import { budgetManager } from '../finance/budget-manager';
import { transactionLedger } from '../finance/transaction-ledger';
import { mailbox } from '../mailbox/mailbox';


// ============================================================================
// IAM MIDDLEWARE — Trancendos 2060 Standard (TRN-PROD-001)
// ============================================================================
import { createHash, createHmac } from 'crypto';

const IAM_JWT_SECRET = process.env.IAM_JWT_SECRET || process.env.JWT_SECRET || '';
const IAM_ALGORITHM = process.env.JWT_ALGORITHM || 'HS512';
const SERVICE_ID = 'dorris';
const MESH_ADDRESS = process.env.MESH_ADDRESS || 'dorris.agent.local';

function sha512Audit(data: string): string {
  return createHash('sha512').update(data).digest('hex');
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64 + '='.repeat((4 - b64.length % 4) % 4), 'base64').toString('utf8');
}

interface JWTClaims {
  sub: string; email?: string; role?: string;
  active_role_level?: number; permissions?: string[];
  exp?: number; jti?: string;
}

function verifyIAMToken(token: string): JWTClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, sig] = parts;
    const header = JSON.parse(b64urlDecode(h));
    const alg = header.alg === 'HS512' ? 'sha512' : 'sha256';
    const expected = createHmac(alg, IAM_JWT_SECRET)
      .update(`${h}.${p}`).digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    if (expected !== sig) return null;
    const claims = JSON.parse(b64urlDecode(p)) as JWTClaims;
    if (claims.exp && Date.now() / 1000 > claims.exp) return null;
    return claims;
  } catch { return null; }
}

function requireIAMLevel(maxLevel: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) { res.status(401).json({ error: 'Authentication required', service: SERVICE_ID }); return; }
    const claims = verifyIAMToken(token);
    if (!claims) { res.status(401).json({ error: 'Invalid or expired token', service: SERVICE_ID }); return; }
    const level = claims.active_role_level ?? 6;
    if (level > maxLevel) {
      console.log(JSON.stringify({ level: 'audit', decision: 'DENY', service: SERVICE_ID,
        principal: claims.sub, requiredLevel: maxLevel, actualLevel: level, path: req.path,
        integrityHash: sha512Audit(`DENY:${claims.sub}:${req.path}:${Date.now()}`),
        timestamp: new Date().toISOString() }));
      res.status(403).json({ error: 'Insufficient privilege level', required: maxLevel, actual: level });
      return;
    }
    (req as any).principal = claims;
    next();
  };
}

function iamRequestMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Service-Id', SERVICE_ID);
  res.setHeader('X-Mesh-Address', MESH_ADDRESS);
  res.setHeader('X-IAM-Version', '1.0');
  next();
}

function iamHealthStatus() {
  return {
    iam: {
      version: '1.0', algorithm: IAM_ALGORITHM,
      status: IAM_JWT_SECRET ? 'configured' : 'unconfigured',
      meshAddress: MESH_ADDRESS,
      routingProtocol: process.env.MESH_ROUTING_PROTOCOL || 'static_port',
      cryptoMigrationPath: 'hmac_sha512 → ml_kem (2030) → hybrid_pqc (2040) → slh_dsa (2060)',
    },
  };
}
// ============================================================================
// END IAM MIDDLEWARE
// ============================================================================

// ============================================================================
// APP SETUP
// ============================================================================

export function createServer(): express.Application {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan('combined', {
    stream: { write: (msg: string) => logger.info({ http: msg.trim() }, 'HTTP') },
  }));

  // ============================================================================
  // HEALTH & METRICS
  // ============================================================================

  app.get('/health', (_req: Request, res: Response) => {
    const snapshot = budgetManager.getFinancialSnapshot();
    const ledgerStats = transactionLedger.getStats();
    res.json({
      status: 'healthy',
      service: 'dorris-ai',
      version: process.env.npm_package_version || '1.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      zeroCostCompliance: snapshot.zeroCostCompliance,
      budgets: snapshot.budgetCount,
      transactions: ledgerStats.totalTransactions,
      pendingApprovals: snapshot.pendingApprovals,
    });
  });

  app.get('/metrics', (_req: Request, res: Response) => {
    const snapshot = budgetManager.getFinancialSnapshot();
    const budgetStats = budgetManager.getStats();
    const ledgerStats = transactionLedger.getStats();
    const mailboxStats = mailbox.getStats();
    const mem = process.memoryUsage();
    res.json({
      service: 'dorris-ai',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
        rssMb: Math.round(mem.rss / 1024 / 1024),
      },
      financial: {
        zeroCostCompliance: snapshot.zeroCostCompliance,
        totalAllocated: snapshot.totalAllocated,
        totalSpent: snapshot.totalSpent,
        totalRemaining: snapshot.totalRemaining,
        pendingApprovals: snapshot.pendingApprovals,
        alertCount: snapshot.alertCount,
      },
      budget: budgetStats,
      ledger: ledgerStats,
      mailbox: mailboxStats,
    });
  });

  // ============================================================================
  // BUDGET ROUTES
  // ============================================================================

  // GET /api/v1/budgets
  app.get('/api/v1/budgets', (_req: Request, res: Response) => {
    const budgets = budgetManager.getBudgets();
    return res.json({ count: budgets.length, budgets });
  });

  // POST /api/v1/budgets
  app.post('/api/v1/budgets', (req: Request, res: Response) => {
    try {
      const { department, category, allocated, period, zeroCostTarget } = req.body;
      if (!department || !category || allocated === undefined || !period) {
        return res.status(400).json({ error: 'department, category, allocated, and period are required' });
      }
      const budget = budgetManager.createBudget({ department, category, allocated, period, zeroCostTarget });
      return res.status(201).json(budget);
    } catch (err) {
      logger.error({ err }, 'Budget creation failed');
      return res.status(500).json({ error: 'Budget creation failed' });
    }
  });

  // GET /api/v1/budgets/:id
  app.get('/api/v1/budgets/:id', (req: Request, res: Response) => {
    const budget = budgetManager.getBudget(req.params.id);
    if (!budget) return res.status(404).json({ error: 'Budget not found' });
    return res.json(budget);
  });

  // PUT /api/v1/budgets/:id
  app.put('/api/v1/budgets/:id', (req: Request, res: Response) => {
    try {
      const updated = budgetManager.updateBudget(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: 'Budget not found' });
      return res.json(updated);
    } catch (err) {
      logger.error({ err }, 'Budget update failed');
      return res.status(500).json({ error: 'Budget update failed' });
    }
  });

  // POST /api/v1/budgets/:id/check
  app.post('/api/v1/budgets/:id/check', (req: Request, res: Response) => {
    try {
      const { amount } = req.body;
      if (amount === undefined) return res.status(400).json({ error: 'amount is required' });
      const result = budgetManager.checkBudget(req.params.id, amount);
      return res.json(result);
    } catch (err) {
      logger.error({ err }, 'Budget check failed');
      return res.status(500).json({ error: 'Budget check failed' });
    }
  });

  // GET /api/v1/budgets/:id/alerts
  app.get('/api/v1/budgets/:id/alerts', (req: Request, res: Response) => {
    const budget = budgetManager.getBudget(req.params.id);
    if (!budget) return res.status(404).json({ error: 'Budget not found' });
    const unacknowledged = req.query.unacknowledged === 'true';
    const alerts = unacknowledged ? budget.alerts.filter(a => !a.acknowledged) : budget.alerts;
    return res.json({ count: alerts.length, alerts });
  });

  // POST /api/v1/budgets/:id/alerts/:alertId/acknowledge
  app.post('/api/v1/budgets/:id/alerts/:alertId/acknowledge', (req: Request, res: Response) => {
    const acknowledged = budgetManager.acknowledgeAlert(req.params.id, req.params.alertId);
    if (!acknowledged) return res.status(404).json({ error: 'Budget or alert not found' });
    return res.json({ acknowledged: true });
  });

  // ============================================================================
  // APPROVAL ROUTES
  // ============================================================================

  // GET /api/v1/approvals
  app.get('/api/v1/approvals', (req: Request, res: Response) => {
    const status = req.query.status as 'pending' | 'approved' | 'rejected' | 'auto_approved' | undefined;
    const requests = budgetManager.getApprovalRequests(status);
    return res.json({ count: requests.length, requests });
  });

  // POST /api/v1/approvals
  app.post('/api/v1/approvals', (req: Request, res: Response) => {
    try {
      const { requesterId, department, amount, description, category, urgency } = req.body;
      if (!requesterId || !department || amount === undefined || !description || !category) {
        return res.status(400).json({ error: 'requesterId, department, amount, description, and category are required' });
      }
      const request = budgetManager.requestApproval({ requesterId, department, amount, description, category, urgency });
      return res.status(201).json(request);
    } catch (err) {
      logger.error({ err }, 'Approval request failed');
      return res.status(500).json({ error: 'Approval request failed' });
    }
  });

  // POST /api/v1/approvals/:id/approve
  app.post('/api/v1/approvals/:id/approve', (req: Request, res: Response) => {
    const result = budgetManager.approveRequest(req.params.id);
    if (!result) return res.status(404).json({ error: 'Approval request not found or not pending' });
    return res.json(result);
  });

  // POST /api/v1/approvals/:id/reject
  app.post('/api/v1/approvals/:id/reject', (req: Request, res: Response) => {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'reason is required' });
    const result = budgetManager.rejectRequest(req.params.id, reason);
    if (!result) return res.status(404).json({ error: 'Approval request not found or not pending' });
    return res.json(result);
  });

  // ============================================================================
  // TRANSACTION ROUTES
  // ============================================================================

  // GET /api/v1/transactions/ledger  (must be before /:id)
  app.get('/api/v1/transactions/ledger', (req: Request, res: Response) => {
    const entries = transactionLedger.getLedgerEntries(req.query.account as string | undefined);
    return res.json({ count: entries.length, entries });
  });

  // GET /api/v1/transactions/accounts
  app.get('/api/v1/transactions/accounts', (_req: Request, res: Response) => {
    const summaries = transactionLedger.getAccountSummaries();
    return res.json({ count: summaries.length, accounts: summaries });
  });

  // GET /api/v1/transactions
  app.get('/api/v1/transactions', (req: Request, res: Response) => {
    try {
      const { type, department, category, status, minAmount, maxAmount, since, until, limit } = req.query;
      const transactions = transactionLedger.queryTransactions({
        type: type as 'income' | undefined,
        department: department as string | undefined,
        category: category as 'infrastructure' | undefined,
        status: status as 'completed' | undefined,
        minAmount: minAmount ? parseFloat(minAmount as string) : undefined,
        maxAmount: maxAmount ? parseFloat(maxAmount as string) : undefined,
        since: since ? new Date(since as string) : undefined,
        until: until ? new Date(until as string) : undefined,
        limit: limit ? parseInt(limit as string) : 100,
      });
      return res.json({ count: transactions.length, transactions });
    } catch (err) {
      logger.error({ err }, 'Transaction query failed');
      return res.status(500).json({ error: 'Transaction query failed' });
    }
  });

  // POST /api/v1/transactions
  app.post('/api/v1/transactions', (req: Request, res: Response) => {
    try {
      const { type, amount, department, category, description, reference, tags, createdBy } = req.body;
      if (!type || amount === undefined || !department || !category || !description) {
        return res.status(400).json({ error: 'type, amount, department, category, and description are required' });
      }
      const transaction = transactionLedger.record({ type, amount, department, category, description, reference, tags, createdBy });
      return res.status(201).json(transaction);
    } catch (err) {
      logger.error({ err }, 'Transaction recording failed');
      return res.status(500).json({ error: 'Transaction recording failed' });
    }
  });

  // GET /api/v1/transactions/:id
  app.get('/api/v1/transactions/:id', (req: Request, res: Response) => {
    const tx = transactionLedger.getTransaction(req.params.id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    return res.json(tx);
  });

  // POST /api/v1/transactions/:id/reverse
  app.post('/api/v1/transactions/:id/reverse', (req: Request, res: Response) => {
    try {
      const { reason } = req.body;
      if (!reason) return res.status(400).json({ error: 'reason is required' });
      const result = transactionLedger.reverseTransaction(req.params.id, reason);
      if (!result) return res.status(404).json({ error: 'Transaction not found or not reversible' });
      return res.json(result);
    } catch (err) {
      logger.error({ err }, 'Transaction reversal failed');
      return res.status(500).json({ error: 'Transaction reversal failed' });
    }
  });

  // ============================================================================
  // REPORT ROUTES
  // ============================================================================

  // GET /api/v1/reports
  app.get('/api/v1/reports', (_req: Request, res: Response) => {
    const reports = transactionLedger.getReports();
    return res.json({ count: reports.length, reports });
  });

  // POST /api/v1/reports
  app.post('/api/v1/reports', (req: Request, res: Response) => {
    try {
      const { since, until } = req.body;
      const report = transactionLedger.generateReport(
        since && until ? { start: new Date(since), end: new Date(until) } : undefined,
      );
      return res.status(201).json(report);
    } catch (err) {
      logger.error({ err }, 'Report generation failed');
      return res.status(500).json({ error: 'Report generation failed' });
    }
  });

  // POST /api/v1/optimize
  app.post('/api/v1/optimize', (_req: Request, res: Response) => {
    try {
      const report = budgetManager.generateOptimizationReport();
      return res.status(201).json(report);
    } catch (err) {
      logger.error({ err }, 'Optimization report generation failed');
      return res.status(500).json({ error: 'Optimization report generation failed' });
    }
  });

  // ============================================================================
  // SNAPSHOT
  // ============================================================================

  // GET /api/v1/snapshot
  app.get('/api/v1/snapshot', (_req: Request, res: Response) => {
    return res.json(budgetManager.getFinancialSnapshot());
  });

  // ============================================================================
  // MAILBOX ROUTES
  // ============================================================================

  // GET /api/v1/mailbox
  app.get('/api/v1/mailbox', (req: Request, res: Response) => {
    try {
      const { from, intent, status, priority, since, limit } = req.query;
      const messages = mailbox.getMessages({
        from: from as string | undefined,
        intent: intent as 'check_budget' | undefined,
        status: status as 'queued' | undefined,
        priority: priority as 'low' | undefined,
        since: since ? new Date(since as string) : undefined,
        limit: limit ? parseInt(limit as string) : 50,
      });
      return res.json({ count: messages.length, messages });
    } catch (err) {
      logger.error({ err }, 'Mailbox query failed');
      return res.status(500).json({ error: 'Mailbox query failed' });
    }
  });

  // POST /api/v1/mailbox
  app.post('/api/v1/mailbox', (req: Request, res: Response) => {
    try {
      const { from, subject, body, payload, priority, replyTo, correlationId, tags } = req.body;
      if (!from || !subject || !payload) {
        return res.status(400).json({ error: 'from, subject, and payload are required' });
      }
      const message = mailbox.receive({ from, subject, body, payload, priority, replyTo, correlationId, tags });
      return res.status(202).json({
        messageId: message.id,
        intent: message.intent,
        priority: message.priority,
        status: message.status,
        correlationId: message.correlationId,
      });
    } catch (err) {
      logger.error({ err }, 'Message send failed');
      return res.status(500).json({ error: 'Message send failed' });
    }
  });

  // GET /api/v1/mailbox/:id
  app.get('/api/v1/mailbox/:id', (req: Request, res: Response) => {
    const message = mailbox.getMessage(req.params.id);
    if (!message) return res.status(404).json({ error: 'Message not found' });
    return res.json(message);
  });

  // GET /api/v1/mailbox/stats
  app.get('/api/v1/mailbox/stats', (_req: Request, res: Response) => {
    return res.json(mailbox.getStats());
  });

  // ============================================================================
  // ERROR HANDLER
  // ============================================================================

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error', message: err.message });
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}