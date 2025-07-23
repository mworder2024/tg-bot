import { TokenService, TokenReward, SecurityAudit } from './token.service.js';
import { SolanaService } from '../../blockchain/solana-service.js';
import { BlockchainConfig, TransactionResult } from '../../types/blockchain.js';
import winston from 'winston';
import * as crypto from 'crypto';

export interface ComplianceRule {
  id: string;
  name: string;
  type: 'rate_limit' | 'amount_limit' | 'pattern_detection' | 'geographic' | 'time_based';
  enabled: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  parameters: {
    // Rate limiting
    maxTransactionsPerHour?: number;
    maxTransactionsPerDay?: number;
    maxAmountPerTransaction?: number;
    maxAmountPerDay?: number;
    
    // Pattern detection
    suspiciousPatternThreshold?: number;
    rapidFireThreshold?: number; // milliseconds between transactions
    identicalAmountThreshold?: number; // percentage of identical amounts
    
    // Geographic restrictions
    allowedRegions?: string[];
    blockedRegions?: string[];
    
    // Time-based restrictions
    allowedHours?: { start: number; end: number };
    blockedDays?: number[]; // 0 = Sunday, 6 = Saturday
    cooldownPeriod?: number; // milliseconds
  };
  actions: Array<'log' | 'warn' | 'block' | 'delay' | 'flag' | 'escalate'>;
  autoResolve: boolean;
  escalationThreshold: number;
}

export interface SecurityIncident {
  id: string;
  userId: string;
  incidentType: 'fraud_attempt' | 'rate_limit_exceeded' | 'suspicious_pattern' | 'geographic_violation' | 'system_anomaly';
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  description: string;
  evidence: {
    transactionHashes?: string[];
    ipAddresses?: string[];
    userAgents?: string[];
    patterns?: any[];
    riskScore: number;
  };
  status: 'open' | 'investigating' | 'resolved' | 'false_positive';
  actions: Array<{
    action: string;
    timestamp: Date;
    result: string;
  }>;
  resolution?: {
    resolvedBy: string;
    resolvedAt: Date;
    resolution: string;
    preventiveMeasures: string[];
  };
}

export interface AuditLog {
  id: string;
  timestamp: Date;
  userId: string;
  action: string;
  resource: string;
  ipAddress?: string;
  userAgent?: string;
  outcome: 'success' | 'failure' | 'blocked';
  details: {
    amount?: number;
    transactionHash?: string;
    ruleViolations?: string[];
    riskScore?: number;
  };
  metadata: Record<string, any>;
}

export interface ComplianceReport {
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    totalTransactions: number;
    blockedTransactions: number;
    flaggedUsers: number;
    resolvedIncidents: number;
    averageRiskScore: number;
    complianceRate: number;
  };
  incidents: {
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    trends: number[];
  };
  rules: {
    triggered: Record<string, number>;
    effectiveness: Record<string, number>;
  };
  recommendations: Array<{
    priority: 'low' | 'medium' | 'high';
    category: string;
    description: string;
    impact: string;
  }>;
}

export interface UserRiskProfile {
  userId: string;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  factors: {
    transactionVolume: number;
    frequencyScore: number;
    patternScore: number;
    geographicScore: number;
    timeScore: number;
  };
  history: {
    totalTransactions: number;
    blockedTransactions: number;
    flaggedTransactions: number;
    incidentCount: number;
    lastActivity: Date;
  };
  restrictions: Array<{
    type: string;
    description: string;
    startDate: Date;
    endDate?: Date;
    active: boolean;
  }>;
}

export class SecurityComplianceService {
  private tokenService: TokenService;
  private solanaService: SolanaService;
  private config: BlockchainConfig;
  private logger: winston.Logger;
  
  // Compliance and security data
  private complianceRules: Map<string, ComplianceRule> = new Map();
  private securityIncidents: Map<string, SecurityIncident> = new Map();
  private auditLogs: AuditLog[] = [];
  private userRiskProfiles: Map<string, UserRiskProfile> = new Map();
  
