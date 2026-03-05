/**
 * Dorris AI — Autonomous Mailbox
 *
 * Intelligent message routing and processing hub for Dorris.
 * Handles incoming financial requests, budget approvals, cost alerts,
 * and inter-agent communications. Routes messages to the appropriate
 * handler based on intent classification.
 *
 * Migrated from: agents/pillars/DorrisFontaine.ts (onMessageReceived)
 *               + agents/base/AgentBase.ts (messaging infrastructure)
 *
 * Architecture: Trancendos Industry 6.0 / 2060 Standard
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { budgetManager } from '../finance/budget-manager';
import { transactionLedger } from '../finance/transaction-ledger';

// ============================================================================
// TYPES
// ============================================================================

export type MessagePriority = 'low' | 'normal' | 'high' | 'urgent' | 'critical';
export type MessageStatus = 'queued' | 'processing' | 'processed' | 'failed' | 'deferred';
export type MessageIntent =
  | 'check_budget'
  | 'record_transaction'
  | 'request_approval'
  | 'optimize_costs'
  | 'generate_report'
  | 'get_snapshot'
  | 'reverse_transaction'
  | 'acknowledge_alert'
  | 'query_transactions'
  | 'get_stats'
  | 'unknown';

export interface MailMessage {
  id: string;
  from: string;               // Sender agent ID
  to: string;                 // Recipient agent ID (usually 'dorris-ai')
  subject: string;
  body: string;
  payload: Record<string, unknown>;
  intent: MessageIntent;
  priority: MessagePriority;
  status: MessageStatus;
  replyTo?: string;           // Message ID to reply to
  correlationId?: string;     // For tracking request-response pairs
  tags: string[];
  receivedAt: Date;
  processedAt?: Date;
  response?: MailResponse;
  error?: string;
  retryCount: number;
  maxRetries: number;
}

export interface MailResponse {
  messageId: string;
  success: boolean;
  data: unknown;
  error?: string;
  processingMs: number;
  timestamp: Date;
}

export interface MailboxStats {
  totalReceived: number;
  totalProcessed: number;
  totalFailed: number;
  totalDeferred: number;
  byIntent: Record<MessageIntent, number>;
  byPriority: Record<MessagePriority, number>;
  averageProcessingMs: number;
  queueDepth: number;
}

export interface MailboxRule {
  id: string;
  name: string;
  condition: (message: MailMessage) => boolean;
  action: 'route' | 'prioritize' | 'defer' | 'auto_reply' | 'tag';
  value?: string | MessagePriority;
  enabled: boolean;
}

// ============================================================================
// MAILBOX
// ============================================================================

export class Mailbox {
  private messages: Map<string, MailMessage> = new Map();
  private queue: string[] = [];           // Message IDs in priority order
  private rules: MailboxRule[] = [];
  private stats: MailboxStats;
  private processingTimes: number[] = [];
  private isProcessing = false;

  constructor() {
    this.stats = this.initStats();
    this.loadDefaultRules();
    logger.info('Mailbox initialised');
  }

  // --------------------------------------------------------------------------
  // RECEIVE & ENQUEUE
  // --------------------------------------------------------------------------

  receive(params: {
    from: string;
    to?: string;
    subject: string;
    body?: string;
    payload: Record<string, unknown>;
    priority?: MessagePriority;
    replyTo?: string;
    correlationId?: string;
    tags?: string[];
  }): MailMessage {
    const intent = this.classifyIntent(params.payload, params.subject);
    const priority = params.priority || this.inferPriority(intent, params.payload);

    const message: MailMessage = {
      id: uuidv4(),
      from: params.from,
      to: params.to || 'dorris-ai',
      subject: params.subject,
      body: params.body || '',
      payload: params.payload,
      intent,
      priority,
      status: 'queued',
      replyTo: params.replyTo,
      correlationId: params.correlationId || uuidv4(),
      tags: params.tags || [],
      receivedAt: new Date(),
      retryCount: 0,
      maxRetries: 3,
    };

    // Apply mailbox rules
    this.applyRules(message);

    this.messages.set(message.id, message);
    this.enqueue(message);

    this.stats.totalReceived++;
    this.stats.byIntent[intent] = (this.stats.byIntent[intent] || 0) + 1;
    this.stats.byPriority[priority] = (this.stats.byPriority[priority] || 0) + 1;

    logger.info({
      messageId: message.id,
      from: message.from,
      intent,
      priority,
    }, 'Message received');

    // Auto-process if not already processing
    if (!this.isProcessing) {
      setImmediate(() => this.processQueue());
    }

    return message;
  }

  // --------------------------------------------------------------------------
  // PROCESS QUEUE
  // --------------------------------------------------------------------------

  async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const messageId = this.queue.shift()!;
      const message = this.messages.get(messageId);
      if (!message || message.status !== 'queued') continue;

      await this.processMessage(message);
    }

    this.isProcessing = false;
    this.stats.queueDepth = this.queue.length;
  }

  private async processMessage(message: MailMessage): Promise<void> {
    const startMs = Date.now();
    message.status = 'processing';

    try {
      const data = await this.dispatch(message);
      const processingMs = Date.now() - startMs;

      message.status = 'processed';
      message.processedAt = new Date();
      message.response = {
        messageId: message.id,
        success: true,
        data,
        processingMs,
        timestamp: new Date(),
      };

      this.stats.totalProcessed++;
      this.processingTimes.push(processingMs);
      if (this.processingTimes.length > 1000) this.processingTimes.shift();

      logger.debug({
        messageId: message.id,
        intent: message.intent,
        processingMs,
      }, 'Message processed');

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      message.retryCount++;

      if (message.retryCount < message.maxRetries) {
        message.status = 'queued';
        this.enqueue(message);
        logger.warn({ messageId: message.id, retryCount: message.retryCount, error }, 'Message processing failed, retrying');
      } else {
        message.status = 'failed';
        message.error = error;
        message.processedAt = new Date();
        message.response = {
          messageId: message.id,
          success: false,
          data: null,
          error,
          processingMs: Date.now() - startMs,
          timestamp: new Date(),
        };
        this.stats.totalFailed++;
        logger.error({ messageId: message.id, intent: message.intent, error }, 'Message processing failed permanently');
      }
    }
  }

  // --------------------------------------------------------------------------
  // DISPATCH — Route to correct handler
  // --------------------------------------------------------------------------

  private async dispatch(message: MailMessage): Promise<unknown> {
    const p = message.payload;

    switch (message.intent) {
      case 'check_budget': {
        const department = p.department as string;
        const amount = p.amount as number;
        if (!department || amount === undefined) throw new Error('department and amount required');
        return budgetManager.checkBudget(department, amount);
      }

      case 'record_transaction': {
        const tx = p.transaction as Record<string, unknown>;
        if (!tx) throw new Error('transaction payload required');
        return transactionLedger.record({
          type: tx.type as 'income' | 'expense' | 'transfer' | 'refund' | 'adjustment',
          amount: tx.amount as number,
          department: tx.department as string,
          category: (tx.category as 'infrastructure') || 'miscellaneous',
          description: tx.description as string,
          reference: tx.reference as string | undefined,
          tags: tx.tags as string[] | undefined,
          createdBy: message.from,
        });
      }

      case 'request_approval': {
        return budgetManager.requestApproval({
          requesterId: message.from,
          department: p.department as string,
          amount: p.amount as number,
          description: p.description as string,
          category: (p.category as 'infrastructure') || 'miscellaneous',
          urgency: p.urgency as 'low' | 'medium' | 'high' | 'critical' | undefined,
        });
      }

      case 'optimize_costs': {
        return budgetManager.generateOptimizationReport();
      }

      case 'generate_report': {
        const since = p.since ? new Date(p.since as string) : undefined;
        const until = p.until ? new Date(p.until as string) : undefined;
        return transactionLedger.generateReport(
          since && until ? { start: since, end: until } : undefined,
        );
      }

      case 'get_snapshot': {
        return budgetManager.getFinancialSnapshot();
      }

      case 'reverse_transaction': {
        const txId = p.transactionId as string;
        const reason = (p.reason as string) || 'Requested reversal';
        if (!txId) throw new Error('transactionId required');
        const result = transactionLedger.reverseTransaction(txId, reason);
        if (!result) throw new Error(`Transaction ${txId} not found or not reversible`);
        return result;
      }

      case 'acknowledge_alert': {
        const budgetId = p.budgetId as string;
        const alertId = p.alertId as string;
        if (!budgetId || !alertId) throw new Error('budgetId and alertId required');
        return { acknowledged: budgetManager.acknowledgeAlert(budgetId, alertId) };
      }

      case 'query_transactions': {
        return transactionLedger.queryTransactions({
          type: p.type as 'income' | undefined,
          department: p.department as string | undefined,
          since: p.since ? new Date(p.since as string) : undefined,
          until: p.until ? new Date(p.until as string) : undefined,
          limit: p.limit as number | undefined,
        });
      }

      case 'get_stats': {
        return {
          budget: budgetManager.getStats(),
          ledger: transactionLedger.getStats(),
          mailbox: this.getStats(),
        };
      }

      default: {
        logger.warn({ intent: message.intent, from: message.from }, 'Unknown message intent');
        return { handled: false, intent: message.intent, message: 'Unknown intent — no handler registered' };
      }
    }
  }

  // --------------------------------------------------------------------------
  // INTENT CLASSIFICATION
  // --------------------------------------------------------------------------

  private classifyIntent(payload: Record<string, unknown>, subject: string): MessageIntent {
    const action = (payload.action as string || '').toLowerCase();
    const subjectLower = subject.toLowerCase();

    // Explicit action field
    const actionMap: Record<string, MessageIntent> = {
      check_budget: 'check_budget',
      record_transaction: 'record_transaction',
      request_approval: 'request_approval',
      optimize_costs: 'optimize_costs',
      generate_report: 'generate_report',
      get_snapshot: 'get_snapshot',
      financial_snapshot: 'get_snapshot',
      reverse_transaction: 'reverse_transaction',
      acknowledge_alert: 'acknowledge_alert',
      query_transactions: 'query_transactions',
      get_stats: 'get_stats',
    };

    if (action && actionMap[action]) return actionMap[action];

    // Subject-based classification
    if (subjectLower.includes('budget')) return 'check_budget';
    if (subjectLower.includes('transaction') || subjectLower.includes('expense')) return 'record_transaction';
    if (subjectLower.includes('approval') || subjectLower.includes('approve')) return 'request_approval';
    if (subjectLower.includes('optim')) return 'optimize_costs';
    if (subjectLower.includes('report')) return 'generate_report';
    if (subjectLower.includes('snapshot') || subjectLower.includes('summary')) return 'get_snapshot';
    if (subjectLower.includes('reverse') || subjectLower.includes('refund')) return 'reverse_transaction';
    if (subjectLower.includes('alert')) return 'acknowledge_alert';
    if (subjectLower.includes('stats') || subjectLower.includes('metrics')) return 'get_stats';

    return 'unknown';
  }

  private inferPriority(intent: MessageIntent, payload: Record<string, unknown>): MessagePriority {
    // Zero-cost violations are always critical
    if (payload.zeroCostViolation) return 'critical';

    // Urgency field
    const urgency = payload.urgency as string;
    if (urgency === 'critical') return 'critical';
    if (urgency === 'high') return 'high';

    // Intent-based priority
    switch (intent) {
      case 'request_approval': return 'high';
      case 'acknowledge_alert': return 'high';
      case 'reverse_transaction': return 'high';
      case 'record_transaction': return 'normal';
      case 'check_budget': return 'normal';
      case 'optimize_costs': return 'low';
      case 'generate_report': return 'low';
      case 'get_snapshot': return 'low';
      case 'get_stats': return 'low';
      default: return 'normal';
    }
  }

  // --------------------------------------------------------------------------
  // PRIORITY QUEUE
  // --------------------------------------------------------------------------

  private enqueue(message: MailMessage): void {
    const priorityOrder: Record<MessagePriority, number> = {
      critical: 0, urgent: 1, high: 2, normal: 3, low: 4,
    };

    // Insert in priority order
    const insertIdx = this.queue.findIndex(id => {
      const existing = this.messages.get(id);
      if (!existing) return false;
      return priorityOrder[existing.priority] > priorityOrder[message.priority];
    });

    if (insertIdx === -1) {
      this.queue.push(message.id);
    } else {
      this.queue.splice(insertIdx, 0, message.id);
    }

    this.stats.queueDepth = this.queue.length;
  }

  // --------------------------------------------------------------------------
  // MAILBOX RULES
  // --------------------------------------------------------------------------

  private loadDefaultRules(): void {
    this.rules = [
      {
        id: uuidv4(),
        name: 'Tag zero-cost violations as critical',
        condition: (msg) => msg.payload.zeroCostViolation === true,
        action: 'prioritize',
        value: 'critical',
        enabled: true,
      },
      {
        id: uuidv4(),
        name: 'Tag financial reports as low priority',
        condition: (msg) => msg.intent === 'generate_report',
        action: 'prioritize',
        value: 'low',
        enabled: true,
      },
      {
        id: uuidv4(),
        name: 'Tag approval requests from cornelius',
        condition: (msg) => msg.from === 'cornelius-ai' && msg.intent === 'request_approval',
        action: 'tag',
        value: 'orchestrator-request',
        enabled: true,
      },
    ];
  }

  private applyRules(message: MailMessage): void {
    for (const rule of this.rules.filter(r => r.enabled)) {
      try {
        if (rule.condition(message)) {
          switch (rule.action) {
            case 'prioritize':
              message.priority = rule.value as MessagePriority;
              break;
            case 'tag':
              if (rule.value && !message.tags.includes(rule.value as string)) {
                message.tags.push(rule.value as string);
              }
              break;
            case 'defer':
              message.status = 'deferred';
              this.stats.totalDeferred++;
              break;
          }
        }
      } catch {
        // Rule evaluation errors are non-fatal
      }
    }
  }

  // --------------------------------------------------------------------------
  // QUERIES
  // --------------------------------------------------------------------------

  getMessage(id: string): MailMessage | undefined {
    return this.messages.get(id);
  }

  getMessages(filters?: {
    from?: string;
    intent?: MessageIntent;
    status?: MessageStatus;
    priority?: MessagePriority;
    since?: Date;
    limit?: number;
  }): MailMessage[] {
    let results = Array.from(this.messages.values());

    if (filters?.from) results = results.filter(m => m.from === filters.from);
    if (filters?.intent) results = results.filter(m => m.intent === filters.intent);
    if (filters?.status) results = results.filter(m => m.status === filters.status);
    if (filters?.priority) results = results.filter(m => m.priority === filters.priority);
    if (filters?.since) results = results.filter(m => m.receivedAt >= filters.since!);

    results.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
    if (filters?.limit) results = results.slice(0, filters.limit);
    return results;
  }

  // --------------------------------------------------------------------------
  // STATS
  // --------------------------------------------------------------------------

  getStats(): MailboxStats {
    return {
      ...this.stats,
      averageProcessingMs: this.processingTimes.length > 0
        ? this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length
        : 0,
      queueDepth: this.queue.length,
    };
  }

  private initStats(): MailboxStats {
    const intents: MessageIntent[] = [
      'check_budget', 'record_transaction', 'request_approval', 'optimize_costs',
      'generate_report', 'get_snapshot', 'reverse_transaction', 'acknowledge_alert',
      'query_transactions', 'get_stats', 'unknown',
    ];
    const priorities: MessagePriority[] = ['low', 'normal', 'high', 'urgent', 'critical'];

    return {
      totalReceived: 0,
      totalProcessed: 0,
      totalFailed: 0,
      totalDeferred: 0,
      byIntent: Object.fromEntries(intents.map(i => [i, 0])) as Record<MessageIntent, number>,
      byPriority: Object.fromEntries(priorities.map(p => [p, 0])) as Record<MessagePriority, number>,
      averageProcessingMs: 0,
      queueDepth: 0,
    };
  }
}

export const mailbox = new Mailbox();