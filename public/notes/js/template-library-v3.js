/* The template library: forty finished documents in the spirit of a good word
   processor's gallery. Each one is a complete, believable example with real
   sample content to overwrite, set in its own page design: a résumé with a
   dark sidebar, a press release set like a newspaper, a statement of work with
   clauses and a fee schedule, a board for a retrospective.

   Everything is ordinary blocks, so all of it stays editable. The whole
   document sits inside one root block carrying its design name, and
   css/templates.css styles that design; there are no images of text and no
   locked regions. Page titles are hidden for these documents because the
   design supplies its own masthead. */
import { template, h1, h2, h3, p, li, num, todo, table, quote, b, select, day } from "./template-kit.js";

export const V3_CATEGORIES = ["Study & Education", "Résumés & Cover Letters", "Official Documents", "Letters", "Planning & Productivity", "Lists"];
const GROUP = { "Study & Education": "School", "Résumés & Cover Letters": "Work", "Official Documents": "Work", "Letters": "Work", "Planning & Productivity": "Life", "Lists": "Life" };
const STUDY = "Study & Education", CV = "Résumés & Cover Letters", OFFICIAL = "Official Documents", LETTER = "Letters", PLAN = "Planning & Productivity", LISTS = "Lists";

/* ------------------------------------------------------------- vocabulary */
const asBlock = (item) => (typeof item === "string" ? p(item) : item);
const list = (items) => [].concat(items).flat().map(asBlock);
/* The root: one column holding the whole document, named for its design. */
const doc = (design, ...blocks) => [b("columns", "", { templateStyle: `doc ${design}` }, [b("column", "", {}, list(blocks))])];
const row = (style, ...cols) => b("columns", "", { templateStyle: style }, cols.map((col) => b("column", "", {}, list(col))));
const role = (name) => (text) => b("text", text, { templateRole: name });
const lbl = role("t-label"), big = role("t-big"), small = role("t-small"), lead = role("t-lead"), mast = role("t-mast"), kicker = role("t-kicker"), mono = role("t-mono"), right = role("t-right");
const kpi = (...pairs) => row("r-kpi", ...pairs.map(([value, name]) => [big(value), small(name)]));
const cards = (...cols) => row("r-cards", ...cols);
const split = (...cols) => row("r-split", ...cols);
const dated = (when, ...body) => row("r-dated", small(when), body);
const facts = (...pairs) => row("r-facts", ...pairs.map(([k, v]) => [lbl(k), p(v)]));
const panel = (...blocks) => row("r-panel", blocks);
/* Tables take their look from the design; `plain` drops the header row. */
const grid = (rows, { style = "t-rule", plain = false } = {}) => { const t = table(rows, { striped: false }); t.props.templateStyle = style; if (plain) t.props.hasHeader = false; return t; };
const bullets = (items) => items.map((x) => li(x));
const steps = (items) => items.map((x) => num(x));
const tasks = (items) => items.map((x) => (Array.isArray(x) ? todo(x[0], x[1]) : todo(x)));
const database = (dbIndex) => b("database", "", { dbIndex });
const db = (name, properties, records, views) => ({ name, properties, records, views });
const title = (name) => ({ name, type: "title" });
const text = (name) => ({ name, type: "text" });
const date = (name) => ({ name, type: "date" });
const number = (name) => ({ name, type: "number" });

const T = [];
const add = (category, id, name, desc, design, look, blocks, databases = []) => T.push({
  ...template({ id, name, emoji: "", subject: category, group: GROUP[category], desc, databases, blocks: () => blocks }),
  layout: design.split(" ")[0], look, wide: true,
});

/* ============================================================= STUDY (12) */
add(STUDY, "concept-map-notes", "Concept Map", "One idea at the centre with its causes, effects, evidence and links around it, laid out as a map you can actually revise from.", "d-map", "A nine-cell map: the central idea in a dark hub, surrounded by cards for causes, effects, examples and counter-arguments.", doc("d-map",
  kicker("Biology · Unit 4 · Concept map"), h1("Photosynthesis"), lead("How light energy becomes the chemical energy nearly all life runs on."),
  row("r-map",
    [lbl("Inputs"), ...bullets(["Light, absorbed by chlorophyll", "Water, split at the thylakoid", "Carbon dioxide, fixed in the stroma"])],
    [lbl("Where it happens"), p("Chloroplasts, mostly in the palisade mesophyll, where cells are packed to catch light.")],
    [lbl("Limiting factors"), ...bullets(["Light intensity", "CO₂ concentration", "Temperature (enzymes)"])]),
  row("r-map hub",
    [lbl("Light stage"), p("Photons excite electrons. Water is split, oxygen is released, ATP and NADPH are produced.")],
    [lbl("Central idea"), big("Light energy → stored chemical energy"), small("6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂")],
    [lbl("Calvin cycle"), p("ATP and NADPH fix carbon into G3P, which builds glucose and regenerates RuBP.")]),
  row("r-map",
    [lbl("Connects to"), ...bullets(["Respiration, the reverse flow", "Food webs and energy transfer", "The carbon cycle"])],
    [lbl("Common mistake"), p("Plants do not make energy. They convert it, and they also respire day and night.")],
    [lbl("Exam prompt"), p("Explain why the rate plateaus as light intensity rises. Name the limiting factor.")]),
  h2("Links in a sentence"),
  grid([["From", "Relationship", "To", "Why it matters"], ["Light stage", "supplies ATP and NADPH to", "Calvin cycle", "No light, no carbon fixation within minutes"], ["Stomata closing", "reduces", "CO₂ supply", "Explains midday dips on hot days"], ["Enzyme activity", "limits", "Calvin cycle rate", "Temperature curve peaks, then falls"]]),
));

add(STUDY, "lab-report-notes", "Lab Report", "A journal-style report: abstract, two-column method and results, a data table with means, error analysis and a defensible conclusion.", "d-journal sheet", "Set like a journal article: serif title, authors line, boxed abstract, then numbered sections with a results table.", doc("d-journal sheet",
  kicker("Chemistry practical · Report 6"), h1("Effect of temperature on the rate of reaction between sodium thiosulfate and hydrochloric acid"), small("Amira Hassan, with Tom Reilly · Year 12 · Marked by Dr Lowe · 14 October"),
  panel(lbl("Abstract"), p("The time for a cross to disappear was recorded at five temperatures from 20 to 60 °C. Rate roughly doubled for every 10 °C rise, supporting collision theory. Uncertainty was dominated by judging the end point by eye.")),
  split(
    [h2("1. Aim and hypothesis"), p("To find how temperature affects reaction rate. **Hypothesis:** rate will increase with temperature because more collisions exceed the activation energy."),
      h2("2. Variables"), grid([["Independent", "Temperature (20–60 °C)"], ["Dependent", "Time for cross to vanish (s)"], ["Controlled", "Volumes, concentration, observer"]], { plain: true })],
    [h2("3. Method"), ...steps(["Measure 50 cm³ of 0.1 M Na₂S₂O₃ into a flask.", "Warm in a water bath to the target temperature.", "Add 5 cm³ of 1 M HCl and start the timer.", "Stop when the cross is no longer visible from above.", "Repeat three times at each temperature."])]),
  h2("4. Results"),
  grid([["Temp (°C)", "Trial 1 (s)", "Trial 2 (s)", "Trial 3 (s)", "Mean (s)", "Rate (s⁻¹)"], ["20", "128", "132", "130", "130", "0.0077"], ["30", "66", "71", "68", "68", "0.0147"], ["40", "35", "33", "36", "35", "0.0286"], ["50", "19", "17", "18", "18", "0.0556"], ["60", "10", "9", "10", "10", "0.1000"]]),
  small("Worked example at 40 °C: rate = 1 ÷ 35 s = 0.0286 s⁻¹."),
  split(
    [h2("5. Evaluation"), grid([["Source of error", "Type", "Improvement"], ["Judging end point", "Random", "Use a light sensor"], ["Cooling after mixing", "Systematic", "Insulate the flask"]])],
    [h2("6. Conclusion"), p("The hypothesis is supported: rate increased with temperature and approximately doubled per 10 °C. The trend fits collision theory, within the ±2 s reading uncertainty.")]),
));

add(STUDY, "seminar-discussion-notes", "Seminar Debate", "A debate record for seminars: the question, both camps with their evidence, your position and the line you will say next.", "d-debate", "The question set large and centred, two opposing columns of argument, and a dark band for your own position.", doc("d-debate",
  kicker("HIST 204 · Week 7 seminar · Led by Priya N."), h1("Was the Industrial Revolution good for workers?"), small("Reading: Thompson ch. 10, Clark pp. 112–140"),
  row("r-versus",
    [lbl("Yes: the optimists"), h3("Wages tell the story"), ...bullets(["Real wages rose about 30%, 1820–1850 (Clark, p. 118)", "Consumption of sugar and tea grew", "Sam: mobility beat rural poverty"])],
    [lbl("No: the pessimists"), h3("Experience tells the story"), ...bullets(["Thompson: weavers lost independence and time", "Urban mortality and heights worsened", "Lena: the wage series omits women and children"])]),
  panel(lbl("Where I stand"), lead("Wages rose, but a generation paid for it. Averages hide who bore the transition.")),
  split([h2("What I will say next"), p("Whose lifetime are we measuring? A handloom weaver in 1835 did not benefit because a factory hand might in 1860.")], [h2("Quotes to use"), quote("“The enormous condescension of posterity.”"), small("Thompson, p. 12")]),
));

