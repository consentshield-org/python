-- BFSI Starter sectoral template — authored 2026-04-18.
-- (c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com
--
-- Seeds one published row into admin.sectoral_templates with the
-- 'bfsi_starter' code (version 1). The template carries 12 DPDP-aligned
-- purpose definitions covering the essential BFSI consent surfaces
-- (KYC, CKYC, credit bureau, AA, marketing, call recording, fraud,
-- collections, third-party sharing, regulatory reporting, location for
-- field verification, biometric/Aadhaar eKYC).
--
-- Sources (all accessed 2026-04-18):
--   * DPDP Act, 2023 (MeitY official PDF)
--       https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf
--   * DPDP Rules, 2025 (PIB notified copy, 14-Nov-2025)
--       https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf
--   * RBI Master Direction — Know Your Customer (KYC) Direction, 2016 (updated)
--       https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=11566
--   * RBI Guidelines on Digital Lending, 02-Sep-2022 (RBI/2022-23/111)
--       https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12382&Mode=0
--   * RBI Master Direction — NBFC Account Aggregator (RBI/DNBR/2016-17/46)
--       https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=10598
--   * SEBI (Intermediaries) Regulations, 2008
--       https://www.sebi.gov.in/acts/intermediaryreg.pdf
--   * SEBI KYC (Know Your Client) Registration Agency Regulations, 2011
--       https://www.sebi.gov.in/sebi_data/commondocs/kycregulation_p.pdf
--
-- Rule 3 discipline (definitive-architecture §7): data_scope values are
-- category declarations only ('pan_number', 'bank_account_number', ...).
-- No PAN / Aadhaar / account numbers / balances / transactions / bureau
-- pulls / KYC documents appear as values in this migration.
--
-- Purpose object shape follows the keys consumed by
-- public.apply_sectoral_template (see 20260424000004_apply_template_materialise.sql):
--     purpose_code, display_name, description, data_scope (text[]),
--     default_expiry_days (int), auto_delete_on_expiry (bool),
--     framework ('dpdp' | 'dpdp+rbi' | ...)
-- Informational keys (legal_basis, sector_regulation_refs,
-- is_default_enabled) are carried alongside; the materialiser ignores
-- them, but the admin template editor + future DEPA surfaces can read
-- them from purpose_definitions.
--
-- created_by / published_by attribution: admin.sectoral_templates
-- requires a non-null admin.admin_users reference. We prefer the
-- bootstrap admin; if none exists we fall back to the oldest active
-- platform_operator. If neither exists, the insert is skipped (benign)
-- and the migration can be re-run after an admin is created.

with chosen_admin as (
  (select id, 1 as pri
     from admin.admin_users
    where bootstrap_admin = true
      and status = 'active')
  union all
  (select id, 2 as pri
     from admin.admin_users
    where status = 'active'
      and admin_role = 'platform_operator'
    order by created_at asc)
  order by pri asc
  limit 1
)
insert into admin.sectoral_templates (
  template_code, display_name, description, sector, version,
  status, purpose_definitions, created_by, published_at, published_by
)
select
  'bfsi_starter',
  'BFSI Starter',
  'DPDP-aligned consent baseline for NBFCs, banks, brokers, payment aggregators, and insurance aggregators that must interoperate with RBI KYC / Digital Lending / Account Aggregator and SEBI intermediary regulations.',
  'bfsi',
  1,
  'published',
  $$[
    {
      "purpose_code": "kyc_account_opening",
      "display_name": "Account opening and customer identification",
      "description": "We collect identification details, address proof and contact information to verify your identity and open your account, as required by Indian anti-money-laundering law. Your identity details are used only to establish the banking/NBFC relationship and meet RBI KYC obligations; withdrawal will end the onboarding but existing records must be retained for the statutory period.",
      "data_scope": ["full_name", "date_of_birth", "address", "pan_number", "aadhaar_reference_number", "mobile_number", "email", "photograph", "signature"],
      "default_expiry_days": 3650,
      "auto_delete_on_expiry": false,
      "framework": "dpdp+rbi",
      "legal_basis": "legal_obligation",
      "is_default_enabled": true,
      "sector_regulation_refs": ["RBI Master Direction KYC 2016 §3, §16", "PMLA 2002 §12", "DPDP Act 2023 §7(b)"]
    },
    {
      "purpose_code": "ckyc_registry_submission",
      "display_name": "Submission of KYC records to the Central KYC Registry (CKYCR)",
      "description": "Your verified KYC record is uploaded to the Central KYC Registry operated by CERSAI so that other regulated entities can re-use it without asking you to repeat KYC. We share only what is prescribed by the CKYC template; the CKYC Identifier is returned to us and stored with your account record.",
      "data_scope": ["full_name", "date_of_birth", "address", "pan_number", "ckyc_identifier", "photograph"],
      "default_expiry_days": 3650,
      "auto_delete_on_expiry": false,
      "framework": "dpdp+rbi",
      "legal_basis": "legal_obligation",
      "is_default_enabled": true,
      "sector_regulation_refs": ["RBI Master Direction KYC 2016 §56", "PMLA Rules 2005 Rule 9A"]
    },
    {
      "purpose_code": "credit_bureau_pull_report",
      "display_name": "Credit bureau enquiries and reporting",
      "description": "We pull your credit report from credit information companies (CIBIL / Experian / Equifax / CRIF) to assess loan or credit-card eligibility, and we report your repayment behaviour to them on a monthly basis. Declining this means we cannot offer credit products that require bureau underwriting; regulatory reporting of existing exposures continues under the Credit Information Companies Act.",
      "data_scope": ["full_name", "date_of_birth", "pan_number", "address", "mobile_number", "loan_account_reference", "repayment_status_category"],
      "default_expiry_days": 2555,
      "auto_delete_on_expiry": false,
      "framework": "dpdp+rbi",
      "legal_basis": "legal_obligation",
      "is_default_enabled": true,
      "sector_regulation_refs": ["Credit Information Companies (Regulation) Act 2005 §17", "RBI Digital Lending Guidelines 2022 §C"]
    },
    {
      "purpose_code": "account_aggregator_data_sharing",
      "display_name": "Financial data sharing via Account Aggregator",
      "description": "With your consent given through a licensed Account Aggregator, we receive the specific financial information (for example, bank-account or investment summaries) you choose to share, for the purpose, duration and frequency stated in the AA consent artefact. We do not retain the data beyond what the artefact permits, and you can revoke the AA consent at any time through the AA app.",
      "data_scope": ["aa_consent_artefact_id", "fip_identifier", "financial_information_category", "consent_purpose_code", "consent_validity_window"],
      "default_expiry_days": 365,
      "auto_delete_on_expiry": true,
      "framework": "dpdp+rbi",
      "legal_basis": "consent",
      "is_default_enabled": false,
      "sector_regulation_refs": ["RBI NBFC-AA Master Direction 2016 §5, §6", "DPDP Act 2023 §6"]
    },
    {
      "purpose_code": "marketing_affiliated_products",
      "display_name": "Marketing and cross-sell of affiliated financial products",
      "description": "We would like to send you communications about loans, cards, investments, insurance and other products offered by us or our group companies, through email, SMS, in-app notifications or calls. This is optional — declining has no effect on the products you already use, and you can withdraw consent any time from the preferences screen.",
      "data_scope": ["full_name", "mobile_number", "email", "product_interest_category", "contact_channel_preference"],
      "default_expiry_days": 365,
      "auto_delete_on_expiry": true,
      "framework": "dpdp",
      "legal_basis": "consent",
      "is_default_enabled": false,
      "sector_regulation_refs": ["DPDP Act 2023 §6", "TRAI TCCCPR 2018"]
    },
    {
      "purpose_code": "call_recording_quality_dispute",
      "display_name": "Call recording for quality and dispute resolution",
      "description": "Calls between you and our customer-service or collections teams may be recorded and retained for a limited period so we can audit service quality, train our staff and resolve disputes raised by you or by a regulator. Recordings are accessed only by authorised personnel and are deleted after the retention period unless needed for an ongoing investigation.",
      "data_scope": ["voice_recording_reference", "call_metadata", "agent_identifier", "customer_identifier"],
      "default_expiry_days": 365,
      "auto_delete_on_expiry": true,
      "framework": "dpdp",
      "legal_basis": "legitimate_use",
      "is_default_enabled": true,
      "sector_regulation_refs": ["RBI Ombudsman Scheme 2021 §16", "DPDP Act 2023 §7(a)"]
    },
    {
      "purpose_code": "fraud_monitoring_risk_scoring",
      "display_name": "Transaction fraud monitoring and risk scoring",
      "description": "We analyse your transaction patterns, device signals and login behaviour in real time to detect and block fraudulent activity on your account, and to meet RBI reporting obligations on suspicious transactions. This processing is essential to keeping your money and account safe; you cannot opt out of the fraud-prevention part, but profiling used purely for optional features is handled under separate consent.",
      "data_scope": ["transaction_metadata", "device_fingerprint_hash", "ip_address_truncated", "geolocation_region", "risk_score"],
      "default_expiry_days": 2190,
      "auto_delete_on_expiry": false,
      "framework": "dpdp+rbi",
      "legal_basis": "legal_obligation",
      "is_default_enabled": true,
      "sector_regulation_refs": ["RBI Master Direction on Digital Payment Security Controls 2021", "PMLA 2002 §12"]
    },
    {
      "purpose_code": "collections_contact",
      "display_name": "Collections contact for overdue amounts",
      "description": "If an amount owed to us becomes overdue we may contact you (or an authorised representative you have given us) by voice call, SMS, email or a field visit, within the hours and manner permitted by the RBI Fair Practices Code. We record the outreach and your responses so that contact stays within regulatory limits; you can nominate a preferred contact channel from the preferences screen.",
      "data_scope": ["full_name", "mobile_number", "email", "registered_address", "loan_account_reference", "overdue_status_category", "contact_log"],
      "default_expiry_days": 2555,
      "auto_delete_on_expiry": false,
      "framework": "dpdp+rbi",
      "legal_basis": "legitimate_use",
      "is_default_enabled": true,
      "sector_regulation_refs": ["RBI Fair Practices Code for NBFCs 2015", "RBI Digital Lending Guidelines 2022 §F"]
    },
    {
      "purpose_code": "third_party_service_providers",
      "display_name": "Sharing with service providers (cloud, analytics, communications)",
      "description": "We use trusted service providers — cloud hosting, analytics, email/SMS delivery and fraud-intelligence vendors — to run the service. We share only the personal data each provider needs to do its specific task, under a written data-processing contract that binds the provider to the same protections as us. A current list of material processors is available on request.",
      "data_scope": ["identifier_reference", "contact_channel_reference", "transaction_metadata", "device_fingerprint_hash"],
      "default_expiry_days": 365,
      "auto_delete_on_expiry": true,
      "framework": "dpdp",
      "legal_basis": "legitimate_use",
      "is_default_enabled": true,
      "sector_regulation_refs": ["DPDP Act 2023 §8(2)", "RBI Outsourcing Guidelines for Financial Services 2006"]
    },
    {
      "purpose_code": "regulatory_reporting",
      "display_name": "Regulatory and statutory reporting",
      "description": "We submit reports, returns and incident notifications to Indian regulators (RBI, SEBI, IRDAI as applicable), FIU-IND for suspicious transactions, and CERT-In for cyber incidents, in the format and timelines set by each regulator. Withdrawal of consent does not affect this processing because it is required by law.",
      "data_scope": ["identifier_reference", "transaction_summary_category", "incident_metadata", "reporting_entity_code"],
      "default_expiry_days": 3650,
      "auto_delete_on_expiry": false,
      "framework": "dpdp+rbi",
      "legal_basis": "legal_obligation",
      "is_default_enabled": true,
      "sector_regulation_refs": ["PMLA 2002 §12", "CERT-In Directions 28-Apr-2022", "RBI Master Direction KYC 2016 §51"]
    },
    {
      "purpose_code": "location_field_verification",
      "display_name": "Location tracking for specific lending products",
      "description": "For certain secured or field-verified loan products we use your device location, only during the onboarding or field-verification step, to confirm that the address you gave us is correct and to route our verification officer. Location is captured at the moment of the check and is not tracked continuously; declining means we may need to verify your address through a physical branch visit instead.",
      "data_scope": ["geolocation_point_sampled", "verification_event_id", "device_identifier_reference"],
      "default_expiry_days": 180,
      "auto_delete_on_expiry": true,
      "framework": "dpdp+rbi",
      "legal_basis": "consent",
      "is_default_enabled": false,
      "sector_regulation_refs": ["RBI Digital Lending Guidelines 2022 §D (data-minimisation)", "DPDP Act 2023 §6"]
    },
    {
      "purpose_code": "biometric_ekyc_face_match",
      "display_name": "Biometric authentication (Aadhaar eKYC, face match)",
      "description": "To verify that the person opening the account is genuinely you, we run an Aadhaar-based eKYC check or a live face-match against a government-issued document, using UIDAI-authorised channels. We never store your raw Aadhaar number or your biometric; we retain only the eKYC/face-match result token and the verification timestamp. You can choose an offline KYC path instead.",
      "data_scope": ["ekyc_reference_token", "face_match_result", "verification_timestamp", "aadhaar_last_four_only"],
      "default_expiry_days": 3650,
      "auto_delete_on_expiry": false,
      "framework": "dpdp+rbi",
      "legal_basis": "consent",
      "is_default_enabled": false,
      "sector_regulation_refs": ["Aadhaar Act 2016 §8", "RBI Master Direction KYC 2016 §16-17", "DPDP Act 2023 §6"]
    }
  ]$$::jsonb,
  ca.id,
  now(),
  ca.id
from chosen_admin ca
on conflict (template_code, version) do nothing;

-- Verification (run manually after db push):
--   select template_code, status, jsonb_array_length(purpose_definitions)
--     from admin.sectoral_templates where template_code = 'bfsi_starter';
--   expected: ('bfsi_starter', 'published', 12)
