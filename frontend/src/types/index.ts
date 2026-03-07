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
  profile_description?: string;
  outreach_target_per_week: number;
  outreach_target_per_month?: number | null;
  is_active: boolean;
  approval_status?: ApprovalStatus;
  uploaded_batch_id?: string;
  team_id?: number;
  business_area_id?: number;
  site_id?: number;
  team_name?: string;
  business_area_name?: string;
  site_name?: string;
  site_languages?: EmployeeSiteLanguage[];
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
  company_name?: string;
  client_name?: string;
  sector?: string;
  client_tier?: string;
  responsibility_domain?: string;
  group_domicile?: string;
  owner_name?: string;
  owner_business_area?: string;
  owner_team?: string;
  last_activity_date?: string;
  has_historical_revenue: boolean;
  revenue?: number;
  days_since_interaction?: number;
  relevant_search?: boolean;
  status: string;
  priority_score?: number;
  is_pinned: boolean;
  contact_flags?: string[];
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
}

export interface Negation {
  id: number;
  outreach_record_id: number;
  employee_id: number;
  reason: NegationReason;
  notes?: string;
  created_at: string;
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
}
