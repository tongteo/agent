/**
 * @fileoverview ToolRegistry entry point.
 * Re-exports ToolRegistry from the tools/ module for backward compatibility.
 */

const { ToolRegistry } = require('./tools/index');
const { ToolParser } = require('./agent');

module.exports = { ToolRegistry };
