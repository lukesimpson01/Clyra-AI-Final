/**
 * Node-only source-library operations.
 *
 * No dependency install, build command, or project script is executed here.
 * The only process calls are fixed Git commands against a repository URL from
 * the curated registry.  This makes inspection useful before an integration is
 * trusted, and keeps source acquisition reversible.
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { TemplateManifest } from "./registry";

const execFileAsync = promisify(execFile);
const SHA = /^[a-f0-9]{40}$/i;
const MAX_MANIFEST_BYTES = 512 * 1024;

export class TemplateLibraryError extends Error {}

export type TemplateRemoteVerification = {
  commit: string;
  verifiedAt: string;
};

export type LicenseScan = {
  files: string[];
  detected: string[];
  notice: string;
};

export type TemplateCheckoutInspection = {
  license: LicenseScan;
  packageManager: "npm" | "pnpm" | "yarn" | "unknown";
  scripts: string[];
  dependencies: string[];
  lockfiles: string[];
  filesScanned: number;
  warnings: string[];
};

export type TemplateImportPlan = {
  manifest: TemplateManifest;
  verification: TemplateRemoteVerification;
  importSafety: {
    doesNotRunInstallScripts: true;
    doesNotMergeSource: true;
    requiresExplicitConfirmation: true;
  };
  warnings: string[];
};

function conciseProcessError(error: unknown, fallback: string) {
  const value = error as { stderr?: string; message?: string };
  const raw = `${value?.stderr ?? ""} ${value?.message ?? ""}`.replace(/\s+/g, " ").trim();
  return raw ? `${fallback}: ${raw.slice(0, 360)}` : fallback;
}

/** Resolve the remote default revision without checking out or executing it. */
export async function verifyTemplateRemote(manifest: TemplateManifest): Promise<TemplateRemoteVerification> {
  try {
    const { stdout } = await execFileAsync("git", ["ls-remote", manifest.repositoryUrl, "HEAD"], {
      timeout: 30_000,
      maxBuffer: 32 * 1024,
      windowsHide: true,
    });
    const commit = stdout.trim().split(/\s+/)[0] ?? "";
    if (!SHA.test(commit)) throw new TemplateLibraryError("The remote did not return a valid commit hash.");
    return { commit: commit.toLowerCase(), verifiedAt: new Date().toISOString() };
  } catch (error) {
    if (error instanceof TemplateLibraryError) throw error;
    throw new TemplateLibraryError(conciseProcessError(error, "Could not verify the public repository"));
  }
}

function knownLicense(text: string): string[] {
  const values = new Set<string>();
  const upper = text.toUpperCase();
  const spdx = text.match(/SPDX-License-Identifier:\s*([^\s*]+)/i)?.[1];
  if (spdx) values.add(spdx);
  if (/MIT LICENSE|THE MIT LICENSE/.test(upper)) values.add("MIT");
  if (/APACHE LICENSE\s*(?:,?\s*VERSION)?\s*2\.0/.test(upper)) values.add("Apache-2.0");
  if (/GNU (?:GENERAL PUBLIC LICENSE|GPL).*VERSION 3/.test(upper)) values.add("GPL-3.0");
  if (/GNU (?:GENERAL PUBLIC LICENSE|GPL).*VERSION 2/.test(upper)) values.add("GPL-2.0");
  if (/GNU (?:AFFERO )?GENERAL PUBLIC LICENSE/.test(upper)) values.add("AGPL/GPL (review exact version)");
  if (/MOZILLA PUBLIC LICENSE.*2\.0/.test(upper)) values.add("MPL-2.0");
  if (/BSD 3-CLAUSE|REDISTRIBUTION AND USE IN SOURCE AND BINARY FORMS/.test(upper)) values.add("BSD-style (review exact terms)");
  return [...values];
}

async function safelyRead(file: string): Promise<string | null> {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) return null;
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * A deliberately bounded static scan. It reads root manifests and license
 * notices, but it never evaluates package.json or runs a package manager.
 */
export async function inspectTemplateCheckout(checkout: string): Promise<TemplateCheckoutInspection> {
  const entries = await fs.readdir(checkout, { withFileTypes: true }).catch(() => []);
  const names = entries.map((entry) => entry.name);
  const licenseFiles = names.filter((name) => /^(?:license|copying|notice)(?:\.[a-z0-9._-]+)?$/i.test(name));
  const licenseTexts = await Promise.all(licenseFiles.map((name) => safelyRead(path.join(checkout, name))));
  const detected = [...new Set(licenseTexts.flatMap((text) => text ? knownLicense(text) : []))];
  const packageText = await safelyRead(path.join(checkout, "package.json"));
  let scripts: string[] = [];
  let dependencies: string[] = [];
  if (packageText) {
    try {
      const pkg = JSON.parse(packageText) as { scripts?: Record<string, unknown>; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
      scripts = Object.keys(pkg.scripts ?? {}).sort();
      dependencies = [...new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])].sort();
    } catch {
      // A malformed package manifest is evidence to report, not a reason to execute anything.
    }
  }
  const lockfiles = names.filter((name) => ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "poetry.lock", "requirements.txt", "Cargo.lock", "Package.resolved"].includes(name));
  const packageManager = names.includes("pnpm-lock.yaml") ? "pnpm"
    : names.includes("yarn.lock") ? "yarn"
      : names.includes("package-lock.json") ? "npm"
        : "unknown";
  const warnings = [
    ...(licenseFiles.length ? [] : ["No top-level LICENSE, COPYING or NOTICE file was found by Clyra's bounded scan."]),
    ...(packageText && scripts.length === 0 ? ["package.json has no scripts, or its scripts could not be read."] : []),
    "This is an automated source scan, not legal advice or a full dependency-license audit.",
  ];
  return {
    license: {
      files: licenseFiles,
      detected,
      notice: "Clyra scanned top-level license notices only; review every upstream notice and dependency before distribution.",
    },
    packageManager,
    scripts,
    dependencies,
    lockfiles,
    filesScanned: names.length,
    warnings,
  };
}