add(STUDY, "language-learning-log", "Language Log", "A week of language practice on one page: streak, plan, new phrases, grammar and the mistakes worth fixing.", "d-dash tiles", "Figures across the top, a seven-day practice strip, then phrase and mistake tables side by side.", doc("d-dash tiles",
  kicker("Spanish · B1 · Week 12"), h1("Language log"), kpi(["18", "day streak"], ["4h 20m", "practised this week"], ["46", "new phrases this month"], ["B1", "current level"]),
  row("r-week", [lbl("Mon"), p("Podcast, 20 min")], [lbl("Tue"), p("Anki review")], [lbl("Wed"), p("Subjunctive drills")], [lbl("Thu"), p("Talk with Lucía")], [lbl("Fri"), p("Read El País")], [lbl("Sat"), p("Film, no subtitles")], [lbl("Sun"), p("Review and plan")]),
  split(
    [h2("New phrases"), grid([["Phrase", "Meaning", "Used in"], ["Me da igual", "I don't mind", "Choosing a café"], ["Vale la pena", "It's worth it", "Talking about a film"], ["Estar en las nubes", "Daydreaming", "Chat with Lucía"], ["Por si acaso", "Just in case", "Packing"]])],
    [h2("Mistakes to fix"), grid([["I said", "Correct", "Rule"], ["Soy aburrido", "Estoy aburrido", "Ser = boring, estar = bored"], ["Espero que vienes", "Espero que vengas", "Subjunctive after esperar"], ["Más mejor", "Mejor", "Already comparative"]])]),
  panel(lbl("Speaking goal"), p("Order a meal and handle a small problem, such as a wrong dish, without switching to English.")),
));

const vocabDb = db("Vocabulary", [title("Term"), text("Definition"), select("Subject", ["Biology", "History", "Languages", "Maths"]), select("Confidence", ["New", "Shaky", "Solid"]), date("Next review")], [
  { Term: "Osmosis", Definition: "Net movement of water across a partially permeable membrane from low to high solute concentration.", Subject: "Biology", Confidence: "Shaky", "Next review": day(1) },
  { Term: "Mercantilism", Definition: "Building national wealth by maximising exports and limiting imports.", Subject: "History", Confidence: "New", "Next review": day(2) },
  { Term: "Subjunctive", Definition: "A verb mood for wishes, doubts and hypotheticals.", Subject: "Languages", Confidence: "Solid", "Next review": day(7) },
  { Term: "Derivative", Definition: "The rate of change of a function at a point.", Subject: "Maths", Confidence: "Shaky", "Next review": day(3) },
  { Term: "Enzyme", Definition: "A biological catalyst that lowers activation energy.", Subject: "Biology", Confidence: "Solid", "Next review": day(9) },
], [{ name: "By confidence", type: "board", group: "Confidence" }, { name: "All terms", type: "table" }, { name: "Review calendar", type: "calendar", date: "Next review" }]);
add(STUDY, "vocabulary-builder", "Vocabulary Builder", "A working glossary: a board that sorts terms by confidence, review dates on a calendar, and a spaced routine.", "d-dash slim", "A headline with review rules beside it, then a live board of terms grouped by confidence.", doc("d-dash slim",
  kicker("Glossary"), h1("Terms I need to own"),
  split([lead("Add a term the moment you meet it. Drag it across the board as it sticks.")], [grid([["Shaky", "Next day"], ["New", "In 3 days"], ["Solid", "In 1 week, then 1 month"]], { plain: true })]),
  database(0),
), [vocabDb]);

const paperDb = db("Past papers", [title("Paper"), select("Subject", ["Maths", "Physics", "English", "History"]), number("Score"), number("Out of"), date("Attempted"), select("Status", ["To do", "Marked", "Reviewed"])], [
  { Paper: "June 2023 · Paper 1", Subject: "Maths", Score: 62, "Out of": 80, Attempted: day(-9), Status: "Reviewed" },
  { Paper: "June 2023 · Paper 2", Subject: "Physics", Score: 48, "Out of": 70, Attempted: day(-4), Status: "Marked" },
  { Paper: "Nov 2022 · Paper 1", Subject: "English", "Out of": 60, Attempted: day(2), Status: "To do" },
  { Paper: "June 2022 · Paper 2", Subject: "History", "Out of": 90, Attempted: day(6), Status: "To do" },
], [{ name: "All papers", type: "table" }, { name: "By status", type: "board", group: "Status" }, { name: "Calendar", type: "calendar", date: "Attempted" }]);
add(STUDY, "past-paper-tracker", "Past Paper Tracker", "An exam-prep cockpit: grade targets, every paper logged, a topic heatmap of lost marks, and timing per section.", "d-dash", "Dark score banner, a live table of papers, and a topic breakdown showing where marks are lost.", doc("d-dash invert",
  kicker("Summer exams · 34 days to go"), h1("Past paper tracker"), kpi(["78%", "latest average"], ["A", "target grade"], ["12 / 20", "papers done"], ["1.1", "minutes per mark"]),
  database(0),
  split(
    [h2("Where the marks go"), grid([["Topic", "Lost", "Why", "Next step"], ["Circular motion", "11", "Method", "Redo 2022 Q6, Q9"], ["Integration by parts", "8", "Knowledge", "Exercise 7C"], ["Essay timing", "6", "Timing", "Plan in 5 minutes"]])],
    [h2("Marking routine"), ...steps(["Mark in a different colour, straight after.", "Write why each mark was lost.", "Redo the question from scratch in two days."])]),
), [paperDb]);

const thesisDb = db("Chapters", [title("Chapter"), select("Stage", ["Outline", "Drafting", "Revising", "Done"]), number("Words"), number("Target"), date("Due")], [
  { Chapter: "1 · Introduction", Stage: "Done", Words: 2400, Target: 2500, Due: day(-20) },
  { Chapter: "2 · Literature review", Stage: "Revising", Words: 6100, Target: 7000, Due: day(-3) },
  { Chapter: "3 · Method", Stage: "Drafting", Words: 1800, Target: 4000, Due: day(14) },
  { Chapter: "4 · Findings", Stage: "Outline", Words: 0, Target: 6000, Due: day(40) },
  { Chapter: "5 · Discussion", Stage: "Outline", Words: 0, Target: 5000, Due: day(60) },
], [{ name: "Timeline", type: "timeline", date: "Due" }, { name: "Table", type: "table" }, { name: "By stage", type: "board", group: "Stage" }]);
add(STUDY, "thesis-chapter-tracker", "Thesis Tracker", "Run a dissertation as a project: chapters on a timeline, word counts, supervisor log and this week's writing plan.", "d-dash ruled", "Word-count figures, a live chapter timeline, and a two-column week plan and supervisor log.", doc("d-dash ruled",
  kicker("MSc dissertation · Submission 12 May"), h1("Attention and memory in bilingual learners"), kpi(["10,300", "words written"], ["24,500", "words target"], ["42%", "complete"], ["186", "days left"]),
  database(0),
  split(
    [h2("This week"), ...tasks([["Finish 1,500 words of chapter 3", true], "Send chapter 2 to Dr Mensah", "Book the library carrel for Friday"])],
    [h2("Supervisor log"), grid([["Date", "Feedback", "Action"], ["3 Oct", "Narrow the second research question", "Rewritten"], ["17 Oct", "Justify the sample size", "Add power analysis"]])]),
), [thesisDb]);

add(STUDY, "study-group-agenda", "Study Group Plan", "A one-hour session plan with roles, a timed run of the hour and owned actions, so the group leaves with work done.", "d-cue", "A timeline of the hour with minute markers down the left, roles along the top, and actions at the foot.", doc("d-cue",
  kicker("Organic chemistry · Session 5"), h1("Study group plan"), facts(["When", "Tuesday, 6–7 pm"], ["Where", "Library room 3.12"], ["Lead", "Noor"], ["Scribe", "Ben"]),
  dated("0:00", h3("Check in"), p("One sentence each: what you want out of tonight.")),
  dated("0:10", h3("Hard-question round"), p("Everyone brings one question they could not answer alone. Spend no more than four minutes on each.")),
  dated("0:30", h3("Teach-back: SN1 vs SN2"), p("Ben explains without notes. Others correct, then Noor draws the energy profile.")),
  dated("0:45", h3("Timed exam question"), p("2019 Paper 2, Q4, eight minutes in silence, then compare answers.")),
  dated("0:55", h3("Actions"), p("Everyone leaves with one job and a date.")),
  grid([["Who", "Job", "By"], ["Noor", "Summarise mechanisms on one page", "Sunday"], ["Ben", "Find two more past-paper questions", "Sunday"], ["Lucy", "Book room for next week", "Friday"]]),
));

add(STUDY, "cornell-notes", "Cornell Notes", "The real Cornell method: a ruled cue column for recall questions, notes beside it, and a summary to write at the end.", "d-cornell", "A cue column ruled off from the notes, each row a recall question beside its answer, with a summary band at the foot.", doc("d-cornell",
  kicker("ECON 101 · Lecture 9 · 4 November"), h1("Supply and demand shocks"), small("Topic: why prices move · Prof. Adeyemi"),
  row("r-cue", [lbl("Cues"), p("What shifts a demand curve?")], [lbl("Notes"), p("Income, tastes, price of substitutes, expectations. A change in the good's own price is a movement **along** the curve, not a shift.")]),
  row("r-cue", [p("Why did egg prices spike?")], [p("Avian flu cut supply: the curve moved left. Demand is inelastic, so price rose far more than quantity fell.")]),
  row("r-cue", [p("Define elasticity.")], [p("% change in quantity ÷ % change in price. Under 1 is inelastic, as with essentials and goods with few substitutes.")]),
  row("r-cue", [p("Exam trap?")], [p("Do not say “demand increased” when price rose. Name which curve moved, and why.")]),
  panel(lbl("Summary"), p("Shocks move curves, and elasticity decides whether the effect lands on price or quantity. Always identify the curve first, then the direction.")),
));

add(STUDY, "lecture-notes-studio", "Lecture Notes", "A full lecture page: the session's three takeaways up front, a timestamped record, definitions, and review questions.", "d-lecture", "A slim course header, a takeaway strip, notes timed down a margin beside a definitions rail, and review questions.", doc("d-lecture",
  row("r-masthead", [kicker("CS 240 · Algorithms · Lecture 12")], [right("Dr Tan · 6 November")]), h1("Graph search and shortest paths"),
  cards([lbl("Takeaway 1"), p("BFS finds shortest paths only when every edge costs the same.")], [lbl("Takeaway 2"), p("Dijkstra is BFS with a priority queue and non-negative edges.")], [lbl("Takeaway 3"), p("Negative edges need Bellman-Ford.")]),
  row("r-rail",
    [dated("00:05", h3("Representing graphs"), p("Adjacency list: O(V + E) space, best for sparse graphs.")), dated("00:20", h3("Breadth-first search"), p("A queue explores in layers. Runs in O(V + E).")), dated("00:40", h3("Dijkstra"), p("Always settle the closest unvisited node. O((V + E) log V) with a heap.")), dated("01:05", h3("Why greedy works"), p("Once settled, no later path can be shorter, if edges are non-negative."))],
    [lbl("Definitions"), p("**Relaxation.** Improving a distance estimate through a new edge."), p("**Frontier.** Nodes discovered but not yet settled."), lbl("Ask in office hours"), p("Why does A* stay optimal with an admissible heuristic?")]),
  h2("Review"), grid([["Question", "Confidence", "Revisit"], ["Trace Dijkstra on the slide 14 graph", "Shaky", "Tomorrow"], ["When does BFS fail on weighted graphs?", "Solid", "Next week"]]),
));

