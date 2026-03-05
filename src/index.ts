/**
 * Dorris AI — Main Entry Point
 *
 * Financial Chief and autonomous mailbox for the Trancendos 24-agent mesh.
 * Manages budgets, transactions, cost optimization, and zero-cost compliance
 * across all departments in the ecosystem.
 *
 * Architecture: Trancendos Industry 6.0 / 2060 Standard
 */

import { logger } from './utils/logger';
import { createServer } from './api/server';
import { budgetManager } from './finance/budget-manager';
import { transactionLedger } from './finance/transaction-ledger';
import { mailbox } from './mailbox/mailbox';

// ============================================================================
// CONFIGURATION
// ============================================================================

const PORT = parseInt(process.env.PORT || '3005', 10);
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';
const ALERT_CHECK_INTERVAL_MS = parseInt(process.env.ALERT_CHECK_INTERVAL_MS || '60000', 10);
const REPORT_INTERVAL_MS = parseInt(process.env.REPORT_INTERVAL_MS || '3600000', 10); // 1 hour

// ============================================================================
// BOOTSTRAP
// ============================================================================

async function bootstrap(): Promise<void> {
  logger.info({
    service: 'dorris-ai',
    version: process.env.npm_package_version || '1.0.0',
    env: NODE_ENV,
    port: PORT,
  }, 'Dorris AI bootstrapping — The Treasury is opening...');

  // ── Step 1: Verify budget manager ───────────────────────────────────────
  const budgets = budgetManager.getBudgets();
  logger.info({ budgetCount: budgets.length }, 'Budget manager verified');

  // ── Step 2: Run initial zero-cost compliance check ───────────────────────
  const snapshot = budgetManager.getFinancialSnapshot();
  logger.info({
    zeroCostCompliance: snapshot.zeroCostCompliance,
    totalAllocated: snapshot.totalAllocated,
    totalSpent: snapshot.totalSpent,
    budgets: snapshot.budgetCount,
  }, 'Initial financial snapshot');

  if (snapshot.zeroCostCompliance < 100) {
    logger.warn({
      compliance: snapshot.zeroCostCompliance,
      totalSpent: snapshot.totalSpent,
    }, 'WARNING: Zero-cost compliance below 100% at startup');
  } else {
    logger.info('Zero-cost mandate: FULLY COMPLIANT — all departments at $0');
  }

  // ── Step 3: Run initial optimization report ──────────────────────────────
  const optimizationReport = budgetManager.generateOptimizationReport();
  logger.info({
    reportId: optimizationReport.id,
    recommendations: optimizationReport.recommendations.length,
    summary: optimizationReport.summary,
  }, 'Initial optimization report generated');

  // ── Step 4: Verify transaction ledger ───────────────────────────────────
  const ledgerStats = transactionLedger.getStats();
  logger.info({ ledgerStats }, 'Transaction ledger verified');

  // ── Step 5: Verify mailbox ───────────────────────────────────────────────
  const mailboxStats = mailbox.getStats();
  logger.info({ mailboxStats }, 'Mailbox verified');

  // ── Step 6: Start HTTP server ────────────────────────────────────────────
  const app = createServer();
  const server = app.listen(PORT, HOST, () => {
    logger.info({
      host: HOST,
      port: PORT,
      env: NODE_ENV,
      endpoints: [
        'GET  /api/v1/budgets',
        'POST /api/v1/budgets',
        'GET  /api/v1/budgets/:id',
        'PUT  /api/v1/budgets/:id',
        'POST /api/v1/budgets/:id/check',
        'GET  /api/v1/budgets/:id/alerts',
        'POST /api/v1/budgets/:id/alerts/:alertId/acknowledge',
        'GET  /api/v1/approvals',
        'POST /api/v1/approvals',
        'POST /api/v1/approvals/:id/approve',
        'POST /api/v1/approvals/:id/reject',
        'GET  /api/v1/transactions',
        'POST /api/v1/transactions',
        'GET  /api/v1/transactions/:id',
        'POST /api/v1/transactions/:id/reverse',
        'GET  /api/v1/transactions/ledger',
        'GET  /api/v1/transactions/accounts',
        'GET  /api/v1/reports',
        'POST /api/v1/reports',
        'POST /api/v1/optimize',
        'GET  /api/v1/snapshot',
        'GET  /api/v1/mailbox',
        'POST /api/v1/mailbox',
        'GET  /api/v1/mailbox/:id',
        'GET  /api/v1/mailbox/stats',
        'GET  /health',
        'GET  /metrics',
      ],
    }, 'Dorris AI listening');
  });

  // ── Step 7: Start periodic alert checks ─────────────────────────────────
  setInterval(() => {
    const alerts = budgetManager.checkAndGenerateAlerts();
    if (alerts.length > 0) {
      logger.warn({ alertCount: alerts.length, alerts }, 'Budget alerts generated');

      // Send alerts to mailbox for processing
      for (const alert of alerts) {
        mailbox.receive({
          from: 'dorris-ai-monitor',
          subject: `Budget Alert: ${alert.type}`,
          payload: {
            action: 'acknowledge_alert',
            alertType: alert.type,
            message: alert.message,
            zeroCostViolation: alert.type === 'zero_cost_violation',
          },
          priority: alert.type === 'zero_cost_violation' ? 'critical' : 'high',
          tags: ['system-alert', alert.type],
        });
      }
    }
  }, ALERT_CHECK_INTERVAL_MS);

  // ── Step 8: Start periodic financial reporting ───────────────────────────
  setInterval(() => {
    const report = transactionLedger.generateReport();
    const currentSnapshot = budgetManager.getFinancialSnapshot();
    logger.info({
      reportId: report.id,
      totalExpenses: report.totalExpenses,
      totalIncome: report.totalIncome,
      netPosition: report.netPosition,
      zeroCostCompliance: currentSnapshot.zeroCostCompliance,
      transactionCount: report.transactionCount,
    }, 'Periodic financial report generated');
  }, REPORT_INTERVAL_MS);

  // ── Step 9: Graceful shutdown ────────────────────────────────────────────
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    server.close(() => {
      const finalSnapshot = budgetManager.getFinancialSnapshot();
      const finalLedger = transactionLedger.getStats();
      logger.info({
        zeroCostCompliance: finalSnapshot.zeroCostCompliance,
        totalSpent: finalSnapshot.totalSpent,
        totalTransactions: finalLedger.totalTransactions,
      }, 'Dorris AI shutdown complete — Books balanced. Treasury secured.');
      process.exit(0);
    });
    setTimeout(() => {
      logger.warn('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Uncaught exception');
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection');
  });

  logger.info('Dorris AI fully operational — Every penny accounted for.');
}

// ── Run ──────────────────────────────────────────────────────────────────────
bootstrap().catch((err) => {
  logger.error({ err }, 'Bootstrap failed');
  process.exit(1);
});