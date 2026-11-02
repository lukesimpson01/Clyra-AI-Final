/* Life: reviews, habits, money, health, travel and home. */
import {
  template, h2, h3, p, li, num, todo, quote, divider, callout, toggle, columns, table, section, grid, todos, bullets, how, facts, checklist,
  select, status, prop, multi, day,
} from "./template-kit.js";

export const LIFE = [
  template({
    id: "weekly-review", name: "Weekly review", emoji: "🔄", group: "Life", subject: "Planning",
    desc: "Close the week, clear your head and decide what the next one is for.",
    blocks: () => [
      callout("🔄", "Twenty minutes, same time every week. The review is what makes the rest of your system trustworthy.", "blue"),
      facts(["Week of", ""], ["Energy 1–5", ""], ["Mood 1–5", ""]),
      columns([section("🏆", "Wins"), ...bullets(3)], [section("🧗", "Hard parts"), ...bullets(3)], [section("📚", "Learned"), ...bullets(3)]),
      section("🧹", "Clear the decks"), ...todos(4, ["Empty the inbox", "Process loose notes", "Check the calendar for next week", "Tidy the desk"]),
      section("🎯", "Next week"), columns([h3("Top 3 outcomes"), num(""), num(""), num("")], [h3("Commitments"), ...bullets(3)]),
      section("🌱", "One thing for me"), p(""),
    ],
  }),
  template({
    id: "daily-journal", name: "Daily journal", emoji: "📔", group: "Life", subject: "Wellbeing",
    desc: "A short evening page: what happened, how you felt, and what you are grateful for.",
    blocks: () => [
      callout("📔", "Three honest lines beat a perfect page you never write. Date it and move on.", "yellow"),
      facts(["Date", ""], ["Mood", ""], ["Sleep", ""]),
      section("🌅", "Today"), p(""),
      section("🙏", "Grateful for"), num(""), num(""), num(""),
      section("🧠", "On my mind"), p(""),
      section("🚀", "Tomorrow"), ...todos(3),
      toggle("Prompts for a slow day", [li("What made me smile?"), li("What did I avoid, and why?"), li("What do I want more of?")]),
    ],
  }),
  template({
    id: "habit-tracker", name: "Habit tracker", emoji: "✅", group: "Life", subject: "Wellbeing",
    desc: "Tick off habits each day and see a week at a glance.",
    database: {
      name: "Habit tracker",
      properties: [prop("Habit", "title"), prop("Mon", "checkbox"), prop("Tue", "checkbox"), prop("Wed", "checkbox"), prop("Thu", "checkbox"), prop("Fri", "checkbox"), prop("Sat", "checkbox"), prop("Sun", "checkbox"), select("Area", ["Health", "Mind", "Work", "Home"])],
      records: [
        { Habit: "Drink 2 litres of water", Mon: true, Tue: true, Wed: true, Thu: false, Fri: true, Sat: false, Sun: false, Area: "Health" },
        { Habit: "Read for 20 minutes", Mon: true, Tue: false, Wed: true, Thu: true, Fri: false, Sat: true, Sun: false, Area: "Mind" },
        { Habit: "Walk outside", Mon: false, Tue: true, Wed: true, Thu: true, Fri: true, Sat: true, Sun: true, Area: "Health" },
        { Habit: "Plan tomorrow", Mon: true, Tue: true, Wed: false, Thu: false, Fri: false, Sat: false, Sun: false, Area: "Work" },
      ],
      views: [{ name: "This week", type: "table" }, { name: "By area", type: "board", group: "Area" }],
      first: "This week",
    },
  }),
  template({
    id: "monthly-budget", name: "Monthly budget", emoji: "💰", group: "Life", subject: "Money",
    desc: "Planned against actual for every line, with income and spending kept separate.",
    database: {
      name: "Monthly budget",
      properties: [prop("Item", "title"), select("Type", ["Income", "Fixed", "Variable", "Savings"]), prop("Planned", "number"), prop("Actual", "number"), prop("Date", "date"), prop("Notes", "text")],
      records: [
        { Item: "Salary", Type: "Income", Planned: 3200, Actual: 3200, Date: day(-10) },
        { Item: "Rent", Type: "Fixed", Planned: 1100, Actual: 1100, Date: day(-9) },
        { Item: "Groceries", Type: "Variable", Planned: 400, Actual: 352, Date: day(-2) },
        { Item: "Transport", Type: "Variable", Planned: 120, Actual: 138, Date: day(-4) },
        { Item: "Emergency fund", Type: "Savings", Planned: 300, Actual: 300, Date: day(-8) },
      ],
      views: [{ name: "Table", type: "table" }, { name: "By type", type: "board", group: "Type" }],
      first: "Table",
    },
  }),
  template({
    id: "trip-planner", name: "Trip planner", emoji: "✈️", group: "Life", subject: "Travel",
    desc: "Flights, stays, day-by-day plans and a packing list in one page.",
    blocks: () => [
      callout("✈️", "Book the big things first (flights, the place to sleep), then fill the days with **one** anchor each and leave the rest open.", "blue"),
      facts(["Where", ""], ["Dates", ""], ["Travellers", ""], ["Budget", ""]),
      section("🎟️", "Bookings"), grid(["What", "Where / ref", "Date", "Cost", "Booked"], 4, { tint: "blue", align: ["left", "left", "center", "right", "center"] }),
      section("🗓️", "Itinerary"), toggle("Day 1", [p("Morning · Afternoon · Evening")]), toggle("Day 2", [p("")]), toggle("Day 3", [p("")]),
      columns([section("🍜", "Food to try"), ...bullets(3)], [section("📍", "Places to see"), ...bullets(3)]),
      section("🧳", "Packing"), checklist("Before you leave", ["Passport and tickets", "Insurance", "Chargers and adapters", "Medication", "Home sorted"]),
    ],
  }),
  template({
    id: "meal-planner", name: "Meal planner", emoji: "🥗", group: "Life", subject: "Food",
    desc: "A week of meals and the shopping list that goes with it.",
    blocks: () => [
      callout("🥗", "Plan dinners first, then fill lunches with leftovers. Write the shopping list from the plan, not from memory.", "green"),
      table([["Day", "Breakfast", "Lunch", "Dinner"], ["Mon", "", "", ""], ["Tue", "", "", ""], ["Wed", "", "", ""], ["Thu", "", "", ""], ["Fri", "", "", ""], ["Sat", "", "", ""], ["Sun", "", "", ""]], { tint: "green" }),
      columns([section("🛒", "Shopping list"), ...todos(6)], [section("🧊", "Already have"), ...bullets(3)]),
      toggle("Favourite quick dinners", bullets(3)),
    ],
  }),
  template({
    id: "workout-log", name: "Workout log", emoji: "🏋️", group: "Life", subject: "Health",
    desc: "Exercises, sets and weights logged by date, so progress is something you can see.",
    database: {
      name: "Workout log",
      properties: [prop("Exercise", "title"), prop("Date", "date"), select("Type", ["Strength", "Cardio", "Mobility"]), prop("Sets", "number"), prop("Reps", "number"), prop("Weight kg", "number"), prop("Notes", "text")],
      records: [
        { Exercise: "Back squat", Date: day(-6), Type: "Strength", Sets: 4, Reps: 6, "Weight kg": 80 },
        { Exercise: "Bench press", Date: day(-4), Type: "Strength", Sets: 4, Reps: 8, "Weight kg": 60 },
        { Exercise: "5 km run", Date: day(-3), Type: "Cardio", Notes: "Easy pace" },
        { Exercise: "Deadlift", Date: day(-1), Type: "Strength", Sets: 3, Reps: 5, "Weight kg": 100 },
      ],
      views: [{ name: "Log", type: "table", sort: "Date" }, { name: "Calendar", type: "calendar", date: "Date" }],
      first: "Log",
    },
  }),
  template({
    id: "recipe-book", name: "Recipe collection", emoji: "🍳", group: "Life", subject: "Food",
    desc: "A gallery of the recipes you actually cook, with time, servings and rating.",
    database: {
      name: "Recipes",
      properties: [prop("Recipe", "title"), select("Meal", ["Breakfast", "Lunch", "Dinner", "Dessert", "Snack"]), prop("Time (min)", "number"), prop("Serves", "number"), select("Rating", ["★★★★★", "★★★★", "★★★"]), prop("Ingredients", "text"), prop("Method", "text")],
      records: [
        { Recipe: "One-pan lemon chicken", Meal: "Dinner", "Time (min)": 40, Serves: 4, Rating: "★★★★★", Ingredients: "Chicken thighs, lemon, garlic, potatoes, thyme", Method: "Roast at 200°C for 35 minutes." },
        { Recipe: "Overnight oats", Meal: "Breakfast", "Time (min)": 5, Serves: 1, Rating: "★★★★", Ingredients: "Oats, milk, yoghurt, berries", Method: "Mix, chill overnight." },
        { Recipe: "Tomato soup", Meal: "Lunch", "Time (min)": 30, Serves: 4, Rating: "★★★★", Ingredients: "Tomatoes, onion, stock, basil", Method: "Simmer, blend." },
      ],
      views: [{ name: "Gallery", type: "gallery" }, { name: "Table", type: "table" }, { name: "By meal", type: "board", group: "Meal" }],
      first: "Gallery",
    },
  }),
  template({
    id: "reading-list", name: "Reading list", emoji: "📚", group: "Life", subject: "Learning",
    desc: "What you are reading, what is next and what you thought of it.",
    database: {
      name: "Reading list",
      properties: [prop("Title", "title"), status("Status", ["To read", "Reading", "Finished"]), prop("Author", "text"), select("Genre", ["Fiction", "Non-fiction", "Science", "Biography"]), select("Rating", ["★★★★★", "★★★★", "★★★"]), prop("Takeaway", "text")],
      records: [
        { Title: "Atomic Habits", Status: "Finished", Author: "James Clear", Genre: "Non-fiction", Rating: "★★★★★", Takeaway: "Change identity, not just outcomes" },
        { Title: "The Remains of the Day", Status: "Reading", Author: "Kazuo Ishiguro", Genre: "Fiction" },
        { Title: "Cosmos", Status: "To read", Author: "Carl Sagan", Genre: "Science" },
      ],
      views: [{ name: "Board", type: "board", group: "Status" }, { name: "Table", type: "table" }, { name: "Shelf", type: "gallery" }],
      first: "Board",
    },
  }),
  template({
    id: "watchlist", name: "Watchlist", emoji: "🎬", group: "Life", subject: "Entertainment",
    desc: "Films and shows to watch, in progress and finished, with where to stream them.",
    database: {
      name: "Watchlist",
      properties: [prop("Title", "title"), status("Status", ["Want to watch", "Watching", "Watched"]), select("Type", ["Film", "Series", "Documentary"]), prop("Where", "text"), select("Rating", ["★★★★★", "★★★★", "★★★"]), prop("Notes", "text")],
      records: [
        { Title: "Arrival", Status: "Watched", Type: "Film", Where: "Streaming", Rating: "★★★★★", Notes: "Think about the ending for days" },
        { Title: "Planet Earth III", Status: "Watching", Type: "Documentary", Where: "iPlayer" },
        { Title: "Severance", Status: "Want to watch", Type: "Series", Where: "Apple TV+" },
      ],
      views: [{ name: "Gallery", type: "gallery" }, { name: "Board", type: "board", group: "Status" }, { name: "Table", type: "table" }],
      first: "Gallery",
    },
  }),
  template({
    id: "goal-setting", name: "Goal setting", emoji: "🧭", group: "Life", subject: "Planning",
    desc: "A year in a few goals, each broken into the next actions that move it.",
    blocks: () => [
      callout("🧭", "Pick **three**. Each needs a reason that is yours, a measure, and a first step you can take this week.", "purple"),
      facts(["Year", ""], ["Theme", ""]),
      section("🎯", "Goals"), grid(["Goal", "Why it matters", "Measure", "By when"], 3, { tint: "purple" }),
      section("🪜", "First steps"), ...todos(5),
      section("🔭", "Quarterly check-ins"), grid(["Quarter", "Progress", "Adjust"], 4, { tint: "purple", fill: [["Q1", "Q2", "Q3", "Q4"]] }),
      section("🚧", "What might get in the way"), ...bullets(3),
      quote("What would I regret not having tried?"),
    ],
  }),
  template({
    id: "moving-checklist", name: "Moving checklist", emoji: "📦", group: "Life", subject: "Home",
    desc: "Everything to do before, during and after a move.",
    blocks: () => [
      callout("📦", "Do the **admin** early (notice, address changes, internet) and pack the things you use least first.", "orange"),
      columns([section("8️⃣", "Eight weeks out"), ...todos(4, ["Give notice", "Book movers or a van", "Start decluttering", "Get quotes"])], [section("2️⃣", "Two weeks out"), ...todos(4, ["Pack non-essentials", "Redirect mail", "Update your address", "Book internet"])], [section("🚚", "Moving day"), ...todos(4, ["Meter readings", "Final walk-through", "Keys handed over", "Essentials box"])]),
      section("🏠", "After the move"), checklist("Settle in", ["Unpack the essentials first", "Test smoke alarms", "Register with local services", "Say hello to the neighbours"]),
      section("💸", "Costs"), grid(["Item", "Cost", "Paid"], 4, { tint: "orange", align: ["left", "right", "center"] }),
    ],
  }),
  template({
    id: "event-planner", name: "Event planner", emoji: "🎉", group: "Life", subject: "Events",
    desc: "A party, wedding or reunion: guests, budget, tasks and the day's timeline.",
    blocks: () => [
      callout("🎉", "Decide the **date, headcount and budget** first. Everything else follows from those three.", "pink"),
      facts(["Event", ""], ["Date", ""], ["Venue", ""], ["Guests", ""], ["Budget", ""]),
      section("🧑‍🤝‍🧑", "Guest list"), grid(["Name", "Invited", "RSVP", "Dietary", "Plus one"], 6, { tint: "pink", align: ["left", "center", "center", "left", "center"] }),
      section("✅", "Tasks"), ...todos(6, ["Book the venue", "Send invitations", "Order the cake", "Arrange music"]),
      section("💷", "Budget"), grid(["Item", "Estimate", "Actual", "Paid"], 5, { tint: "pink", align: ["left", "right", "right", "center"] }),
      section("⏱️", "Timeline for the day"), grid(["Time", "What", "Who"], 5, { tint: "pink", align: ["center", "left", "left"] }),
    ],
  }),
  template({
    id: "personal-wiki", name: "Personal wiki", emoji: "🧠", group: "Life", subject: "Knowledge",
    desc: "A home page for everything you want to remember, linked from one place.",
    blocks: () => [
      callout("🧠", "Make this your **start page**. Link to the pages you open most, and add a line about each so future you remembers why.", "gray"),
      columns([h3("📥 Inbox"), li("Quick captures to sort later")], [h3("🎯 Projects"), li("Things with an end")], [h3("🌿 Areas"), li("Things you maintain")], [h3("🗄️ Archive"), li("Done and kept")]),
      section("⭐", "Pinned"), ...bullets(4),
      section("📖", "Reference"), grid(["Topic", "Page", "Why I keep it"], 4, { tint: "gray" }),
      section("💭", "Ideas"), ...bullets(3),
    ],
  }),
  template({
    id: "daily-planner", name: "Daily planner", emoji: "☀️", group: "Life", subject: "Planning",
    desc: "Top three priorities, a time-blocked day and an end-of-day shutdown.",
    blocks: () => [
      callout("☀️", "Choose **three** things that would make today a good day. Everything else is a bonus.", "yellow"),
      facts(["Date", ""], ["Energy 1–5", ""], ["Weather", ""]),
      columns([section("🎯", "Top three"), num(""), num(""), num("")], [section("📌", "Also today"), ...todos(4)]),
      section("⏱️", "Time blocks"), table([["Time", "Plan", "Done"], ["8:00", "", ""], ["9:00", "", ""], ["10:00", "", ""], ["11:00", "", ""], ["12:00", "Lunch", ""], ["1:00", "", ""], ["2:00", "", ""], ["3:00", "", ""], ["4:00", "", ""]], { tint: "yellow", align: ["center", "left", "center"] }),
      section("💧", "Look after me"), checklist("Today", ["Water", "Move", "Eat properly", "Offline time"]),
      section("🌙", "Shutdown"), columns([h3("Done today"), ...bullets(2)], [h3("Tomorrow's first step"), p("")]),
    ],
  }),
];
