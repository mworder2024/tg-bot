const TestSequencer = require('@jest/test-sequencer').default;

class CustomTestSequencer extends TestSequencer {
  sort(tests) {
    // Sort tests by priority: unit tests first, then integration, then e2e
    const priority = {
      'unit': 1,
      'integration': 2,
      'e2e': 3,
      'edge-cases': 4,
      'performance': 5,
      'security': 6
    };

    return tests.sort((testA, testB) => {
      const priorityA = this.getPriority(testA.path, priority);
      const priorityB = this.getPriority(testB.path, priority);
      
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      
      // If same priority, sort alphabetically
      return testA.path.localeCompare(testB.path);
    });
  }

  getPriority(testPath, priority) {
    for (const [key, value] of Object.entries(priority)) {
      if (testPath.includes(key)) {
        return value;
      }
    }
    return 10; // Default priority for unmatched tests
  }
}

module.exports = CustomTestSequencer;