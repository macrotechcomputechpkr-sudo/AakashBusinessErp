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

/** A ready-to-send WhatsApp / Viber link (Messaging "link" mode) for the person who made a change. */
export interface NotifyLink { user_id: string; user_name: string; channel: 'whatsapp' | 'viber' | 'email' | 'sms'; link: string }
export interface WorkUser { id: string; name: string; department_id?: string | null; department_name?: string | null }

export interface TaskRow {
    id: string; task_no: string; title: string; description: string | null;
    priority: 'low' | 'normal' | 'high' | 'urgent'; status: 'todo' | 'in_progress' | 'on_hold' | 'done' | 'cancelled'; status_label: string;
    start_date: string | null; due_at: string | null; progress: number;
    assigned_to: string | null; assigned_to_name: string | null; assigned_by: string | null; assigned_by_name: string | null;
    created_by: string | null; created_by_name: string | null; watchers: string[]; watcher_names: string[];
    darta_chalani_id: string | null; related_type: string | null; related_id: string | null; related_label: string | null;
    tags: string[]; recurrence: 'none' | 'daily' | 'weekly' | 'monthly'; completed_at: string | null; created_at: string; is_overdue: boolean;
    comments?: { id: string; user_name: string; kind: 'comment' | 'change'; body: string; created_at: string }[];
    darta?: { id: string; reg_no: string; subject: string; entry_type: string } | null;
    notify_links?: NotifyLink[];
}

export interface DartaRow {
    id: string; entry_type: 'darta' | 'chalani'; reg_no: string; fiscal_year_label: string; serial_no: number;
    entry_date: string; entry_date_bs: string | null; letter_no: string | null; letter_date: string | null; letter_date_bs: string | null;
    party_name: string; party_address: string | null; party_phone: string | null; party_email: string | null; ledger_id: string | null;
    subject: string; description: string | null; department_id: string | null; department_name: string | null;
    assigned_to: string | null; assigned_to_name: string | null; created_by_name: string | null;
    channel: string; tracking_no: string | null; pages: number | null; priority: string; status: string; status_label: string;
    due_date: string | null; reply_to_id: string | null; attachment_url: string | null; attachment_name: string | null;
    is_confidential: boolean; remarks: string | null; is_overdue: boolean; created_at: string;
    replies?: { id: string; reg_no: string; entry_type: string; subject: string; entry_date: string; status: string }[];
    reply_to?: { id: string; reg_no: string; entry_type: string; subject: string } | null;
    tasks?: { id: string; task_no: string; title: string; status: string; due_at: string | null }[];
    notify_links?: NotifyLink[];
}
