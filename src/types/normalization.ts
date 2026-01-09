// Re-export both values (const objects) and types from normalization/types
export {
  MarketCategory,
  NormalizedMarketType,
  NormalizedSelection,
  ParameterType,
  ViewType,
  buildMarketKey,
} from "../services/normalization/types.js";

// Also export the types
export type {
  MarketCategory as MarketCategoryType,
  NormalizedMarketType as NormalizedMarketTypeType,
  NormalizedSelection as NormalizedSelectionType,
  ParameterType as ParameterTypeType,
  ViewType as ViewTypeType,
} from "../services/normalization/types.js";