add(STUDY, "reading-notes", "Reading Notes", "An annotated-bibliography page: the source, its argument, key passages with page numbers and your own response.", "d-reading sheet", "A citation block, a thesis statement, passages with page numbers in the margin, and a critique beside open questions.", doc("d-reading sheet",
  kicker("Reading notes · Sociology"), h1("The Death and Life of Great American Cities"), small("Jane Jacobs (1961). New York: Random House. Chapters 1–4 · Read 2 November"),
  panel(lbl("The argument in one sentence"), lead("Cities thrive on mixed uses and short blocks, because safety and vitality come from people, not from planning.")),
  h2("Key passages"), dated("p. 35", p("“Eyes on the street”: safety comes from the natural surveillance of people going about their day.")), dated("p. 56", p("Sidewalk contact builds public trust through small, casual encounters.")), dated("p. 150", p("Four conditions for diversity: mixed uses, short blocks, varied building ages, density.")),
  split([h2("My response"), p("Her evidence is largely observational and rooted in 1950s Manhattan, but the mechanism still explains why some regenerated areas feel empty.")], [h2("Open questions"), ...bullets(["Does this hold in car-based cities?", "Who gets displaced when a street succeeds?"]), h2("Use in"), p("Essay 2, section on public space.")]),
));

const notesDb = db("Study notes", [title("Note"), select("Subject", ["Biology", "History", "Maths"]), select("Stage", ["New", "To review", "Learned"]), date("Review on")], [
  { Note: "Enzyme kinetics summary", Subject: "Biology", Stage: "To review", "Review on": day(1) },
  { Note: "Causes of the 1848 revolutions", Subject: "History", Stage: "New", "Review on": day(2) },
  { Note: "Integration by parts", Subject: "Maths", Stage: "Learned", "Review on": day(10) },
  { Note: "Cell signalling pathways", Subject: "Biology", Stage: "To review", "Review on": day(3) },
], [{ name: "Review queue", type: "board", group: "Stage" }, { name: "Calendar", type: "calendar", date: "Review on" }, { name: "All notes", type: "table" }]);
add(STUDY, "study-notes-dashboard", "Study Dashboard", "A term's home page: subject cards, a live review queue and this week's plan, in one place.", "d-dash tiles", "A row of subject cards with grades, a live review board, then a week's plan and upcoming deadlines.", doc("d-dash tiles",
  kicker("Autumn term · Week 9"), h1("Study dashboard"),
  cards([lbl("Biology"), big("A−"), small("Next: enzymes test, 14 Nov")], [lbl("History"), big("B+"), small("Next: essay, 21 Nov")], [lbl("Maths"), big("A"), small("Next: problem set 6, Friday")]),
  database(0),
  split([h2("This week"), ...tasks([["Finish essay plan", true], "Past paper, Maths", "Flashcards for cell signalling"])], [h2("Deadlines"), grid([["Due", "What", "Weight"], ["14 Nov", "Enzymes test", "15%"], ["21 Nov", "History essay", "30%"]])]),
), [notesDb]);

/* ============================================ RÉSUMÉS AND COVER LETTERS (7) */
add(CV, "creative-portfolio-resume", "Portfolio Résumé", "A two-tone résumé with a dark profile sidebar, skills, and selected work with outcomes for designers and makers.", "d-cv-split sheet", "A dark sidebar with name, contact and skills; a white column of experience and selected projects.", doc("d-cv-split sheet",
  row("r-side",
    [mast("Maya Okafor"), lbl("Product designer"), p("Designing calm, useful software for health and finance teams."),
      lbl("Contact"), p("maya@okafor.design"), p("+44 7700 900142"), p("London, UK"), p("okafor.design"),
      lbl("Skills"), mono("Product design  ●●●●●"), mono("Prototyping    ●●●●●"), mono("Research       ●●●●○"), mono("Design systems ●●●●○"), mono("Front-end      ●●●○○"),
      lbl("Tools"), p("Figma, Framer, Principle, HTML/CSS"),
      lbl("Education"), p("BA Graphic Design, Central Saint Martins, 2016")],
    [h2("Selected work"),
      row("r-cards", [lbl("Monzo"), h3("Bills redesign"), p("Lead designer. Cut missed payments by 18% across 2M customers.")], [lbl("Babylon"), h3("Booking flow"), p("Reduced drop-off from 41% to 23% in six weeks.")]),
      h2("Experience"),
      dated("2021 – now", h3("Senior Product Designer, Monzo"), ...bullets(["Lead design for the bills and subscriptions squad of nine", "Built the pattern library now used by 40 designers", "Mentor two mid-level designers through promotion"])),
      dated("2018 – 2021", h3("Product Designer, Babylon Health"), ...bullets(["Redesigned booking used by 300,000 patients a month", "Ran weekly research with clinicians and patients"])),
      dated("2016 – 2018", h3("Designer, ustwo"), p("Client work for Google, Sky and Ford in cross-disciplinary teams.")),
      h2("Recognition"), p("D&AD Wood Pencil 2022 · Speaker, Config Europe 2023")]),
));

add(CV, "executive-resume", "Executive Résumé", "A senior leadership résumé: centred masthead, headline figures, and career history led by scope and results.", "d-cv-classic sheet", "A centred serif masthead with a results strip, then experience with dates in a ruled left margin.", doc("d-cv-classic sheet",
  mast("James R. Whitfield"), lbl("Chief Operating Officer · Logistics and supply chain"), small("Manchester, UK · james@whitfield.me · +44 7700 900318 · linkedin.com/in/jrwhitfield"),
  kpi(["£420M", "P&L led"], ["1,900", "people across 6 countries"], ["+31%", "EBITDA in three years"]),
  h2("Leadership summary"), p("Operating executive with 20 years in logistics, leading turnarounds and multi-site growth. Known for building leadership benches and getting complex organisations to deliver on time."),
  h2("Career history"),
  dated("2019 – now", h3("Chief Operating Officer, Northway Logistics"), small("£420M revenue · reports to CEO · board member"), ...bullets(["Led the turnaround from a £14M loss to a £38M profit in 30 months", "Consolidated 11 depots into 4 automated hubs, saving £22M a year", "Raised on-time delivery from 87% to 98.4%"])),
  dated("2013 – 2019", h3("VP Operations EMEA, Kestrel Freight"), small("£260M revenue · 1,100 people"), ...bullets(["Opened operations in Poland and the Netherlands", "Negotiated a £90M carrier framework, reducing unit cost by 12%"])),
  dated("2006 – 2013", h3("Director of Supply Chain, Halden Group"), p("Moved through regional and national roles, leading the ERP rollout across 40 sites.")),
  h2("Board and education"), split([p("**Non-executive Director,** Fairway Housing, 2021–now"), p("**Trustee,** Transaid, 2018–now")], [p("**MBA,** Warwick Business School"), p("**BEng Mechanical Engineering,** Leeds")]),
));

add(CV, "career-change-resume", "Career Change Résumé", "A skills-first résumé that translates past work into the new field and shows the bridge you have already built.", "d-cv-bridge sheet", "A dark name band, a then-to-now skills translation table, and recent projects above a short history.", doc("d-cv-bridge sheet",
  panel(mast("Daniel Reyes"), lead("Teacher moving into learning experience design"), small("Bristol, UK · daniel.reyes@mail.com · +44 7700 900451 · danielreyes.co")),
  h2("Why this move"), p("Eight years teaching showed me what actually helps people learn. I now want to build that into products used by far more than thirty students at a time."),
  h2("How my experience translates"),
  grid([["What the role needs", "What I did as a teacher", "Result"], ["Instructional design", "Rebuilt the Year 10 science course around retrieval practice", "Top grades up 22%"], ["User research", "Observed 120 students, ran half-termly surveys", "Redesigned 14 units"], ["Stakeholder management", "Led a department of six, reported to governors", "Rated Outstanding"], ["Data analysis", "Tracked attainment across 400 students", "Interventions cut gaps by 15%"]]),
  split(
    [h2("Recent projects"), ...bullets(["**Onboarding course for Oak Academy.** Six-module course, 4.8/5 from 900 learners", "**Certificate.** ATD Instructional Design, 2024", "**Portfolio.** Three Articulate Rise case studies"])],
    [h2("Work history"), p("**Head of Science,** Redland School, 2020–now"), p("**Science Teacher,** St Mary's, 2016–2020"), h2("Education"), p("PGCE, University of Bath · BSc Biology, Exeter")]),
));

add(CV, "academic-cv", "Academic CV", "A complete academic CV in a classic serif layout: appointments, numbered publications, teaching, grants and service.", "d-cv-academic sheet", "A restrained serif CV with small-capital section heads, dates in the margin and numbered publications.", doc("d-cv-academic sheet",
  mast("Dr. Eleanor Marsh"), small("Lecturer in Cognitive Neuroscience, Department of Psychology, University of York · e.marsh@york.ac.uk · ORCID 0000-0002-1825-0097"),
  h2("Research interests"), p("Memory consolidation, sleep, and the neural basis of language learning, using fMRI and computational modelling."),
  h2("Appointments"), dated("2021 – now", p("**Lecturer,** University of York")), dated("2018 – 2021", p("**Postdoctoral Fellow,** MRC Cognition and Brain Sciences Unit, Cambridge")),
  h2("Education"), dated("2018", p("**PhD Psychology,** University of Oxford. Thesis: *Sleep and the integration of new words.*")), dated("2013", p("**BSc Psychology,** University of Edinburgh, First Class")),
  h2("Selected publications"), ...steps(["Marsh, E., & Tan, L. (2024). Spindle density predicts overnight word integration. *Journal of Neuroscience, 44*(8), 1–12.", "Marsh, E., Okoye, C., & Hart, P. (2022). Hippocampal replay in second-language learners. *Cortex, 151*, 88–104.", "Tan, L., & Marsh, E. (2020). A computational account of consolidation. *Psychological Review, 127*(3), 412–436."]),
  h2("Grants and awards"), grid([["Funder", "Award", "Value", "Year"], ["ESRC", "New Investigator Grant", "£298,000", "2023"], ["Wellcome", "Seed Award", "£95,000", "2021"]]),
  h2("Teaching"), p("Cognitive Neuroscience (UG, convenor); Research Methods (PG); supervised 3 PhD and 14 MSc students."),
  h2("Service"), p("Associate Editor, *Cortex*; reviewer for *Nature Human Behaviour* and *eLife*; departmental EDI lead."),
));