  // Rate limiting and monitoring
  private userTransactionCounts: Map<string, { hour: number; day: number; lastReset: Date }> = new Map();
  private suspiciousPatterns: Map<string, any[]> = new Map();
  
  // Monitoring intervals
  private complianceMonitor: NodeJS.Timeout | null = null;
  private riskAnalyzer: NodeJS.Timeout | null = null;
  
  // Security metrics
  private securityMetrics = {
    totalTransactionsProcessed: 0,
    blockedTransactions: 0,
    flaggedUsers: 0,
    averageResponseTime: 0,
    falsePositiveRate: 0,
    lastRiskAssessment: new Date()
  };

  constructor(
    tokenService: TokenService,
    solanaService: SolanaService,
    config: BlockchainConfig,
    logger: winston.Logger
  ) {
    this.tokenService = tokenService;
    this.solanaService = solanaService;
    this.config = config;
    this.logger = logger;
    
    this.initializeDefaultRules();
  }

  /**
   * Initialize the security compliance service
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing Security & Compliance Service...');
    
    try {
      // Load existing compliance data
      await this.loadComplianceData();
      
      // Start monitoring
      this.startComplianceMonitoring();
      
      // Initialize user risk profiles
      await this.initializeRiskProfiles();
      
      this.logger.info('Security & Compliance Service initialized successfully');
      
    } catch (error) {
      this.logger.error('Failed to initialize security compliance service:', error);
      throw error;
    }
  }

  /**
   * Shutdown the service
   */
  shutdown(): void {
    if (this.complianceMonitor) {
      clearInterval(this.complianceMonitor);
      this.complianceMonitor = null;
    }
    
    if (this.riskAnalyzer) {
      clearInterval(this.riskAnalyzer);
      this.riskAnalyzer = null;
    }
    
    this.logger.info('Security & Compliance Service shutdown complete');
  }

  /**
   * Validate transaction against compliance rules
   */
  async validateTransaction(
    userId: string,
    amount: number,
    transactionType: string,
    metadata?: Record<string, any>
  ): Promise<{
    approved: boolean;
    riskScore: number;
    violations: string[];
    actions: string[];
    incident?: SecurityIncident;
  }> {
    const startTime = Date.now();
    
    try {
      const violations: string[] = [];
      const actions: string[] = [];
      let riskScore = 0;
      let approved = true;
      
      // Get or create user risk profile
      const userProfile = await this.getUserRiskProfile(userId);
      
      // Check each compliance rule
      for (const rule of this.complianceRules.values()) {
        if (!rule.enabled) continue;
        
        const ruleResult = await this.checkComplianceRule(
          rule,
          userId,
          amount,
          transactionType,
          metadata
        );
        
        if (!ruleResult.passed) {
          violations.push(`${rule.name}: ${ruleResult.reason}`);
          riskScore += this.getRuleRiskWeight(rule.severity);
          
          // Execute rule actions
          for (const action of rule.actions) {
            switch (action) {
              case 'block':
                approved = false;
                actions.push('Transaction blocked');
                break;
              case 'flag':
                actions.push('User flagged for review');
                await this.flagUser(userId, rule.name);
                break;
              case 'log':
                actions.push('Violation logged');
                break;
              case 'escalate':
                actions.push('Incident escalated');
                break;
            }
          }
        }
      }
      
      // Update risk score
      riskScore = Math.min(riskScore / 100, 1.0); // Normalize to 0-1
      await this.updateUserRiskScore(userId, riskScore);
      
      // Create incident if high risk or blocked
      let incident: SecurityIncident | undefined;
      if (!approved || riskScore > 0.7) {
        incident = await this.createSecurityIncident(
          userId,
          riskScore > 0.7 ? 'suspicious_pattern' : 'fraud_attempt',
          violations,
          { amount, transactionType, metadata, riskScore }
        );
      }
      
      // Log audit entry
      await this.logAuditEntry({
        userId,
        action: 'transaction_validation',
        resource: 'token_transaction',
        outcome: approved ? 'success' : 'blocked',
        details: {
          amount,
          ruleViolations: violations,
          riskScore
        },
        metadata: metadata || {}
      });
      
      // Update metrics
      this.securityMetrics.totalTransactionsProcessed++;
      if (!approved) {
        this.securityMetrics.blockedTransactions++;
      }
      this.securityMetrics.averageResponseTime = 
        (this.securityMetrics.averageResponseTime + (Date.now() - startTime)) / 2;
      
      return {
        approved,
        riskScore,
        violations,
        actions,
        incident
      };
      
    } catch (error) {
      this.logger.error(`Transaction validation failed for user ${userId}:`, error);
      
      // Fail secure - block transaction on error
      return {
        approved: false,
        riskScore: 1.0,
        violations: ['System error during validation'],
        actions: ['Transaction blocked due to system error']
      };
    }
  }

