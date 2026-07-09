---
name: code-conventions
description: "JavaScript coding standards for this project"
tags: [javascript, style, conventions]
---

# Code Conventions

## Formatting
- 2-space indentation (no tabs)
- Semicolons required at end of statements
- Single quotes preferred over double quotes
- Maximum line length: 100 characters

## Naming
- `camelCase` for variables, functions, and methods
- `PascalCase` for classes and constructor functions
- `UPPER_SNAKE_CASE` for constants
- File names: `kebab-case.js` for utility modules,
  `PascalCase.js` for class modules

## Documentation
- Use JSDoc `/** ... */` for all exported functions and classes
- Include `@param` and `@returns` tags with types
- Use `@fileoverview` at the top of each module file
- Use `@private` for internal methods

## Error Handling
- Tool functions return error strings: `return 'Error: ...'`
- Never throw exceptions from tool handlers (catch internally)
- Use `'Error: missing required param "name"'` pattern for parameter validation

## Imports
- Use `require()` (CommonJS), not ES module imports
- Destructure imported objects where possible
- Group imports: 1) stdlib, 2) npm packages, 3) local modules

## File Structure
- One class or concern per file
- Tools go in `src/core/tools/<name>.js`
- Registration function pattern: `registerXxxTools(registry, ...deps)`
