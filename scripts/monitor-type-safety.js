#!/usr/bin/env node
/**
 * Type Safety Monitoring Script
 * 
 * This script monitors the progress of type safety fixes by running tests
 * and tracking which type issues have been resolved.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class TypeSafetyMonitor {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '..');
    this.testResults = {
      timestamp: new Date().toISOString(),
      totalTests: 0,
      passingTests: 0,
      failingTests: 0,
      typeIssuesFixed: 0,
      typeIssuesRemaining: 0,
      coverage: 0
    };
  }

  async runTypeChecking() {
    console.log('🔍 Running TypeScript type checking...');
    
    try {
      const output = execSync('npx tsc --noEmit --listFiles', {
        cwd: this.projectRoot,
        encoding: 'utf8',
        timeout: 30000
      });
      
      console.log('✅ TypeScript compilation successful!');
      return { success: true, errors: [] };
    } catch (error) {
      const errorOutput = error.stdout || error.stderr || '';
      const errors = this.parseTypeScriptErrors(errorOutput);
      
      console.log(`❌ Found ${errors.length} TypeScript errors`);
      return { success: false, errors };
    }
  }

  parseTypeScriptErrors(output) {
    const errorPattern = /^(.+\.ts)\((\d+),(\d+)\): error (TS\d+): (.+)$/gm;
    const errors = [];
    let match;

    while ((match = errorPattern.exec(output)) !== null) {
      errors.push({
        file: match[1],
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        code: match[4],
        message: match[5]
      });
    }

    return errors;
  }

  async runTypeSafetyTests() {
    console.log('🧪 Running type safety tests...');
    
    try {
      const output = execSync('npm test -- tests/type-safety --json', {
        cwd: this.projectRoot,
        encoding: 'utf8',
        timeout: 60000
      });
      
      const results = JSON.parse(output);
      this.testResults.totalTests = results.numTotalTests;
      this.testResults.passingTests = results.numPassedTests;
      this.testResults.failingTests = results.numFailedTests;
      
      return results;
    } catch (error) {
      console.log('❌ Type safety tests are failing (as expected in TDD)');
      
      // Parse the error output to extract test information
      const errorOutput = error.stdout || error.stderr || '';
      this.analyzeTestFailures(errorOutput);
      
      return null;
    }
  }

  analyzeTestFailures(output) {
    // Count different types of failures
    const missingExportErrors = (output.match(/Property '.*' does not exist on type/g) || []).length;
    const propertyAccessErrors = (output.match(/Cannot read property|Property '.*' does not exist/g) || []).length;
    const functionSignatureErrors = (output.match(/Expected \d+-\d+ arguments, but got \d+/g) || []).length;
    
    console.log(`📊 Error Analysis:
    - Missing Export Errors: ${missingExportErrors}
    - Property Access Errors: ${propertyAccessErrors}
    - Function Signature Errors: ${functionSignatureErrors}`);
  }

  async checkTestCoverage() {
    console.log('📊 Checking test coverage...');
    
    try {
      const output = execSync('npm test -- --coverage --coverageReporters=json', {
        cwd: this.projectRoot,
        encoding: 'utf8',
        timeout: 120000
      });
      
      const coverageFile = path.join(this.projectRoot, 'coverage/coverage-final.json');
      if (fs.existsSync(coverageFile)) {
        const coverage = JSON.parse(fs.readFileSync(coverageFile, 'utf8'));
        const totalCoverage = this.calculateOverallCoverage(coverage);
        this.testResults.coverage = totalCoverage;
        
        console.log(`📈 Overall test coverage: ${totalCoverage.toFixed(1)}%`);
        return totalCoverage;
      }
    } catch (error) {
      console.log('❌ Coverage check failed');
      return 0;
    }
  }

  calculateOverallCoverage(coverage) {
    let totalLines = 0;
    let coveredLines = 0;
    
    Object.values(coverage).forEach(file => {
      if (file.s) {
        totalLines += Object.keys(file.s).length;
        coveredLines += Object.values(file.s).filter(count => count > 0).length;
      }
    });
    
    return totalLines > 0 ? (coveredLines / totalLines) * 100 : 0;
  }

  generateReport() {
    const report = {
      ...this.testResults,
      typeFixProgress: this.calculateTypeFixProgress(),
      recommendations: this.generateRecommendations()
    };

    const reportPath = path.join(this.projectRoot, 'reports/type-safety-monitor.json');
    const reportsDir = path.dirname(reportPath);
    
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    console.log(`📋 Report saved to: ${reportPath}`);
    return report;
  }

  calculateTypeFixProgress() {
    // This would be updated as fixes are implemented
    const knownIssues = {
      missingExports: 3,
      propertyAccess: 8,
      functionSignatures: 6,
      configurations: 2
    };

    const totalIssues = Object.values(knownIssues).reduce((sum, count) => sum + count, 0);
    const fixedIssues = 0; // Would be updated based on successful tests

    return {
      total: totalIssues,
      fixed: fixedIssues,
      remaining: totalIssues - fixedIssues,
      progress: (fixedIssues / totalIssues) * 100
    };
  }

  generateRecommendations() {
    return [
      'Fix missing exports in src/game/index.ts (GameManager, DrawAnimations)',
      'Add DrawSystemConfig export to src/types/index.ts',
      'Implement type guards for union type property access',
      'Update function signatures to match expected argument counts',
      'Add public methods to replace private property access',
      'Update tsconfig.json to support import.meta usage',
      'Fix Sentry integration type conflicts'
    ];
  }

  async run() {
    console.log('🚀 Starting Type Safety Monitoring...\n');

    // Run type checking
    const typeCheckResult = await this.runTypeChecking();
    
    // Run TDD tests (expect them to fail initially)
    await this.runTypeSafetyTests();
    
    // Check coverage
    await this.checkTestCoverage();
    
    // Generate report
    const report = this.generateReport();
    
    console.log('\n📊 Type Safety Status Summary:');
    console.log(`✅ Tests passing: ${this.testResults.passingTests}`);
    console.log(`❌ Tests failing: ${this.testResults.failingTests}`);
    console.log(`📈 Coverage: ${this.testResults.coverage.toFixed(1)}%`);
    console.log(`🔧 Type fix progress: ${report.typeFixProgress.progress.toFixed(1)}%`);
    
    if (!typeCheckResult.success) {
      console.log('\n🎯 Next Actions for Type Fix Engineer:');
      report.recommendations.forEach((rec, i) => {
        console.log(`${i + 1}. ${rec}`);
      });
    }

    return report;
  }
}

// Run the monitor if called directly
if (require.main === module) {
  const monitor = new TypeSafetyMonitor();
  monitor.run().catch(console.error);
}

module.exports = TypeSafetyMonitor;