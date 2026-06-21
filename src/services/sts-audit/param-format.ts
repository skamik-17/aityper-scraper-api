/**
 * Detect the parameter-value format for an STS-normalized market.
 * Lives in the sts-audit module (not the prep script) so it is unit-testable
 * under the vitest `src/**` include glob, and is imported by sts-prep-audit.ts.
 */
import type { MechanicalFlags } from "./types.js";

export function detectParamFormatSts(
  paramValue: string | null | undefined,
): MechanicalFlags["param_format"] {
  if (!paramValue) return "none";
  if (
    paramValue === "HOME" ||
    paramValue === "AWAY" ||
    paramValue.startsWith("HOME:") ||
    paramValue.startsWith("AWAY:")
  )
    return "team_side";
  if (paramValue.includes(".")) return "decimal_dot";
  if (paramValue.includes(",")) return "decimal_comma";
  if (/^[+-]?\d+$/.test(paramValue)) return "signed_integer";
  return "none";
}
