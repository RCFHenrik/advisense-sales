export type Role = 'consultant' | 'team_manager' | 'ba_manager' | 'admin';
export type Language = 'sv' | 'no' | 'da' | 'en' | 'de' | 'fi';
export type OutreachStatus =
  | 'candidate' | 'proposed' | 'accepted' | 'draft' | 'prepared'
  | 'sent' | 'replied' | 'meeting_booked'
  | 'closed_met' | 'closed_no_response' | 'closed_not_relevant' | 'closed_bounced'
  | 'negated';

export type NegationReason =
  | 'wrong_person' | 'wrong_domain' | 'sensitive_situation'
  | 'not_appropriate_timing' | 'another_consultant_better'
  | 'duplicate_ongoing' | 'do_not_contact';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface SiteLanguageItem {
  id: number;
  name: string;
  code?: string;
  is_active: boolean;
}

export interface EmployeeSiteLanguage {
  id: number;
  site_language_id: number;
  name: string;
  code?: string;
}

export interface Employee {
  id: number;
  name: string;
  email: string;
  role: Role;
  seniority?: string;
  primary_language: Language;
  domain_expertise_tags?: string;
  relevance_tags?: string;
  profile_description?: string;
  outreach_target_per_week: number;
  outreach_target_per_month?: number | null;
  is_active: boolean;
  approval_status?: ApprovalStatus;
  uploaded_batch_id?: string;
  can_campaign?: boolean;
  team_id?: number;
  business_area_id?: number;
  site_id?: number;
  team_name?: string;
  business_area_name?: string;
  site_name?: string;
  site_country_code?: string;
  site_languages?: EmployeeSiteLanguage[];
  must_change_password?: boolean;
  created_at: string;
}

export interface Contact {
  id: number;
  record_id?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  job_title?: string;
  original_job_title?: string;
  company_name?: string;
  client_name?: string;
  sector?: string;
  client_tier?: string;
  responsibility_domain?: string;
  group_domicile?: string;
  owner_name?: string;
  owner_business_area?: string;
  owner_team?: string;
  owner_seniority?: string;
  owner_org_site?: string;
  owner_email?: string;
  last_activity_date?: string;
  has_historical_revenue: boolean;
  revenue?: number;
  days_since_interaction?: number;
  relevant_search?: boolean;
  status: string;
  priority_score?: number;
  is_pinned: boolean;
  bounced_at?: string;
  expert_areas?: string;
  relevance_tags?: string;
  is_decision_maker?: boolean;
  opt_out_one_on_one?: boolean;
  opt_out_marketing_info?: boolean;
  contact_flags?: string[];
  coverage_gap_critical?: number;
  coverage_gap_potential?: number;
  created_at: string;
}

export interface OutreachRecord {
  id: number;
  contact_id: number;
  employee_id: number;
  status: OutreachStatus;
  email_subject?: string;
  email_body?: string;
  email_language?: Language;
  proposed_slot_1_start?: string;
  proposed_slot_1_end?: string;
  proposed_slot_2_start?: string;
  proposed_slot_2_end?: string;
  message_id?: string;
  sent_at?: string;
  replied_at?: string;
  outcome?: string;
  outcome_notes?: string;
  cooldown_override: boolean;
  recommendation_score?: number;
  recommendation_reason?: string;
  created_at: string;
  updated_at: string;
  contact_name?: string;
  contact_email?: string;
  contact_company?: string;
  contact_job_title?: string;
  employee_name?: string;
  team_name?: string;
  business_area_name?: string;
  selected_attachment_ids?: string;
  // Redirect provenance
  redirected_from_id?: number;
  redirected_by_id?: number;
  redirected_by_name?: string;
  redirected_at?: string;
  redirect_notes?: string;
}

export interface Negation {
  id: number;
  outreach_record_id: number;
  employee_id: number;
  reason: NegationReason;
  notes?: string;
  created_at: string;
  redirected_outreach_id?: number;
}

export interface DashboardStats {
  total_contacts: number;
  active_contacts: number;
  total_outreach_this_week: number;
  total_outreach_this_month: number;
  pending_proposals: number;
  sent_this_week: number;
  meetings_booked: number;
  negation_count: number;
}

export interface FilterOptions {
  client_tiers: string[];
  sectors: string[];
  responsibility_domains: string[];
  business_areas: string[];
  teams: string[];
  group_domiciles: string[];
  relevance_tags: string[];
  has_decision_makers: boolean;
}

