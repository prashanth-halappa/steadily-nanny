/**
 * Pattern A helpers — parse individual function bodies from migration SQL.
 */
import { expect } from 'bun:test';

/** Extract the plpgsql body between `$$` delimiters for a named public function. */
export function extractFunctionBody(sql: string, fnName: string): string {
  const re = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${fnName}\\b[\\s\\S]*?\\$\\$\\s*([\\s\\S]*?)\\s*\\$\\$`,
    'i'
  );
  const match = sql.match(re);
  if (!match?.[1]) {
    throw new Error(`Could not extract body for public.${fnName}`);
  }
  return match[1];
}

/** Extract revoke/grant block for one function (from first revoke through service_role grant). */
export function extractFunctionGrantBlock(sql: string, fnName: string): string {
  const re = new RegExp(
    `(revoke all on function public\\.${fnName}[\\s\\S]*?grant execute on function public\\.${fnName}[\\s\\S]*?to service_role;)`,
    'i'
  );
  const match = sql.match(re);
  if (!match?.[1]) {
    throw new Error(`Could not extract grants for public.${fnName}`);
  }
  return match[1];
}

/** Index of a statement token within a function body (must appear after `after`). */
export function statementPrecedes(
  body: string,
  earlier: string,
  later: string
): boolean {
  const earlierIdx = body.indexOf(earlier);
  const laterIdx = body.indexOf(later);
  expect(earlierIdx).toBeGreaterThanOrEqual(0);
  expect(laterIdx).toBeGreaterThan(earlierIdx);
  return true;
}
