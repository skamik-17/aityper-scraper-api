CREATE TABLE market_types (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_pl TEXT NOT NULL,
  name_en TEXT NOT NULL,
  description_pl TEXT NOT NULL,
  description_en TEXT NOT NULL,
  view_type view_type NOT NULL,
  category market_category NOT NULL,
  has_parameter BOOLEAN NOT NULL DEFAULT FALSE,
  param_type parameter_type,
  selections TEXT[] NOT NULL,
  display_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_market_types_code ON market_types(code);
CREATE INDEX idx_market_types_category ON market_types(category);
CREATE INDEX idx_market_types_display_order ON market_types(display_order);