export interface TemplateAttachment {
  id: number;
  template_id: number;
  original_filename: string;
  display_name: string;
  content_type: string;
  file_size_bytes: number;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface EmailTemplate {
  id: number;
  name: string;
  business_area_id?: number;
  responsibility_domain?: string;
  language: Language;
  subject_template: string;
  body_template: string;
  version: string;
  is_active: boolean;
  is_personal?: boolean;
  created_by_id?: number;
  published_at?: string;
  created_at: string;
  attachments?: TemplateAttachment[];
}

export interface HotTopic {
  id: number;
  business_area_id: number;
  responsibility_domain: string;
  topic_text: string;
  language: Language;
  is_active: boolean;
  published_at?: string;
  updated_at?: string;
  created_by_id?: number;
  created_at: string;
}

export interface SystemConfigItem {
  id: number;
  key: string;
  value: string;
  description?: string;
  updated_at: string;
}

export interface ColumnMapping {
  id: number;
  file_type: string;
  logical_field: string;
  physical_column: string;
  is_required: boolean;
}

export interface FileUploadRecord {
  id: number;
  file_type: string;
  filename: string;
  row_count?: number;
  added_count: number;
  updated_count: number;
  removed_count: number;
  uploaded_at: string;
  batch_id: string;
  uploaded_by_name?: string;
}

// Activity history types for outreach detail / contact tooltip
export interface MeetingHistoryItem {
  id: number;
  employee_name: string | null;
  activity_date: string | null;
  details: string | null;
  outcome: string | null;
}

export interface OutreachHistoryItem {
  id: number;
  employee_name: string | null;
  status: string;
  sent_at: string | null;
  email_subject: string | null;
  template_name: string | null;
  recommendation_score: number | null;
  outcome: string | null;
  replied_at: string | null;
  created_at: string;
}

export interface CampaignHistoryItem {
  id: number;
  campaign_name: string | null;
  email_subject: string | null;
  sent_at: string | null;
  status: string;
  created_by_name: string | null;
}

export interface ContactHistory {
  outreach: OutreachHistoryItem[];
  meetings: MeetingHistoryItem[];
  campaigns: CampaignHistoryItem[];
  coverage_gap?: CoverageGapInfo;
}

// ── Campaign Outreach ──────────────────────────────────────────────

export type CampaignStatus = 'draft' | 'ready' | 'sending' | 'sent' | 'cancelled';
export type CampaignRecipientStatus = 'pending' | 'sent' | 'failed' | 'bounced';

export type ConsultantStatus = 'pending' | 'accepted';

export interface CampaignRecipient {
  id: number;
  campaign_id: number;
  contact_id: number;
  status: CampaignRecipientStatus;
  sent_at?: string;
  error_message?: string;
  created_at: string;
  contact_name?: string;
  contact_email?: string;
  contact_company?: string;
  contact_job_title?: string;
  contact_domain?: string;
  contact_domicile?: string;
  contact_tier?: string;
  contact_expert_areas?: string;
  contact_relevance_tags?: string;
  contact_is_decision_maker?: boolean;
  contact_relevant_search?: boolean;
  added_via?: 'filter' | 'individual' | null;
  // Consultant assignment
  assigned_consultant_id?: number;
  assigned_consultant_name?: string;
  consultant_status?: ConsultantStatus;
  custom_email_subject?: string;
  custom_email_body?: string;
  consultant_accepted_at?: string;
}

export interface CampaignAttachment {
  id: number;
  campaign_id: number;
  original_filename: string;
  display_name: string;
  content_type: string;
  file_size_bytes: number;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface Campaign {
  id: number;
  name: string;
  description?: string;
  email_subject: string;
  email_body: string;
  email_language: Language;
  template_id?: number;
  bcc_mode: boolean;
  status: CampaignStatus;
  created_by_id: number;
  created_by_name?: string;
  recipient_count: number;
  sent_count: number;
  attachment_count?: number;
  scheduled_at?: string;
  sent_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CampaignDetail extends Campaign {
  recipients: CampaignRecipient[];
  attachments?: CampaignAttachment[];
}

// ── Notifications ───────────────────────────────────────────────────

export interface Notification {
  id: number;
  employee_id: number;
  notification_type: string;
  title: string;
  message?: string;
  link?: string;
  reference_type?: string;
  reference_id?: number;
  is_read: boolean;
  created_at: string;
}

// ── Campaign Assignments (consultant view) ──────────────────────────

export interface CampaignAssignment {
  recipient_id: number;
  campaign_id: number;
  campaign_name: string;
  campaign_description?: string;
  contact_id: number;
  contact_name?: string;
  contact_email?: string;
  contact_company?: string;
  contact_job_title?: string;
  default_email_subject: string;
  default_email_body: string;
  custom_email_subject?: string;
  custom_email_body?: string;
  consultant_status?: ConsultantStatus;
  consultant_accepted_at?: string;
  campaign_status: string;
  // Campaign-level context
  campaign_language?: string;
  campaign_created_by?: string;
  campaign_total_recipients?: number;
  campaign_attachment_names?: string[];
  campaign_created_at?: string;
}

// ── Analytics Dashboard ──────────────────────────────────────────────

export interface AnalyticsKPIs {
  total_contacts: number;
  interacted_contacts: number;
  outreach_total: number;
  outreach_sent: number;
  meetings_booked: number;
  campaigns_sent: number;
  coverage_gaps_critical: number;
  companies_with_gaps: number;
}

export interface StatusCount {
  status: string;
  count: number;
}

export interface DistributionItem {
  label: string;
  value: number;
}

export interface TimeSeriesPoint {
  date: string;
  outreach: number;
  meetings: number;
}

export interface GapByIndustry {
  label: string;
  critical: number;
  potential: number;
  closed: number;
}

export interface AnalyticsData {
  kpis: AnalyticsKPIs;
  outreach_by_status: StatusCount[];
  distribution_by_tier: DistributionItem[];
  distribution_by_sector: DistributionItem[];
  activity_over_time: TimeSeriesPoint[];
  time_bucket: 'daily' | 'weekly' | 'monthly';
  gap_by_industry: GapByIndustry[];
  gap_kpi: { total_critical: number; companies_with_gaps: number; closed_gaps: number };
}

// ── Campaign AI Analysis ─────────────────────────────────────────────

export interface CampaignAnalysisSuggestion {
  contact_id: number;
  full_name: string;
  email: string;
  company_name: string;
  job_title?: string;
  relevance_tags?: string;
  match_score: number;
  matched_tags: string[];
  is_decision_maker?: boolean;
}

export interface CampaignAnalysisResult {
  analysis_id: number;
  extracted_themes: string[];
  suggested_contacts: CampaignAnalysisSuggestion[];
  total_matches: number;
}


// ── Coverage Gaps ────────────────────────────────────────────────────

export interface CoverageGap {
  id: number;
  company_name: string;
  industry?: string;
  tier?: string;
  contacts_in_crm?: number;
  critical_gap_count: number;
  potential_gap_count: number;
  total_gap_count: number;
  missing_domains_critical?: string;  // JSON array
  missing_titles_critical?: string;
  missing_domains_potential?: string;
  missing_titles_potential?: string;
  created_at: string;
}

export interface CoverageGapInfo {
  critical_gap_count: number;
  potential_gap_count: number;
  missing_domains_critical: string[];
  missing_titles_critical: string[];
  missing_domains_potential: string[];
  missing_titles_potential: string[];
}

// ── Campaign Builder ─────────────────────────────────────────────────

export interface FilterGroupFilters {
  client_tier: string[];
  sector: string[];
  responsibility_domain: string[];
  group_domicile: string[];
  owner_business_area: string[];
  owner_team: string[];
  relevance_tag: string[];
  search: string;
  is_decision_maker: '' | 'true' | 'false';
}

export interface FilterGroup {
  id: string;
  type: 'filter' | 'individual';
  filters: FilterGroupFilters;
  contactIds: number[];  // for type='individual'
  contactLabels: { id: number; name: string; email: string }[];  // display info
}

export type GroupCombineOperator = 'or' | 'and';

export interface GroupedPreviewResponse {
  total_count: number;
  group_counts: number[];
  contacts: {
    id: number;
    full_name: string;
    email: string;
    company_name: string;
    job_title: string;
    responsibility_domain: string;
    client_tier: string;
    group_domicile: string;
    is_decision_maker: boolean;
    relevance_tags: string;
  }[];
}

export interface QuickCreateContactRequest {
  name: string;
  email: string;
  company_name?: string;
  job_title?: string;
  responsibility_domain?: string;
}

