/* Additional original Clyra templates. The public Notion Marketplace informed
   the category coverage (notes, planning, writing, and finance), but each
   page structure, description, and starter content below is our own. */
import { template, h1, h2, p, todo, callout, divider, table, columns } from "./template-kit.js";

const blocksFor = (entry, index) => {
  const opening = [h1(entry.name), callout(entry.emoji, entry.desc, index % 2 ? "gray" : "blue")];
  if (index % 4 === 0) return [...opening, p("Start with the next useful detail. Keep this page as short or as rich as the work needs."), todo("Add the first item"), todo("Decide the next action")];
  if (index % 4 === 1) return [...opening, h2("Overview"), p("Use this quiet structure to collect context before you turn it into action."), divider(), h2("Next"), todo("Add a next step"), todo("Review when ready")];
  if (index % 4 === 2) return [...opening, columns([h2("Focus"), p("What matters now?"), todo("First action")], [h2("Reference"), p("Keep links, notes, or prompts here.")]), h2("Working list"), todo("Add an item"), todo("Add another item")];
  return [...opening, h2("Details"), p("A flexible starter page with enough shape to begin and enough room to adapt."), table([["Item", "Status", "Notes"], ["First item", "Not started", ""], ["Second item", "Not started", ""]]), h2("Review"), p("What changed? What comes next?")];
};

const definitions = [
  ["quick-capture-inbox", "Quick Capture Inbox", "⚡", "Notes", "School", "A minimal landing place for ideas, links, and small tasks before you sort them."],
  ["meeting-notes-starter", "Meeting Notes", "🗣️", "Notes", "Work", "A clear agenda, decisions, and follow-ups for a meeting that is easy to revisit."],
  ["cornell-notes-clean", "Cornell Notes", "✍️", "Notes", "School", "A focused cue-and-summary layout for active recall after class."],
  ["book-notes-shelf", "Book Notes Shelf", "📚", "Notes", "Personal", "Save the useful ideas from a book with a short summary and your own takeaways."],
  ["research-notes-lab", "Research Notes Lab", "🔎", "Notes", "School", "Collect sources, questions, evidence, and a concise working conclusion."],
  ["knowledge-base-light", "Knowledge Base", "🧠", "Notes", "Work", "A lightweight home for recurring answers, processes, and useful references."],
  ["daily-reflection", "Daily Reflection", "☀️", "Notes", "Personal", "A gentle daily check-in for what happened, what helped, and what to carry forward."],
  ["weekly-planning-board", "Weekly Planning Board", "🗓️", "Planning", "Personal", "Map the week around priorities, appointments, and a realistic next action."],
  ["content-calendar-light", "Content Calendar", "📣", "Planning", "Work", "Plan ideas, production, and publishing without turning a calendar into a wall of detail."],
  ["project-roadmap-light", "Project Roadmap", "🛤️", "Planning", "Work", "A milestone view for a project from first decision through launch and review."],
  ["trip-planner-simple", "Trip Planner", "🧳", "Planning", "Personal", "Keep an itinerary, packing list, and a few key bookings in one calm travel page."],
  ["writing-dashboard", "Writing Dashboard", "✒️", "Writing", "Personal", "A home for drafts, sparks, and the next small writing session."],
  ["article-brief", "Article Brief", "📰", "Writing", "Work", "Shape a useful article with audience, angle, outline, and source notes before drafting."],
  ["novel-planner", "Novel Planner", "📖", "Writing", "Personal", "Track story questions, characters, scenes, and the thread that keeps them together."],
  ["content-pipeline", "Content Pipeline", "🎬", "Writing", "Work", "Move ideas from rough thought to drafted, edited, and published work."],
  ["essay-planner", "Essay Planner", "🎓", "Writing", "School", "Turn a prompt into a claim, supporting evidence, and a focused draft plan."],
  ["newsletter-system", "Newsletter System", "💌", "Writing", "Work", "Collect recurring sections, story ideas, and one clear send checklist."],
  ["script-outline", "Script Outline", "🎞️", "Writing", "Personal", "Build a scene-by-scene spine before you write the dialogue."],
  ["journal-prompts", "Journal Prompts", "🌙", "Writing", "Personal", "A private prompt library for days when you want to write but do not know where to begin."],
  ["portfolio-case-study", "Portfolio Case Study", "🖼️", "Writing", "Work", "Tell the story of a project with context, choices, outcome, and what you learned."],
  ["budget-basics", "Budget Basics", "💶", "Money", "Personal", "A simple monthly budget with room for the numbers and the decisions behind them."],
  ["subscription-checkup", "Subscription Checkup", "🔁", "Money", "Personal", "See recurring costs clearly and decide which ones still earn their place."],
  ["debt-payoff-plan", "Debt Payoff Plan", "📉", "Money", "Personal", "A practical place to list balances, payment dates, and the next payoff milestone."],
];

export const CURATED_TEMPLATES = definitions.map(([id, name, emoji, subject, group, desc], index) => template({
  id, name, emoji, subject, group, desc,
  blocks: () => blocksFor({ name, emoji, desc }, index),
}));
