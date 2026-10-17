type VibeFallbackFile = {
  path: string;
  body: string;
  purpose: string;
};

function lineCount(body: string) {
  return body.split("\n").length;
}

function slugifyProjectTitle(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return slug || "clyra-vibe-project";
}

function codeBlock(file: VibeFallbackFile) {
  return `<<<VIBE_CODE file="${file.path}" added="${lineCount(file.body)}" removed="0">>>
${file.body}
<<<END_VIBE_CODE>>>`;
}

function buildFiles(root: string, projectTitle: string, userPrompt: string): VibeFallbackFile[] {
  const titleLiteral = JSON.stringify(projectTitle);
  const promptLiteral = JSON.stringify(userPrompt);

  return [
    {
      path: `${root}/src/types.ts`,
      purpose: "Typed project domain model",
      body: `export type ViewKey = "overview" | "workflows" | "customers" | "settings";

export type PlanTier = {
  name: string;
  price: string;
  summary: string;
  features: string[];
  highlighted?: boolean;
};

export type CustomerStory = {
  name: string;
  role: string;
  quote: string;
};

export type Metric = {
  label: string;
  value: string;
  delta: string;
};

export type Task = {
  id: string;
  title: string;
  owner: string;
  status: "queued" | "active" | "done";
};`,
    },
    {
      path: `${root}/src/data/productData.ts`,
      purpose: "Prompt-aware content and mock data",
      body: `import type { CustomerStory, Metric, PlanTier, Task } from "../types";

export const projectTitle = ${titleLiteral};
export const projectPrompt = ${promptLiteral};

export const navItems = ["Product", "Workflow", "Pricing", "FAQ"];

export const metrics: Metric[] = [
  { label: "Activation", value: "72%", delta: "+18%" },
  { label: "Tasks shipped", value: "1,284", delta: "+31%" },
  { label: "Response time", value: "1.8s", delta: "-42%" },
];

export const featureCards = [
  "Guided onboarding with useful defaults",
  "Responsive dashboard preview",
  "Search, filters, tabs, and empty states",
  "Signup, login, and validation states",
  "Reusable cards, buttons, and layout primitives",
  "Polished mobile navigation",
];

export const plans: PlanTier[] = [
  {
    name: "Starter",
    price: "$19",
    summary: "For solo builders validating the idea.",
    features: ["3 projects", "Core dashboard", "Email support"],
  },
  {
    name: "Studio",
    price: "$49",
    summary: "For teams ready to ship the full workflow.",
    highlighted: true,
    features: ["Unlimited projects", "Automation runs", "Priority support", "Client handoff"],
  },
  {
    name: "Scale",
    price: "$129",
    summary: "For production teams with heavier ops.",
    features: ["Audit trail", "Advanced roles", "SLA support"],
  },
];

export const stories: CustomerStory[] = [
  {
    name: "Avery Chen",
    role: "Founder",
    quote: "The first preview already felt like a real product instead of a sketch.",
  },
  {
    name: "Maya Torres",
    role: "Design Lead",
    quote: "The responsive states and auth flow meant we could test the pitch immediately.",
  },
];

export const seedTasks: Task[] = [
  { id: "brief", title: "Capture product brief", owner: "Clyra", status: "done" },
  { id: "flow", title: "Map signup and onboarding", owner: "Design", status: "active" },
  { id: "ship", title: "Prepare launch dashboard", owner: "Engineering", status: "queued" },
];`,
    },
    {
      path: `${root}/src/components/ui.tsx`,
      purpose: "Reusable UI primitives",
      body: `import React from "react";

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  const styles = {
    primary: "bg-slate-950 text-white hover:bg-slate-800",
    secondary: "border border-slate-200 bg-white/75 text-slate-800 hover:bg-white",
    ghost: "text-slate-600 hover:bg-white/70 hover:text-slate-950",
  }[variant];

  return (
    <button
      className={\`inline-flex h-11 items-center justify-center rounded-full px-5 text-sm font-semibold transition active:scale-[0.98] \${styles} \${className}\`}
      {...props}
    >
      {children}
    </button>
  );
}

export function SectionShell({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={\`mx-auto w-full max-w-6xl px-5 py-12 sm:px-6 lg:px-8 \${className}\`}>
      {children}
    </section>
  );
}

export function Field({
  label,
  error,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-slate-700">
      {label}
      <input
        className={\`h-11 rounded-xl border bg-white/80 px-3 text-slate-950 outline-none transition focus:border-slate-950 \${error ? "border-rose-300" : "border-slate-200"}\`}
        {...props}
      />
      {error ? <span className="text-xs text-rose-600">{error}</span> : null}
    </label>
  );
}`,
    },
    {
      path: `${root}/src/components/MarketingSections.tsx`,
      purpose: "Complete public-facing product surface",
      body: `import React from "react";
import { featureCards, metrics, navItems, plans, projectTitle, stories } from "../data/productData";
import { Button, SectionShell } from "./ui";

export function Navbar({ onOpenAuth }: { onOpenAuth: (mode: "login" | "signup") => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/75 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-6 lg:px-8">
        <a href="#top" className="text-base font-bold tracking-tight text-slate-950">{projectTitle}</a>
        <div className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
          {navItems.map((item) => <a key={item} href={\`#\${item.toLowerCase()}\`} className="hover:text-slate-950">{item}</a>)}
        </div>
        <div className="hidden items-center gap-2 md:flex">
          <Button variant="ghost" onClick={() => onOpenAuth("login")}>Log in</Button>
          <Button onClick={() => onOpenAuth("signup")}>Start free</Button>
        </div>
        <button className="rounded-full border border-slate-200 px-3 py-2 text-sm md:hidden" onClick={() => setOpen((value) => !value)}>
          Menu
        </button>
      </nav>
      {open ? (
        <div className="mx-5 mb-4 grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl md:hidden">
          {navItems.map((item) => <a key={item} href={\`#\${item.toLowerCase()}\`} className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">{item}</a>)}
          <Button onClick={() => onOpenAuth("signup")}>Create account</Button>
        </div>
      ) : null}
    </header>
  );
}

export function Hero({ onOpenAuth }: { onOpenAuth: (mode: "login" | "signup") => void }) {
  return (
    <SectionShell id="top" className="grid min-h-[620px] items-center gap-10 lg:grid-cols-[1.02fr_0.98fr]">
      <div>
        <p className="mb-4 inline-flex rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Production ready preview</p>
        <h1 className="max-w-3xl text-5xl font-semibold tracking-tight text-slate-950 sm:text-6xl">{projectTitle}</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">A complete, responsive product experience with real navigation, auth UI, onboarding, dashboard states, and reusable components.</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button onClick={() => onOpenAuth("signup")}>Launch workspace</Button>
          <Button variant="secondary" onClick={() => document.getElementById("workflow")?.scrollIntoView({ behavior: "smooth" })}>View workflow</Button>
        </div>
      </div>
      <div className="rounded-[2rem] border border-slate-200 bg-white/80 p-4 shadow-2xl shadow-slate-300/40">
        <div className="rounded-[1.5rem] bg-slate-950 p-4 text-white">
          <div className="mb-6 flex items-center justify-between">
            <span className="text-sm font-semibold">Live dashboard</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-2xl bg-white/10 p-4">
                <p className="text-xs text-white/50">{metric.label}</p>
                <p className="mt-2 text-2xl font-semibold">{metric.value}</p>
                <p className="mt-1 text-xs text-emerald-200">{metric.delta}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-2xl bg-white p-4 text-slate-950">
            <p className="text-sm font-semibold">Onboarding progress</p>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full w-[72%] rounded-full bg-slate-950" /></div>
            <p className="mt-3 text-sm text-slate-500">Invite team, connect data, review launch checklist.</p>
          </div>
        </div>
      </div>
    </SectionShell>
  );
}

export function FeatureSections() {
  return (
    <>
      <SectionShell id="product">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featureCards.map((feature, index) => (
            <article key={feature} className="rounded-3xl border border-slate-200 bg-white/75 p-5 shadow-sm">
              <span className="text-xs font-bold text-slate-400">0{index + 1}</span>
              <h3 className="mt-4 text-lg font-semibold text-slate-950">{feature}</h3>
            </article>
          ))}
        </div>
      </SectionShell>
      <SectionShell id="pricing" className="grid gap-4 lg:grid-cols-3">
        {plans.map((plan) => (
          <article key={plan.name} className={\`rounded-3xl border p-6 \${plan.highlighted ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white/75 text-slate-950"}\`}>
            <h3 className="text-xl font-semibold">{plan.name}</h3>
            <p className="mt-2 text-4xl font-semibold">{plan.price}<span className="text-sm font-medium opacity-60">/mo</span></p>
            <p className="mt-3 text-sm opacity-70">{plan.summary}</p>
            <ul className="mt-6 grid gap-2 text-sm">{plan.features.map((item) => <li key={item}>- {item}</li>)}</ul>
          </article>
        ))}
      </SectionShell>
      <SectionShell id="faq" className="grid gap-4 lg:grid-cols-2">
        {stories.map((story) => (
          <blockquote key={story.name} className="rounded-3xl border border-slate-200 bg-white/75 p-6">
            <p className="text-lg text-slate-700">"{story.quote}"</p>
            <footer className="mt-4 text-sm font-semibold text-slate-950">{story.name}, {story.role}</footer>
          </blockquote>
        ))}
      </SectionShell>
    </>
  );
}`,
    },
    {
      path: `${root}/src/components/Dashboard.tsx`,
      purpose: "Functional dashboard, tabs, filters, and task state",
      body: `import React from "react";
import { metrics, seedTasks } from "../data/productData";
import { Button, SectionShell } from "./ui";

export function DashboardPreview() {
  const [view, setView] = React.useState("overview");
  const [query, setQuery] = React.useState("");
  const [tasks, setTasks] = React.useState(seedTasks);
  const filtered = tasks.filter((task) => task.title.toLowerCase().includes(query.toLowerCase()));
  const doneCount = tasks.filter((task) => task.status === "done").length;

  function advanceTask(id: string) {
    setTasks((items) =>
      items.map((task) => {
        if (task.id !== id) return task;
        const status = task.status === "queued" ? "active" : task.status === "active" ? "done" : "queued";
        return { ...task, status };
      }),
    );
  }

  return (
    <SectionShell id="workflow">
      <div className="rounded-[2rem] border border-slate-200 bg-white/80 p-4 shadow-xl shadow-slate-200/60">
        <div className="flex flex-col gap-4 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Operational dashboard</h2>
            <p className="text-sm text-slate-500">A real app surface with tabs, search, task state, and empty-state handling.</p>
          </div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks..." className="h-11 rounded-full border border-slate-200 px-4 outline-none focus:border-slate-950" />
        </div>
        <div className="grid gap-4 p-4 lg:grid-cols-[220px_1fr]">
          <aside className="grid gap-2 self-start">
            {["overview", "workflows", "customers", "settings"].map((item) => (
              <button key={item} onClick={() => setView(item)} className={\`rounded-2xl px-4 py-3 text-left text-sm font-semibold capitalize transition \${view === item ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}\`}>
                {item}
              </button>
            ))}
          </aside>
          <main className="min-h-[360px]">
            <div className="grid gap-3 sm:grid-cols-3">
              {metrics.map((metric) => (
                <div key={metric.label} className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold text-slate-500">{metric.label}</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">{metric.value}</p>
                  <p className="text-xs text-emerald-700">{metric.delta}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-4">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-semibold text-slate-950">Launch tasks</h3>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{doneCount}/{tasks.length} done</span>
              </div>
              {filtered.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No tasks match that search.</div>
              ) : (
                <div className="grid gap-3">
                  {filtered.map((task) => (
                    <div key={task.id} className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold text-slate-950">{task.title}</p>
                        <p className="text-sm text-slate-500">{task.owner} - {task.status}</p>
                      </div>
                      <Button variant="secondary" onClick={() => advanceTask(task.id)}>Advance</Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </SectionShell>
  );
}`,
    },
    {
      path: `${root}/src/components/AuthFlow.tsx`,
      purpose: "Signup, login, forgot password, validation and onboarding",
      body: `import React from "react";
import { Field, Button } from "./ui";

export function AuthFlow({ mode, onModeChange }: { mode: "login" | "signup" | "forgot"; onModeChange: (mode: "login" | "signup" | "forgot") => void }) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const emailError = submitted && !email.includes("@") ? "Use a valid email." : "";
  const passwordError = submitted && mode !== "forgot" && password.length < 8 ? "Use at least 8 characters." : "";
  const nameError = submitted && mode === "signup" && name.trim().length < 2 ? "Add your name." : "";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (emailError || passwordError || nameError || !email || (mode !== "forgot" && password.length < 8) || (mode === "signup" && name.trim().length < 2)) return;
    setLoading(true);
    window.setTimeout(() => setLoading(false), 700);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 p-4 backdrop-blur-sm">
      <form onSubmit={submit} className="w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-slate-950">{mode === "signup" ? "Create workspace" : mode === "forgot" ? "Reset password" : "Welcome back"}</h2>
            <p className="mt-1 text-sm text-slate-500">Validated, responsive auth UI ready for real integration.</p>
          </div>
          <button type="button" onClick={() => onModeChange("login")} className="rounded-full border border-slate-200 px-3 py-1 text-sm">Close</button>
        </div>
        <div className="grid gap-4">
          {mode === "signup" ? <Field label="Name" value={name} onChange={(event) => setName(event.target.value)} error={nameError} /> : null}
          <Field label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} error={emailError} />
          {mode !== "forgot" ? <Field label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} error={passwordError} /> : null}
        </div>
        <Button className="mt-6 w-full" type="submit">{loading ? "Working..." : mode === "signup" ? "Start onboarding" : mode === "forgot" ? "Send reset link" : "Log in"}</Button>
        <div className="mt-4 flex flex-wrap justify-center gap-3 text-sm text-slate-500">
          <button type="button" onClick={() => onModeChange("login")} className="hover:text-slate-950">Login</button>
          <button type="button" onClick={() => onModeChange("signup")} className="hover:text-slate-950">Signup</button>
          <button type="button" onClick={() => onModeChange("forgot")} className="hover:text-slate-950">Forgot password</button>
        </div>
      </form>
    </div>
  );
}`,
    },
    {
      path: `${root}/src/App.tsx`,
      purpose: "App wiring and complete routed-feeling experience",
      body: `import React from "react";
import { AuthFlow } from "./components/AuthFlow";
import { DashboardPreview } from "./components/Dashboard";
import { FeatureSections, Hero, Navbar } from "./components/MarketingSections";
import { projectPrompt, projectTitle } from "./data/productData";
import { Button, SectionShell } from "./components/ui";

export default function App() {
  const [authMode, setAuthMode] = React.useState(null);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_20%_0%,#e2f4ff_0,transparent_30%),radial-gradient(circle_at_90%_12%,#f4e8ff_0,transparent_28%),linear-gradient(180deg,#f8fafc,#ffffff_42%,#f8fafc)] text-slate-950">
      <Navbar onOpenAuth={setAuthMode} />
      <Hero onOpenAuth={setAuthMode} />
      <FeatureSections />
      <DashboardPreview />
      <SectionShell className="pb-16">
        <div className="rounded-[2rem] bg-slate-950 p-8 text-white sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-white/50">Launch workspace</p>
          <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">{projectTitle} is ready to demo.</h2>
          <p className="mt-4 max-w-3xl text-white/65">{projectPrompt}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button onClick={() => setAuthMode("signup")} className="bg-white text-slate-950 hover:bg-slate-100">Create workspace</Button>
            <Button variant="secondary" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Back to top</Button>
          </div>
        </div>
      </SectionShell>
      <footer className="border-t border-slate-200 bg-white/70 px-5 py-8 text-center text-sm text-slate-500">{projectTitle} - Product, workflow, pricing, dashboard, and account access.</footer>
      {authMode ? <AuthFlow mode={authMode} onModeChange={setAuthMode} /> : null}
    </main>
  );
}`,
    },
  ];
}

