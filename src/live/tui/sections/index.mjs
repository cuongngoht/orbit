// The dashboard's sections in their screen order. Each is (ctx) -> { name, head?, rows, scroll? } | null, and
// null means it has nothing to say for this task (no workflow, no QA, the console closed).
import { activitySection } from "./activity.mjs";
import { stageSection } from "./top.mjs";
import { engineerSection, workflowSection } from "./work.mjs";
import { qaSection } from "./qa.mjs";
import { verifySection } from "./verify.mjs";
import { sandboxSection } from "./console.mjs";
import { noticesSection, recentSection } from "./recent.mjs";

export const SECTIONS = Object.freeze([stageSection, activitySection, workflowSection, engineerSection, verifySection, qaSection, sandboxSection, recentSection, noticesSection]);