add(CV, "internship-cover-letter", "Internship Cover Letter", "A bright, one-page cover letter with a monogram header and a short why-them, why-me, what-next structure.", "d-letter lh-monogram sheet", "A monogram letterhead with contact details in a left rail and the letter beside them.", doc("d-letter lh-monogram sheet",
  row("r-side",
    [mast("AK"), lbl("Aisha Khan"), small("Computer Science, University of Warwick, Year 2"), small("aisha.khan@warwick.ac.uk"), small("+44 7700 900266"), small("github.com/aishak")],
    [small("3 February 2026"), p("**Hiring team, Data Platform**\nSpotify, London"), p("**Application for Data Engineering Summer Internship**"), p("Dear Hiring Team,"),
      p("Your engineering blog post on rebuilding Wrapped's pipelines is why I am applying. Making billions of events feel personal is the kind of problem I want to spend a summer on."),
      p("In my second year I built a streaming pipeline for the university's bike-share data, processing 40,000 events a day with Kafka and dbt. It cut report time from a day to five minutes, and taught me how much of data work is reliability rather than cleverness."),
      p("I would bring curiosity, careful testing and a habit of writing things down. I would love to talk about how I could help the Data Platform team this summer."),
      p("Yours sincerely,"), p("**Aisha Khan**")]),
));

add(CV, "career-change-cover-letter", "Career Change Cover Letter", "A confident cover letter for changing fields, with a pull-quote opening and a three-part what-I-bring strip.", "d-letter lh-band sheet", "A dark name band, a large opening statement, the letter, and three proof points across the foot.", doc("d-letter lh-band sheet",
  panel(mast("Daniel Reyes"), small("Learning experience designer · danielreyes.co · +44 7700 900451")),
  small("12 March 2026 · Lena Fischer, Head of Learning, Duolingo"),
  quote("Eight years of teaching taught me what helps people learn. I want to build that into products."),
  p("Dear Lena,"),
  p("I am applying for the Learning Designer role because Duolingo sits exactly where I want to work: rigorous learning science, delivered at a scale no classroom can reach."),
  p("I am moving from teaching deliberately. I have spent the past year closing the gap: completing the ATD certificate, building a six-module onboarding course that 900 learners rated 4.8 out of 5, and studying how your team tests lessons."),
  row("r-cards", [lbl("Learning science"), p("Rebuilt a full course around retrieval practice. Top grades rose 22%.")], [lbl("Research"), p("Observed 120 learners and turned findings into 14 redesigned units.")], [lbl("Delivery"), p("Led six teachers to an Outstanding rating, on schedule.")]),
  p("I would welcome a conversation about what I could contribute in my first six months. Thank you for considering a different path into the role."),
  p("Kind regards,"), p("**Daniel Reyes**"),
));

add(CV, "references-and-thank-you", "References & Follow-Up", "A matched pair for the end of an interview: a clean reference sheet and a short thank-you note ready to send.", "d-refs sheet", "Three referee cards under a slim masthead, then a thank-you note set apart as its own page.", doc("d-refs sheet",
  mast("Priya Nair"), small("References · Available on request for the Senior Analyst role at Lloyds"),
  cards([lbl("Line manager"), h3("Helen Burke"), small("Head of Risk, Barclays"), p("Managed me for three years. Can speak to delivery and judgement."), small("helen.burke@barclays.com · 020 7946 0102")], [lbl("Project lead"), h3("Marcus Webb"), small("Director, Deloitte"), p("Led our FCA review. Can speak to analysis under pressure."), small("mwebb@deloitte.co.uk · 020 7946 0177")], [lbl("Mentor"), h3("Prof. Ana Costa"), small("LSE Finance"), p("Supervised my thesis. Can speak to rigour and writing."), small("a.costa@lse.ac.uk · 020 7946 0129")]),
  h2("Thank-you note"), small("Send within 24 hours · Subject: Thank you, Senior Analyst conversation"),
  panel(p("Dear Helen,"), p("Thank you for speaking with me on Tuesday. Hearing how your team is rebuilding its stress-testing models made me even more interested in the role."), p("Since we spoke I remembered the Basel reporting project, which is close to the challenge you described. I have attached a short summary."), p("I look forward to hearing about next steps."), p("Best wishes,"), p("**Priya Nair**")),
));

/* ====================================================== OFFICIAL DOCUMENTS (9) */
add(OFFICIAL, "meeting-agenda-formal", "Board Meeting Agenda", "A formal board agenda with timings, papers, owners and the decision required on each item.", "d-report sheet", "A ruled formal masthead, an attendance strip, and an item table showing time, owner and decision.", doc("d-report sheet",
  kicker("Harbour Trust · Board of Trustees"), h1("Agenda: Quarterly Board Meeting"), facts(["Date", "Thu 12 March, 2–4 pm"], ["Venue", "Boardroom, 4 Quay St"], ["Chair", "Ruth Ellison"], ["Secretary", "Omar Aziz"]),
  grid([["#", "Item", "Lead", "Time", "Paper", "Decision needed"], ["1", "Apologies and declarations of interest", "Chair", "5", "—", "Note"], ["2", "Minutes of 11 December", "Chair", "5", "A", "Approve"], ["3", "Chief Executive's report", "CEO", "20", "B", "Note"], ["4", "Q3 finance and reserves policy", "Treasurer", "25", "C", "Approve policy"], ["5", "Strategy 2027: three options", "CEO", "40", "D", "Choose option"], ["6", "Risk register", "COO", "15", "E", "Approve changes"], ["7", "Any other business", "Chair", "10", "—", "—"]]),
  split([h2("Papers"), ...bullets(["A. December minutes", "B. CEO report", "C. Q3 accounts and draft policy", "D. Strategy options paper", "E. Risk register, March"])], [h2("Reminders"), p("Papers were circulated seven days ahead. Please read Paper D in full: it needs a decision."), p("**Next meeting:** Thursday 11 June, 2 pm.")]),
));

add(OFFICIAL, "statement-of-work", "Statement of Work", "A contract-ready SOW with parties, scope, deliverables, milestones, fee schedule, assumptions and signatures.", "d-report sheet", "A title block with parties, numbered clauses, milestone and fee tables with totals, and a signature panel.", doc("d-report sheet",
  kicker("Statement of Work · SOW-2026-014 · Version 1.0"), h1("Website Replatform for Alder & Co"),
  facts(["Client", "Alder & Co Ltd"], ["Supplier", "Northlight Studio Ltd"], ["Start", "2 March 2026"], ["End", "29 May 2026"]),
  h2("1. Purpose"), p("Move alderandco.com to a modern CMS, improving page speed and letting the marketing team publish without developer support."),
  h2("2. Deliverables"), grid([["Ref", "Deliverable", "Due", "Accepted when"], ["D1", "Discovery report and sitemap", "20 Mar", "Signed off by Marketing Lead"], ["D2", "Design system and templates", "17 Apr", "All 12 templates approved"], ["D3", "Built site on staging", "15 May", "Passes agreed test plan"], ["D4", "Launch and handover", "29 May", "Live, team trained"]]),
  split(
    [h2("3. Out of scope"), ...bullets(["Copywriting and photography", "Migration of content older than 2021", "Ongoing hosting after 90 days"]), h2("4. Assumptions"), ...bullets(["Client gives feedback within 3 working days", "Changes follow a written change request"])],
    [h2("5. Fees"), grid([["Milestone", "Amount"], ["On signature", "£6,000"], ["D2 accepted", "£9,000"], ["D3 accepted", "£9,000"], ["Launch", "£6,000"], ["Total (excl. VAT)", "£30,000"]], { style: "t-total" })]),
  h2("6. Agreed"), row("r-sign", [lbl("For the client"), p("Name:"), p("Signature:"), p("Date:")], [lbl("For the supplier"), p("Name:"), p("Signature:"), p("Date:")]),
));

add(OFFICIAL, "incident-report", "Incident Report", "A structured incident record: severity, timeline to the minute, impact, five-whys root cause and owned actions.", "d-form sheet", "A form with a severity header, a time-stamped log, an impact grid, a five-whys ladder and an action table.", doc("d-form sheet",
  kicker("Incident report · INC-2291"), h1("Payment gateway outage"), facts(["Severity", "SEV-1"], ["Status", "Resolved"], ["Duration", "47 minutes"], ["Owner", "Sana Malik"]),
  panel(lbl("Summary"), p("On 14 October card payments failed for 47 minutes after an expired TLS certificate on the gateway proxy. 3,120 checkouts failed. No data was exposed.")),
  h2("Timeline (UTC)"), dated("09:02", p("Certificate expires. Error rate rises.")), dated("09:06", p("Monitoring alert fires; on-call acknowledges.")), dated("09:19", p("Cause identified on the proxy.")), dated("09:41", p("New certificate deployed.")), dated("09:49", p("Error rate normal. Incident closed.")),
  h2("Impact"), kpi(["3,120", "failed checkouts"], ["£84k", "delayed revenue"], ["0", "data exposed"], ["212", "support tickets"]),
  split(
    [h2("Five whys"), ...steps(["Payments failed because the proxy rejected TLS.", "It rejected TLS because the certificate had expired.", "It expired because renewal was manual.", "Renewal was manual because the proxy was never moved to ACM.", "It was not moved because no one owned the migration."])],
    [h2("Actions"), grid([["Action", "Owner", "Due"], ["Move proxy to automatic renewal", "Tom", "21 Oct"], ["Alert 30 days before expiry", "Sana", "18 Oct"], ["Add owner to infra register", "Priya", "25 Oct"]])]),
));

