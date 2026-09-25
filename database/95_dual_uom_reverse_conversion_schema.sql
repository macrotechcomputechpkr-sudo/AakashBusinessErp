-- =============================================
-- SYSTEM CONTROL - Dual UOM Reverse Conversion flag
-- The existing dual_uom_mode ('fixed' | 'auto_convert') already
-- decided whether entry auto-converts at all. This flag decides
-- whether that auto-conversion also works in reverse: typing into the
-- SECONDARY unit field converts back into the primary field (5 Crt =
-- 12 Pcs -> typing 60 Pcs gives 5 Crt). Meaningless (and ignored) when
-- dual_uom_mode is 'fixed'.
-- =============================================

ALTER TABLE tenant_master.system_control_settings
    ADD COLUMN IF NOT EXISTS dual_uom_reverse_conversion BOOLEAN DEFAULT FALSE;
