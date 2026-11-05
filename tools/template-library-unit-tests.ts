/* Active catalogue contract. This runs without a browser or a user workspace:
   it prevents an accidental legacy import, missing category or malformed
   database spec from shipping in the template picker. */
/* template-kit intentionally shares the production inline-markdown helper.
   That import chain registers a browser unload handler, so provide the tiny
   inert surface it needs while this is running in Node. */
(globalThis as any).window = { addEventListener() {}, removeEventListener() {} };
(globalThis as any).document = { addEventListener() {}, removeEventListener() {} };

const { TEMPLATES, TEMPLATE_CATEGORIES, templateBlocks } = await import("../public/notes/js/templates-data.js");

let failures = 0;
const check = (label: string, pass: unknown, detail?: unknown) => {
  if (pass) console.log(`  ok   ${label}`);
  else { failures += 1; console.error(`  FAIL ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`); }
};

console.log("\n[template library]");
check("exactly four active templates", TEMPLATES.length === 4, TEMPLATES.length);
check("only Study & Education is active", JSON.stringify(TEMPLATE_CATEGORIES) === JSON.stringify(["Study & Education"]), TEMPLATE_CATEGORIES);
check("template ids are unique", new Set(TEMPLATES.map((entry) => entry.id)).size === 4);
check("the public catalogue contains the four active study templates", JSON.stringify(TEMPLATES.map((entry) => entry.name)) === JSON.stringify(["Cornell Notes", "Lecture Notes", "Reading Notes", "Study Notes Dashboard"]), TEMPLATES.map((entry) => entry.name));

for (const entry of TEMPLATES) {
  const blocks = templateBlocks(entry);
  check(`${entry.id} has editable page content`, blocks.length > 0, blocks.length);
  check(`${entry.id} has a meaningful description`, entry.desc.trim().length >= 32, entry.desc);
  const databases = entry.databases || [];
  for (const database of databases) {
    check(`${entry.id}/${database.name} has a title property`, database.properties.some((property: any) => property.type === "title"));
    check(`${entry.id}/${database.name} has a usable view`, database.views?.length > 0, database.views);
    check(`${entry.id}/${database.name} has representative records`, database.records?.length > 0, database.records);
  }
}

if (failures) process.exitCode = 1;
else console.log(`\nVerified ${TEMPLATES.length} templates and ${TEMPLATES.reduce((sum, entry) => sum + (entry.databases?.length || 0), 0)} live databases.`);