add(OFFICIAL, "press-release", "Press Release", "A news-ready release set like a front page: dateline, headline, two-column story, pull quote and boilerplate.", "d-news sheet", "A newspaper masthead and headline, two columns of story, a pull quote and a boilerplate panel.", doc("d-news sheet",
  row("r-masthead", [mast("Lumen Energy")], [right("FOR IMMEDIATE RELEASE · 9 June 2026")]),
  h1("Lumen opens UK's largest community-owned solar farm"), lead("The 48 MW site in Lincolnshire will power 14,000 homes, with profits returned to local residents."),
  split(
    [p("**LINCOLN, 9 June 2026 —** Lumen Energy today opened the UK's largest community-owned solar farm, a 48 MW site that will supply clean electricity to 14,000 homes and return profits directly to residents."), p("The £52 million project was funded by 6,200 local investors alongside the National Wealth Fund, and created 110 construction jobs."), p("Residents within five miles will receive a 15% discount on their energy bills, and a community fund will distribute £400,000 a year.")],
    [quote("“This is what the energy transition should feel like: local, shared and fair. Every panel here belongs in part to someone who lives nearby.”"), small("Ruth Adeyemi, Chief Executive, Lumen Energy"), p("Construction of a second site in Norfolk begins next spring. Residents can register interest at lumenenergy.co.uk.")]),
  panel(lbl("About Lumen Energy"), p("Lumen Energy develops community-owned renewable power across the UK. Founded in 2017, it has returned £9M to local communities."), lbl("Media contact"), p("Hannah Cole · press@lumenenergy.co.uk · +44 20 7946 0193")),
  right("###"),
));

add(OFFICIAL, "terms-of-reference", "Terms of Reference", "A governance charter: purpose, scope, membership, RACI, decision rights and reporting, ready for sign-off.", "d-report sheet", "A numbered charter with an in/out scope table and a RACI matrix of who does what.", doc("d-report sheet",
  kicker("Governance · Terms of Reference · Reviewed annually"), h1("AI Steering Group"), facts(["Sponsor", "Chief Operating Officer"], ["Chair", "Dr Sophie Lane"], ["Meets", "Monthly, 60 minutes"], ["Review", "January 2027"]),
  h2("1. Purpose"), lead("To make sure the organisation uses AI safely, legally and where it creates real value."),
  h2("2. Scope"), grid([["In scope", "Out of scope"], ["Approving new AI use cases", "Day-to-day product decisions"], ["Policy, risk and training", "Procurement under £10,000"], ["Vendor and model assurance", "Individual staff performance"]]),
  h2("3. Who does what"), grid([["Activity", "Chair", "Legal", "Security", "Data", "Sponsor"], ["Approve use cases", "A", "C", "C", "R", "I"], ["Set AI policy", "R", "C", "C", "C", "A"], ["Incident response", "I", "C", "R", "C", "A"], ["Quarterly reporting", "R", "I", "I", "C", "A"]]),
  small("R = Responsible, A = Accountable, C = Consulted, I = Informed"),
  split([h2("4. Decision rights"), ...bullets(["Quorum is four members including the Chair", "Decisions by consensus, then majority vote", "High-risk use cases go to the Sponsor"])], [h2("5. Reporting"), p("The Chair reports to the Executive Committee each quarter with a risk summary and decisions taken.")]),
));

add(OFFICIAL, "performance-review", "Performance Review", "A balanced annual review: goal outcomes, a competency scorecard, development plan and both sides' comments.", "d-form sheet", "A profile header with an overall rating, goal outcomes, a dotted competency scorecard and a signed comment panel.", doc("d-form sheet",
  kicker("Annual performance review · 2025/26"), h1("Tom Fletcher"), facts(["Role", "Senior Engineer"], ["Manager", "Sana Malik"], ["Period", "Apr 2025 – Mar 2026"], ["Overall", "Exceeds expectations"]),
  h2("Goals"), grid([["Goal", "Result", "Rating"], ["Reduce p95 latency below 200 ms", "Reached 164 ms in January", "Exceeded"], ["Lead the billing migration", "Shipped on time, no incidents", "Met"], ["Mentor one engineer to mid-level", "Promoted in December", "Exceeded"]]),
  split(
    [h2("Competencies"), mono("Technical depth   ●●●●●"), mono("Delivery          ●●●●○"), mono("Collaboration     ●●●●○"), mono("Communication     ●●●○○"), mono("Leadership        ●●●●○")],
    [h2("Development plan"), ...tasks(["Present at two engineering all-hands", "Lead one cross-team design review", "Take the staff-engineer pathway course"])]),
  row("r-cards", [lbl("Manager's summary"), p("Tom's reliability work changed how the team operates. Next step is influence beyond his squad.")], [lbl("Employee's comments"), p("I want more ownership of technical direction, and help getting comfortable presenting.")]),
  row("r-sign", [lbl("Employee"), p("Signature:"), p("Date:")], [lbl("Manager"), p("Signature:"), p("Date:")]),
));

add(OFFICIAL, "expense-report", "Expense Report", "A finance-ready claim laid out like an invoice: line items by category, totals, policy check and approval.", "d-invoice sheet", "An invoice layout: bold title and claim number, a ruled line-item table and a right-aligned totals block.", doc("d-invoice sheet",
  row("r-masthead", [mast("Expense claim")], [right("EXP-2026-0318"), right("Submitted 18 March 2026")]),
  facts(["Employee", "Hannah Cole"], ["Department", "Communications"], ["Trip", "Berlin press launch"], ["Cost centre", "4120"]),
  grid([["Date", "Description", "Category", "Receipt", "Amount"], ["10 Mar", "Return flights LHR–BER", "Travel", "Yes", "£214.60"], ["10 Mar", "Hotel, two nights", "Accommodation", "Yes", "£312.00"], ["11 Mar", "Client lunch, 3 people", "Meals", "Yes", "£96.40"], ["11 Mar", "Taxis, airport and venue", "Travel", "Yes", "£58.20"], ["12 Mar", "Printed press packs", "Materials", "Yes", "£41.80"]]),
  row("r-totals", [p("All receipts attached. Spend is within the travel policy limit of £250 a night.")], [grid([["Subtotal", "£723.00"], ["Advance received", "−£200.00"], ["Due to employee", "£523.00"]], { style: "t-total", plain: true })]),
  row("r-sign", [lbl("Claimant"), p("Signature:"), p("Date:")], [lbl("Approved by"), p("Signature:"), p("Date:")]),
));

add(OFFICIAL, "purchase-request", "Purchase Request", "A business case on one page: the need, a scored supplier comparison, cost over three years and a clear recommendation.", "d-invoice sheet", "A request header, a weighted supplier scoring matrix and a recommendation panel beside three-year costs.", doc("d-invoice sheet",
  row("r-masthead", [mast("Purchase request")], [right("PR-0482"), right("Needed by 30 April")]),
  facts(["Requested by", "Liam Ortiz"], ["Department", "Customer Support"], ["Budget code", "CS-7710"], ["Total", "£18,600"]),
  h2("The need"), p("Support tickets are up 40% and agents work across three tools. A shared helpdesk would cut first-response time and give us reporting."),
  h2("Options scored"), grid([["Criteria (weight)", "Zendesk", "Intercom", "Front"], ["Fit to workflow (40%)", "9", "7", "8"], ["Cost (30%)", "6", "5", "8"], ["Reporting (20%)", "9", "7", "6"], ["Ease of rollout (10%)", "7", "8", "9"], ["Weighted score", "7.9", "6.5", "7.6"]], { style: "t-total" }),
  split([panel(lbl("Recommendation"), p("**Choose Zendesk.** Best fit and reporting. The higher licence cost is repaid by saving an estimated 12 agent hours a week."))], [grid([["Year 1", "£7,800"], ["Year 2", "£5,400"], ["Year 3", "£5,400"], ["Three-year cost", "£18,600"]], { style: "t-total", plain: true })]),
  h2("Approvals"), ...tasks(["Line manager", "Finance", "IT security review"]),
));

add(OFFICIAL, "event-run-sheet", "Event Run Sheet", "A stage manager's cue sheet: minute-by-minute cues, owners, kit and fallbacks, plus key contacts.", "d-cue", "A cue-sheet table with time stamps and fallbacks, under an event header with crew contacts beside the kit list.", doc("d-cue",
  kicker("Run sheet · Version 3 · Print two copies"), h1("Founders' Summit 2026"), facts(["Date", "Thu 22 May"], ["Venue", "Hall 2, Barbican"], ["Show caller", "Nadia K."], ["Doors", "17:30"]),
  grid([["Time", "Cue", "Owner", "Needs", "If it goes wrong"], ["17:00", "Crew call, sound check", "Nadia", "All mics live", "Spare mic in rack B"], ["17:30", "Doors open, walk-in music", "Front of house", "Playlist, 4 staff", "Hold doors 10 min"], ["18:00", "Welcome", "Host", "Slide 1, handheld", "Host reads from card"], ["18:10", "Keynote", "Speaker", "Clicker, lapel mic", "PDF on backup laptop"], ["18:50", "Panel", "Moderator", "4 chairs, 4 mics", "Drop to 3 panellists"], ["19:30", "Close and drinks", "Host", "Slide 12, music", "Skip thank-you video"]]),
  split([h2("Kit"), ...tasks([["Slides on two laptops", true], ["Batteries charged", true], "Signage placed", "Registration list printed"])], [h2("Contacts"), grid([["Role", "Name", "Mobile"], ["Venue manager", "Paul D.", "07700 900811"], ["AV", "Zoe M.", "07700 900632"], ["Catering", "Sam T.", "07700 900947"]])]),
));

