// =============================================
// types/erp.ts
// Shared TypeScript types for the typed part of the client. The app is
// being moved to TypeScript file by file (tsconfig allowJs): new modules
// are written in .ts / .tsx and import the existing .js / .jsx freely.
// =============================================

/** Every API route answers { success, data } or { success: false, error }. */
export interface ApiResponse<T> {
    success: boolean;
    data: T;
    error?: string;
    message?: string;
    warning?: string;
}

/** authFetch from contexts/AuthContext - fetch + JSON + throw on !ok. */
export type AuthFetch = <T = unknown>(path: string, options?: RequestInit) => Promise<ApiResponse<T>>;

export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'hbar' | 'kpi' | 'table';

export interface SeriesPoint {
    label: string;
    value: number;
    value2?: number | null;
}

export interface WidgetData {
    title: string;
    kind: 'series' | 'kpi' | 'table';
    points?: SeriesPoint[];
    series_labels?: [string, string?];
    value?: number;
    previous?: number | null;
    change_pct?: number | null;
    unit?: string;
    columns?: { key: string; label: string; money?: boolean }[];
    rows?: Record<string, unknown>[];
    link?: string;
    /** the period the server actually used */
    from?: string;
    to?: string;
}

export interface WidgetDef {
    key: string;
    label: string;
    group: string;
    kind: 'series' | 'kpi' | 'table';
    default_chart: ChartType;
    charts: ChartType[];
}

export interface DashboardTile {
    id: string;
    widget: string;
    chart: ChartType;
    size: 1 | 2 | 3;
    period: string;
    title?: string;
}

/** One row of tenant_master.audit_log as returned by /api/audit-log. */
export interface AuditEntry {
    id: number;
    table_name: string;
    table_label: string;
    module: string;
    record_id: string | null;
    record_label: string | null;
    parent_table: string | null;
    parent_id: string | null;
    parent_label: string | null;
    action: 'I' | 'U' | 'D';
    action_label: string;
    changed_fields: string[] | null;
    old_data: Record<string, unknown> | null;
    new_data: Record<string, unknown> | null;
    user_id: string | null;
    user_name: string;
    ip_address: string | null;
    api_route: string | null;
    source: 'api' | 'db';
    changed_at: string;
}