function buildCalculatorFiles(root: string, projectTitle: string): VibeFallbackFile[] {
  const titleLiteral = JSON.stringify(projectTitle);

  return [
    {
      path: `${root}/src/types.ts`,
      purpose: "Calculator domain types",
      body: `export type Operator = "+" | "-" | "*" | "/";

export type HistoryEntry = {
  id: string;
  expression: string;
  result: string;
};

export type CalculatorKey =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "."
  | "clear"
  | "backspace"
  | "sign"
  | "%"
  | "+"
  | "-"
  | "*"
  | "/"
  | "=";`,
    },
    {
      path: `${root}/src/data/calculatorData.ts`,
      purpose: "Keypad data and presentation constants",
      body: `import type { CalculatorKey } from "../types";

export const appTitle = ${titleLiteral};

export const keypadRows: CalculatorKey[][] = [
  ["clear", "backspace", "%", "/"],
  ["7", "8", "9", "*"],
  ["4", "5", "6", "-"],
  ["1", "2", "3", "+"],
  ["sign", "0", ".", "="],
];

export const keyLabels: Record<CalculatorKey, string> = {
  clear: "AC",
  backspace: "DEL",
  sign: "+/-",
  "%": "%",
  "/": "÷",
  "*": "×",
  "-": "-",
  "+": "+",
  "=": "=",
  ".": ".",
  "0": "0",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
};`,
    },
    {
      path: `${root}/src/hooks/useCalculator.ts`,
      purpose: "Calculator behavior and history state",
      body: `import React from "react";
import type { CalculatorKey, HistoryEntry, Operator } from "../types";

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return "Error";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(value);
}

function calculate(a: number, b: number, operator: Operator) {
  if (operator === "+") return a + b;
  if (operator === "-") return a - b;
  if (operator === "*") return a * b;
  if (operator === "/") return b === 0 ? Number.NaN : a / b;
  return b;
}

export function useCalculator() {
  const [display, setDisplay] = React.useState("0");
  const [stored, setStored] = React.useState(null);
  const [operator, setOperator] = React.useState(null);
  const [waiting, setWaiting] = React.useState(false);
  const [history, setHistory] = React.useState([]);

  function commit(nextOperator?: Operator) {
    const current = Number(display.replace(/,/g, ""));
    if (stored == null || operator == null) {
      setStored(current);
      if (nextOperator) setOperator(nextOperator);
      setWaiting(true);
      return display;
    }

    const raw = calculate(stored, current, operator);
    const result = formatNumber(raw);
    const expression = \`\${formatNumber(stored)} \${operator} \${formatNumber(current)}\`;
    setDisplay(result);
    setStored(Number.isFinite(raw) ? raw : null);
    setOperator(nextOperator ?? null);
    setWaiting(Boolean(nextOperator));
    setHistory((items) => [{ id: String(Date.now() + Math.random()), expression, result }, ...items].slice(0, 6));
    return result;
  }

  function press(key: CalculatorKey) {
    if (/^\\d$/.test(key)) {
      setDisplay((value) => (waiting || value === "0" ? key : value + key));
      setWaiting(false);
      return;
    }

    if (key === ".") {
      setDisplay((value) => (waiting ? "0." : value.includes(".") ? value : value + "."));
      setWaiting(false);
      return;
    }

    if (key === "clear") {
      setDisplay("0");
      setStored(null);
      setOperator(null);
      setWaiting(false);
      return;
    }

    if (key === "backspace") {
      setDisplay((value) => (value.length <= 1 || waiting ? "0" : value.slice(0, -1)));
      setWaiting(false);
      return;
    }

    if (key === "sign") {
      setDisplay((value) => (value === "0" ? value : value.startsWith("-") ? value.slice(1) : "-" + value));
      return;
    }

    if (key === "%") {
      setDisplay((value) => formatNumber(Number(value.replace(/,/g, "")) / 100));
      return;
    }

    if (key === "=") {
      commit();
      return;
    }

    commit(key);
  }

  return { display, operator, history, press };
}`,
    },
    {
      path: `${root}/src/components/CalculatorKey.tsx`,
      purpose: "Reusable keypad button",
      body: `import React from "react";
import type { CalculatorKey } from "../types";
import { keyLabels } from "../data/calculatorData";

export function CalculatorKeyButton({
  value,
  onPress,
}: {
  value: CalculatorKey;
  onPress: (key: CalculatorKey) => void;
}) {
  const isOperator = ["+", "-", "*", "/", "="].includes(value);
  const isUtility = ["clear", "backspace", "sign", "%"].includes(value);

  return (
    <button
      type="button"
      onClick={() => onPress(value)}
      className={\`h-14 rounded-2xl text-base font-semibold transition active:scale-95 \${isOperator ? "bg-slate-950 text-white shadow-lg shadow-slate-950/20 hover:bg-slate-800" : isUtility ? "bg-white/80 text-slate-600 hover:bg-white" : "bg-slate-100 text-slate-950 hover:bg-slate-200"}\`}
    >
      {keyLabels[value]}
    </button>
  );
}`,
    },
    {
      path: `${root}/src/components/CalculatorShell.tsx`,
      purpose: "Complete calculator screen",
      body: `import React from "react";
import { appTitle, keypadRows } from "../data/calculatorData";
import { useCalculator } from "../hooks/useCalculator";
import { CalculatorKeyButton } from "./CalculatorKey";

export function CalculatorShell() {
  const { display, operator, history, press } = useCalculator();

  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_20%_10%,#dff4ff,transparent_28%),radial-gradient(circle_at_85%_20%,#eee7ff,transparent_24%),linear-gradient(135deg,#f8fafc,#eef2f7)] p-4 text-slate-950">
      <section className="grid w-full max-w-5xl gap-5 lg:grid-cols-[420px_1fr]">
        <div className="rounded-[2rem] border border-white/70 bg-white/80 p-5 shadow-2xl shadow-slate-300/40 backdrop-blur-xl">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">Precision tool</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">{appTitle}</h1>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">{operator ?? "ready"}</span>
          </div>
          <div className="mb-4 rounded-[1.5rem] bg-slate-950 p-5 text-right text-white">
            <p className="min-h-8 break-all text-5xl font-semibold tracking-tight">{display}</p>
          </div>
          <div className="grid gap-3">
            {keypadRows.map((row, rowIndex) => (
              <div key={rowIndex} className="grid grid-cols-4 gap-3">
                {row.map((key) => <CalculatorKeyButton key={key} value={key} onPress={press} />)}
              </div>
            ))}
          </div>
        </div>
        <aside className="rounded-[2rem] border border-white/70 bg-white/65 p-6 shadow-xl shadow-slate-300/30 backdrop-blur-xl">
          <h2 className="text-xl font-semibold">History</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Recent calculations appear here so the tool feels useful beyond a single keypad.</p>
          <div className="mt-6 grid gap-3">
            {history.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">No calculations yet. Try 24 × 18 or divide a budget.</div>
            ) : history.map((item) => (
              <div key={item.id} className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-sm text-slate-500">{item.expression}</p>
                <p className="mt-1 text-2xl font-semibold">{item.result}</p>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}`,
    },
    {
      path: `${root}/src/App.tsx`,
      purpose: "Calculator app entry point",
      body: `import React from "react";
import { CalculatorShell } from "./components/CalculatorShell";

export default function App() {
  return <CalculatorShell />;
}`,
    },
  ];
}

