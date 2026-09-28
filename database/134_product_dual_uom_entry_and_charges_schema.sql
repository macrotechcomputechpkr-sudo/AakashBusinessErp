-- =============================================
-- 134: dual-UOM entry per product
--   products.dual_auto_convert       - true: the second unit is worked out
--                                      from the first (Flexible / auto
--                                      convert); false: both typed (Fixed);
--                                      null: System Control's Dual UOM mode
--   products.dual_reverse_conversion - true / false / null (System Control):
--                                      typing the second unit works the
--                                      first one back out
-- Billing terms already carry basis ('value' | 'quantity'), which now also
-- decides how an amount typed in an entry's Charges Summary is split over
-- the lines.
-- =============================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS dual_auto_convert BOOLEAN;
ALTER TABLE products ADD COLUMN IF NOT EXISTS dual_reverse_conversion BOOLEAN;
COMMENT ON COLUMN products.dual_auto_convert IS 'Dual UOM entry: true = auto convert (flexible), false = fixed, null = System Control';
COMMENT ON COLUMN products.dual_reverse_conversion IS 'Dual UOM reverse conversion: true / false, null = System Control';