/* ================================================================ LETTERS (9) */
add(LETTER, "resignation-letter", "Resignation Letter", "A gracious, formal resignation with a clear last day, thanks and a concrete handover offer.", "d-letter lh-rule sheet", "A classic serif letter under a slim ruled letterhead, right-aligned date and generous margins.", doc("d-letter lh-rule sheet",
  row("r-masthead", [mast("Claire Donovan")], [right("14 Elm Grove, Leeds LS6 2AB"), right("claire.donovan@mail.com · 07700 900274")]),
  right("2 March 2026"),
  p("Mr Andrew Pike\nHead of Marketing\nBrightwell Foods Ltd\nLeeds LS1 4DT"),
  p("**Resignation: Senior Marketing Manager**"),
  p("Dear Andrew,"),
  p("Please accept this letter as formal notice of my resignation from my role as Senior Marketing Manager. In line with my four-week notice period, my last working day will be Monday 30 March."),
  p("I have valued my five years at Brightwell, especially leading the Harvest relaunch and working with such a thoughtful team. Thank you for the opportunities and support you have given me."),
  p("I will do everything I can to make the transition smooth, including documenting the campaign calendar and handing over agency relationships to Jess before I leave."),
  p("Yours sincerely,"), p("**Claire Donovan**"),
));

add(LETTER, "recommendation-letter", "Recommendation Letter", "A credible academic reference on institutional letterhead, built around two specific examples and a clear ranking.", "d-letter lh-seal sheet", "A centred crest and institution name above a formal serif reference, closing with a signature block.", doc("d-letter lh-seal sheet",
  mast("St Aldwyn's College"), small("Office of the Head of Sixth Form · Cambridge CB2 1TQ"),
  right("18 January 2026"),
  p("**Reference for Maria Santos, UCAS 123-456-7890**"),
  p("To the Admissions Tutor,"),
  p("I am delighted to recommend Maria Santos for Natural Sciences. I have taught her for two years and been her tutor since September, and she is among the strongest students I have worked with in twenty years."),
  p("Maria's distinguishing quality is intellectual independence. When our class reached the limits of the syllabus on enzyme kinetics, she designed her own assay, spotted a flaw in the textbook model and presented it to the department."),
  p("She is equally generous. She runs a weekly chemistry clinic for younger students, and three of them have since chosen to study science at A level."),
  p("Maria is predicted two A* grades and an A, and ranks first of 142 in her year. I recommend her without reservation."),
  p("Yours faithfully,"), p("**Dr Helen Armitage**\nHead of Sixth Form"),
));

add(LETTER, "complaint-letter", "Complaint Letter", "A firm formal complaint with a case-details box, dated timeline of events, clear remedy and escalation route.", "d-memo sheet", "A formal notice with a boxed case summary, a timeline of events and the remedy requested.", doc("d-memo sheet",
  kicker("Formal complaint · Sent by recorded delivery"), h1("Faulty washing machine, order 88213"),
  facts(["From", "Robert Lane, 8 Mill Rd, Bath"], ["To", "Customer Relations, HomeGoods"], ["Date", "6 March 2026"], ["Reference", "Case 88213"]),
  p("Dear Customer Relations Manager,"),
  p("I am writing to make a formal complaint about the Bosch washing machine I bought from you, which failed within six weeks and has not been repaired."),
  h2("What happened"), dated("20 Jan", p("Delivered and installed by your team.")), dated("2 Mar", p("Drum stopped mid-cycle, error E18.")), dated("3 Mar", p("Called support. Engineer promised for 5 March.")), dated("5 Mar", p("No engineer arrived and no one called.")),
  panel(lbl("What I am asking for"), p("Under the Consumer Rights Act 2015 the goods are not of satisfactory quality. Please **refund £549 in full and collect the machine by 20 March**.")),
  p("If this is not resolved by that date, I will refer the matter to the retail ombudsman. I enclose my receipt, photographs and call log."),
  p("Yours faithfully,"), p("**Robert Lane**"),
));

add(LETTER, "refund-request-letter", "Refund Request", "A short, invoice-style refund request: exactly what was bought, why it is owed, and how to pay it back.", "d-invoice sheet", "A compact letter with an order summary table and a highlighted amount due.", doc("d-invoice sheet",
  row("r-masthead", [mast("Refund request")], [right("Order A-55102"), right("24 February 2026")]),
  facts(["From", "Grace Liu, 3 Park Row, York"], ["To", "Returns, Northwind Travel"]),
  p("Dear Returns Team,"),
  p("My flight on 12 February was cancelled by Northwind and I did not travel. I contacted you on 13 February and have had no resolution, so I am requesting a full refund."),
  grid([["Item", "Date", "Amount"], ["Return flights, York to Lisbon", "12 Feb", "£186.00"], ["Checked baggage", "12 Feb", "£52.00"], ["Refund due", "", "£238.00"]], { style: "t-total" }),
  panel(lbl("Please do this"), p("Refund **£238.00** to the original Visa ending 4471 within 14 days. Under UK261 a refund is due within seven days of a cancelled flight.")),
  p("I enclose my booking confirmation and cancellation email. Thank you for resolving this promptly."),
  p("Kind regards,"), p("**Grace Liu**"),
));

add(LETTER, "letter-of-intent", "Letter of Intent", "A business letter of intent with a key-terms table, non-binding clause and countersignature panel.", "d-letter lh-rule sheet", "A company letterhead, a key-terms summary table and countersignature blocks.", doc("d-letter lh-rule sheet",
  row("r-masthead", [mast("Oakline Capital")], [right("22 Finsbury Sq, London EC2A 1DX"), right("10 April 2026")]),
  p("Ms Tara Singh, CEO\nFernhill Software Ltd"),
  p("**Letter of intent: proposed acquisition of Fernhill Software Ltd**"),
  p("Dear Tara,"),
  p("Following our recent discussions, Oakline Capital is pleased to confirm its intent to acquire the entire issued share capital of Fernhill Software, on the principal terms below."),
  grid([["Term", "Proposal"], ["Purchase price", "£24M, cash-free and debt-free"], ["Structure", "£20M at completion, £4M earn-out over 24 months"], ["Due diligence", "Six weeks from signing"], ["Exclusivity", "Eight weeks"], ["Target completion", "30 June 2026"]]),
  p("This letter is an expression of intent and is not legally binding, except for the exclusivity and confidentiality terms."),
  p("We are excited about working with you and your team. Please countersign below to proceed."),
  row("r-sign", [lbl("Oakline Capital"), p("Name: David Hale, Partner"), p("Signature:")], [lbl("Fernhill Software"), p("Name: Tara Singh, CEO"), p("Signature:")]),
));

add(LETTER, "thank-you-letter", "Thank-You Card", "A warm personal note laid out like a printed card, centred and unhurried.", "d-card sheet", "A centred card with a serif greeting, a fine ornament and a short handwritten-style note.", doc("d-card sheet",
  big("Thank you"), small("· · ·"),
  p("Dear Mrs Patel,"),
  p("I wanted to say how much your reference meant to me. Because of it, I got the place at Leeds, and I start in September."),
  p("You were the first teacher who told me that my writing was worth taking seriously. I don't think you knew how much that changed things."),
  p("I hope I can visit and tell you about it in person."),
  p("With gratitude,"), p("**Sophie**"),
));

add(LETTER, "landlord-notice-letter", "Notice to Landlord", "A formal tenancy notice with property details, notice dates, deposit request and proof-of-service record.", "d-memo sheet", "A notice form with tenancy details at the top, the notice in clear prose and a served-by record.", doc("d-memo sheet",
  kicker("Tenant's notice to quit"), h1("Notice of ending tenancy"),
  facts(["Property", "Flat 4, 19 Queen St, Cardiff"], ["Tenancy began", "1 September 2024"], ["Notice served", "1 April 2026"], ["Moving out", "31 May 2026"]),
  p("Dear Ms Rees,"),
  p("I am writing to give you notice that I will be ending my tenancy at the above property. In line with the two-month notice period in clause 6 of our agreement, I will vacate on 31 May 2026."),
  split([h2("Before I leave"), ...tasks(["Agree a check-out inspection date", "Final meter readings", "Return all keys"])], [h2("Deposit"), p("My deposit of £950 is held with the TDS, reference TDS-448120. Please confirm how it will be returned.")]),
  p("Please confirm receipt of this notice by 8 April. My forwarding address will follow."),
  p("Yours sincerely,"), p("**Owen Price**"),
  grid([["Served by", "Date", "Proof"], ["Recorded delivery", "1 April 2026", "RM 8842 1190 GB"]]),
));

add(LETTER, "leave-request-letter", "Leave Request Memo", "An internal memo requesting leave, with dates, a named handover plan and cover by workstream.", "d-memo sheet", "A TO / FROM / DATE / RE memo header with a handover table.", doc("d-memo sheet",
  kicker("Internal memo"), h1("Annual leave request"),
  facts(["To", "Rachel Moore, Head of Product"], ["From", "Ben Clarke, Product Manager"], ["Date", "9 June 2026"], ["Re", "Leave, 4–22 August"]),
  p("Rachel, I would like to request 15 days of annual leave from Monday 4 August to Friday 22 August, returning on the 25th. I have 19 days remaining this year and I have checked the team calendar for clashes."),
  h2("Handover"), grid([["Workstream", "Status when I leave", "Covered by"], ["Checkout redesign", "In build, launch 1 Sept", "Amelia"], ["Q3 roadmap review", "Pre-read drafted", "Rachel"], ["Customer interviews", "Paused until 26 Aug", "—"]]),
  p("I will be unreachable except for genuine emergencies, through Amelia. Please let me know by Friday if these dates work."),
  p("Thanks,"), p("**Ben**"),
));

add(LETTER, "reference-request-letter", "Reference Request", "A considerate ask with everything a referee needs in one card, and an easy way to say no.", "d-letter lh-rule sheet", "A short friendly letter with a boxed card listing role, deadline and what to mention.", doc("d-letter lh-rule sheet",
  row("r-masthead", [mast("Jordan Hayes")], [right("jordan.hayes@mail.com"), right("5 May 2026")]),
  p("Dear Dr Whitlock,"),
  p("I hope term is going well. I am applying for the Policy Fellowship at the Institute for Government, and wondered whether you would be willing to act as a referee."),
  p("You supervised my dissertation on housing policy and know my research better than anyone, so a reference from you would mean a great deal."),
  panel(lbl("Everything you need"), grid([["Role", "Policy Fellow, Institute for Government"], ["Deadline", "Friday 23 May"], ["Format", "Online form, about 15 minutes"], ["Worth mentioning", "My dissertation and the select committee briefing"]], { plain: true })),
  p("I have attached my CV and the role description. Please do say if you would rather not, or if timing is difficult. I completely understand."),
  p("With thanks,"), p("**Jordan Hayes**"),
));

