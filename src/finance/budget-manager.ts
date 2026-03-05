/**
 * Dorris AI — Budget Manager
 *
 * Core financial governance engine. Tracks budgets, approvals,
 * zero-cost compliance, and cost optimization across all departments
 * in the Trancendos ecosystem.
 *
 * Zero-Cost Mandate: The Trancendos architecture targets $0 operational
 * cost by using open-source, self-hosted, and free-tier services only.
 * Dorris enforces this mandate and reports compliance in real time.
 *
 * Migrated from: agents/pillars/DorrisFontaine.ts
 *
 * Architecture: Trancendos Industry 6.0 / 2060 Standard
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

// ============================================================================
// TYPES
// ============================================================================

export type BudgetPeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
export type BudgetStatus = 'healthy' | 'warning' | 'critical' | 'exceeded';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'auto_approved';
export type CostCategory =
  | 'infrastructure'
  | 'development'
  | 'operations'
  | 'security'
  | 'ai_services'
  | 'data_storage'
  | 'networking'
  | 'tooling'
  | 'miscellaneous';

export interface Budget {
  id: string;
  department: string;
  category: CostCategory;
  allocated: number;          // USD
  spent: number;              // USD
  reserved: number;           // USD (pending approvals)
  period: BudgetPeriod;
  periodStart: Date;
  periodEnd: Date;
  status: BudgetStatus;
  zeroCostTarget: boolean;    // true = must stay at $0
  alerts: BudgetAlert[];
  createdAt: Date;
  updatedAt: Date;
}

export interface BudgetAlert {
  id: string;
  type: 'warning' | 'critical' | 'exceeded' | 'zero_cost_violation';
  message: string;
  threshold: number;
  currentValue: number;
  timestamp: Date;
  acknowledged: boolean;
}

export interface ApprovalRequest {
  id: string;
  requesterId: string;
  department: string;
  amount: number;
  description: string;
  category: CostCategory;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  status: ApprovalStatus;
  autoApproveReason?: string;
  rejectionReason?: string;
  requestedAt: Date;
  resolvedAt?: Date;
}

export interface CostOptimizationRecommendation {
  id: string;
  department: string;
  category: CostCategory;
  title: string;
  description: string;
  currentCost: number;
  projectedSaving: number;
  savingPercent: number;
  effort: 'low' | 'medium' | 'high';
  priority: 'low' | 'medium' | 'high' | 'critical';
  actionItems: string[];
}

export interface CostOptimizationReport {
  id: string;
  timestamp: Date;
  totalCurrentSpend: number;
  totalProjectedSavings: number;
  zeroCostCompliance: number;   // 0-100
  recommendations: CostOptimizationRecommendation[];
  departmentBreakdown: DepartmentBreakdown[];
  summary: string;
}

export interface DepartmentBreakdown {
  department: string;
  allocated: number;
  spent: number;
  remaining: number;
  utilizationPercent: number;
  status: BudgetStatus;
  zeroCostCompliant: boolean;
}

export interface FinancialSnapshot {
  timestamp: Date;
  totalAllocated: number;
  totalSpent: number;
  totalReserved: number;
  totalRemaining: number;
  zeroCostCompliance: number;
  budgetCount: number;
  alertCount: number;
  pendingApprovals: number;
  departmentBreakdown: DepartmentBreakdown[];
}

export interface BudgetManagerStats {
  totalBudgets: number;
  totalAllocated: number;
  totalSpent: number;
  zeroCostCompliance: number;
  approvalRequests: number;
  approvedRequests: number;
  rejectedRequests: number;
  autoApprovedRequests: number;
  optimizationReports: number;
  alertsGenerated: number;
}

// ============================================================================
// BUDGET MANAGER
// ============================================================================

export class BudgetManager {
  private budgets: Map<string, Budget> = new Map();
  private approvalRequests: Map<string, ApprovalRequest> = new Map();
  private optimizationReports: CostOptimizationReport[] = [];
  private stats: BudgetManagerStats;

  // Auto-approval thresholds
  private readonly AUTO_APPROVE_THRESHOLD = 0;    // $0 — zero-cost mandate
  private readonly WARNING_THRESHOLD = 0.7;        // 70% of budget
  private readonly CRITICAL_THRESHOLD = 0.9;       // 90% of budget

  constructor() {
    this.stats = this.initStats();
    this.seedDefaultBudgets();
    logger.info({ budgetCount: this.budgets.size }, 'BudgetManager initialised');
  }

  // --------------------------------------------------------------------------
  // BUDGET CRUD
  // --------------------------------------------------------------------------

  createBudget(params: {
    department: string;
    category: CostCategory;
    allocated: number;
    period: BudgetPeriod;
    zeroCostTarget?: boolean;
  }): Budget {
    const now = new Date();
    const budget: Budget = {
      id: uuidv4(),
      department: params.department,
      category: params.category,
      allocated: params.allocated,
      spent: 0,
      reserved: 0,
      period: params.period,
      periodStart: now,
      periodEnd: this.calculatePeriodEnd(now, params.period),
      status: 'healthy',
      zeroCostTarget: params.zeroCostTarget ?? params.allocated === 0,
      alerts: [],
      createdAt: now,
      updatedAt: now,
    };

    this.budgets.set(budget.id, budget);
    this.stats.totalBudgets++;
    this.stats.totalAllocated += budget.allocated;

    logger.info({ budgetId: budget.id, department: budget.department, allocated: budget.allocated }, 'Budget created');
    return budget;
  }

  getBudget(idOrDepartment: string): Budget | undefined {
    // Try by ID first
    if (this.budgets.has(idOrDepartment)) return this.budgets.get(idOrDepartment);
    // Try by department name
    return Array.from(this.budgets.values()).find(b => b.department === idOrDepartment);
  }

  getBudgets(): Budget[] {
    return Array.from(this.budgets.values());
  }

  updateBudget(id: string, updates: Partial<Pick<Budget, 'allocated' | 'period' | 'zeroCostTarget'>>): Budget | null {
    const budget = this.budgets.get(id);
    if (!budget) return null;

    if (updates.allocated !== undefined) {
      this.stats.totalAllocated += updates.allocated - budget.allocated;
      budget.allocated = updates.allocated;
    }
    if (updates.period !== undefined) budget.period = updates.period;
    if (updates.zeroCostTarget !== undefined) budget.zeroCostTarget = updates.zeroCostTarget;

    budget.updatedAt = new Date();
    budget.status = this.calculateBudgetStatus(budget);
    return budget;
  }

  // --------------------------------------------------------------------------
  // BUDGET CHECKS & APPROVALS
  // --------------------------------------------------------------------------

  checkBudget(department: string, amount: number): {
    approved: boolean;
    remaining: number;
    budget: Budget | null;
    reason: string;
  } {
    const budget = this.getBudget(department);

    if (!budget) {
      return { approved: false, remaining: 0, budget: null, reason: `No budget found for department: ${department}` };
    }

    const remaining = budget.allocated - budget.spent - budget.reserved;

    if (budget.zeroCostTarget && amount > 0) {
      return { approved: false, remaining, budget, reason: `Zero-cost mandate: ${department} must not incur costs` };
    }

    if (amount > remaining) {
      return { approved: false, remaining, budget, reason: `Insufficient budget: requested $${amount}, remaining $${remaining}` };
    }

    return { approved: true, remaining, budget, reason: 'Budget available' };
  }

  requestApproval(params: {
    requesterId: string;
    department: string;
    amount: number;
    description: string;
    category: CostCategory;
    urgency?: 'low' | 'medium' | 'high' | 'critical';
  }): ApprovalRequest {
    const request: ApprovalRequest = {
      id: uuidv4(),
      requesterId: params.requesterId,
      department: params.department,
      amount: params.amount,
      description: params.description,
      category: params.category,
      urgency: params.urgency || 'medium',
      status: 'pending',
      requestedAt: new Date(),
    };

    // Auto-approve zero-cost requests
    if (params.amount <= this.AUTO_APPROVE_THRESHOLD) {
      request.status = 'auto_approved';
      request.autoApproveReason = 'Zero-cost request — auto-approved per mandate';
      request.resolvedAt = new Date();
      this.stats.autoApprovedRequests++;
    } else {
      // Check budget availability
      const check = this.checkBudget(params.department, params.amount);
      if (!check.approved) {
        request.status = 'rejected';
        request.rejectionReason = check.reason;
        request.resolvedAt = new Date();
        this.stats.rejectedRequests++;
        logger.warn({ requestId: request.id, reason: check.reason }, 'Approval request rejected');
      }
      // Otherwise stays pending for manual review
    }

    this.approvalRequests.set(request.id, request);
    this.stats.approvalRequests++;

    logger.info({
      requestId: request.id,
      department: params.department,
      amount: params.amount,
      status: request.status,
    }, 'Approval request created');

    return request;
  }

  approveRequest(requestId: string): ApprovalRequest | null {
    const request = this.approvalRequests.get(requestId);
    if (!request || request.status !== 'pending') return null;

    const budget = this.getBudget(request.department);
    if (budget) {
      budget.reserved += request.amount;
      budget.status = this.calculateBudgetStatus(budget);
    }

    request.status = 'approved';
    request.resolvedAt = new Date();
    this.stats.approvedRequests++;

    logger.info({ requestId, amount: request.amount, department: request.department }, 'Approval request approved');
    return request;
  }

  rejectRequest(requestId: string, reason: string): ApprovalRequest | null {
    const request = this.approvalRequests.get(requestId);
    if (!request || request.status !== 'pending') return null;

    request.status = 'rejected';
    request.rejectionReason = reason;
    request.resolvedAt = new Date();
    this.stats.rejectedRequests++;

    logger.info({ requestId, reason }, 'Approval request rejected');
    return request;
  }

  getApprovalRequests(status?: ApprovalStatus): ApprovalRequest[] {
    const all = Array.from(this.approvalRequests.values());
    return status ? all.filter(r => r.status === status) : all;
  }

  // --------------------------------------------------------------------------
  // COST OPTIMIZATION
  // --------------------------------------------------------------------------

  generateOptimizationReport(): CostOptimizationReport {
    const recommendations: CostOptimizationRecommendation[] = [];
    const departmentBreakdown: DepartmentBreakdown[] = [];
    let totalSpend = 0;
    let totalSavings = 0;

    for (const budget of this.budgets.values()) {
      totalSpend += budget.spent;
      const remaining = budget.allocated - budget.spent - budget.reserved;
      const utilization = budget.allocated > 0 ? (budget.spent / budget.allocated) * 100 : 0;

      departmentBreakdown.push({
        department: budget.department,
        allocated: budget.allocated,
        spent: budget.spent,
        remaining,
        utilizationPercent: Math.round(utilization),
        status: budget.status,
        zeroCostCompliant: budget.zeroCostTarget ? budget.spent === 0 : true,
      });

      // Generate recommendations
      if (budget.spent > budget.allocated * this.WARNING_THRESHOLD) {
        const saving = budget.spent * 0.15;
        recommendations.push({
          id: uuidv4(),
          department: budget.department,
          category: budget.category,
          title: `Reduce ${budget.department} spending`,
          description: `${budget.department} is at ${utilization.toFixed(0)}% of budget. Review and reduce non-essential costs.`,
          currentCost: budget.spent,
          projectedSaving: saving,
          savingPercent: 15,
          effort: 'medium',
          priority: budget.spent > budget.allocated * this.CRITICAL_THRESHOLD ? 'critical' : 'high',
          actionItems: [
            `Audit all ${budget.department} expenses for the current period`,
            `Identify and eliminate redundant services`,
            `Switch to free-tier alternatives where possible`,
            `Implement usage-based scaling to reduce idle costs`,
          ],
        });
        totalSavings += saving;
      }

      // Zero-cost violation recommendations
      if (budget.zeroCostTarget && budget.spent > 0) {
        recommendations.push({
          id: uuidv4(),
          department: budget.department,
          category: budget.category,
          title: `Zero-cost violation in ${budget.department}`,
          description: `${budget.department} has incurred $${budget.spent.toFixed(2)} in costs, violating the zero-cost mandate.`,
          currentCost: budget.spent,
          projectedSaving: budget.spent,
          savingPercent: 100,
          effort: 'high',
          priority: 'critical',
          actionItems: [
            `Immediately identify the source of costs in ${budget.department}`,
            `Replace paid services with free/open-source alternatives`,
            `Review and revoke any paid API keys or subscriptions`,
            `Implement cost alerts to prevent future violations`,
          ],
        });
        totalSavings += budget.spent;
      }
    }

    // Sort recommendations by priority
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    const compliance = this.calculateZeroCostCompliance();
    const report: CostOptimizationReport = {
      id: uuidv4(),
      timestamp: new Date(),
      totalCurrentSpend: totalSpend,
      totalProjectedSavings: totalSavings,
      zeroCostCompliance: compliance,
      recommendations,
      departmentBreakdown,
      summary: this.buildOptimizationSummary(totalSpend, totalSavings, compliance, recommendations.length),
    };

    this.optimizationReports.push(report);
    this.stats.optimizationReports++;

    logger.info({
      reportId: report.id,
      totalSpend,
      totalSavings,
      compliance,
      recommendations: recommendations.length,
    }, 'Cost optimization report generated');

    return report;
  }

  // --------------------------------------------------------------------------
  // FINANCIAL SNAPSHOT
  // --------------------------------------------------------------------------

  getFinancialSnapshot(): FinancialSnapshot {
    let totalAllocated = 0;
    let totalSpent = 0;
    let totalReserved = 0;
    const departmentBreakdown: DepartmentBreakdown[] = [];

    for (const budget of this.budgets.values()) {
      totalAllocated += budget.allocated;
      totalSpent += budget.spent;
      totalReserved += budget.reserved;

      const remaining = budget.allocated - budget.spent - budget.reserved;
      const utilization = budget.allocated > 0 ? (budget.spent / budget.allocated) * 100 : 0;

      departmentBreakdown.push({
        department: budget.department,
        allocated: budget.allocated,
        spent: budget.spent,
        remaining,
        utilizationPercent: Math.round(utilization),
        status: budget.status,
        zeroCostCompliant: budget.zeroCostTarget ? budget.spent === 0 : true,
      });
    }

    const allAlerts = Array.from(this.budgets.values()).flatMap(b => b.alerts.filter(a => !a.acknowledged));
    const pendingApprovals = Array.from(this.approvalRequests.values()).filter(r => r.status === 'pending').length;

    return {
      timestamp: new Date(),
      totalAllocated,
      totalSpent,
      totalReserved,
      totalRemaining: totalAllocated - totalSpent - totalReserved,
      zeroCostCompliance: this.calculateZeroCostCompliance(),
      budgetCount: this.budgets.size,
      alertCount: allAlerts.length,
      pendingApprovals,
      departmentBreakdown,
    };
  }

  // --------------------------------------------------------------------------
  // ALERTS
  // --------------------------------------------------------------------------

  checkAndGenerateAlerts(): BudgetAlert[] {
    const newAlerts: BudgetAlert[] = [];

    for (const budget of this.budgets.values()) {
      const utilization = budget.allocated > 0 ? budget.spent / budget.allocated : 0;

      // Zero-cost violation
      if (budget.zeroCostTarget && budget.spent > 0) {
        const alert: BudgetAlert = {
          id: uuidv4(),
          type: 'zero_cost_violation',
          message: `ZERO-COST VIOLATION: ${budget.department} has spent $${budget.spent.toFixed(2)}`,
          threshold: 0,
          currentValue: budget.spent,
          timestamp: new Date(),
          acknowledged: false,
        };
        budget.alerts.push(alert);
        newAlerts.push(alert);
        this.stats.alertsGenerated++;
        logger.error({ department: budget.department, spent: budget.spent }, 'Zero-cost violation detected');
      }

      // Critical threshold
      else if (utilization >= this.CRITICAL_THRESHOLD && budget.allocated > 0) {
        const alert: BudgetAlert = {
          id: uuidv4(),
          type: 'critical',
          message: `CRITICAL: ${budget.department} at ${(utilization * 100).toFixed(0)}% of budget`,
          threshold: this.CRITICAL_THRESHOLD,
          currentValue: utilization,
          timestamp: new Date(),
          acknowledged: false,
        };
        budget.alerts.push(alert);
        newAlerts.push(alert);
        this.stats.alertsGenerated++;
        logger.warn({ department: budget.department, utilization }, 'Critical budget threshold reached');
      }

      // Warning threshold
      else if (utilization >= this.WARNING_THRESHOLD && budget.allocated > 0) {
        const alert: BudgetAlert = {
          id: uuidv4(),
          type: 'warning',
          message: `WARNING: ${budget.department} at ${(utilization * 100).toFixed(0)}% of budget`,
          threshold: this.WARNING_THRESHOLD,
          currentValue: utilization,
          timestamp: new Date(),
          acknowledged: false,
        };
        budget.alerts.push(alert);
        newAlerts.push(alert);
        this.stats.alertsGenerated++;
      }

      budget.status = this.calculateBudgetStatus(budget);
    }

    return newAlerts;
  }

  acknowledgeAlert(budgetId: string, alertId: string): boolean {
    const budget = this.budgets.get(budgetId);
    if (!budget) return false;
    const alert = budget.alerts.find(a => a.id === alertId);
    if (!alert) return false;
    alert.acknowledged = true;
    return true;
  }

  // --------------------------------------------------------------------------
  // STATS
  // --------------------------------------------------------------------------

  getStats(): BudgetManagerStats {
    return {
      ...this.stats,
      totalAllocated: Array.from(this.budgets.values()).reduce((s, b) => s + b.allocated, 0),
      totalSpent: Array.from(this.budgets.values()).reduce((s, b) => s + b.spent, 0),
      zeroCostCompliance: this.calculateZeroCostCompliance(),
    };
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  private seedDefaultBudgets(): void {
    const departments: Array<{ department: string; category: CostCategory; allocated: number }> = [
      { department: 'infrastructure', category: 'infrastructure', allocated: 0 },
      { department: 'development', category: 'development', allocated: 0 },
      { department: 'operations', category: 'operations', allocated: 0 },
      { department: 'security', category: 'security', allocated: 0 },
      { department: 'ai_services', category: 'ai_services', allocated: 0 },
      { department: 'data_storage', category: 'data_storage', allocated: 0 },
      { department: 'networking', category: 'networking', allocated: 0 },
      { department: 'tooling', category: 'tooling', allocated: 0 },
    ];

    for (const dept of departments) {
      this.createBudget({ ...dept, period: 'monthly', zeroCostTarget: true });
    }
  }

  private calculatePeriodEnd(start: Date, period: BudgetPeriod): Date {
    const end = new Date(start);
    switch (period) {
      case 'daily': end.setDate(end.getDate() + 1); break;
      case 'weekly': end.setDate(end.getDate() + 7); break;
      case 'monthly': end.setMonth(end.getMonth() + 1); break;
      case 'quarterly': end.setMonth(end.getMonth() + 3); break;
      case 'annual': end.setFullYear(end.getFullYear() + 1); break;
    }
    return end;
  }

  private calculateBudgetStatus(budget: Budget): BudgetStatus {
    if (budget.zeroCostTarget && budget.spent > 0) return 'exceeded';
    if (budget.allocated === 0) return 'healthy';
    const utilization = budget.spent / budget.allocated;
    if (utilization >= 1) return 'exceeded';
    if (utilization >= this.CRITICAL_THRESHOLD) return 'critical';
    if (utilization >= this.WARNING_THRESHOLD) return 'warning';
    return 'healthy';
  }

  private calculateZeroCostCompliance(): number {
    const zeroCostBudgets = Array.from(this.budgets.values()).filter(b => b.zeroCostTarget);
    if (zeroCostBudgets.length === 0) return 100;
    const compliant = zeroCostBudgets.filter(b => b.spent === 0).length;
    return Math.round((compliant / zeroCostBudgets.length) * 100);
  }

  private buildOptimizationSummary(
    totalSpend: number,
    totalSavings: number,
    compliance: number,
    recommendationCount: number,
  ): string {
    if (totalSpend === 0) {
      return `Zero-cost mandate fully compliant (${compliance}%). No cost optimization needed. All ${this.budgets.size} departments operating at $0.`;
    }
    return `Total spend: $${totalSpend.toFixed(2)}. Potential savings: $${totalSavings.toFixed(2)} (${((totalSavings / totalSpend) * 100).toFixed(0)}%). Zero-cost compliance: ${compliance}%. ${recommendationCount} recommendation(s) generated.`;
  }

  private initStats(): BudgetManagerStats {
    return {
      totalBudgets: 0,
      totalAllocated: 0,
      totalSpent: 0,
      zeroCostCompliance: 100,
      approvalRequests: 0,
      approvedRequests: 0,
      rejectedRequests: 0,
      autoApprovedRequests: 0,
      optimizationReports: 0,
      alertsGenerated: 0,
    };
  }
}

export const budgetManager = new BudgetManager();