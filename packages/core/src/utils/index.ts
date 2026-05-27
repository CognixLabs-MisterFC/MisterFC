/**
 * Helpers puros, sin dependencias de React/Next.
 */

export function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}

export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