export async function buildTemplateImportPlan(manifest: TemplateManifest): Promise<TemplateImportPlan> {
  const verification = await verifyTemplateRemote(manifest);
  return {
    manifest,
    verification,
    importSafety: {
      doesNotRunInstallScripts: true,
      doesNotMergeSource: true,
      requiresExplicitConfirmation: true,
    },
    warnings: [
      ...manifest.warnings,
      "Importing creates an isolated Git checkout. It never installs dependencies or runs upstream scripts.",
      "Integrating source into a product remains a separate reviewed change; Clyra does not merge upstream code automatically.",
    ],
  };
}

async function emptyDestination(destination: string) {
  try {
    const entries = await fs.readdir(destination);
    if (entries.length) throw new TemplateLibraryError("The isolated import destination is not empty.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await fs.mkdir(destination, { recursive: true });
      return;
    }
    throw error;
  }
}

/** Clone a single, pinned public revision without executing repository code. */
export async function cloneTemplateCheckout(
  manifest: TemplateManifest,
  verification: TemplateRemoteVerification,
  destination: string,
): Promise<TemplateCheckoutInspection> {
  await emptyDestination(destination);
  // git clone requires that the destination does not exist, so use a sibling
  // temporary directory and move it into place only after checkout succeeds.
  const temporary = `${destination}.partial-${process.pid}-${Date.now()}`;
  await fs.rm(temporary, { recursive: true, force: true });
  try {
    await execFileAsync("git", ["clone", "--depth", "1", "--no-tags", manifest.repositoryUrl, temporary], {
      timeout: 120_000,
      maxBuffer: 256 * 1024,
      windowsHide: true,
    });
    // The verified commit can move out of a one-commit shallow clone when
    // upstream advances between verification and checkout. Fetch the exact
    // revision before retrying, and fail rather than silently using HEAD.
    try {
      await execFileAsync("git", ["-C", temporary, "checkout", "--detach", verification.commit], {
        timeout: 30_000, maxBuffer: 128 * 1024, windowsHide: true,
      });
    } catch {
      try {
        await execFileAsync("git", ["-C", temporary, "fetch", "--depth", "1", "origin", verification.commit], {
          timeout: 120_000, maxBuffer: 128 * 1024, windowsHide: true,
        });
      } catch {
        await execFileAsync("git", ["-C", temporary, "fetch", "--unshallow", "origin"], {
          timeout: 180_000, maxBuffer: 128 * 1024, windowsHide: true,
        });
      }
      await execFileAsync("git", ["-C", temporary, "checkout", "--detach", verification.commit], {
        timeout: 30_000, maxBuffer: 128 * 1024, windowsHide: true,
      });
    }
    const { stdout: checkedOutRevision } = await execFileAsync("git", ["-C", temporary, "rev-parse", "HEAD"], {
      timeout: 10_000, windowsHide: true,
    });
    if (checkedOutRevision.trim() !== verification.commit.trim()) {
      throw new TemplateLibraryError("Git checkout did not match the verified revision.");
    }
    const origin = {
      schemaVersion: 1,
      templateId: manifest.id,
      name: manifest.name,
      repositoryUrl: manifest.repositoryUrl,
      pinnedCommit: verification.commit,
      verifiedAt: verification.verifiedAt,
      attribution: manifest.attribution,
      license: manifest.licenseSpdxOrReview,
      importPolicy: "Isolated checkout only. No dependency install or upstream script has been run by Clyra.",
    };
    await fs.writeFile(path.join(temporary, "CLYRA_TEMPLATE_ORIGIN.json"), `${JSON.stringify(origin, null, 2)}\n`, "utf8");
    const inspection = await inspectTemplateCheckout(temporary);
    await fs.rm(destination, { recursive: true, force: true });
    await fs.rename(temporary, destination);
    return inspection;
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    throw error instanceof TemplateLibraryError
      ? error
      : new TemplateLibraryError(conciseProcessError(error, "Could not clone the pinned source checkout"));
  }
}

export function isolatedCheckoutName(manifest: TemplateManifest, verification: TemplateRemoteVerification) {
  return `${manifest.id}-${verification.commit.slice(0, 8)}`;
}