  /**
   * Generate compliance report
   */
  async generateComplianceReport(
    startDate: Date,
    endDate: Date
  ): Promise<ComplianceReport> {
    try {
      // Filter data by date range
      const relevantLogs = this.auditLogs.filter(
        log => log.timestamp >= startDate && log.timestamp <= endDate
      );
      
      const relevantIncidents = Array.from(this.securityIncidents.values()).filter(
        incident => incident.timestamp >= startDate && incident.timestamp <= endDate
      );
      
      // Calculate summary metrics
      const totalTransactions = relevantLogs.filter(log => 
        log.action === 'transaction_validation'
      ).length;
      
      const blockedTransactions = relevantLogs.filter(log => 
        log.action === 'transaction_validation' && log.outcome === 'blocked'
      ).length;
      
      const flaggedUsers = new Set(
        relevantIncidents.map(incident => incident.userId)
      ).size;
      
      const resolvedIncidents = relevantIncidents.filter(
        incident => incident.status === 'resolved'
      ).length;
      
      const averageRiskScore = relevantLogs
        .filter(log => log.details.riskScore !== undefined)
        .reduce((sum, log) => sum + (log.details.riskScore || 0), 0) / 
        Math.max(totalTransactions, 1);
      
      const complianceRate = totalTransactions > 0 ? 
        (totalTransactions - blockedTransactions) / totalTransactions : 1;
      
      // Analyze incidents by type and severity
      const incidentsByType: Record<string, number> = {};
      const incidentsBySeverity: Record<string, number> = {};
      
      relevantIncidents.forEach(incident => {
        incidentsByType[incident.incidentType] = 
          (incidentsByType[incident.incidentType] || 0) + 1;
        incidentsBySeverity[incident.severity] = 
          (incidentsBySeverity[incident.severity] || 0) + 1;
      });
      
      // Analyze rule effectiveness
      const ruleTriggered: Record<string, number> = {};
      const ruleEffectiveness: Record<string, number> = {};
      
      relevantLogs.forEach(log => {
        if (log.details.ruleViolations) {
          log.details.ruleViolations.forEach(violation => {
            const ruleName = violation.split(':')[0];
            ruleTriggered[ruleName] = (ruleTriggered[ruleName] || 0) + 1;
          });
        }
      });
      
      // Calculate rule effectiveness (simplified)
      for (const [ruleName, triggers] of Object.entries(ruleTriggered)) {
        const falsePositives = Math.floor(triggers * 0.1); // Assume 10% false positive rate
        ruleEffectiveness[ruleName] = (triggers - falsePositives) / triggers;
      }
      
      // Generate trends (simplified daily data)
      const trends = this.generateTrends(relevantIncidents, startDate, endDate);
      
      // Generate recommendations
      const recommendations = this.generateRecommendations(
        { blockedTransactions, totalTransactions, averageRiskScore },
        ruleTriggered,
        incidentsByType
      );
      
      return {
        period: { start: startDate, end: endDate },
        summary: {
          totalTransactions,
          blockedTransactions,
          flaggedUsers,
          resolvedIncidents,
          averageRiskScore,
          complianceRate
        },
        incidents: {
          byType: incidentsByType,
          bySeverity: incidentsBySeverity,
          trends
        },
        rules: {
          triggered: ruleTriggered,
          effectiveness: ruleEffectiveness
        },
        recommendations
      };
      
    } catch (error) {
      this.logger.error('Failed to generate compliance report:', error);
      throw error;
    }
  }