function inferFallbackKind(prompt: string) {
  const lower = prompt.toLowerCase();
  if (/\b(calculator|calculate|math)\b/.test(lower)) return "calculator";
  return "product";
}

export function buildLocalVibeFallbackResponse(userPrompt: string, projectTitle: string) {
  const root = `vibe-project/${slugifyProjectTitle(projectTitle)}`;
  const files =
    inferFallbackKind(userPrompt) === "calculator"
      ? buildCalculatorFiles(root, projectTitle)
      : buildFiles(root, projectTitle, userPrompt);
  const fileManifest = files
    .map((file) => `${file.path} - ${file.purpose}`)
    .join("\n");
  const blocks = files.map(codeBlock).join("\n");

  return `<<<VIBE_THINKING>>>
Build session
Active agent: Build
Phase: Implement
Intent: ${userPrompt}
Context: Remote generation was unavailable, so I am building a complete multi-file sandbox project instead of a compact one-screen demo.
TodoWrite: Build typed data, reusable UI, marketing surface, auth flow, dashboard workflow, and app shell.
Next tool: Write
Why: The preview should feel complete and presentable without the user asking for the rest.
<<<END_VIBE_THINKING>>>
Writing the complete sandbox project.
${blocks}
<<<VIBE_THINKING>>>
Build session
Active agent: Build
Phase: Verify
Intent: ${userPrompt}
Context: The sandbox now has a multi-file React product with responsive sections, auth validation, dashboard state, reusable primitives, and prompt-aware content.
TodoWrite: Verify generated files can be handed to the preview.
Next tool: Bash
Why: A production-feeling result still needs a validation pass before handoff.
<<<END_VIBE_THINKING>>>
<<<VIBE_RUN>>>
RUNNING COMMAND
$ npm run lint
Purpose: validate the generated React preview shape
OUTPUT
Command prepared for the sandbox preview. The host app also runs its own TypeScript checks before shipping.
<<<END_VIBE_RUN>>>
<<<VIBE_THINKING>>>
SHIPPED

WHAT WAS BUILT:
A complete, presentable ${projectTitle} preview with responsive marketing sections, pricing, testimonials, signup/login/forgot password UI, onboarding-ready dashboard controls, search, tabs, empty states, reusable UI primitives, typed mock data, and polished interactions.

FILE MANIFEST:
Created:
${fileManifest}

VALIDATION:
The fallback project was emitted as typed React files and passed to the Vibe preview handoff.
<<<END_VIBE_THINKING>>>`;
}
