/**
 * Dorris AI — Transaction Ledger
 *
 * Immutable double-entry ledger for all financial transactions
 * in the Trancendos ecosystem. Tracks income, expenses, transfers,
 * refunds, and adjustments with full audit trail.
 *
 * Migrated from: agents/pillars/DorrisFontaine.ts (recordTransaction)
 *
 * Architecture: Trancendos Industry 6.0 / 2060 Standard
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { budgetManager, CostCategory } from './budget-manager';

// ============================================================================
// TYPES
// ============================================================================

export type TransactionType = 'income' | 'expense' | 'transfer' | 'refund' | 'adjustment';
export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'reversed';

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;             // USD, always positive
  department: string;
  category: CostCategory;
  description: string;
  reference?: string;         // External reference (invoice #, PO #, etc.)
  tags: string[];
  status: TransactionStatus;
  metadata: Record<string, unknown>;
  createdBy: string;
  timestamp: Date;
  completedAt?: Date;
  reversedAt?: Date;
  reversalId?: string;        // ID of the reversal transaction
}

export interface LedgerEntry {
  id: string;
  transactionId: string;
  account: string;            // e.g. 'infrastructure:expense', 'operations:income'
  debit: number;
  credit: number;
  balance: number;            // Running balance for this account
  timestamp: Date;
}

export interface AccountSummary {
  account: string;
  department: string;
  category: CostCategory;
  totalDebits: number;
  totalCredits: number;
  balance: number;
  transactionCount: number;
  lastActivity: Date | null;
}

export interface FinancialReport {
  id: string;
  period: { start: Date; end: Date };
  generatedAt: Date;
  totalIncome: number;
  totalExpenses: number;
  totalTransfers: number;
  totalRefunds: number;
  netPosition: number;
  zeroCostCompliance: number;
  transactionCount: number;
  byDepartment: DepartmentFinancials[];
  byCategory: CategoryFinancials[];
  topExpenses: Transaction[];
  anomalies: TransactionAnomaly[];
}

export interface DepartmentFinancials {
  department: string;
  income: number;
  expenses: number;
  refunds: number;
  net: number;
  transactionCount: number;
}

export interface CategoryFinancials {
  category: CostCategory;
  total: number;
  transactionCount: number;
  averageAmount: number;
}

export interface TransactionAnomaly {
  transactionId: string;
  type: 'large_amount' | 'unusual_category' | 'zero_cost_violation' | 'duplicate' | 'rapid_succession';
  severity: 'low' | 'medium' | 'high';
  description: string;
  detectedAt: Date;
}

export interface LedgerStats {
  totalTransactions: number;
  completedTransactions: number;
  failedTransactions: number;
  reversedTransactions: number;
  totalVolume: number;
  totalExpenses: number;
  totalIncome: number;
  anomaliesDetected: number;
  reportsGenerated: number;
}

// ============================================================================
// TRANSACTION LEDGER
// ============================================================================

export class TransactionLedger {
  private transactions: Map<string, Transaction> = new Map();
  private ledgerEntries: LedgerEntry[] = [];
  private accountBalances: Map<string, number> = new Map();
  private reports: FinancialReport[] = [];
  private stats: LedgerStats;

  // Anomaly detection thresholds
  private readonly LARGE_AMOUNT_THRESHOLD = 100;   // $100 — flag any expense over this
  private readonly RAPID_SUCCESSION_WINDOW = 60_000; // 60 seconds
  private readonly RAPID_SUCCESSION_COUNT = 5;

  constructor() {
    this.stats = this.initStats();
    logger.info('TransactionLedger initialised');
  }

  // --------------------------------------------------------------------------
  // RECORD TRANSACTIONS
  // --------------------------------------------------------------------------

  record(params: {
    type: TransactionType;
    amount: number;
    department: string;
    category: CostCategory;
    description: string;
    reference?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    createdBy?: string;
  }): Transaction {
    const transaction: Transaction = {
      id: uuidv4(),
      type: params.type,
      amount: Math.abs(params.amount),
      department: params.department,
      category: params.category,
      description: params.description,
      reference: params.reference,
      tags: params.tags || [],
      status: 'pending',
      metadata: params.metadata || {},
      createdBy: params.createdBy || 'system',
      timestamp: new Date(),
    };

    this.transactions.set(transaction.id, transaction);
    this.stats.totalTransactions++;

    // Detect anomalies before completing
    const anomalies = this.detectAnomalies(transaction);
    if (anomalies.length > 0) {
      this.stats.anomaliesDetected += anomalies.length;
      for (const anomaly of anomalies) {
        logger.warn({ transactionId: transaction.id, anomaly }, 'Transaction anomaly detected');
      }
    }

    // Complete the transaction
    this.completeTransaction(transaction);

    logger.info({
      transactionId: transaction.id,
      type: transaction.type,
      amount: transaction.amount,
      department: transaction.department,
    }, 'Transaction recorded');

    return transaction;
  }

  private completeTransaction(transaction: Transaction): void {
    // Update budget
    const budget = budgetManager.getBudget(transaction.department);
    if (budget) {
      if (transaction.type === 'expense') {
        budget.spent += transaction.amount;
        this.stats.totalExpenses += transaction.amount;
      } else if (transaction.type === 'income' || transaction.type === 'refund') {
        this.stats.totalIncome += transaction.amount;
      }
    }

    // Create ledger entries (double-entry)
    this.createLedgerEntries(transaction);

    transaction.status = 'completed';
    transaction.completedAt = new Date();
    this.stats.completedTransactions++;
    this.stats.totalVolume += transaction.amount;
  }

  private createLedgerEntries(transaction: Transaction): void {
    const account = `${transaction.department}:${transaction.type}`;
    const currentBalance = this.accountBalances.get(account) || 0;

    let debit = 0;
    let credit = 0;
    let newBalance = currentBalance;

    switch (transaction.type) {
      case 'expense':
      case 'transfer':
        debit = transaction.amount;
        newBalance = currentBalance + transaction.amount;
        break;
      case 'income':
      case 'refund':
        credit = transaction.amount;
        newBalance = currentBalance - transaction.amount;
        break;
      case 'adjustment':
        // Adjustments can go either way
        if (transaction.metadata.direction === 'debit') {
          debit = transaction.amount;
          newBalance = currentBalance + transaction.amount;
        } else {
          credit = transaction.amount;
          newBalance = currentBalance - transaction.amount;
        }
        break;
    }

    this.accountBalances.set(account, newBalance);

    const entry: LedgerEntry = {
      id: uuidv4(),
      transactionId: transaction.id,
      account,
      debit,
      credit,
      balance: newBalance,
      timestamp: new Date(),
    };

    this.ledgerEntries.push(entry);
  }

  // --------------------------------------------------------------------------
  // REVERSAL
  // --------------------------------------------------------------------------

  reverseTransaction(transactionId: string, reason: string): Transaction | null {
    const original = this.transactions.get(transactionId);
    if (!original || original.status !== 'completed') return null;

    // Create reversal transaction
    const reversal = this.record({
      type: original.type === 'expense' ? 'refund' : 'adjustment',
      amount: original.amount,
      department: original.department,
      category: original.category,
      description: `REVERSAL: ${original.description} — ${reason}`,
      reference: original.id,
      tags: [...original.tags, 'reversal'],
      metadata: { originalTransactionId: original.id, reversalReason: reason },
      createdBy: 'dorris-ai',
    });

    // Mark original as reversed
    original.status = 'reversed';
    original.reversedAt = new Date();
    original.reversalId = reversal.id;
    this.stats.reversedTransactions++;

    // Undo budget impact
    const budget = budgetManager.getBudget(original.department);
    if (budget && original.type === 'expense') {
      budget.spent = Math.max(0, budget.spent - original.amount);
    }

    logger.info({ originalId: transactionId, reversalId: reversal.id, reason }, 'Transaction reversed');
    return reversal;
  }

  // --------------------------------------------------------------------------
  // QUERIES
  // --------------------------------------------------------------------------

  getTransaction(id: string): Transaction | undefined {
    return this.transactions.get(id);
  }

  queryTransactions(filters?: {
    type?: TransactionType;
    department?: string;
    category?: CostCategory;
    status?: TransactionStatus;
    minAmount?: number;
    maxAmount?: number;
    since?: Date;
    until?: Date;
    tags?: string[];
    limit?: number;
  }): Transaction[] {
    let results = Array.from(this.transactions.values());

    if (filters?.type) results = results.filter(t => t.type === filters.type);
    if (filters?.department) results = results.filter(t => t.department === filters.department);
    if (filters?.category) results = results.filter(t => t.category === filters.category);
    if (filters?.status) results = results.filter(t => t.status === filters.status);
    if (filters?.minAmount !== undefined) results = results.filter(t => t.amount >= filters.minAmount!);
    if (filters?.maxAmount !== undefined) results = results.filter(t => t.amount <= filters.maxAmount!);
    if (filters?.since) results = results.filter(t => t.timestamp >= filters.since!);
    if (filters?.until) results = results.filter(t => t.timestamp <= filters.until!);
    if (filters?.tags?.length) {
      results = results.filter(t => filters.tags!.some(tag => t.tags.includes(tag)));
    }

    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (filters?.limit) results = results.slice(0, filters.limit);
    return results;
  }

  getLedgerEntries(account?: string): LedgerEntry[] {
    if (account) return this.ledgerEntries.filter(e => e.account === account);
    return [...this.ledgerEntries];
  }

  getAccountSummaries(): AccountSummary[] {
    const summaries: AccountSummary[] = [];

    for (const [account, balance] of this.accountBalances.entries()) {
      const [department, type] = account.split(':');
      const entries = this.ledgerEntries.filter(e => e.account === account);
      const transactions = Array.from(this.transactions.values()).filter(
        t => t.department === department && t.type === type,
      );

      const lastActivity = transactions.length > 0
        ? new Date(Math.max(...transactions.map(t => t.timestamp.getTime())))
        : null;

      summaries.push({
        account,
        department,
        category: (transactions[0]?.category || 'miscellaneous') as CostCategory,
        totalDebits: entries.reduce((s, e) => s + e.debit, 0),
        totalCredits: entries.reduce((s, e) => s + e.credit, 0),
        balance,
        transactionCount: transactions.length,
        lastActivity,
      });
    }

    return summaries;
  }

  // --------------------------------------------------------------------------
  // FINANCIAL REPORTS
  // --------------------------------------------------------------------------

  generateReport(period?: { start: Date; end: Date }): FinancialReport {
    const now = new Date();
    const start = period?.start || new Date(now.getFullYear(), now.getMonth(), 1);
    const end = period?.end || now;

    const periodTransactions = Array.from(this.transactions.values()).filter(
      t => t.timestamp >= start && t.timestamp <= end && t.status === 'completed',
    );

    const totalIncome = periodTransactions
      .filter(t => t.type === 'income' || t.type === 'refund')
      .reduce((s, t) => s + t.amount, 0);

    const totalExpenses = periodTransactions
      .filter(t => t.type === 'expense')
      .reduce((s, t) => s + t.amount, 0);

    const totalTransfers = periodTransactions
      .filter(t => t.type === 'transfer')
      .reduce((s, t) => s + t.amount, 0);

    const totalRefunds = periodTransactions
      .filter(t => t.type === 'refund')
      .reduce((s, t) => s + t.amount, 0);

    // Department breakdown
    const deptMap = new Map<string, DepartmentFinancials>();
    for (const tx of periodTransactions) {
      if (!deptMap.has(tx.department)) {
        deptMap.set(tx.department, { department: tx.department, income: 0, expenses: 0, refunds: 0, net: 0, transactionCount: 0 });
      }
      const dept = deptMap.get(tx.department)!;
      dept.transactionCount++;
      if (tx.type === 'income') dept.income += tx.amount;
      else if (tx.type === 'expense') dept.expenses += tx.amount;
      else if (tx.type === 'refund') dept.refunds += tx.amount;
      dept.net = dept.income + dept.refunds - dept.expenses;
    }

    // Category breakdown
    const catMap = new Map<CostCategory, CategoryFinancials>();
    for (const tx of periodTransactions.filter(t => t.type === 'expense')) {
      if (!catMap.has(tx.category)) {
        catMap.set(tx.category, { category: tx.category, total: 0, transactionCount: 0, averageAmount: 0 });
      }
      const cat = catMap.get(tx.category)!;
      cat.total += tx.amount;
      cat.transactionCount++;
      cat.averageAmount = cat.total / cat.transactionCount;
    }

    // Top expenses
    const topExpenses = periodTransactions
      .filter(t => t.type === 'expense')
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);

    // Anomalies in period
    const anomalies = periodTransactions.flatMap(t => this.detectAnomalies(t));

    const snapshot = budgetManager.getFinancialSnapshot();

    const report: FinancialReport = {
      id: uuidv4(),
      period: { start, end },
      generatedAt: now,
      totalIncome,
      totalExpenses,
      totalTransfers,
      totalRefunds,
      netPosition: totalIncome + totalRefunds - totalExpenses,
      zeroCostCompliance: snapshot.zeroCostCompliance,
      transactionCount: periodTransactions.length,
      byDepartment: Array.from(deptMap.values()),
      byCategory: Array.from(catMap.values()),
      topExpenses,
      anomalies,
    };

    this.reports.push(report);
    this.stats.reportsGenerated++;

    logger.info({
      reportId: report.id,
      period: { start: start.toISOString(), end: end.toISOString() },
      totalExpenses,
      totalIncome,
      transactionCount: periodTransactions.length,
    }, 'Financial report generated');

    return report;
  }

  getReports(): FinancialReport[] {
    return [...this.reports].sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
  }

  // --------------------------------------------------------------------------
  // ANOMALY DETECTION
  // --------------------------------------------------------------------------

  private detectAnomalies(transaction: Transaction): TransactionAnomaly[] {
    const anomalies: TransactionAnomaly[] = [];

    // Large amount
    if (transaction.type === 'expense' && transaction.amount > this.LARGE_AMOUNT_THRESHOLD) {
      anomalies.push({
        transactionId: transaction.id,
        type: 'large_amount',
        severity: transaction.amount > 1000 ? 'high' : 'medium',
        description: `Large expense: $${transaction.amount.toFixed(2)} in ${transaction.department}`,
        detectedAt: new Date(),
      });
    }

    // Zero-cost violation
    if (transaction.type === 'expense' && transaction.amount > 0) {
      const budget = budgetManager.getBudget(transaction.department);
      if (budget?.zeroCostTarget) {
        anomalies.push({
          transactionId: transaction.id,
          type: 'zero_cost_violation',
          severity: 'high',
          description: `Zero-cost violation: $${transaction.amount.toFixed(2)} expense in zero-cost department ${transaction.department}`,
          detectedAt: new Date(),
        });
      }
    }

    // Rapid succession
    const recentSameDept = Array.from(this.transactions.values()).filter(
      t =>
        t.department === transaction.department &&
        t.type === 'expense' &&
        t.id !== transaction.id &&
        Date.now() - t.timestamp.getTime() < this.RAPID_SUCCESSION_WINDOW,
    );
    if (recentSameDept.length >= this.RAPID_SUCCESSION_COUNT) {
      anomalies.push({
        transactionId: transaction.id,
        type: 'rapid_succession',
        severity: 'medium',
        description: `${recentSameDept.length + 1} transactions in ${transaction.department} within 60 seconds`,
        detectedAt: new Date(),
      });
    }

    // Duplicate detection (same amount + department + description within 5 minutes)
    const duplicates = Array.from(this.transactions.values()).filter(
      t =>
        t.id !== transaction.id &&
        t.amount === transaction.amount &&
        t.department === transaction.department &&
        t.description === transaction.description &&
        Date.now() - t.timestamp.getTime() < 300_000,
    );
    if (duplicates.length > 0) {
      anomalies.push({
        transactionId: transaction.id,
        type: 'duplicate',
        severity: 'high',
        description: `Possible duplicate transaction: same amount/department/description within 5 minutes`,
        detectedAt: new Date(),
      });
    }

    return anomalies;
  }

  // --------------------------------------------------------------------------
  // STATS
  // --------------------------------------------------------------------------

  getStats(): LedgerStats {
    return { ...this.stats };
  }

  private initStats(): LedgerStats {
    return {
      totalTransactions: 0,
      completedTransactions: 0,
      failedTransactions: 0,
      reversedTransactions: 0,
      totalVolume: 0,
      totalExpenses: 0,
      totalIncome: 0,
      anomaliesDetected: 0,
      reportsGenerated: 0,
    };
  }
}

export const transactionLedger = new TransactionLedger();