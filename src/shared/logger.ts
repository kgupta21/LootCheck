import { redactSensitiveValue } from "./errors";

export function redactForLog(value: unknown): unknown {
  return redactSensitiveValue(value);
}

export const logger = {
  info(message: string, data?: unknown): void {
    console.info(`[LootCheck] ${message}`, redactForLog(data));
  },
  warn(message: string, data?: unknown): void {
    console.warn(`[LootCheck] ${message}`, redactForLog(data));
  },
  error(message: string, data?: unknown): void {
    console.error(`[LootCheck] ${message}`, redactForLog(data));
  }
};