  /**
   * Get user risk profile
   */
  async getUserRiskProfile(userId: string): Promise<UserRiskProfile> {
    let profile = this.userRiskProfiles.get(userId);
    
    if (!profile) {
      // Create new risk profile
      profile = {
        userId,
        riskScore: 0.1, // Start with low risk
        riskLevel: 'low',
        factors: {
          transactionVolume: 0,
          frequencyScore: 0,
          patternScore: 0,
          geographicScore: 0,
          timeScore: 0
        },
        history: {
          totalTransactions: 0,
          blockedTransactions: 0,
          flaggedTransactions: 0,
          incidentCount: 0,
          lastActivity: new Date()
        },
        restrictions: []
      };
      
      this.userRiskProfiles.set(userId, profile);
    }
    
    return profile;
  }

  /**
   * Update user risk score
   */
  async updateUserRiskScore(userId: string, transactionRisk: number): Promise<void> {
    const profile = await this.getUserRiskProfile(userId);
    
    // Update risk factors
    profile.factors.transactionVolume = await this.calculateVolumeScore(userId);
    profile.factors.frequencyScore = await this.calculateFrequencyScore(userId);
    profile.factors.patternScore = await this.calculatePatternScore(userId);
    
    // Calculate weighted risk score
    const weights = {
      transaction: 0.3,
      volume: 0.2,
      frequency: 0.2,
      pattern: 0.2,
      geographic: 0.05,
      time: 0.05
    };
    
    profile.riskScore = 
      transactionRisk * weights.transaction +
      profile.factors.transactionVolume * weights.volume +
      profile.factors.frequencyScore * weights.frequency +
      profile.factors.patternScore * weights.pattern +
      profile.factors.geographicScore * weights.geographic +
      profile.factors.timeScore * weights.time;
    
    // Update risk level
    if (profile.riskScore <= 0.3) profile.riskLevel = 'low';
    else if (profile.riskScore <= 0.6) profile.riskLevel = 'medium';
    else if (profile.riskScore <= 0.8) profile.riskLevel = 'high';
    else profile.riskLevel = 'critical';
    
    profile.history.lastActivity = new Date();
    this.userRiskProfiles.set(userId, profile);
  }

  /**
   * Create security incident
   */
  async createSecurityIncident(
    userId: string,
    type: SecurityIncident['incidentType'],
    violations: string[],
    evidence: any
  ): Promise<SecurityIncident> {
    const incident: SecurityIncident = {
      id: this.generateIncidentId(),
      userId,
      incidentType: type,
      severity: this.calculateIncidentSeverity(evidence.riskScore, violations.length),
      timestamp: new Date(),
      description: `${type} detected for user ${userId}: ${violations.join(', ')}`,
      evidence: {
        riskScore: evidence.riskScore,
        ...evidence
      },
      status: 'open',
      actions: [{
        action: 'incident_created',
        timestamp: new Date(),
        result: 'Initial incident logged'
      }]
    };
    
    this.securityIncidents.set(incident.id, incident);
    
    // Auto-escalate critical incidents
    if (incident.severity === 'critical') {
      await this.escalateIncident(incident.id);
    }
    
    this.logger.warn(`Security incident created: ${incident.id} for user ${userId}`);
    return incident;
  }

