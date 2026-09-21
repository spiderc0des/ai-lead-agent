/**
 * Confirm the five skills actually load into an Agent SDK session.
 *
 * This is the check that catches the three silent failure modes: a wrong cwd,
 * settingSources missing "project", and a .claude/ directory left out of a
 * container image. All three produce an agent that runs happily with no
 * skills, which is much worse than one that fails.
 *
 *   npm run verify:skills
 */
import "./env";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync } from "node:fs";
import path from "node:path";

const REQUIRED = [
  "icp-refinement",
  "lead-qualification",
  "outbound-copywriting",
  "lead-list-quality",
  "outreach-safety",
];

async function main() {
  const cwd = process.env.AGENT_CWD ?? process.cwd();
  console.log(`cwd: ${cwd}`);

  // Cheap filesystem check first — no API call needed to catch a missing file.
  let missingFiles = 0;
  for (const name of REQUIRED) {
    const p = path.join(cwd, ".claude", "skills", name, "SKILL.md");
    const ok = existsSync(p);
    console.log(`  ${ok ? "found  " : "MISSING"} .claude/skills/${name}/SKILL.md`);
    if (!ok) missingFiles++;
  }
  if (missingFiles > 0) {
    console.error(`\n${missingFiles} skill file(s) missing on disk. Fix that before checking the session.`);
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("\nANTHROPIC_API_KEY not set — skipping the live session check.");
    console.log("Files are in place; set the key to confirm the SDK actually loads them.");
    process.exit(0);
  }

  console.log("\nStarting a session to read the init message...");

  let loaded: string[] | null = null;
  const controller = new AbortController();

  try {
    for await (const message of query({
      prompt: "Reply with the single word: ok",
      options: {
        cwd,
        settingSources: ["project"],
        skills: REQUIRED,
        tools: ["Skill"],
        maxTurns: 1,
        abortController: controller,
        persistSession: false,
        model: process.env.AGENT_MODEL || "claude-sonnet-5",
      },
    })) {
      if (message.type === "system" && message.subtype === "init") {
        loaded = message.skills ?? [];
        controller.abort(); // We only needed the init message.
        break;
      }
    }
  } catch (err) {
    if (loaded === null) {
      console.error("\nSession failed before init:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  const found = new Set(loaded ?? []);
  const missing = REQUIRED.filter((s) => !found.has(s));

  console.log(`\nSkills reported by the session: ${[...found].join(", ") || "(none)"}`);

  if (missing.length > 0) {
    console.error(`\nFAIL — not loaded: ${missing.join(", ")}`);
    console.error("Check cwd, settingSources: ['project'], and that .claude/ shipped with the build.");
    process.exit(1);
  }

  console.log("\nPASS — all five skills load.");
  process.exit(0);
}

main().catch((err) => {
  // Config mistakes are the common case here; a stack trace buries the message.
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