/* ======================================================= PLANNING AND LIFE (7) */
const okrDb = db("Key results", [title("Key result"), select("Objective", ["Launch", "Grow", "Learn"]), number("Start"), number("Target"), number("Now"), select("Confidence", ["On track", "At risk", "Off track"])], [
  { "Key result": "Ship the public beta to 500 users", Objective: "Launch", Start: 0, Target: 500, Now: 210, Confidence: "On track" },
  { "Key result": "Raise weekly active users from 1,200 to 2,000", Objective: "Grow", Start: 1200, Target: 2000, Now: 1380, Confidence: "At risk" },
  { "Key result": "Complete 12 customer interviews", Objective: "Learn", Start: 0, Target: 12, Now: 9, Confidence: "On track" },
], [{ name: "By confidence", type: "board", group: "Confidence" }, { name: "Table", type: "table" }]);
add(PLAN, "okr-planner", "OKR Scorecard", "A quarterly scorecard: three objective cards, live key results by confidence, and a weekly check-in rhythm.", "d-dash slate", "Three objective cards with progress, a live key-results board and a weekly check-in table.", doc("d-dash slate",
  kicker("Product team · Q2 2026"), h1("OKR scorecard"),
  cards([lbl("Objective 1"), h3("Launch a beta people love"), mono("●●●●○○○○○○  42%")], [lbl("Objective 2"), h3("Grow weekly habit"), mono("●●○○○○○○○○  23%")], [lbl("Objective 3"), h3("Learn from customers"), mono("●●●●●●●○○○  75%")]),
  database(0),
  h2("Weekly check-in"), grid([["Week", "Progress", "Blocker", "Next", "Confidence"], ["14 Apr", "Beta invites sent to first 200", "Onboarding email bugs", "Fix and resend", "On track"], ["21 Apr", "Nine interviews done", "None", "Synthesise themes", "On track"]]),
), [okrDb]);

add(PLAN, "sprint-retrospective", "Sprint Retrospective", "A team retro board: mood, what to start, stop and continue, kudos, and only the actions that matter.", "d-board", "A four-column wall of cards for Start, Stop, Continue and Kudos above a short action list.", doc("d-board",
  kicker("Payments squad · Sprint 42 · 3–14 March"), h1("Sprint retrospective"), kpi(["34 / 38", "points delivered"], ["4.1 / 5", "team mood"], ["2", "incidents"]),
  row("r-wall",
    [lbl("Start"), p("Writing the release note before the PR"), p("Pairing on risky migrations")],
    [lbl("Stop"), p("Last-minute scope in week two"), p("Reviews that wait more than a day")],
    [lbl("Continue"), p("Friday demo with support"), p("Small PRs behind flags")],
    [lbl("Kudos"), p("Amira for the 2 am rollback"), p("Ben for the test-suite speed-up")]),
  h2("Actions from this retro"), grid([["Action", "Owner", "Due", "Done?"], ["Add 24-hour review reminder bot", "Ben", "21 Mar", ""], ["Freeze scope from day six", "Amira", "Next sprint", ""]]),
));

add(PLAN, "home-move-checklist", "Moving Home Planner", "A countdown from eight weeks to moving day, with who to tell, meter readings and costs.", "d-board", "A five-stage countdown wall from eight weeks out to moving day, with address-change and cost tables below.", doc("d-board",
  kicker("Moving day · Saturday 27 June"), h1("Moving to 12 Ashfield Road"), kpi(["58", "days to go"], ["£2,480", "budget"], ["9 / 26", "tasks done"]),
  row("r-wall",
    [lbl("8 weeks"), ...tasks([["Book removals", true], ["Give notice", true], "Declutter loft"])],
    [lbl("4 weeks"), ...tasks(["Order boxes", "Book cleaner", "Transfer broadband"])],
    [lbl("2 weeks"), ...tasks(["Redirect post", "Confirm utilities", "Use up freezer"])],
    [lbl("1 week"), ...tasks(["Pack essentials box", "Defrost freezer", "Label rooms"])],
    [lbl("The day"), ...tasks(["Meter readings", "Photograph rooms", "Hand over keys"])]),
  split(
    [h2("Who to tell"), grid([["Who", "Told", "Reference"], ["Bank and cards", "Yes", "—"], ["Employer", "Yes", "HR-219"], ["GP and dentist", "", ""], ["Council tax", "", ""], ["DVLA", "", ""]])],
    [h2("Costs"), grid([["Item", "Quote", "Paid"], ["Removals", "£980", "£200"], ["Cleaning", "£220", ""], ["Boxes", "£80", "£80"], ["Total", "£1,280", "£280"]], { style: "t-total" })]),
));

const eventDb = db("Tasks", [title("Task"), select("Area", ["Venue", "Guests", "Food", "Budget"]), select("Status", ["To do", "Doing", "Done"]), date("Due"), number("Cost")], [
  { Task: "Book the venue", Area: "Venue", Status: "Done", Due: day(-10), Cost: 800 },
  { Task: "Send invitations", Area: "Guests", Status: "Doing", Due: day(5), Cost: 60 },
  { Task: "Choose menu, confirm numbers", Area: "Food", Status: "To do", Due: day(14), Cost: 600 },
  { Task: "Agree playlist and equipment", Area: "Venue", Status: "To do", Due: day(21), Cost: 150 },
], [{ name: "Board", type: "board", group: "Status" }, { name: "Calendar", type: "calendar", date: "Due" }, { name: "Table", type: "table" }]);
add(PLAN, "event-planner", "Event Planner", "Plan a party or gathering in one place: headline figures, a live task board, guest list and day-of timeline.", "d-dash poster", "A figures strip above a live task board, with guest list and day-of timeline side by side.", doc("d-dash poster",
  kicker("Saturday 12 July · The Old Barn, Ilkley"), h1("Mum's 60th birthday"), kpi(["62", "guests invited"], ["£1,610", "of £2,000 budget"], ["41", "RSVPs in"], ["35", "days to go"]),
  database(0),
  split(
    [h2("Guest list"), grid([["Name", "RSVP", "Dietary"], ["Aunt Jo + 2", "Yes", "Vegetarian"], ["The Harrisons", "Yes", "—"], ["Dev and Kim", "Maybe", "Nut allergy"]])],
    [h2("On the day"), dated("14:00", p("Setup and deliveries")), dated("17:00", p("Guests arrive")), dated("19:00", p("Dinner and speeches")), dated("23:00", p("Wrap up"))]),
), [eventDb]);

add(PLAN, "podcast-episode-planner", "Podcast Episode Rundown", "A producer's rundown: hook, timed segments, guest questions, recording checklist and show notes.", "d-cue", "An episode header with a hook panel, timed segment rows, then questions beside the recording checklist.", doc("d-cue",
  kicker("The Long View · Episode 47"), h1("Why cities are getting quieter"), facts(["Guest", "Dr Ines Moreau, urban acoustics"], ["Record", "Tue 3 June, 10 am"], ["Publish", "Mon 16 June"], ["Length", "38 minutes"]),
  panel(lbl("The hook"), lead("Electric buses changed what a city sounds like, and it is changing how we sleep.")),
  dated("00:00", h3("Cold open"), p("Ninety seconds of Lyon before and after, then the question.")),
  dated("02:00", h3("Who and why now"), p("Ines's measurements across 12 cities.")),
  dated("08:00", h3("The sleep data"), p("Night-time noise fell 6 dB. What that did to health.")),
  dated("24:00", h3("Who loses"), p("Quiet streets and property prices.")),
  dated("35:00", h3("Close"), p("What one listener can do, and next week's episode.")),
  split([h2("Questions"), ...steps(["What first made you listen to cities?", "What surprised you most in the Lyon data?", "Tell me about a street that changed."])], [h2("Recording checklist"), ...tasks(["Test levels", "Send guest questions", "Record room tone", "Back up immediately"])]),
));

add(PLAN, "gratitude-journal", "Gratitude Journal", "A quiet journal page: three lines today, a week of moods, and a prompt for when the words will not come.", "d-paper sheet", "A ruled-paper journal page with a serif date, three lines and a small mood week.", doc("d-paper sheet",
  kicker("Sunday 8 March"), h1("Three good things"),
  ...steps(["The first warm morning. Coffee on the step before anyone was up.", "Dad rang for no reason, and we talked for an hour.", "Finished the hard chapter. It was not as bad as I feared."]),
  h2("One small win"), p("Went for the walk even though it was raining."),
  h2("Who made today easier?"), p("Sam, who took the bins out without being asked. Tell him."),
  row("r-week", [lbl("Mon"), p("Calm")], [lbl("Tue"), p("Tired")], [lbl("Wed"), p("Good")], [lbl("Thu"), p("Busy")], [lbl("Fri"), p("Bright")], [lbl("Sat"), p("Slow")], [lbl("Sun"), p("Warm")]),
));

const readDb = db("Reading challenge", [title("Book"), text("Author"), select("Status", ["Want to read", "Reading", "Finished"]), number("Rating"), date("Finished on")], [
  { Book: "The Remains of the Day", Author: "Kazuo Ishiguro", Status: "Finished", Rating: 5, "Finished on": day(-14) },
  { Book: "Piranesi", Author: "Susanna Clarke", Status: "Finished", Rating: 4, "Finished on": day(-40) },
  { Book: "Sapiens", Author: "Yuval Noah Harari", Status: "Reading" },
  { Book: "Middlemarch", Author: "George Eliot", Status: "Want to read" },
  { Book: "The Overstory", Author: "Richard Powers", Status: "Want to read" },
], [{ name: "Shelf", type: "gallery" }, { name: "By status", type: "board", group: "Status" }, { name: "Table", type: "table" }]);
add(PLAN, "reading-challenge", "Reading Challenge", "A year of reading on one page: goal figures, a live bookshelf, pace by quarter and the ideas worth keeping.", "d-dash", "Dark figures banner, a live gallery shelf of books, then pace and favourite ideas side by side.", doc("d-dash shelf",
  kicker("2026 reading challenge"), h1("Twenty-four books"), kpi(["9", "finished"], ["24", "goal"], ["20", "pages a day"], ["4.3", "average rating"]),
  database(0),
  split([h2("Pace"), grid([["Quarter", "Target", "Read"], ["Jan – Mar", "6", "7"], ["Apr – Jun", "12", "9"], ["Jul – Sep", "18", ""], ["Oct – Dec", "24", ""]])], [h2("Worth keeping"), ...bullets(["*The Remains of the Day:* dignity can be its own trap", "*Piranesi:* attention is a kind of love"])]),
), [readDb]);

