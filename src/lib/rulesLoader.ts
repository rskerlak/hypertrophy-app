// Carga y valida rules.config.json una sola vez (Zod). Fuente única de los
// números científicos para toda la app (dominio, seed, UI).

import rulesJson from "../../rules.config.json";
import { parseRules, type Rules } from "@/domain/rules";

let _rules: Rules | null = null;

export function getRules(): Rules {
  if (!_rules) _rules = parseRules(rulesJson);
  return _rules;
}
