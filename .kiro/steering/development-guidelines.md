# Development Guidelines

## Script Creation Policy

**Avoid creating new scripts in the `/scripts` folder unless absolutely necessary.**

### Preferred Approach
- Run node commands directly from the command line instead of creating script files
- Use inline node execution: `node -e "your code here"`
- Execute existing modules directly: `node src/path/to/module.js`

### When Scripts Are Acceptable
- Complex, reusable operations that would be cumbersome to run inline
- Operations that require multiple steps or complex argument parsing
- Maintenance or deployment scripts that need to be version controlled

### Examples

**Preferred:**
```bash
# Direct execution
node -e "console.log('Hello World')"

# Running existing modules
node src/modules/sports/GameLogManager.js

# Quick data operations
node -e "const data = require('./data/file.json'); console.log(data.length)"
```

**Avoid (unless necessary):**
```bash
# Creating new script files for simple operations
echo "console.log('Hello World')" > scripts/hello.js
node scripts/hello.js
```

This approach keeps the codebase cleaner and reduces maintenance overhead.