  /**
   * Get audit trail for user
   */
  getUserAuditTrail(userId: string, limit: number = 100): AuditLog[] {
    return this.auditLogs
      .filter(log => log.userId === userId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Get security metrics
   */
  getSecurityMetrics(): typeof this.securityMetrics & {
    ruleCount: number;
    activeIncidents: number;
    criticalIncidents: number;
  } {
    const activeIncidents = Array.from(this.securityIncidents.values())
      .filter(incident => incident.status === 'open' || incident.status === 'investigating').length;
    
    const criticalIncidents = Array.from(this.securityIncidents.values())
      .filter(incident => incident.severity === 'critical' && incident.status !== 'resolved').length;
    
    return {
      ...this.securityMetrics,
      ruleCount: this.complianceRules.size,
      activeIncidents,
      criticalIncidents
    };
  }

  /**
   * Initialize default compliance rules
   */
  private initializeDefaultRules(): void {
    // Rate limiting rule
    this.complianceRules.set('rate_limit', {
      id: 'rate_limit',
      name: 'Transaction Rate Limiting',
      type: 'rate_limit',
      enabled: true,
      severity: 'medium',
      parameters: {
        maxTransactionsPerHour: 50,
        maxTransactionsPerDay: 200,
        rapidFireThreshold: 5000 // 5 seconds
      },
      actions: ['log', 'delay', 'flag'],
      autoResolve: true,
      escalationThreshold: 3
    });
    
    // Amount limiting rule
    this.complianceRules.set('amount_limit', {
      id: 'amount_limit',
      name: 'Transaction Amount Limits',
      type: 'amount_limit',
      enabled: true,
      severity: 'high',
      parameters: {
        maxAmountPerTransaction: 10000,
        maxAmountPerDay: 50000
      },
      actions: ['log', 'block', 'escalate'],
      autoResolve: false,
      escalationThreshold: 1
    });
    
    // Pattern detection rule
    this.complianceRules.set('pattern_detection', {
      id: 'pattern_detection',
      name: 'Suspicious Pattern Detection',
      type: 'pattern_detection',
      enabled: true,
      severity: 'high',
      parameters: {
        suspiciousPatternThreshold: 0.8,
        identicalAmountThreshold: 0.7
      },
      actions: ['log', 'flag', 'escalate'],
      autoResolve: false,
      escalationThreshold: 2
    });
    
    // Time-based restrictions
    this.complianceRules.set('time_restrictions', {
      id: 'time_restrictions',
      name: 'Time-based Transaction Restrictions',
      type: 'time_based',
      enabled: true,
      severity: 'low',
      parameters: {
        allowedHours: { start: 6, end: 23 }, // 6 AM to 11 PM
        cooldownPeriod: 10000 // 10 seconds between transactions
      },
      actions: ['log', 'delay'],
      autoResolve: true,
      escalationThreshold: 5
    });
  }

  /**
   * Check compliance rule
   */
  private async checkComplianceRule(
    rule: ComplianceRule,
    userId: string,
    amount: number,
    transactionType: string,
    metadata?: Record<string, any>
  ): Promise<{ passed: boolean; reason?: string }> {
    try {
      switch (rule.type) {
        case 'rate_limit':
          return this.checkRateLimit(rule, userId);
        
        case 'amount_limit':
          return this.checkAmountLimit(rule, userId, amount);
        
        case 'pattern_detection':
          return this.checkPatternDetection(rule, userId, amount);
        
        case 'time_based':
          return this.checkTimeRestrictions(rule, userId);
        
        default:
          return { passed: true };
      }
    } catch (error) {
      this.logger.error(`Error checking compliance rule ${rule.id}:`, error);
      return { passed: false, reason: 'Rule check error' };
    }
  }

  /**
   * Check rate limiting
   */
  private checkRateLimit(rule: ComplianceRule, userId: string): { passed: boolean; reason?: string } {
    const userCounts = this.userTransactionCounts.get(userId) || {
      hour: 0,
      day: 0,
      lastReset: new Date()
    };
    
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Reset counters if needed
    if (userCounts.lastReset < hourAgo) {
      userCounts.hour = 0;
    }
    if (userCounts.lastReset < dayAgo) {
      userCounts.day = 0;
    }
    
    // Check limits
    if (rule.parameters.maxTransactionsPerHour && 
        userCounts.hour >= rule.parameters.maxTransactionsPerHour) {
      return { passed: false, reason: 'Hourly transaction limit exceeded' };
    }
    
    if (rule.parameters.maxTransactionsPerDay && 
        userCounts.day >= rule.parameters.maxTransactionsPerDay) {
      return { passed: false, reason: 'Daily transaction limit exceeded' };
    }
    
    // Update counters
    userCounts.hour++;
    userCounts.day++;
    userCounts.lastReset = now;
    this.userTransactionCounts.set(userId, userCounts);
    
    return { passed: true };
  }

  /**
   * Check amount limits
   */
  private checkAmountLimit(
    rule: ComplianceRule, 
    userId: string, 
    amount: number
  ): { passed: boolean; reason?: string } {
    if (rule.parameters.maxAmountPerTransaction && 
        amount > rule.parameters.maxAmountPerTransaction) {
      return { passed: false, reason: 'Transaction amount exceeds limit' };
    }
    
    // Check daily amount (simplified - would need to track actual daily amounts)
    if (rule.parameters.maxAmountPerDay && 
        amount > rule.parameters.maxAmountPerDay) {
      return { passed: false, reason: 'Daily amount limit would be exceeded' };
    }
    
    return { passed: true };
  }

  /**
   * Check pattern detection
   */
  private checkPatternDetection(
    rule: ComplianceRule, 
    userId: string, 
    amount: number
  ): { passed: boolean; reason?: string } {
    const userPatterns = this.suspiciousPatterns.get(userId) || [];
    
    // Check for identical amounts (simplified)
    const recentAmounts = userPatterns.slice(-10).map(p => p.amount);
    const identicalCount = recentAmounts.filter(a => a === amount).length;
    
    if (rule.parameters.identicalAmountThreshold && 
        identicalCount / recentAmounts.length > rule.parameters.identicalAmountThreshold) {
      return { passed: false, reason: 'Suspicious identical amount pattern detected' };
    }
    
    // Add current transaction to patterns
    userPatterns.push({ amount, timestamp: new Date() });
    if (userPatterns.length > 50) {
      userPatterns.shift(); // Keep only last 50
    }
    this.suspiciousPatterns.set(userId, userPatterns);
    
    return { passed: true };
  }

  /**
   * Check time-based restrictions
   */
  private checkTimeRestrictions(rule: ComplianceRule, userId: string): { passed: boolean; reason?: string } {
    const now = new Date();
    const hour = now.getHours();
    
    // Check allowed hours
    if (rule.parameters.allowedHours) {
      const { start, end } = rule.parameters.allowedHours;
      if (hour < start || hour > end) {
        return { passed: false, reason: 'Transaction outside allowed hours' };
      }
    }
    
    // Check blocked days
    if (rule.parameters.blockedDays) {
      const day = now.getDay();
      if (rule.parameters.blockedDays.includes(day)) {
        return { passed: false, reason: 'Transaction on blocked day' };
      }
    }
    
    return { passed: true };
  }

  /**
   * Calculate risk scores
   */
  private async calculateVolumeScore(userId: string): Promise<number> {
    // Simplified volume score calculation
    return Math.random() * 0.5; // 0-0.5 range
  }

  private async calculateFrequencyScore(userId: string): Promise<number> {
    // Simplified frequency score calculation
    return Math.random() * 0.3; // 0-0.3 range
  }

  private async calculatePatternScore(userId: string): Promise<number> {
    // Simplified pattern score calculation
    return Math.random() * 0.2; // 0-0.2 range
  }

  /**
   * Utility functions
   */
  private getRuleRiskWeight(severity: string): number {
    const weights = { low: 10, medium: 25, high: 50, critical: 100 };
    return weights[severity as keyof typeof weights] || 10;
  }

  private calculateIncidentSeverity(riskScore: number, violationCount: number): SecurityIncident['severity'] {
    if (riskScore > 0.8 || violationCount > 3) return 'critical';
    if (riskScore > 0.6 || violationCount > 2) return 'high';
    if (riskScore > 0.3 || violationCount > 1) return 'medium';
    return 'low';
  }

  private generateIncidentId(): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    return `incident_${timestamp}_${random}`;
  }

  private async flagUser(userId: string, reason: string): Promise<void> {
    const profile = await this.getUserRiskProfile(userId);
    profile.restrictions.push({
      type: 'monitoring',
      description: `Flagged for: ${reason}`,
      startDate: new Date(),
      active: true
    });
    this.userRiskProfiles.set(userId, profile);
  }

  private async escalateIncident(incidentId: string): Promise<void> {
    const incident = this.securityIncidents.get(incidentId);
    if (incident) {
      incident.status = 'investigating';
      incident.actions.push({
        action: 'escalated',
        timestamp: new Date(),
        result: 'Incident escalated for manual review'
      });
      this.securityIncidents.set(incidentId, incident);
    }
  }

  private async logAuditEntry(data: Omit<AuditLog, 'id' | 'timestamp'>): Promise<void> {
    const auditEntry: AuditLog = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      ...data
    };
    
    this.auditLogs.push(auditEntry);
    
    // Keep only last 10000 entries
    if (this.auditLogs.length > 10000) {
      this.auditLogs = this.auditLogs.slice(-10000);
    }
  }

