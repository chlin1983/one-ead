import { validateKnowledge } from "../src/knowledge/validate";
import { COMPONENTS, EQUATIONS, PARAMETERS, RELATIONSHIPS, SOURCES } from "../src/data";

const issues = validateKnowledge();
console.log(
  `sources=${SOURCES.length} parameters=${PARAMETERS.length} equations=${EQUATIONS.length} relationships=${RELATIONSHIPS.length} components=${COMPONENTS.length}`,
);
for (const i of issues) console.log(`${i.severity.toUpperCase()} [${i.rule}] ${i.record}: ${i.message}`);
const errors = issues.filter((i) => i.severity === "error").length;
console.log(errors ? `FAILED: ${errors} error(s)` : `OK (${issues.length} warning(s))`);
process.exit(errors ? 1 : 0);
