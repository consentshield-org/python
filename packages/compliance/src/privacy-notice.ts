// Privacy notice composition from org config + data inventory
// Produces a DPDP-compliant notice covering required disclosures (Section 5)

interface InventoryItem {
  data_category: string
  collection_source: string | null
  purposes: string[]
  legal_basis: string
  retention_period: string | null
  third_parties: string[]
  data_locations: string[]
}

interface OrgContext {
  name: string
  compliance_contact_email: string | null
  dpo_name: string | null
}

export interface NoticeSection {
  heading: string
  body: string
}

export function composePrivacyNotice(
  org: OrgContext,
  inventory: InventoryItem[],
): NoticeSection[] {
  const sections: NoticeSection[] = []

  // 1. Identity of the Data Fiduciary
  sections.push({
    heading: 'Who we are',
    body: `${org.name} ("we", "us", "our") is the Data Fiduciary responsible for the personal data you provide. Under the Digital Personal Data Protection Act 2023, we are accountable for how your data is processed.${
      org.compliance_contact_email
        ? ` You can contact us at ${org.compliance_contact_email}.`
        : ''
    }${org.dpo_name ? ` Our Data Protection Officer is ${org.dpo_name}.` : ''}`,
  })

  // 2. Categories of personal data we process
  const categories =
    inventory.length > 0
      ? inventory.map((i) => `• ${formatCategory(i.data_category)}`).join('\n')
      : '(No data categories documented yet — please complete the data inventory.)'
  sections.push({
    heading: 'What data we process',
    body: `We process the following categories of personal data:\n\n${categories}`,
  })

  // 3. Purposes of processing
  const purposesSet = new Set<string>()
  inventory.forEach((i) => i.purposes.forEach((p) => purposesSet.add(p)))
  const purposes =
    purposesSet.size > 0
      ? Array.from(purposesSet).map((p) => `• ${formatPurpose(p)}`).join('\n')
      : '(No purposes documented yet.)'
  sections.push({
    heading: 'Why we process it',
    body: `We process your personal data for the following purposes:\n\n${purposes}`,
  })

  // 4. Legal basis (DPDP recognises consent + legitimate uses)
  const bases = new Set(inventory.map((i) => i.legal_basis))
  sections.push({
    heading: 'Our legal basis',
    body: bases.size > 0
      ? `We rely on the following lawful bases for processing under DPDP and applicable law:\n\n${Array.from(bases)
          .map((b) => `• ${formatLegalBasis(b)}`)
          .join('\n')}`
      : 'We rely primarily on your consent for processing personal data.',
  })

  // 5. Retention
  const retentions = inventory
    .filter((i) => i.retention_period)
    .map((i) => `• ${formatCategory(i.data_category)}: ${i.retention_period}`)
  sections.push({
    heading: 'How long we keep it',
    body:
      retentions.length > 0
        ? `Retention periods vary by data category:\n\n${retentions.join('\n')}\n\nWhen the retention period ends, we delete or anonymise the data.`
        : 'We retain personal data only for as long as necessary to fulfil the purposes described above, or as required by law.',
  })

  // 6. Sharing with third parties
  const thirdParties = new Set<string>()
  inventory.forEach((i) => i.third_parties.forEach((tp) => thirdParties.add(tp)))
  sections.push({
    heading: 'Who we share it with',
    body:
      thirdParties.size > 0
        ? `We share personal data with the following processors and partners:\n\n${Array.from(thirdParties)
            .map((tp) => `• ${tp}`)
            .join('\n')}\n\nEach processor is bound by a Data Processing Agreement and may only process data on our instructions.`
        : 'We do not share your personal data with third parties except where required by law.',
  })

  // 7. Cross-border transfers
  const locations = new Set<string>()
  inventory.forEach((i) => i.data_locations.forEach((l) => locations.add(l)))
  const nonIN = Array.from(locations).filter((l) => l !== 'IN' && l !== 'India')
  sections.push({
    heading: 'Where your data is stored',
    body:
      nonIN.length > 0
        ? `Some of your data is processed outside India, in: ${nonIN.join(', ')}. Cross-border transfers are subject to safeguards required under DPDP Section 16.`
        : 'Your data is processed within India.',
  })

  // 8. Your rights as a Data Principal
  sections.push({
    heading: 'Your rights',
    body: `Under DPDP 2023, you have the right to:\n\n• Access your personal data\n• Correct or update inaccurate data\n• Erase your data (subject to legal retention)\n• Withdraw consent at any time\n• Nominate someone to act on your behalf\n\nTo exercise any of these rights, contact us at ${
      org.compliance_contact_email || 'the email provided in this notice'
    }. We will respond within 30 days.`,
  })

  // 9. Complaints
  sections.push({
    heading: 'Complaints',
    body: `If you believe your rights have been violated, you may file a complaint with the Data Protection Board of India at https://dpboard.gov.in once it becomes operational, or with us directly at ${
      org.compliance_contact_email || 'our compliance address'
    }.`,
  })

  // 10. Updates
  sections.push({
    heading: 'Updates to this notice',
    body: `We may update this notice from time to time to reflect changes in our processing or in the law. The current version is always available at this URL.`,
  })

  return sections
}

function formatCategory(slug: string): string {
  return slug
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function formatPurpose(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1).replace(/_/g, ' ')
}

function formatLegalBasis(slug: string): string {
  const map: Record<string, string> = {
    consent: 'Consent — you have given clear consent for this specific purpose',
    contract: 'Contract — processing is necessary for a contract with you',
    legal_obligation: 'Legal obligation — we are required by law to process this data',
    legitimate_interest:
      'Legitimate interest — processing is necessary for our legitimate business interests',
    vital_interests: 'Vital interests — processing protects life or physical safety',
    public_task: 'Public task — processing is necessary for a task in the public interest',
  }
  return map[slug] || slug
}
