import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const AGENTMX_DIR = join(homedir(), ".agentmx");
const ONBOARDING_FILE = join(AGENTMX_DIR, "onboarding.json");

interface OnboardingState {
  completedAt: string;
  version: string;
}

/**
 * Check if the user has completed onboarding.
 */
export function isOnboardingComplete(): boolean {
  return existsSync(ONBOARDING_FILE);
}

/**
 * Mark onboarding as complete.
 */
export function completeOnboarding(version: string): void {
  mkdirSync(AGENTMX_DIR, { recursive: true });
  const state: OnboardingState = {
    completedAt: new Date().toISOString(),
    version,
  };
  writeFileSync(ONBOARDING_FILE, JSON.stringify(state, null, 2));
}

/**
 * Reset onboarding (for testing or re-triggering).
 */
export function resetOnboarding(): void {
  try {
    unlinkSync(ONBOARDING_FILE);
  } catch {
    // File doesn't exist
  }
}