/* ================================================================= LISTS (7) */
/* A list row: a number in the margin, the item, and where it stands. */
const item = (n, name, detail, state) => row("r-num", big(n), [h3(name), small(detail)], right(state));

add(LISTS, "grocery-list", "Grocery List", "A weekly shop sorted by aisle, with quantities, the meals it feeds and a running spend.", "d-aisle", "Checklists grouped into aisle cards across the page, a seven-day meal strip, and a spend table with a total.", doc("d-aisle",
  kicker("Week of 9 November · Big shop"), h1("Grocery list"), facts(["Store", "Riverside Market"], ["Budget", "£85"], ["Meals planned", "7 dinners"], ["Shop on", "Saturday morning"]),
  row("r-aisle",
    [lbl("Produce"), ...tasks([["Bananas · 6", true], "Spinach · 2 bags", "Lemons · 3", "Sweet potatoes · 4", "Garlic · 1 bulb"])],
    [lbl("Dairy & eggs"), ...tasks([["Eggs · 12", true], "Greek yoghurt · 500 g", "Feta · 200 g", "Oat milk · 2 L"])],
    [lbl("Pantry"), ...tasks(["Chickpeas · 2 tins", "Basmati rice · 1 kg", "Coconut milk · 2 tins", "Chilli flakes"])],
    [lbl("Freezer & home"), ...tasks(["Frozen peas", "Washing-up liquid", "Bin bags", "Kitchen roll"])]),
  h2("What it feeds"),
  row("r-week", [lbl("Sat"), p("Shakshuka")], [lbl("Sun"), p("Roast veg and feta")], [lbl("Mon"), p("Chickpea curry")], [lbl("Tue"), p("Leftover curry")], [lbl("Wed"), p("Lemon pasta")], [lbl("Thu"), p("Sweet potato tacos")], [lbl("Fri"), p("Eat out")]),
  split([h2("Spend"), grid([["Section", "Estimate"], ["Produce", "£18.40"], ["Dairy & eggs", "£14.20"], ["Pantry", "£12.60"], ["Freezer & home", "£11.80"], ["Total", "£57.00"]], { style: "t-total" })], [h2("Already in the cupboard"), ...bullets(["Olive oil, half a bottle", "Pasta, two packs", "Tinned tomatoes, four"])]),
));

add(LISTS, "packing-list", "Packing List", "A trip packing list split by bag, with the weather, documents, and the last-minute checks by the door.", "d-tags", "Bag cards with dark tag headers, a trip strip with the weather, and a by-the-door checklist.", doc("d-tags",
  kicker("Lisbon · 14–19 March · 5 nights"), h1("Packing list"), kpi(["22°C", "daytime, sunny"], ["1", "carry-on bag"], ["7 kg", "weight limit"], ["06:40", "flight, Gatwick"]),
  row("r-aisle",
    [lbl("Clothes"), ...tasks([["T-shirts · 4", true], ["Linen shirt", true], "Shorts · 2", "Light jacket", "Walking shoes", "Swimwear"])],
    [lbl("Wash bag"), ...tasks(["Toothbrush and paste", "Sunscreen, under 100 ml", "Razor", "Medication", "Glasses"])],
    [lbl("Tech"), ...tasks(["Phone and charger", "EU plug adapter", "Headphones", "Power bank, in hand luggage"])],
    [lbl("Documents"), ...tasks([["Passport", true], "Boarding pass on phone", "Travel insurance PDF", "Bank card and €50"])]),
  split([h2("By the door"), ...tasks(["Heating down", "Windows locked", "Plants watered", "Bins out", "Keys with Sam"])], [h2("Don't forget"), panel(p("Book the airport train before Thursday. Download offline maps of Lisbon and Sintra."))]),
));

add(LISTS, "gift-list", "Gift List", "Everyone you're buying for, with ideas, budget, where to buy and what's already wrapped.", "d-gift sheet", "A gift ledger with budget totals, then a bank of ideas saved for later as small cards.", doc("d-gift sheet",
  row("r-masthead", [mast("Christmas gifts")], [right("Budget £420"), right("Shop by 18 December")]),
  kpi(["6", "people"], ["£243", "of £420 budget"], ["4", "sorted"], ["2", "still to buy"]),
  grid([["Who", "Idea", "Where", "Status", "Budget"], ["Mum", "Pottery class for two", "Clay Studio", "Booked", "£80"], ["Dad", "Walking poles", "Cotswold", "Bought", "£45"], ["Ellie", "Watercolour set", "Cass Art", "Wrapped", "£35"], ["Sam", "Vinyl: Blue, Joni Mitchell", "Rough Trade", "To buy", "£28"], ["Gran", "Framed family photo", "Online", "Ordered", "£40"], ["Secret Santa", "Hot sauce trio", "Market", "To buy", "£15"], ["Total", "", "", "", "£243"]], { style: "t-total" }),
  h2("Ideas for later"),
  cards([lbl("Ellie · birthday"), p("The ceramics book she mentioned, Hand Made.")], [lbl("Sam · anniversary"), p("Weekend in Bath, the place with the roof pool.")], [lbl("Dad · retirement"), p("Ask his team to write letters for an album.")]),
));

const mediaDb = db("Watch and read", [title("Title"), select("Type", ["Film", "Series", "Book", "Podcast"]), select("Status", ["Up next", "In progress", "Finished"]), text("Why"), number("Rating")], [
  { Title: "Past Lives", Type: "Film", Status: "Finished", Why: "Recommended by Priya", Rating: 5 },
  { Title: "Slow Horses", Type: "Series", Status: "In progress", Why: "Season 3 is out" },
  { Title: "Tomorrow, and Tomorrow, and Tomorrow", Type: "Book", Status: "Up next", Why: "Book club, December" },
  { Title: "The Rest Is History", Type: "Podcast", Status: "In progress", Why: "The Titanic series" },
  { Title: "Perfect Days", Type: "Film", Status: "Up next", Why: "Wim Wenders, Tokyo" },
], [{ name: "Queue", type: "board", group: "Status" }, { name: "Shelf", type: "gallery" }, { name: "All", type: "table" }]);
add(LISTS, "watch-read-list", "Watch & Read List", "Films, series, books and podcasts in one queue you can drag from up next to finished.", "d-queue", "A slim header with counts by type, then a live board of everything up next, in progress and finished.", doc("d-queue",
  kicker("The queue"), h1("Watch & read"), row("r-chips", p("Films · 2"), p("Series · 1"), p("Books · 1"), p("Podcasts · 1")),
  database(0),
  panel(lbl("Rule of thumb"), p("If it's been up next for three months, delete it. Something better is already waiting.")),
), [mediaDb]);

add(LISTS, "bucket-list", "Bucket List", "A life list with big numbers, the reason behind each one, and the year it finally happened.", "d-bucket sheet", "Large serif numerals down the margin, each item with its reason, and its status set on the right.", doc("d-bucket sheet",
  kicker("Things to do while I can"), h1("Bucket list"),
  item("01", "See the northern lights", "Tromsø in February, with a proper camera this time.", "Done · 2024"),
  item("02", "Run a marathon", "Training plan starts in January. Target: under 4 hours.", "Training"),
  item("03", "Learn to sail", "RYA Competent Crew, five days on the Solent.", "Booked"),
  item("04", "Cook every recipe in Jerusalem", "Twelve down, 108 to go.", "12 of 120"),
  item("05", "Walk the Camino de Santiago", "The Portuguese route from Porto. Two weeks.", "Someday"),
  item("06", "Write letters to my nieces", "To open when they turn eighteen.", "Started"),
));

add(LISTS, "pros-cons-list", "Pros & Cons", "A decision list with weighted pros and cons, a running score and the call you made.", "d-decide", "The question across the top, weighted pros and cons facing each other, scores below and a dark verdict band.", doc("d-decide",
  kicker("Decision · by Friday 21 November"), h1("Should I take the Manchester job?"),
  row("r-versus",
    [lbl("Pros"), mono("+3  £12k more salary"), mono("+3  Leading a team of six"), mono("+2  Cheaper rent, bigger flat"), mono("+1  Closer to family")],
    [lbl("Cons"), mono("−3  Leaving friends in London"), mono("−2  Partner's job is remote, but unsettled"), mono("−1  New city, no network"), mono("−1  Six-month probation")]),
  kpi(["+9", "pros"], ["−7", "cons"], ["+2", "net score"]),
  panel(lbl("The call"), lead("Take it, on a one-year test. Revisit next October.")),
  h2("Before deciding"), ...tasks([["Ask about hybrid working", true], "Visit for a weekend", "Talk it through with Jo"]),
));

add(LISTS, "daily-todo", "Today", "A one-day list: the three things that matter, everything else below, and the day blocked out in time.", "d-today", "A date masthead, three large numbered priority cards, then the rest of the list beside a time-blocked day.", doc("d-today",
  row("r-masthead", [mast("Tuesday")], [right("11 November"), right("Week 46")]),
  row("r-top", [big("1"), h3("Send the Q4 budget to Rachel"), small("Due 12:00 · 1 hour")], [big("2"), h3("Draft the onboarding email"), small("Focus block · 90 min")], [big("3"), h3("Call the dentist"), small("Five minutes, do it first")]),
  split(
    [h2("Everything else"), ...tasks([["Reply to Ben about Friday", true], ["Order printer ink", true], "Review Amira's PR", "Book train to Leeds", "Pick up dry cleaning", "30-minute walk"])],
    [h2("The day"), dated("08:30", p("Dentist call, then inbox")), dated("09:00", p("Budget, no meetings")), dated("12:30", p("Lunch away from the desk")), dated("14:00", p("Onboarding email draft")), dated("16:30", p("Wrap up and plan tomorrow"))]),
));

export const TEMPLATE_LIBRARY_V3 = T;
