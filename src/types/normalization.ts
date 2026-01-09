import type {
  MarketCategory,
  NormalizedMarketType,
  NormalizedSelection,
  ParameterType,
  ViewType,
} from "../services/normalization/types.js";

export type {
  MarketCategory,
  NormalizedMarketType,
  NormalizedSelection,
  ParameterType,
  ViewType,
};

export function buildMarketKey(type: NormalizedMarketType, param?: string): string {
  if (!param) return type;
  const normalizedParam = param.replace(",", ".");
  return `${type}:${normalizedParam}`;
}