  private generateTrends(incidents: SecurityIncident[], start: Date, end: Date): number[] {
    // Simplified trend generation (daily incident counts)
    const days = Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
    const trends = new Array(days).fill(0);
    
    incidents.forEach(incident => {
      const dayIndex = Math.floor(
        (incident.timestamp.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)
      );
      if (dayIndex >= 0 && dayIndex < days) {
        trends[dayIndex]++;
      }
    });
    
    return trends;
  }

  private generateRecommendations(
    summary: any,
    ruleTriggered: Record<string, number>,
    incidentsByType: Record<string, number>
  ): ComplianceReport['recommendations'] {
    const recommendations: ComplianceReport['recommendations'] = [];
    
    // High block rate recommendation
    if (summary.blockedTransactions / summary.totalTransactions > 0.1) {
      recommendations.push({
        priority: 'high',
        category: 'Rule Tuning',
        description: 'High transaction block rate detected',
        impact: 'May be blocking legitimate transactions'
      });
    }
    
    // High risk score recommendation
    if (summary.averageRiskScore > 0.5) {
      recommendations.push({
        priority: 'medium',
        category: 'Risk Assessment',
        description: 'Average risk score is elevated',
        impact: 'Increased fraud risk'
      });
    }
    
    // Pattern detection recommendation
    if (incidentsByType.suspicious_pattern > 10) {
      recommendations.push({
        priority: 'high',
        category: 'Pattern Analysis',
        description: 'High number of pattern violations',
        impact: 'Potential coordinated fraud attempt'
      });
    }
    
    return recommendations;
  }

  private startComplianceMonitoring(): void {
    // Monitor compliance rules every 5 minutes
    this.complianceMonitor = setInterval(() => {
      this.performComplianceCheck();
    }, 300000);
    
    // Analyze risk profiles every hour
    this.riskAnalyzer = setInterval(() => {
      this.performRiskAnalysis();
    }, 3600000);
  }

  private async loadComplianceData(): Promise<void> {
    // In production, load from database
    this.logger.debug('Loading compliance data from storage...');
  }

  private async initializeRiskProfiles(): Promise<void> {
    // In production, load existing risk profiles
    this.logger.debug('Initializing user risk profiles...');
  }

  private performComplianceCheck(): void {
    // Perform periodic compliance checks
    this.logger.debug('Performing scheduled compliance check...');
  }

  private performRiskAnalysis(): void {
    // Perform periodic risk analysis
    this.logger.debug('Performing scheduled risk analysis...');
    this.securityMetrics.lastRiskAssessment = new Date();
  }
}