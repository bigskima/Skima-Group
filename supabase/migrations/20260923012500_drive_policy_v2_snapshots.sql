begin;


do $sync$
declare
  doc_id uuid;
  old_id uuid;
begin
  select id into doc_id from public.policy_documents where key='policy.privacy.notice';
  if doc_id is null then
    raise exception 'policy document policy.privacy.notice is missing';
  end if;

  if not exists (
    select 1 from public.policy_versions
    where policy_document_id=doc_id and version_label='2.0'
  ) then
    select id into old_id
    from public.policy_versions
    where policy_document_id=doc_id and status='published'
    order by effective_from desc nulls last,published_at desc nulls last
    limit 1;

    if old_id is not null then
      update public.policy_versions
      set status='superseded',
          effective_until=coalesce(effective_until,timezone('utc',now())),
          updated_at=timezone('utc',now())
      where id=old_id;
    end if;

    insert into public.policy_versions(
      policy_document_id,version_label,summary_content,full_content,content_format,content_hash,status,
      effective_from,published_at,requires_reacceptance,source_url,source_reference,source_updated_at,
      supersedes_version_id,metadata
    )
    select
      doc_id,'2.0',document.summary_content,$p0$SKIMA
# Privacy Notice — Nigeria
Version 2.0 · Updated 23 September 2026
For customers, Driver Partners, SKIMA Managed Drivers, Station Partners, applicants and administrators
## 1. Purpose and scope
This Privacy Notice explains how SKIMA Group processes personal data when people use SKIMA services, apply to participate, carry out LPG operations, use the SKIMA Wallet or supported utility services, contact support, use SKIMA AI features, or administer the platform.
This notice is read together with the terms that apply to a person’s role. It does not replace a role-specific agreement, safety notice, or transaction-specific disclosure.
## 2. Information SKIMA may process
Account and contact information may include name, email address, phone number, account identifiers, profile details, authentication and security events.
Customer service information may include saved service locations, cylinder records, order history, refill quantity, pickup and return events, support messages, ratings, complaints and safety reports.
Partner and workforce information may include identity and application details, driver licence information, vehicle records, station or business information, service-area information, verification results, training or compliance evidence, payout details, availability and operational performance.
Location information may include saved customer locations, a station’s operating location and, for drivers, device location while location sharing is enabled for job matching, active fulfilment, safety, custody or delivery tracking.
Financial information may include SKIMA Wallet records, transaction references, deposits, withdrawals, refunds, settlement records, utility-service payments, payout beneficiary details and provider status. SKIMA should not store full payment-card credentials when the payment provider is responsible for collecting them.
Verification media may include documents, photographs and, where a configured verification provider requires it, identity or liveness evidence. Private KYC and verification media are not public profile content. Public station or driver presentation media is handled separately from confidential verification evidence.
Technical and security information may include device and session information, logs, error records, fraud signals, audit events and information reasonably required to protect an account or investigate an incident.
## 3. Why SKIMA processes personal data
SKIMA may process personal data to create and secure accounts; determine service availability; register and identify cylinders; create quotes and orders; coordinate pickup, refill and return; operate partner or SKIMA-managed fulfilment where enabled; provide tracking; process payments, wallet activity, refunds, settlements and withdrawals; provide utility services; verify applicants, drivers, vehicles and stations; prevent fraud and cylinder switching; support users; investigate complaints and safety incidents; maintain audit records; comply with law; and improve service reliability.
Where required by applicable law, SKIMA will rely on an appropriate lawful basis for each purpose, such as performance of a contract, compliance with a legal obligation, consent where consent is appropriate, or a legitimate operational or security interest permitted by law.
## 4. Location and background location
Customer location is used to help identify a service point, determine coverage, support routing and delivery, and investigate relevant service disputes. Customers can control device location permission, although some location-dependent features may become unavailable.
Driver location is more operationally sensitive. A Driver Partner or SKIMA Managed Driver may share location while marked online, while being considered for nearby work, or while completing an assigned job. SKIMA may use the location to match work, track an active cylinder journey, support customer visibility, protect custody and safety, and investigate a delivery incident.
Going offline should stop background location sharing for new-job matching. Location is not intended to be displayed publicly. SKIMA should not continuously collect driver location beyond what is reasonably necessary for the disclosed operational, safety, security or legal purpose.
## 5. Maps, routing and address services
SKIMA may use device location and third-party or open mapping data to display maps, identify places, reverse-geocode coordinates, estimate routes or calculate operational distance. A map display provider may receive the technical requests needed to deliver map tiles. Routing or geocoding providers may receive coordinates or search text needed for the requested operation.
SKIMA’s architecture is provider-agnostic. A change of map provider does not change the privacy rule: only the information reasonably required for the map, route or address operation should be sent.
## 6. Payments, wallet activity and payout accounts
SKIMA may use licensed or otherwise appropriate payment providers to initialize payments, verify transactions, resolve bank accounts, execute transfers and process provider webhooks. The SKIMA Wallet is an in-app financial record used for supported services; it should not be represented as a bank deposit account unless the applicable regulated structure supports that description.
When a payout account is added, SKIMA may send the bank code and account number to the configured payout provider to confirm the registered account name and create a transfer recipient. The app may retain masked account information and provider references rather than displaying the full account number after setup.
## 7. Utility services
When airtime, data, electricity or another supported utility service is used, SKIMA may process the customer identifier, selected provider or biller, amount, service reference, wallet/payment information and provider result needed to complete, reconcile or reverse the transaction.
## 8. Identity, verification and media privacy
SKIMA may use configured verification providers to verify identity, liveness, documents, licences, station information or other eligibility requirements. The information collected depends on the role and verification step.
Private KYC, private verification and internal-only media must not be exposed as public profile content. Public-safe station premises media or approved profile media may be displayed publicly only when the relevant publication rules allow it.
## 9. SKIMA AI and automated assistance
SKIMA provides AI-assisted features for users and administrators. A prompt may be sent to a configured AI provider together with the minimum authorised context needed for the task. SKIMA AI should respect the user’s workspace and permission scope and should not reveal protected credentials, private KYC records or another person’s restricted information.
AI may assist with explanations, support triage, cylinder-image presentation, operational summaries, risk signals, pricing or dispatch review and other configured capabilities. AI output is advisory unless the product explicitly records a separate authoritative backend action. Safety, financial, approval and compliance decisions remain governed by applicable backend rules and authorised human processes.
Where automated processing materially affects a person, SKIMA will provide an appropriate review or correction path where required by applicable law.
## 10. Who SKIMA may share information with
SKIMA may share information with the assigned driver, eligible station, SKIMA Managed Driver team, payment or payout provider, utility provider, verification provider, mapping or routing provider, cloud hosting and storage provider, communications provider, support or security provider, professional adviser, insurer, regulator, court or law-enforcement body when the disclosure is reasonably necessary and lawful.
A driver receives only the customer and order information needed to perform the assigned job. A station receives only the order, cylinder and fulfilment information reasonably required for the refill. Partners must not sell, publish or reuse customer data for unrelated purposes.
## 11. International or cross-border processing
Some service providers may process information outside Nigeria. Where a cross-border transfer occurs, SKIMA will apply the safeguards or other lawful transfer mechanism required by applicable Nigerian data-protection law.
## 12. Retention and deletion
SKIMA retains personal data only for as long as reasonably necessary for the purpose for which it was collected and for applicable legal, accounting, tax, fraud-prevention, safety, dispute, audit and regulatory requirements.
Closing an account does not automatically require immediate deletion of every transaction, safety, legal or audit record. Where data is no longer required and no lawful retention basis remains, SKIMA should delete, anonymise or otherwise securely dispose of it.
## 13. Security
SKIMA uses role- and permission-based access, secure authentication, audit records, protected server-side credentials, restricted media classes and other reasonable technical and organisational controls. No online system can promise absolute security.
Users should keep passwords and one-time codes private. Administrators must not copy protected service credentials into chat, documents, screenshots or AI prompts. Suspected account compromise or data misuse should be reported promptly.
## 14. Your privacy rights
Subject to applicable law and lawful limitations, a person may have rights to be informed, request access, correct inaccurate data, object to or restrict certain processing, request deletion where applicable, request portability where applicable, withdraw consent where processing depends on consent, and seek review of certain significant automated decisions.
A person may also complain to the Nigeria Data Protection Commission where the law permits. SKIMA may need to verify identity before acting on a privacy request.
## 15. Children and legal capacity
SKIMA services are intended for people who can lawfully enter the relevant transaction or agreement. SKIMA does not intentionally design normal LPG ordering, driver participation or station participation as a child-directed service.
## 16. Changes to this notice
SKIMA may update this notice when services, providers, laws, safety requirements or data practices change. Material changes should be communicated appropriately and the current version should remain available.
## 17. Contact and privacy requests
Use the official SKIMA support or privacy channel shown in the app, website or authorised service interface. Do not send passwords, one-time codes, full payment credentials or unnecessary identity documents through unofficial channels.
## 18. Regulatory references
This notice is designed with reference to the Nigeria Data Protection Act 2023 and the Nigeria Data Protection Commission’s General Application and Implementation Directive (GAID) 2025. Consumer-facing transparency also reflects the Federal Competition and Consumer Protection Act 2018 and FCCPC guidance.
Official references:
Nigeria Data Protection Commission — https://ndpc.gov.ng/
Federal Competition and Consumer Protection Commission — https://fccpc.gov.ng/
This document is an operational privacy notice and should be reviewed with qualified Nigerian legal/data-protection advisers before final regulated launch where required.$p0$,'markdown',
      encode(extensions.digest($p0$SKIMA
# Privacy Notice — Nigeria
Version 2.0 · Updated 23 September 2026
For customers, Driver Partners, SKIMA Managed Drivers, Station Partners, applicants and administrators
## 1. Purpose and scope
This Privacy Notice explains how SKIMA Group processes personal data when people use SKIMA services, apply to participate, carry out LPG operations, use the SKIMA Wallet or supported utility services, contact support, use SKIMA AI features, or administer the platform.
This notice is read together with the terms that apply to a person’s role. It does not replace a role-specific agreement, safety notice, or transaction-specific disclosure.
## 2. Information SKIMA may process
Account and contact information may include name, email address, phone number, account identifiers, profile details, authentication and security events.
Customer service information may include saved service locations, cylinder records, order history, refill quantity, pickup and return events, support messages, ratings, complaints and safety reports.
Partner and workforce information may include identity and application details, driver licence information, vehicle records, station or business information, service-area information, verification results, training or compliance evidence, payout details, availability and operational performance.
Location information may include saved customer locations, a station’s operating location and, for drivers, device location while location sharing is enabled for job matching, active fulfilment, safety, custody or delivery tracking.
Financial information may include SKIMA Wallet records, transaction references, deposits, withdrawals, refunds, settlement records, utility-service payments, payout beneficiary details and provider status. SKIMA should not store full payment-card credentials when the payment provider is responsible for collecting them.
Verification media may include documents, photographs and, where a configured verification provider requires it, identity or liveness evidence. Private KYC and verification media are not public profile content. Public station or driver presentation media is handled separately from confidential verification evidence.
Technical and security information may include device and session information, logs, error records, fraud signals, audit events and information reasonably required to protect an account or investigate an incident.
## 3. Why SKIMA processes personal data
SKIMA may process personal data to create and secure accounts; determine service availability; register and identify cylinders; create quotes and orders; coordinate pickup, refill and return; operate partner or SKIMA-managed fulfilment where enabled; provide tracking; process payments, wallet activity, refunds, settlements and withdrawals; provide utility services; verify applicants, drivers, vehicles and stations; prevent fraud and cylinder switching; support users; investigate complaints and safety incidents; maintain audit records; comply with law; and improve service reliability.
Where required by applicable law, SKIMA will rely on an appropriate lawful basis for each purpose, such as performance of a contract, compliance with a legal obligation, consent where consent is appropriate, or a legitimate operational or security interest permitted by law.
## 4. Location and background location
Customer location is used to help identify a service point, determine coverage, support routing and delivery, and investigate relevant service disputes. Customers can control device location permission, although some location-dependent features may become unavailable.
Driver location is more operationally sensitive. A Driver Partner or SKIMA Managed Driver may share location while marked online, while being considered for nearby work, or while completing an assigned job. SKIMA may use the location to match work, track an active cylinder journey, support customer visibility, protect custody and safety, and investigate a delivery incident.
Going offline should stop background location sharing for new-job matching. Location is not intended to be displayed publicly. SKIMA should not continuously collect driver location beyond what is reasonably necessary for the disclosed operational, safety, security or legal purpose.
## 5. Maps, routing and address services
SKIMA may use device location and third-party or open mapping data to display maps, identify places, reverse-geocode coordinates, estimate routes or calculate operational distance. A map display provider may receive the technical requests needed to deliver map tiles. Routing or geocoding providers may receive coordinates or search text needed for the requested operation.
SKIMA’s architecture is provider-agnostic. A change of map provider does not change the privacy rule: only the information reasonably required for the map, route or address operation should be sent.
## 6. Payments, wallet activity and payout accounts
SKIMA may use licensed or otherwise appropriate payment providers to initialize payments, verify transactions, resolve bank accounts, execute transfers and process provider webhooks. The SKIMA Wallet is an in-app financial record used for supported services; it should not be represented as a bank deposit account unless the applicable regulated structure supports that description.
When a payout account is added, SKIMA may send the bank code and account number to the configured payout provider to confirm the registered account name and create a transfer recipient. The app may retain masked account information and provider references rather than displaying the full account number after setup.
## 7. Utility services
When airtime, data, electricity or another supported utility service is used, SKIMA may process the customer identifier, selected provider or biller, amount, service reference, wallet/payment information and provider result needed to complete, reconcile or reverse the transaction.
## 8. Identity, verification and media privacy
SKIMA may use configured verification providers to verify identity, liveness, documents, licences, station information or other eligibility requirements. The information collected depends on the role and verification step.
Private KYC, private verification and internal-only media must not be exposed as public profile content. Public-safe station premises media or approved profile media may be displayed publicly only when the relevant publication rules allow it.
## 9. SKIMA AI and automated assistance
SKIMA provides AI-assisted features for users and administrators. A prompt may be sent to a configured AI provider together with the minimum authorised context needed for the task. SKIMA AI should respect the user’s workspace and permission scope and should not reveal protected credentials, private KYC records or another person’s restricted information.
AI may assist with explanations, support triage, cylinder-image presentation, operational summaries, risk signals, pricing or dispatch review and other configured capabilities. AI output is advisory unless the product explicitly records a separate authoritative backend action. Safety, financial, approval and compliance decisions remain governed by applicable backend rules and authorised human processes.
Where automated processing materially affects a person, SKIMA will provide an appropriate review or correction path where required by applicable law.
## 10. Who SKIMA may share information with
SKIMA may share information with the assigned driver, eligible station, SKIMA Managed Driver team, payment or payout provider, utility provider, verification provider, mapping or routing provider, cloud hosting and storage provider, communications provider, support or security provider, professional adviser, insurer, regulator, court or law-enforcement body when the disclosure is reasonably necessary and lawful.
A driver receives only the customer and order information needed to perform the assigned job. A station receives only the order, cylinder and fulfilment information reasonably required for the refill. Partners must not sell, publish or reuse customer data for unrelated purposes.
## 11. International or cross-border processing
Some service providers may process information outside Nigeria. Where a cross-border transfer occurs, SKIMA will apply the safeguards or other lawful transfer mechanism required by applicable Nigerian data-protection law.
## 12. Retention and deletion
SKIMA retains personal data only for as long as reasonably necessary for the purpose for which it was collected and for applicable legal, accounting, tax, fraud-prevention, safety, dispute, audit and regulatory requirements.
Closing an account does not automatically require immediate deletion of every transaction, safety, legal or audit record. Where data is no longer required and no lawful retention basis remains, SKIMA should delete, anonymise or otherwise securely dispose of it.
## 13. Security
SKIMA uses role- and permission-based access, secure authentication, audit records, protected server-side credentials, restricted media classes and other reasonable technical and organisational controls. No online system can promise absolute security.
Users should keep passwords and one-time codes private. Administrators must not copy protected service credentials into chat, documents, screenshots or AI prompts. Suspected account compromise or data misuse should be reported promptly.
## 14. Your privacy rights
Subject to applicable law and lawful limitations, a person may have rights to be informed, request access, correct inaccurate data, object to or restrict certain processing, request deletion where applicable, request portability where applicable, withdraw consent where processing depends on consent, and seek review of certain significant automated decisions.
A person may also complain to the Nigeria Data Protection Commission where the law permits. SKIMA may need to verify identity before acting on a privacy request.
## 15. Children and legal capacity
SKIMA services are intended for people who can lawfully enter the relevant transaction or agreement. SKIMA does not intentionally design normal LPG ordering, driver participation or station participation as a child-directed service.
## 16. Changes to this notice
SKIMA may update this notice when services, providers, laws, safety requirements or data practices change. Material changes should be communicated appropriately and the current version should remain available.
## 17. Contact and privacy requests
Use the official SKIMA support or privacy channel shown in the app, website or authorised service interface. Do not send passwords, one-time codes, full payment credentials or unnecessary identity documents through unofficial channels.
## 18. Regulatory references
This notice is designed with reference to the Nigeria Data Protection Act 2023 and the Nigeria Data Protection Commission’s General Application and Implementation Directive (GAID) 2025. Consumer-facing transparency also reflects the Federal Competition and Consumer Protection Act 2018 and FCCPC guidance.
Official references:
Nigeria Data Protection Commission — https://ndpc.gov.ng/
Federal Competition and Consumer Protection Commission — https://fccpc.gov.ng/
This document is an operational privacy notice and should be reviewed with qualified Nigerian legal/data-protection advisers before final regulated launch where required.$p0$,'sha256'),'hex'),'published',
      timezone('utc',now()),timezone('utc',now()),false,
      'https://docs.google.com/document/d/1vw43-cbquF7t4e4ZcAMxB_N8YGu6i-VUP3Mldvs0YsQ/edit?usp=drivesdk','gdrive:1vw43-cbquF7t4e4ZcAMxB_N8YGu6i-VUP3Mldvs0YsQ',timezone('utc',now()),old_id,
      jsonb_build_object(
        'sourceType','google_drive',
        'driveDocumentId','1vw43-cbquF7t4e4ZcAMxB_N8YGu6i-VUP3Mldvs0YsQ',
        'driveRevision','ANLCKQkdWmDoyHcP_jDKWNwsA452wXT1_ZTwXdunuY1ntrr1q3jHbh42pnrWtotDZdXZLSGJ7zlOA46uEttsSvV3iafRTYy5_l8KL4PXIfc',
        'syncedAt',timezone('utc',now())
      )
    from public.policy_documents document
    where document.id=doc_id;
  end if;
end
$sync$;


do $sync$
declare
  doc_id uuid;
  old_id uuid;
begin
  select id into doc_id from public.policy_documents where key='policy.customer.terms';
  if doc_id is null then
    raise exception 'policy document policy.customer.terms is missing';
  end if;

  if not exists (
    select 1 from public.policy_versions
    where policy_document_id=doc_id and version_label='2.0'
  ) then
    select id into old_id
    from public.policy_versions
    where policy_document_id=doc_id and status='published'
    order by effective_from desc nulls last,published_at desc nulls last
    limit 1;

    if old_id is not null then
      update public.policy_versions
      set status='superseded',
          effective_until=coalesce(effective_until,timezone('utc',now())),
          updated_at=timezone('utc',now())
      where id=old_id;
    end if;

    insert into public.policy_versions(
      policy_document_id,version_label,summary_content,full_content,content_format,content_hash,status,
      effective_from,published_at,requires_reacceptance,source_url,source_reference,source_updated_at,
      supersedes_version_id,metadata
    )
    select
      doc_id,'2.0',document.summary_content,$p1$SKIMA
# Customer Terms of Service & LPG Service Policy
Version 2.0 · Updated 23 September 2026
Applies to customers using SKIMA services in Nigeria
## 1. Quick summary
SKIMA coordinates service requests through the SKIMA app and related channels. For LPG, SKIMA may coordinate an eligible Station Partner and an approved Driver Partner, or use SKIMA-managed fulfilment and SKIMA-owned fleet capacity where that model is enabled and launch-ready.
Before you confirm an order, the app should show the cylinder, refill amount, service location and the material price components that apply. You should not be charged for LPG that was not supplied. SKIMA does not use a blanket “no refund” rule to remove rights that apply under law.
You must provide accurate account, cylinder and service-location information, protect your account and follow reasonable safety instructions.
## 2. Your account
You must be legally capable of entering the transaction you request. Information supplied to SKIMA should be accurate and reasonably current. Keep passwords, recovery links and one-time codes secure.
Do not use SKIMA for fraud, impersonation, cylinder switching, stolen property, unlawful activity or abuse of promotions. SKIMA may restrict an account where reasonably necessary for safety, fraud prevention, security or legal compliance and should provide a review path where appropriate.
## 3. Service availability and coverage
Creating an account does not guarantee that every SKIMA service is available everywhere. Availability can depend on enabled service areas, driver capacity, station capacity, SKIMA-owned fulfilment readiness, safety, regulation, network conditions and operational capacity.
The app may use your saved address, device location and map information to determine whether a service is available. If SKIMA cannot provide a paid service, the customer should receive the appropriate cancellation, reversal, refund or other lawful remedy for the service outcome.
## 4. Registering and identifying your cylinder
A cylinder submitted for normal LPG service should be registered or otherwise identified through SKIMA. Provide the cylinder size and other information you reasonably know to be correct.
Do not deliberately remove, copy, alter or transfer a SKIMA cylinder identity, QR code or other identifier in a way that could cause one cylinder to be mistaken for another. SKIMA may stop a journey where the scanned cylinder does not match the order.
## 5. Cylinder capacity and safety
The requested refill must not exceed the cylinder’s recorded or verified capacity. If the recorded capacity appears wrong, SKIMA may require correction or re-verification before a larger refill is accepted.
Tell SKIMA about a known leak, fire exposure, serious damage or other immediate safety concern. A driver, station or SKIMA operator may stop normal fulfilment where a cylinder appears unsafe. A safety stop is a precaution, not by itself a final technical diagnosis.
## 6. Quotes, price and fees
SKIMA should show the material charges before payment or final confirmation. Depending on the service, this may include the LPG amount, a platform or service fee, delivery or route-related fees, payment or withdrawal fees, utility-service fees, taxes where applicable, discounts, credits or promotions.
SKIMA does not hardcode one permanent public fee in these terms. Current commercial amounts are governed by the active configuration and should be shown to you before you commit to the transaction.
A quote may expire. After you accept and pay or authorise a valid order, SKIMA should not silently impose a material price increase. Where a material change is unavoidable, SKIMA may request your approval or follow an appropriate cancellation, reroute, return or refund process.
## 7. SKIMA Wallet and payments
The SKIMA Wallet is the in-app balance and transaction record used for supported SKIMA services. It is not described as a bank deposit account unless the applicable regulated payment structure permits that description.
Payments may be processed through an approved payment provider. A top-up is credited only after authoritative payment confirmation. Failed, reversed or disputed transactions are handled according to the provider result, SKIMA financial records and applicable law.
Never pay an undisclosed amount to a driver or station outside the authorised SKIMA process merely to complete a normal prepaid order. Report any request for an unauthorised side payment.
## 8. Utility and bill-payment services
Where enabled, SKIMA may offer airtime, data, electricity or other bill-payment services. The app should show the provider, service, amount and any applicable SKIMA fee or reward before confirmation.
A utility transaction is not treated as successful only because a request was created. Completion depends on the authoritative provider result. If the provider fails after SKIMA reserved or debited money, SKIMA should apply the appropriate reversal, refund or reconciliation process.
## 9. Fulfilment model
SKIMA may fulfil an LPG order through:
Partner fulfilment — an eligible Station Partner and approved Driver Partner; or
SKIMA-managed fulfilment — a SKIMA Managed Driver and an eligible SKIMA-owned fleet vehicle, with the physical LPG source or station determined by the active operating model.
SKIMA-managed fulfilment is available only where the platform’s readiness controls permit it. The app may choose or rank fulfilment based on location, coverage, eligibility, availability, workload, safety and other configured operational factors.
## 10. Pickup and driver verification
Before handing over a cylinder, reasonably confirm that the collector matches the active SKIMA assignment. The app may show a driver name, image, SKIMA Driver ID, vehicle information or verification status.
Do not hand the cylinder to an unknown person who cannot reasonably be connected to the order. You or an authorised person should be available at the confirmed pickup point unless SKIMA has expressly enabled another safe process.
## 11. Custody, scanning and tracking
After verified pickup, SKIMA records the cylinder’s service journey. Events may include pickup, station or procurement handoff, refill completion, return journey and delivery.
Tracking is provided to help you understand the order state. Exact live location can be affected by device, network, GPS and map limitations. Driver location is not intended to be publicly visible.
## 12. Refill quantity and actual billing
The final billable LPG quantity should reflect the approved quantity actually supplied. If a customer paid for more LPG than was supplied, the difference should be adjusted or refunded according to the payment method and the documented service outcome.
A Station Partner or other physical refill source must not deliberately misrepresent a materially smaller quantity as the quantity purchased. Credible quantity complaints may be investigated using refill records, scans, evidence, measurements and other relevant information.
## 13. If the planned fulfilment cannot continue
If an assigned station, driver or internal fulfilment path cannot safely or practically complete the service, SKIMA may reroute or reassign where this is allowed, safe and does not impose an undisclosed material change.
If the change would materially affect price or another important term, SKIMA should obtain appropriate customer approval or apply the relevant cancellation and return process.
## 14. Delivery and confirmation
You or an authorised person should be available to receive the cylinder at the confirmed return location. Do not give a delivery PIN or completion confirmation before the cylinder has actually been returned unless the service clearly provides a lawful alternative completion method.
A recorded delivery status can be challenged. SKIMA may review tracking, custody events, communications and completion evidence.
## 15. Cancellations, refunds and service failures
Refund treatment depends on what actually occurred. Before meaningful fulfilment begins, cancellation will normally lead to a full or substantially full refund subject to any lawful and clearly disclosed cost actually incurred.
After dispatch, pickup or partial service, a proportionate charge may apply only where it reflects an actual disclosed cost or service. A customer should not bear an avoidable failure cost caused by SKIMA or a fulfilment participant merely because SKIMA has an internal commercial arrangement.
Nothing in these terms removes a consumer right that cannot lawfully be excluded.
## 16. Support, complaints and safety incidents
You may report payment problems, underfilling concerns, lost or switched cylinders, damage, driver or station conduct, delivery problems, fraud or safety incidents through official SKIMA support.
For an immediate gas leak, fire, serious injury or other emergency, prioritise personal safety and contact the appropriate emergency or local safety authority. Ordinary in-app support is not a substitute for emergency assistance.
## 17. SKIMA AI and automated assistance
SKIMA may provide AI-assisted help for explanations, support triage, cylinder-image presentation and other configured tasks. AI can be wrong and is not a substitute for emergency, legal, medical or technical safety advice.
Automated systems may assist with serviceability, matching, risk controls or operational ranking. A backend rule, payment provider confirmation, verified scan or authorised human decision remains authoritative where the service requires one.
Where applicable law provides a right to review a material automated decision, SKIMA will provide an appropriate review path.
## 18. Privacy
SKIMA processes account, contact, location, cylinder, order, financial, support, security and other information needed to provide and protect the service. The separate SKIMA Privacy Notice explains the categories, purposes, sharing, retention, security and rights in more detail.
Assigned drivers and stations should receive only the information reasonably required for the order. Sensitive verification data is not public merely because a person participates in SKIMA.
## 19. Promotions and communications
Promotions may have eligibility, time, location, service, minimum-order or usage conditions. Fraudulent or manipulated use may be rejected without affecting a separate valid refund right.
SKIMA may send service communications through the app, push notification, SMS, email or another supported channel. Marketing communications are subject to applicable law and available preferences.
## 20. Changes to these terms
SKIMA may update these terms for service, safety, provider, regulatory or legal changes. Material changes should be communicated and renewed acceptance obtained where required.
A new version applies prospectively and does not silently rewrite the financial outcome of a completed order.
## 21. Governing law and consumer rights
These terms are governed by applicable law in the Federal Republic of Nigeria. Customer transparency, price disclosure, refunds and fair dealing are intended to operate consistently with applicable Nigerian consumer-protection law.
Customers may contact SKIMA first for investigation and may also approach an appropriate regulator or court where the law permits.
## 22. Contact
Use official SKIMA support channels shown in the app or authorised website for order questions, complaints, payment concerns, privacy requests and safety reports. Never send passwords or one-time codes to an unofficial person claiming to represent SKIMA.
Regulatory references:
Federal Competition and Consumer Protection Commission — https://fccpc.gov.ng/
Nigeria Data Protection Commission — https://ndpc.gov.ng/
Nigerian Midstream and Downstream Petroleum Regulatory Authority — https://www.nmdpra.gov.ng/
## Acceptance statement
By selecting the SKIMA acceptance control, you confirm that you had the opportunity to read these terms and agree to the current version for the customer services you use. Statutory consumer and privacy rights remain protected to the extent required by applicable law.$p1$,'markdown',
      encode(extensions.digest($p1$SKIMA
# Customer Terms of Service & LPG Service Policy
Version 2.0 · Updated 23 September 2026
Applies to customers using SKIMA services in Nigeria
## 1. Quick summary
SKIMA coordinates service requests through the SKIMA app and related channels. For LPG, SKIMA may coordinate an eligible Station Partner and an approved Driver Partner, or use SKIMA-managed fulfilment and SKIMA-owned fleet capacity where that model is enabled and launch-ready.
Before you confirm an order, the app should show the cylinder, refill amount, service location and the material price components that apply. You should not be charged for LPG that was not supplied. SKIMA does not use a blanket “no refund” rule to remove rights that apply under law.
You must provide accurate account, cylinder and service-location information, protect your account and follow reasonable safety instructions.
## 2. Your account
You must be legally capable of entering the transaction you request. Information supplied to SKIMA should be accurate and reasonably current. Keep passwords, recovery links and one-time codes secure.
Do not use SKIMA for fraud, impersonation, cylinder switching, stolen property, unlawful activity or abuse of promotions. SKIMA may restrict an account where reasonably necessary for safety, fraud prevention, security or legal compliance and should provide a review path where appropriate.
## 3. Service availability and coverage
Creating an account does not guarantee that every SKIMA service is available everywhere. Availability can depend on enabled service areas, driver capacity, station capacity, SKIMA-owned fulfilment readiness, safety, regulation, network conditions and operational capacity.
The app may use your saved address, device location and map information to determine whether a service is available. If SKIMA cannot provide a paid service, the customer should receive the appropriate cancellation, reversal, refund or other lawful remedy for the service outcome.
## 4. Registering and identifying your cylinder
A cylinder submitted for normal LPG service should be registered or otherwise identified through SKIMA. Provide the cylinder size and other information you reasonably know to be correct.
Do not deliberately remove, copy, alter or transfer a SKIMA cylinder identity, QR code or other identifier in a way that could cause one cylinder to be mistaken for another. SKIMA may stop a journey where the scanned cylinder does not match the order.
## 5. Cylinder capacity and safety
The requested refill must not exceed the cylinder’s recorded or verified capacity. If the recorded capacity appears wrong, SKIMA may require correction or re-verification before a larger refill is accepted.
Tell SKIMA about a known leak, fire exposure, serious damage or other immediate safety concern. A driver, station or SKIMA operator may stop normal fulfilment where a cylinder appears unsafe. A safety stop is a precaution, not by itself a final technical diagnosis.
## 6. Quotes, price and fees
SKIMA should show the material charges before payment or final confirmation. Depending on the service, this may include the LPG amount, a platform or service fee, delivery or route-related fees, payment or withdrawal fees, utility-service fees, taxes where applicable, discounts, credits or promotions.
SKIMA does not hardcode one permanent public fee in these terms. Current commercial amounts are governed by the active configuration and should be shown to you before you commit to the transaction.
A quote may expire. After you accept and pay or authorise a valid order, SKIMA should not silently impose a material price increase. Where a material change is unavoidable, SKIMA may request your approval or follow an appropriate cancellation, reroute, return or refund process.
## 7. SKIMA Wallet and payments
The SKIMA Wallet is the in-app balance and transaction record used for supported SKIMA services. It is not described as a bank deposit account unless the applicable regulated payment structure permits that description.
Payments may be processed through an approved payment provider. A top-up is credited only after authoritative payment confirmation. Failed, reversed or disputed transactions are handled according to the provider result, SKIMA financial records and applicable law.
Never pay an undisclosed amount to a driver or station outside the authorised SKIMA process merely to complete a normal prepaid order. Report any request for an unauthorised side payment.
## 8. Utility and bill-payment services
Where enabled, SKIMA may offer airtime, data, electricity or other bill-payment services. The app should show the provider, service, amount and any applicable SKIMA fee or reward before confirmation.
A utility transaction is not treated as successful only because a request was created. Completion depends on the authoritative provider result. If the provider fails after SKIMA reserved or debited money, SKIMA should apply the appropriate reversal, refund or reconciliation process.
## 9. Fulfilment model
SKIMA may fulfil an LPG order through:
Partner fulfilment — an eligible Station Partner and approved Driver Partner; or
SKIMA-managed fulfilment — a SKIMA Managed Driver and an eligible SKIMA-owned fleet vehicle, with the physical LPG source or station determined by the active operating model.
SKIMA-managed fulfilment is available only where the platform’s readiness controls permit it. The app may choose or rank fulfilment based on location, coverage, eligibility, availability, workload, safety and other configured operational factors.
## 10. Pickup and driver verification
Before handing over a cylinder, reasonably confirm that the collector matches the active SKIMA assignment. The app may show a driver name, image, SKIMA Driver ID, vehicle information or verification status.
Do not hand the cylinder to an unknown person who cannot reasonably be connected to the order. You or an authorised person should be available at the confirmed pickup point unless SKIMA has expressly enabled another safe process.
## 11. Custody, scanning and tracking
After verified pickup, SKIMA records the cylinder’s service journey. Events may include pickup, station or procurement handoff, refill completion, return journey and delivery.
Tracking is provided to help you understand the order state. Exact live location can be affected by device, network, GPS and map limitations. Driver location is not intended to be publicly visible.
## 12. Refill quantity and actual billing
The final billable LPG quantity should reflect the approved quantity actually supplied. If a customer paid for more LPG than was supplied, the difference should be adjusted or refunded according to the payment method and the documented service outcome.
A Station Partner or other physical refill source must not deliberately misrepresent a materially smaller quantity as the quantity purchased. Credible quantity complaints may be investigated using refill records, scans, evidence, measurements and other relevant information.
## 13. If the planned fulfilment cannot continue
If an assigned station, driver or internal fulfilment path cannot safely or practically complete the service, SKIMA may reroute or reassign where this is allowed, safe and does not impose an undisclosed material change.
If the change would materially affect price or another important term, SKIMA should obtain appropriate customer approval or apply the relevant cancellation and return process.
## 14. Delivery and confirmation
You or an authorised person should be available to receive the cylinder at the confirmed return location. Do not give a delivery PIN or completion confirmation before the cylinder has actually been returned unless the service clearly provides a lawful alternative completion method.
A recorded delivery status can be challenged. SKIMA may review tracking, custody events, communications and completion evidence.
## 15. Cancellations, refunds and service failures
Refund treatment depends on what actually occurred. Before meaningful fulfilment begins, cancellation will normally lead to a full or substantially full refund subject to any lawful and clearly disclosed cost actually incurred.
After dispatch, pickup or partial service, a proportionate charge may apply only where it reflects an actual disclosed cost or service. A customer should not bear an avoidable failure cost caused by SKIMA or a fulfilment participant merely because SKIMA has an internal commercial arrangement.
Nothing in these terms removes a consumer right that cannot lawfully be excluded.
## 16. Support, complaints and safety incidents
You may report payment problems, underfilling concerns, lost or switched cylinders, damage, driver or station conduct, delivery problems, fraud or safety incidents through official SKIMA support.
For an immediate gas leak, fire, serious injury or other emergency, prioritise personal safety and contact the appropriate emergency or local safety authority. Ordinary in-app support is not a substitute for emergency assistance.
## 17. SKIMA AI and automated assistance
SKIMA may provide AI-assisted help for explanations, support triage, cylinder-image presentation and other configured tasks. AI can be wrong and is not a substitute for emergency, legal, medical or technical safety advice.
Automated systems may assist with serviceability, matching, risk controls or operational ranking. A backend rule, payment provider confirmation, verified scan or authorised human decision remains authoritative where the service requires one.
Where applicable law provides a right to review a material automated decision, SKIMA will provide an appropriate review path.
## 18. Privacy
SKIMA processes account, contact, location, cylinder, order, financial, support, security and other information needed to provide and protect the service. The separate SKIMA Privacy Notice explains the categories, purposes, sharing, retention, security and rights in more detail.
Assigned drivers and stations should receive only the information reasonably required for the order. Sensitive verification data is not public merely because a person participates in SKIMA.
## 19. Promotions and communications
Promotions may have eligibility, time, location, service, minimum-order or usage conditions. Fraudulent or manipulated use may be rejected without affecting a separate valid refund right.
SKIMA may send service communications through the app, push notification, SMS, email or another supported channel. Marketing communications are subject to applicable law and available preferences.
## 20. Changes to these terms
SKIMA may update these terms for service, safety, provider, regulatory or legal changes. Material changes should be communicated and renewed acceptance obtained where required.
A new version applies prospectively and does not silently rewrite the financial outcome of a completed order.
## 21. Governing law and consumer rights
These terms are governed by applicable law in the Federal Republic of Nigeria. Customer transparency, price disclosure, refunds and fair dealing are intended to operate consistently with applicable Nigerian consumer-protection law.
Customers may contact SKIMA first for investigation and may also approach an appropriate regulator or court where the law permits.
## 22. Contact
Use official SKIMA support channels shown in the app or authorised website for order questions, complaints, payment concerns, privacy requests and safety reports. Never send passwords or one-time codes to an unofficial person claiming to represent SKIMA.
Regulatory references:
Federal Competition and Consumer Protection Commission — https://fccpc.gov.ng/
Nigeria Data Protection Commission — https://ndpc.gov.ng/
Nigerian Midstream and Downstream Petroleum Regulatory Authority — https://www.nmdpra.gov.ng/
## Acceptance statement
By selecting the SKIMA acceptance control, you confirm that you had the opportunity to read these terms and agree to the current version for the customer services you use. Statutory consumer and privacy rights remain protected to the extent required by applicable law.$p1$,'sha256'),'hex'),'published',
      timezone('utc',now()),timezone('utc',now()),true,
      'https://docs.google.com/document/d/1f6Mm-lbrDppTF0Sa9SL4XvU1KBsnyi0QLl6c6Fz5f6A/edit?usp=drivesdk','gdrive:1f6Mm-lbrDppTF0Sa9SL4XvU1KBsnyi0QLl6c6Fz5f6A',timezone('utc',now()),old_id,
      jsonb_build_object(
        'sourceType','google_drive',
        'driveDocumentId','1f6Mm-lbrDppTF0Sa9SL4XvU1KBsnyi0QLl6c6Fz5f6A',
        'driveRevision','ANLCKQkpGnFvVl2wcuflUOFEBgzqFeMyEb2D0czlohJQnv-pT7ma032PPiX5ddYLQRnzOQZDQd0AYUteURX6BEVUNRaxON0BuV-LgkQeSE8',
        'syncedAt',timezone('utc',now())
      )
    from public.policy_documents document
    where document.id=doc_id;
  end if;
end
$sync$;


do $sync$
declare
  doc_id uuid;
  old_id uuid;
begin
  select id into doc_id from public.policy_documents where key='policy.partner.participation';
  if doc_id is null then
    raise exception 'policy document policy.partner.participation is missing';
  end if;

  if not exists (
    select 1 from public.policy_versions
    where policy_document_id=doc_id and version_label='2.0'
  ) then
    select id into old_id
    from public.policy_versions
    where policy_document_id=doc_id and status='published'
    order by effective_from desc nulls last,published_at desc nulls last
    limit 1;

    if old_id is not null then
      update public.policy_versions
      set status='superseded',
          effective_until=coalesce(effective_until,timezone('utc',now())),
          updated_at=timezone('utc',now())
      where id=old_id;
    end if;

    insert into public.policy_versions(
      policy_document_id,version_label,summary_content,full_content,content_format,content_hash,status,
      effective_from,published_at,requires_reacceptance,source_url,source_reference,source_updated_at,
      supersedes_version_id,metadata
    )
    select
      doc_id,'2.0',document.summary_content,$p2$SKIMA
# Partner Participation Terms & Public Policy
Version 2.0 · Updated 23 September 2026
Applies to SKIMA Driver Partners, SKIMA Managed Drivers, Vehicle Partners and Station Partners in Nigeria
## 1. Purpose and role boundaries
These terms establish common participation rules for people and businesses that provide or support SKIMA services.
A Driver Partner independently provides approved delivery services using an eligible vehicle and chooses when to become available, subject to the accepted job and safety rules.
A SKIMA Managed Driver is a driver selected or engaged by SKIMA to operate an eligible SKIMA-owned fleet vehicle under a separate written work or engagement arrangement. Managed Driver is the current operational term for the internal-fulfilment driver programme.
A Vehicle Partner may place an approved vehicle into a managed-fleet arrangement under a separate commercial schedule.
A Station Partner is an independently operated LPG station, retailer or other eligible refill facility approved to fulfil the activities it is legally permitted to perform.
A role name never overrides applicable law or the actual written relationship.
## 2. Application, verification and approval
Applicants must provide accurate identity, contact, location, document and role information. SKIMA may verify identity, licences, permits, vehicles, station location, insurance, payout information and other eligibility evidence.
Document approval is not the same as overall partner approval. A document can be valid while the application is still incomplete, ineligible, under review or rejected for another reason.
Required documents must remain current. Expiry, suspension or loss of a required licence, permit, insurance policy, vehicle status or other eligibility condition may pause participation until corrected.
## 3. Station licence and regulatory verification
A Station Partner remains responsible for lawful LPG operations, facility safety, staff, equipment, measurement and the permits or licences required for its actual activity.
Where an official NMDPRA verification route is available, SKIMA may verify a permit or licence directly rather than relying only on an uploaded image. Approval may be suspended where the relevant authorisation cannot be confirmed or has expired.
## 4. Driver and vehicle eligibility
A vehicle used for LPG work must be separately eligible for the service. Physical carrying capacity alone does not prove lawful LPG transport eligibility.
SKIMA may require registration, roadworthiness, insurance, inspection, cargo-securing or other safety evidence. A SKIMA-owned fleet vehicle remains separately tracked for compliance, maintenance and driver assignment.
A Managed Driver may receive internal fulfilment work only when the driver, assigned SKIMA-owned vehicle and approved operational coverage satisfy the current backend readiness rules.
## 5. Availability and work commitment
Driver Partners should mark themselves online only when genuinely available. They may decline an offered job before acceptance where the product permits it. After acceptance, the driver must make reasonable efforts to complete the job or follow the approved exception process.
Managed Drivers may work under assigned shifts, schedules or direct assignment rules in their separate agreement.
Going offline stops new-job matching and should stop background location sharing for new jobs. An active job may still require the location and custody information needed to close the journey safely.
## 6. Matching and dispatch
SKIMA may use location, service area, availability, vehicle eligibility, workload, recent opportunity, reliability, order requirements, safety status and other configured factors to rank eligible fulfilment participants.
Internal fulfilment and partner fulfilment may coexist. The active platform configuration determines whether SKIMA-managed capacity is disabled, used as fallback, prioritised or used in another approved hybrid model.
No participant is guaranteed a fixed number of jobs, queue position or income unless a separate written agreement expressly provides it.
## 7. Cylinder custody and scanning
The assigned driver must collect only the cylinder associated with the order. Required scans, PINs, handoff evidence and order-state checks must be completed honestly.
Deliberate cylinder switching, falsified scans, false completion, fabricated location or unauthorised handoff are serious breaches.
Where a cylinder appears dangerously damaged, leaking or otherwise unsafe, normal fulfilment should stop and the incident or exception process should be used.
## 8. Station refill obligations
A Station Partner must provide accurate price and availability information, use lawful and properly maintained refill/measurement equipment, record the approved actual quantity accurately, verify the active order and arriving driver, and protect customer data.
A station must not demand an unauthorised side payment from a driver for a normal SKIMA order or intentionally represent a materially smaller refill as the quantity purchased.
## 9. Pricing and commercial changes
Station LPG prices and SKIMA commercial fees are governed by current platform policy and role-specific commercial terms. This public policy does not permanently fix a single fee or revenue share.
A future pricing or payout policy applies prospectively. It must not silently rewrite completed historical earnings or customer charges.
## 10. Earnings, settlements and withdrawals
Driver Partner earnings, Managed Driver compensation, Vehicle Partner shares and Station Partner settlement are governed by the applicable role and commercial arrangement.
Where the SKIMA Wallet and withdrawal feature are available, a participant can add a verified payout account and request withdrawal of an available balance subject to provider processing, identity/account verification, disclosed fees, unresolved disputes, reversals, fraud/security review and lawful holds.
A zero wallet balance does not by itself prevent a participant from setting up a payout account.
## 11. Customer and partner information
Partners receive only the customer, cylinder, order, location or contact information reasonably needed to perform the assigned service. Do not sell, publish, retain for an unrelated purpose, threaten, stalk or otherwise misuse customer information.
Private KYC and verification information must not be treated as public merely because SKIMA verified it.
## 12. Location and tracking
Driver location may be collected while online for nearby work or during an assigned journey for dispatch, tracking, cylinder custody, safety and support. It is not intended for public display.
Station location may be used to verify the approved branch, service coverage, routing and customer discovery.
## 13. Ratings, quality and review
Ratings may contribute to service-quality analysis but do not automatically prove misconduct. SKIMA may consider reliability, complaints, completion history, safety, quantity concerns and other authorised evidence.
Suspicious or abusive ratings may be investigated or excluded. A materially adverse rating or automated decision should have an appropriate review path where required by law or policy.
## 14. Conduct
Partners must not engage in fraud, theft, bribery, harassment, threats, unlawful discrimination, unsafe driving, unsafe cylinder handling, false completion, unauthorised cash settlement, deliberate data misuse or misleading use of SKIMA identity.
A Driver Partner or Station Partner is not authorised to bind SKIMA to a contract, debt, loan or guarantee unless SKIMA gives written authority.
## 15. SKIMA branding and Driver ID
Approved participants may use only authorised SKIMA identity, signage or branding and only while the approval remains current.
A SKIMA Driver ID is an identity and participation credential. It does not by itself create employment, authority to collect unauthorised cash or authority to make legal commitments for SKIMA.
## 16. Privacy and AI
SKIMA may process identity, verification, business, vehicle, station, location, order, earnings, support, ratings, incident and security information for participation and platform safety.
SKIMA AI may assist authorised users with explanations, operational summaries, support triage, risk signals and other configured tasks. AI does not override the backend source of truth or an authorised human approval requirement.
The SKIMA Privacy Notice contains the wider privacy rules and rights.
## 17. Complaints, investigations and appeals
SKIMA may investigate service, safety, fraud, payment, rating, data or conduct complaints and may temporarily restrict new work while protecting customers, preserving evidence or complying with law.
Where appropriate, participants may request review of a correctable application issue, suspension, rating consequence, disputed service responsibility or settlement discrepancy.
## 18. Suspension and termination
Participation may be suspended or ended for expired or invalid required documents, loss of eligibility, serious or repeated safety breaches, fraud, theft, cylinder switching, data misuse, serious misconduct, payment manipulation, unauthorised branding or a legal/regulatory requirement.
Immediate protective suspension may be used where continued participation presents a serious safety, fraud, legal, data-security or customer-protection risk. Otherwise, SKIMA should provide reasonable notice or correction opportunity where appropriate.
## 19. No guarantee of territory
Approval in one location does not create a right to operate in every future SKIMA service area. Coverage can be enabled, limited, paused or expanded according to operational and regulatory readiness.
## 20. Changes and role-specific agreements
A separate Driver Partner agreement, Managed Driver work agreement, Vehicle Management Agreement, Station Partner Agreement, pricing schedule, privacy notice or safety rule may add to these public terms. A more specific lawful signed term controls over a general term on the same subject.
Material public-policy changes should be communicated and renewed acceptance obtained where required.
## 21. Governing law and contacts
These terms are governed by applicable law in Nigeria. Use the official SKIMA support or partner channel for applications, approval, earnings, safety, privacy or disputes.
Official reference sources include:
NMDPRA — https://www.nmdpra.gov.ng/
Nigeria Data Protection Commission — https://ndpc.gov.ng/
Federal Competition and Consumer Protection Commission — https://fccpc.gov.ng/
Federal Road Safety Corps — https://frsc.gov.ng/
## Acceptance statement
By accepting this policy, you confirm that you had the opportunity to read the current terms and agree to the common participation rules and any role-specific agreement that lawfully applies to you.$p2$,'markdown',
      encode(extensions.digest($p2$SKIMA
# Partner Participation Terms & Public Policy
Version 2.0 · Updated 23 September 2026
Applies to SKIMA Driver Partners, SKIMA Managed Drivers, Vehicle Partners and Station Partners in Nigeria
## 1. Purpose and role boundaries
These terms establish common participation rules for people and businesses that provide or support SKIMA services.
A Driver Partner independently provides approved delivery services using an eligible vehicle and chooses when to become available, subject to the accepted job and safety rules.
A SKIMA Managed Driver is a driver selected or engaged by SKIMA to operate an eligible SKIMA-owned fleet vehicle under a separate written work or engagement arrangement. Managed Driver is the current operational term for the internal-fulfilment driver programme.
A Vehicle Partner may place an approved vehicle into a managed-fleet arrangement under a separate commercial schedule.
A Station Partner is an independently operated LPG station, retailer or other eligible refill facility approved to fulfil the activities it is legally permitted to perform.
A role name never overrides applicable law or the actual written relationship.
## 2. Application, verification and approval
Applicants must provide accurate identity, contact, location, document and role information. SKIMA may verify identity, licences, permits, vehicles, station location, insurance, payout information and other eligibility evidence.
Document approval is not the same as overall partner approval. A document can be valid while the application is still incomplete, ineligible, under review or rejected for another reason.
Required documents must remain current. Expiry, suspension or loss of a required licence, permit, insurance policy, vehicle status or other eligibility condition may pause participation until corrected.
## 3. Station licence and regulatory verification
A Station Partner remains responsible for lawful LPG operations, facility safety, staff, equipment, measurement and the permits or licences required for its actual activity.
Where an official NMDPRA verification route is available, SKIMA may verify a permit or licence directly rather than relying only on an uploaded image. Approval may be suspended where the relevant authorisation cannot be confirmed or has expired.
## 4. Driver and vehicle eligibility
A vehicle used for LPG work must be separately eligible for the service. Physical carrying capacity alone does not prove lawful LPG transport eligibility.
SKIMA may require registration, roadworthiness, insurance, inspection, cargo-securing or other safety evidence. A SKIMA-owned fleet vehicle remains separately tracked for compliance, maintenance and driver assignment.
A Managed Driver may receive internal fulfilment work only when the driver, assigned SKIMA-owned vehicle and approved operational coverage satisfy the current backend readiness rules.
## 5. Availability and work commitment
Driver Partners should mark themselves online only when genuinely available. They may decline an offered job before acceptance where the product permits it. After acceptance, the driver must make reasonable efforts to complete the job or follow the approved exception process.
Managed Drivers may work under assigned shifts, schedules or direct assignment rules in their separate agreement.
Going offline stops new-job matching and should stop background location sharing for new jobs. An active job may still require the location and custody information needed to close the journey safely.
## 6. Matching and dispatch
SKIMA may use location, service area, availability, vehicle eligibility, workload, recent opportunity, reliability, order requirements, safety status and other configured factors to rank eligible fulfilment participants.
Internal fulfilment and partner fulfilment may coexist. The active platform configuration determines whether SKIMA-managed capacity is disabled, used as fallback, prioritised or used in another approved hybrid model.
No participant is guaranteed a fixed number of jobs, queue position or income unless a separate written agreement expressly provides it.
## 7. Cylinder custody and scanning
The assigned driver must collect only the cylinder associated with the order. Required scans, PINs, handoff evidence and order-state checks must be completed honestly.
Deliberate cylinder switching, falsified scans, false completion, fabricated location or unauthorised handoff are serious breaches.
Where a cylinder appears dangerously damaged, leaking or otherwise unsafe, normal fulfilment should stop and the incident or exception process should be used.
## 8. Station refill obligations
A Station Partner must provide accurate price and availability information, use lawful and properly maintained refill/measurement equipment, record the approved actual quantity accurately, verify the active order and arriving driver, and protect customer data.
A station must not demand an unauthorised side payment from a driver for a normal SKIMA order or intentionally represent a materially smaller refill as the quantity purchased.
## 9. Pricing and commercial changes
Station LPG prices and SKIMA commercial fees are governed by current platform policy and role-specific commercial terms. This public policy does not permanently fix a single fee or revenue share.
A future pricing or payout policy applies prospectively. It must not silently rewrite completed historical earnings or customer charges.
## 10. Earnings, settlements and withdrawals
Driver Partner earnings, Managed Driver compensation, Vehicle Partner shares and Station Partner settlement are governed by the applicable role and commercial arrangement.
Where the SKIMA Wallet and withdrawal feature are available, a participant can add a verified payout account and request withdrawal of an available balance subject to provider processing, identity/account verification, disclosed fees, unresolved disputes, reversals, fraud/security review and lawful holds.
A zero wallet balance does not by itself prevent a participant from setting up a payout account.
## 11. Customer and partner information
Partners receive only the customer, cylinder, order, location or contact information reasonably needed to perform the assigned service. Do not sell, publish, retain for an unrelated purpose, threaten, stalk or otherwise misuse customer information.
Private KYC and verification information must not be treated as public merely because SKIMA verified it.
## 12. Location and tracking
Driver location may be collected while online for nearby work or during an assigned journey for dispatch, tracking, cylinder custody, safety and support. It is not intended for public display.
Station location may be used to verify the approved branch, service coverage, routing and customer discovery.
## 13. Ratings, quality and review
Ratings may contribute to service-quality analysis but do not automatically prove misconduct. SKIMA may consider reliability, complaints, completion history, safety, quantity concerns and other authorised evidence.
Suspicious or abusive ratings may be investigated or excluded. A materially adverse rating or automated decision should have an appropriate review path where required by law or policy.
## 14. Conduct
Partners must not engage in fraud, theft, bribery, harassment, threats, unlawful discrimination, unsafe driving, unsafe cylinder handling, false completion, unauthorised cash settlement, deliberate data misuse or misleading use of SKIMA identity.
A Driver Partner or Station Partner is not authorised to bind SKIMA to a contract, debt, loan or guarantee unless SKIMA gives written authority.
## 15. SKIMA branding and Driver ID
Approved participants may use only authorised SKIMA identity, signage or branding and only while the approval remains current.
A SKIMA Driver ID is an identity and participation credential. It does not by itself create employment, authority to collect unauthorised cash or authority to make legal commitments for SKIMA.
## 16. Privacy and AI
SKIMA may process identity, verification, business, vehicle, station, location, order, earnings, support, ratings, incident and security information for participation and platform safety.
SKIMA AI may assist authorised users with explanations, operational summaries, support triage, risk signals and other configured tasks. AI does not override the backend source of truth or an authorised human approval requirement.
The SKIMA Privacy Notice contains the wider privacy rules and rights.
## 17. Complaints, investigations and appeals
SKIMA may investigate service, safety, fraud, payment, rating, data or conduct complaints and may temporarily restrict new work while protecting customers, preserving evidence or complying with law.
Where appropriate, participants may request review of a correctable application issue, suspension, rating consequence, disputed service responsibility or settlement discrepancy.
## 18. Suspension and termination
Participation may be suspended or ended for expired or invalid required documents, loss of eligibility, serious or repeated safety breaches, fraud, theft, cylinder switching, data misuse, serious misconduct, payment manipulation, unauthorised branding or a legal/regulatory requirement.
Immediate protective suspension may be used where continued participation presents a serious safety, fraud, legal, data-security or customer-protection risk. Otherwise, SKIMA should provide reasonable notice or correction opportunity where appropriate.
## 19. No guarantee of territory
Approval in one location does not create a right to operate in every future SKIMA service area. Coverage can be enabled, limited, paused or expanded according to operational and regulatory readiness.
## 20. Changes and role-specific agreements
A separate Driver Partner agreement, Managed Driver work agreement, Vehicle Management Agreement, Station Partner Agreement, pricing schedule, privacy notice or safety rule may add to these public terms. A more specific lawful signed term controls over a general term on the same subject.
Material public-policy changes should be communicated and renewed acceptance obtained where required.
## 21. Governing law and contacts
These terms are governed by applicable law in Nigeria. Use the official SKIMA support or partner channel for applications, approval, earnings, safety, privacy or disputes.
Official reference sources include:
NMDPRA — https://www.nmdpra.gov.ng/
Nigeria Data Protection Commission — https://ndpc.gov.ng/
Federal Competition and Consumer Protection Commission — https://fccpc.gov.ng/
Federal Road Safety Corps — https://frsc.gov.ng/
## Acceptance statement
By accepting this policy, you confirm that you had the opportunity to read the current terms and agree to the common participation rules and any role-specific agreement that lawfully applies to you.$p2$,'sha256'),'hex'),'published',
      timezone('utc',now()),timezone('utc',now()),true,
      'https://docs.google.com/document/d/1YbOBejHhnDs2kqAV3kl1YbpLbV2laeZeYrAer12kffE/edit?usp=drivesdk','gdrive:1YbOBejHhnDs2kqAV3kl1YbpLbV2laeZeYrAer12kffE',timezone('utc',now()),old_id,
      jsonb_build_object(
        'sourceType','google_drive',
        'driveDocumentId','1YbOBejHhnDs2kqAV3kl1YbpLbV2laeZeYrAer12kffE',
        'driveRevision','ANLCKQlVqQ4equad-kVV64K7d0wlka4eMQe3eOEvybjWbx8YQ4vFN7YrR-298aZI62ZBHaLlYczELb3W343QGlFSRhxGeO7NBe0ICsRyy14',
        'syncedAt',timezone('utc',now())
      )
    from public.policy_documents document
    where document.id=doc_id;
  end if;
end
$sync$;


do $sync$
declare
  doc_id uuid;
  old_id uuid;
begin
  select id into doc_id from public.policy_documents where key='policy.driver.operations';
  if doc_id is null then
    raise exception 'policy document policy.driver.operations is missing';
  end if;

  if not exists (
    select 1 from public.policy_versions
    where policy_document_id=doc_id and version_label='2.0'
  ) then
    select id into old_id
    from public.policy_versions
    where policy_document_id=doc_id and status='published'
    order by effective_from desc nulls last,published_at desc nulls last
    limit 1;

    if old_id is not null then
      update public.policy_versions
      set status='superseded',
          effective_until=coalesce(effective_until,timezone('utc',now())),
          updated_at=timezone('utc',now())
      where id=old_id;
    end if;

    insert into public.policy_versions(
      policy_document_id,version_label,summary_content,full_content,content_format,content_hash,status,
      effective_from,published_at,requires_reacceptance,source_url,source_reference,source_updated_at,
      supersedes_version_id,metadata
    )
    select
      doc_id,'2.0',document.summary_content,$p3$SKIMA
# Driver & Managed Driver Operations Policy
Version 2.0 · Updated 23 September 2026
For approved SKIMA Driver Partners and SKIMA Managed Drivers
## 1. Which driver role applies
Driver Partner — an independent approved driver who uses an eligible approved vehicle and chooses when to make themselves available, subject to the job they accept.
SKIMA Managed Driver — a driver selected or engaged by SKIMA to operate an eligible SKIMA-owned fleet vehicle within the internal fulfilment programme. A Managed Driver’s schedule, pay and employment/engagement terms are governed by the separate written arrangement that applies to that driver.
## 2. Going online, busy and offline
Use Online only when you are genuinely available for SKIMA work. Busy means you are completing or otherwise occupied with a current job. Offline means SKIMA should not send new jobs.
The current mobile app may use background location while a driver is online for nearby-job matching or while an active journey requires tracking. Going offline stops location sharing for new-job matching. Location is not shown publicly.
## 3. Location accuracy
Keep device location permission enabled when the job requires it. Do not spoof, manipulate or deliberately falsify driver location.
Location is used for dispatch, pickup/return tracking, cylinder custody, support and safety. GPS, device and network limitations can affect precision, so location is evidence to be considered with the wider order record rather than an infallible proof of conduct.
## 4. Job offers and assignments
A Driver Partner may accept or decline available work according to the app flow. Once accepted, complete the work or use the proper exception process.
A Managed Driver may receive direct or scheduled assignments according to the internal fulfilment operating model and the driver’s separate agreement.
Never transfer an assigned job to an unauthorised driver.
## 5. Vehicle eligibility
Use only the vehicle approved and currently eligible for the assigned service. A Managed Driver must use the SKIMA-owned fleet vehicle assigned through the platform unless an authorised operator changes the assignment.
Do not treat physical carrying capacity as proof that a vehicle is legally or safely suitable for LPG cylinders. Follow active compliance, insurance, inspection, cargo-securing and safety requirements.
## 6. Customer pickup
Confirm the order and cylinder before taking custody. Use required scan or verification controls. Be respectful at the customer location and do not demand an unauthorised payment.
Do not collect an unattended cylinder unless SKIMA has expressly enabled a safe authorised process for that order.
## 7. Cylinder safety and custody
If a cylinder appears to be leaking, fire-damaged, dangerously corroded or otherwise immediately unsafe, do not continue normal handling merely to finish the job. Use the safety or support path.
Never switch cylinders, remove or transfer cylinder identity labels to another cylinder, or hand a cylinder to an unauthorised person.
## 8. Station or internal refill handoff
At a Station Partner, verify the correct active job and complete the required station handoff/scan. A station should not require the driver to settle a normal SKIMA order from personal funds.
For SKIMA-managed fulfilment, follow the internal refill/procurement flow shown by the platform. Do not invent an off-platform supplier, payment or completion record.
## 9. Return and delivery
Follow the approved route and return the same identified cylinder to the customer. Use the required delivery verification only after the cylinder is actually returned.
If the customer cannot receive delivery, do not abandon the cylinder. Use the failed-delivery/support process and keep custody safe.
## 10. Earnings and Managed Driver pay
Driver Partner earnings are based on the applicable completed-job policy. Managed Driver earnings may be accrued separately and become part of the normal wallet only after SKIMA pays them according to the Managed Driver compensation process.
Do not treat “available for payout” internal Managed Driver earnings as already withdrawn or already in the wallet until the platform records the payout.
## 11. Payout account and withdrawals
A driver can set up a verified payout account even when the current available wallet balance is zero. Account verification may use the configured payout provider.
A withdrawal can proceed only when the available balance covers the requested amount and any disclosed fee or other required debit. Provider processing, disputes, reversals, fraud/security review or lawful holds may affect completion.
## 12. Customer information and privacy
Use customer names, phone/contact details, addresses, order information and cylinder details only for the assigned service, support, safety or a lawful requirement.
Do not retain customer addresses for personal use, publish them, share them with unauthorised people or contact customers for unrelated purposes.
## 13. Public Driver ID
Only the information reasonably needed to verify current SKIMA participation should be public. Private licence, identity, banking and verification documents are not public Driver ID content.
## 14. Ratings and performance
Customer ratings and service records may contribute to quality review and matching. A rating alone is not final proof of misconduct. Fraudulent, retaliatory or manipulated ratings may be reviewed.
## 15. SKIMA AI
Driver AI assistance may explain the driver’s own jobs, earnings and next operational steps within the driver’s authorised scope. It does not replace a required scan, order state, payout record, safety procedure or human review.
Never ask SKIMA AI to reveal another user’s private data or protected credentials.
## 16. Incidents and support
Report lost/switched cylinders, accidents, threats, suspected fraud, station disputes, unsafe cylinders, payment demands, vehicle breakdowns and other material incidents promptly.
For an emergency, prioritise personal safety and contact the appropriate emergency authority. In-app support is not emergency response.
## 17. Conduct and suspension
Fraud, theft, cylinder switching, falsified completion, dangerous conduct, serious customer harassment, bribery, deliberate location manipulation, misuse of customer data or use of an ineligible vehicle may lead to immediate protective suspension and investigation.
## 18. Privacy notice and partner terms
This operations policy should be read together with the SKIMA Partner Participation Terms & Public Policy, the SKIMA Privacy Notice and any separate Driver Partner or Managed Driver agreement that applies.
Use the official SKIMA support channel for a correction, appeal, earnings dispute, privacy request or safety report.$p3$,'markdown',
      encode(extensions.digest($p3$SKIMA
# Driver & Managed Driver Operations Policy
Version 2.0 · Updated 23 September 2026
For approved SKIMA Driver Partners and SKIMA Managed Drivers
## 1. Which driver role applies
Driver Partner — an independent approved driver who uses an eligible approved vehicle and chooses when to make themselves available, subject to the job they accept.
SKIMA Managed Driver — a driver selected or engaged by SKIMA to operate an eligible SKIMA-owned fleet vehicle within the internal fulfilment programme. A Managed Driver’s schedule, pay and employment/engagement terms are governed by the separate written arrangement that applies to that driver.
## 2. Going online, busy and offline
Use Online only when you are genuinely available for SKIMA work. Busy means you are completing or otherwise occupied with a current job. Offline means SKIMA should not send new jobs.
The current mobile app may use background location while a driver is online for nearby-job matching or while an active journey requires tracking. Going offline stops location sharing for new-job matching. Location is not shown publicly.
## 3. Location accuracy
Keep device location permission enabled when the job requires it. Do not spoof, manipulate or deliberately falsify driver location.
Location is used for dispatch, pickup/return tracking, cylinder custody, support and safety. GPS, device and network limitations can affect precision, so location is evidence to be considered with the wider order record rather than an infallible proof of conduct.
## 4. Job offers and assignments
A Driver Partner may accept or decline available work according to the app flow. Once accepted, complete the work or use the proper exception process.
A Managed Driver may receive direct or scheduled assignments according to the internal fulfilment operating model and the driver’s separate agreement.
Never transfer an assigned job to an unauthorised driver.
## 5. Vehicle eligibility
Use only the vehicle approved and currently eligible for the assigned service. A Managed Driver must use the SKIMA-owned fleet vehicle assigned through the platform unless an authorised operator changes the assignment.
Do not treat physical carrying capacity as proof that a vehicle is legally or safely suitable for LPG cylinders. Follow active compliance, insurance, inspection, cargo-securing and safety requirements.
## 6. Customer pickup
Confirm the order and cylinder before taking custody. Use required scan or verification controls. Be respectful at the customer location and do not demand an unauthorised payment.
Do not collect an unattended cylinder unless SKIMA has expressly enabled a safe authorised process for that order.
## 7. Cylinder safety and custody
If a cylinder appears to be leaking, fire-damaged, dangerously corroded or otherwise immediately unsafe, do not continue normal handling merely to finish the job. Use the safety or support path.
Never switch cylinders, remove or transfer cylinder identity labels to another cylinder, or hand a cylinder to an unauthorised person.
## 8. Station or internal refill handoff
At a Station Partner, verify the correct active job and complete the required station handoff/scan. A station should not require the driver to settle a normal SKIMA order from personal funds.
For SKIMA-managed fulfilment, follow the internal refill/procurement flow shown by the platform. Do not invent an off-platform supplier, payment or completion record.
## 9. Return and delivery
Follow the approved route and return the same identified cylinder to the customer. Use the required delivery verification only after the cylinder is actually returned.
If the customer cannot receive delivery, do not abandon the cylinder. Use the failed-delivery/support process and keep custody safe.
## 10. Earnings and Managed Driver pay
Driver Partner earnings are based on the applicable completed-job policy. Managed Driver earnings may be accrued separately and become part of the normal wallet only after SKIMA pays them according to the Managed Driver compensation process.
Do not treat “available for payout” internal Managed Driver earnings as already withdrawn or already in the wallet until the platform records the payout.
## 11. Payout account and withdrawals
A driver can set up a verified payout account even when the current available wallet balance is zero. Account verification may use the configured payout provider.
A withdrawal can proceed only when the available balance covers the requested amount and any disclosed fee or other required debit. Provider processing, disputes, reversals, fraud/security review or lawful holds may affect completion.
## 12. Customer information and privacy
Use customer names, phone/contact details, addresses, order information and cylinder details only for the assigned service, support, safety or a lawful requirement.
Do not retain customer addresses for personal use, publish them, share them with unauthorised people or contact customers for unrelated purposes.
## 13. Public Driver ID
Only the information reasonably needed to verify current SKIMA participation should be public. Private licence, identity, banking and verification documents are not public Driver ID content.
## 14. Ratings and performance
Customer ratings and service records may contribute to quality review and matching. A rating alone is not final proof of misconduct. Fraudulent, retaliatory or manipulated ratings may be reviewed.
## 15. SKIMA AI
Driver AI assistance may explain the driver’s own jobs, earnings and next operational steps within the driver’s authorised scope. It does not replace a required scan, order state, payout record, safety procedure or human review.
Never ask SKIMA AI to reveal another user’s private data or protected credentials.
## 16. Incidents and support
Report lost/switched cylinders, accidents, threats, suspected fraud, station disputes, unsafe cylinders, payment demands, vehicle breakdowns and other material incidents promptly.
For an emergency, prioritise personal safety and contact the appropriate emergency authority. In-app support is not emergency response.
## 17. Conduct and suspension
Fraud, theft, cylinder switching, falsified completion, dangerous conduct, serious customer harassment, bribery, deliberate location manipulation, misuse of customer data or use of an ineligible vehicle may lead to immediate protective suspension and investigation.
## 18. Privacy notice and partner terms
This operations policy should be read together with the SKIMA Partner Participation Terms & Public Policy, the SKIMA Privacy Notice and any separate Driver Partner or Managed Driver agreement that applies.
Use the official SKIMA support channel for a correction, appeal, earnings dispute, privacy request or safety report.$p3$,'sha256'),'hex'),'published',
      timezone('utc',now()),timezone('utc',now()),false,
      'https://docs.google.com/document/d/1cIJrh8E3YBbNipbQqHffBKQnHjamKC2BfP6MN36xT1Q/edit?usp=drivesdk','gdrive:1cIJrh8E3YBbNipbQqHffBKQnHjamKC2BfP6MN36xT1Q',timezone('utc',now()),old_id,
      jsonb_build_object(
        'sourceType','google_drive',
        'driveDocumentId','1cIJrh8E3YBbNipbQqHffBKQnHjamKC2BfP6MN36xT1Q',
        'driveRevision','ANLCKQmbfMrwRsgCYsUFxB5cPysPb29sB-gBJfCHl0HT0uaYEdhl3uAVPqgyrT3izysWXczwI8rsRPVjC8Mfi_fFLG9WEb1s8J6JZxt2WlQ',
        'syncedAt',timezone('utc',now())
      )
    from public.policy_documents document
    where document.id=doc_id;
  end if;
end
$sync$;


do $sync$
declare
  doc_id uuid;
  old_id uuid;
begin
  select id into doc_id from public.policy_documents where key='policy.station.operations';
  if doc_id is null then
    raise exception 'policy document policy.station.operations is missing';
  end if;

  if not exists (
    select 1 from public.policy_versions
    where policy_document_id=doc_id and version_label='2.0'
  ) then
    select id into old_id
    from public.policy_versions
    where policy_document_id=doc_id and status='published'
    order by effective_from desc nulls last,published_at desc nulls last
    limit 1;

    if old_id is not null then
      update public.policy_versions
      set status='superseded',
          effective_until=coalesce(effective_until,timezone('utc',now())),
          updated_at=timezone('utc',now())
      where id=old_id;
    end if;

    insert into public.policy_versions(
      policy_document_id,version_label,summary_content,full_content,content_format,content_hash,status,
      effective_from,published_at,requires_reacceptance,source_url,source_reference,source_updated_at,
      supersedes_version_id,metadata
    )
    select
      doc_id,'2.0',document.summary_content,$p4$SKIMA
# Station Partner Participation & Operations Policy
Version 2.0 · Updated 23 September 2026
For approved SKIMA LPG Station Partners and authorised station staff
## 1. Station participation
A Station Partner is an independently operated LPG station, retailer or eligible refill facility approved for the SKIMA activities it is lawfully permitted to perform.
SKIMA participation does not transfer the station’s legal responsibility for its LPG operations, licences, facility safety, staff, measurement equipment or refill activity to SKIMA.
## 2. Approval and continued eligibility
Station participation depends on the approved branch/location, required business and regulatory evidence, verification, safety and current platform status.
Document approval is not overall station approval. Expired, suspended or unverified required authorisation may make the station temporarily ineligible.
SKIMA may use an available official NMDPRA permit/licence verification route rather than relying only on an uploaded document image.
## 3. Approved location and coverage
Operate SKIMA work only from the approved branch/location unless a location change has been reviewed and approved.
The platform may use station coordinates, service areas, route distance, availability and current capacity to determine customer visibility and order eligibility.
## 4. Station availability
Keep the station’s operational status accurate. Available, paused, closed or unavailable status should reflect whether the branch can currently receive and fulfil eligible work.
Do not remain available when the station cannot safely or lawfully perform the service.
## 5. LPG price
Maintain the station’s applicable LPG price accurately where the station participates in price-based fulfilment. SKIMA may add separately disclosed platform, coordination or delivery fees under current platform policy.
Do not demand an undisclosed price increase after a customer has accepted and paid a valid order. A material change must use the approved SKIMA adjustment, approval, cancellation or reroute flow.
## 6. Inventory and capacity
Where station inventory features are enabled, keep stock and operational capacity reasonably current through the configured source: manual entry, POS/provider connection, tank telemetry or another approved method.
A provider or sensor feed is operational evidence, not a licence to fabricate availability. Use authorised manual fallback only when the normal source is unavailable and record the required reason.
## 7. Driver and cylinder reception
Verify the active SKIMA order, arriving driver and identified cylinder. Complete the required scan/handoff controls before refill.
Do not accept a cylinder that does not match the order merely because a driver presents it. Use the mismatch/support process.
## 8. Refill safety and actual quantity
Use lawful and properly maintained refill and measurement equipment. Do not intentionally misstate quantity.
Record the approved actual kilograms filled. If the actual quantity is lower than originally requested or paid, the order should reflect the approved actual billable quantity so the customer and settlement records can be adjusted appropriately.
Stop normal fulfilment and use the safety path where a cylinder appears dangerously damaged or otherwise unsuitable for refill.
## 9. Completion and handoff
Complete the station-side refill record honestly and hand the correct cylinder back to the authorised assigned driver or other approved fulfilment participant.
Do not fabricate refill completion to trigger settlement.
## 10. Settlements
Station settlement becomes eligible according to the completed service stage, actual billable quantity, active commercial policy and any lawful dispute, refund, fraud or reconciliation control.
A station’s money is not automatically SKIMA revenue. SKIMA accounting separates platform-earned amounts from amounts economically attributable to the station and other beneficiaries.
## 11. Payout account and withdrawals
An authorised Station finance user may add a verified payout account even when the station’s currently available balance is zero.
A withdrawal is allowed only from the station’s available wallet balance and is subject to account verification, provider processing, disclosed withdrawal fees, disputes, reversals, security/fraud review and lawful holds.
Never ask staff or drivers to use a personal bank account as a substitute for an authorised station payout account.
## 12. Staff, roles and access
Station Owner and delegated station staff should use their own SKIMA accounts. Grant only the permissions needed for the person’s work.
A staff member must not see another user’s private profile or a different station’s records merely because they belong to the same organisation. Report any apparent data leakage immediately.
## 13. Customer information
Use customer, cylinder, order and delivery information only for the service, safety, support or a lawful requirement. Do not sell, publish or reuse private customer information.
## 14. Media and public station profile
SKIMA may display public-safe station logo or premises media after applicable approval. Private KYC, infrastructure verification and confidential business evidence must remain protected.
## 15. Ratings, complaints and quality review
Customer ratings can contribute to service-quality assessment, but a rating alone is not final proof of underfilling or misconduct.
Credible quantity, safety, fraud or service complaints may trigger review, evidence requests, temporary routing restrictions or other proportionate action.
## 16. SKIMA AI and station tools
Station AI may explain the station’s own authorised orders, inventory, settlement activity and operational next steps. AI does not override a scan, actual refill record, financial ledger, eligibility control or required human approval.
## 17. Incidents and support
Report cylinder mismatch, unsafe cylinders, measurement concerns, fraud, driver disputes, payment issues, data incidents and serious service failures through official SKIMA support.
For immediate fire, gas leak or other emergency, follow applicable facility emergency procedures and contact the appropriate emergency authority. Ordinary app support is not emergency response.
## 18. Suspension and termination
SKIMA may pause or terminate station participation for expired or invalid required authorisation, serious safety concerns, fraud, deliberate underfilling or false records, data misuse, unauthorised payment demands, repeated material service failures or a legal/regulatory requirement.
Where immediate protective action is not required, an appropriate correction or review opportunity should be provided.
## 19. Related documents
Read this policy together with:
SKIMA Partner Participation Terms & Public Policy
SKIMA Privacy Notice — Nigeria
Any signed Station Partner Agreement, pricing schedule or safety/compliance requirement that applies to the station
Use official SKIMA support channels for finance, access, privacy, application, safety or dispute questions.$p4$,'markdown',
      encode(extensions.digest($p4$SKIMA
# Station Partner Participation & Operations Policy
Version 2.0 · Updated 23 September 2026
For approved SKIMA LPG Station Partners and authorised station staff
## 1. Station participation
A Station Partner is an independently operated LPG station, retailer or eligible refill facility approved for the SKIMA activities it is lawfully permitted to perform.
SKIMA participation does not transfer the station’s legal responsibility for its LPG operations, licences, facility safety, staff, measurement equipment or refill activity to SKIMA.
## 2. Approval and continued eligibility
Station participation depends on the approved branch/location, required business and regulatory evidence, verification, safety and current platform status.
Document approval is not overall station approval. Expired, suspended or unverified required authorisation may make the station temporarily ineligible.
SKIMA may use an available official NMDPRA permit/licence verification route rather than relying only on an uploaded document image.
## 3. Approved location and coverage
Operate SKIMA work only from the approved branch/location unless a location change has been reviewed and approved.
The platform may use station coordinates, service areas, route distance, availability and current capacity to determine customer visibility and order eligibility.
## 4. Station availability
Keep the station’s operational status accurate. Available, paused, closed or unavailable status should reflect whether the branch can currently receive and fulfil eligible work.
Do not remain available when the station cannot safely or lawfully perform the service.
## 5. LPG price
Maintain the station’s applicable LPG price accurately where the station participates in price-based fulfilment. SKIMA may add separately disclosed platform, coordination or delivery fees under current platform policy.
Do not demand an undisclosed price increase after a customer has accepted and paid a valid order. A material change must use the approved SKIMA adjustment, approval, cancellation or reroute flow.
## 6. Inventory and capacity
Where station inventory features are enabled, keep stock and operational capacity reasonably current through the configured source: manual entry, POS/provider connection, tank telemetry or another approved method.
A provider or sensor feed is operational evidence, not a licence to fabricate availability. Use authorised manual fallback only when the normal source is unavailable and record the required reason.
## 7. Driver and cylinder reception
Verify the active SKIMA order, arriving driver and identified cylinder. Complete the required scan/handoff controls before refill.
Do not accept a cylinder that does not match the order merely because a driver presents it. Use the mismatch/support process.
## 8. Refill safety and actual quantity
Use lawful and properly maintained refill and measurement equipment. Do not intentionally misstate quantity.
Record the approved actual kilograms filled. If the actual quantity is lower than originally requested or paid, the order should reflect the approved actual billable quantity so the customer and settlement records can be adjusted appropriately.
Stop normal fulfilment and use the safety path where a cylinder appears dangerously damaged or otherwise unsuitable for refill.
## 9. Completion and handoff
Complete the station-side refill record honestly and hand the correct cylinder back to the authorised assigned driver or other approved fulfilment participant.
Do not fabricate refill completion to trigger settlement.
## 10. Settlements
Station settlement becomes eligible according to the completed service stage, actual billable quantity, active commercial policy and any lawful dispute, refund, fraud or reconciliation control.
A station’s money is not automatically SKIMA revenue. SKIMA accounting separates platform-earned amounts from amounts economically attributable to the station and other beneficiaries.
## 11. Payout account and withdrawals
An authorised Station finance user may add a verified payout account even when the station’s currently available balance is zero.
A withdrawal is allowed only from the station’s available wallet balance and is subject to account verification, provider processing, disclosed withdrawal fees, disputes, reversals, security/fraud review and lawful holds.
Never ask staff or drivers to use a personal bank account as a substitute for an authorised station payout account.
## 12. Staff, roles and access
Station Owner and delegated station staff should use their own SKIMA accounts. Grant only the permissions needed for the person’s work.
A staff member must not see another user’s private profile or a different station’s records merely because they belong to the same organisation. Report any apparent data leakage immediately.
## 13. Customer information
Use customer, cylinder, order and delivery information only for the service, safety, support or a lawful requirement. Do not sell, publish or reuse private customer information.
## 14. Media and public station profile
SKIMA may display public-safe station logo or premises media after applicable approval. Private KYC, infrastructure verification and confidential business evidence must remain protected.
## 15. Ratings, complaints and quality review
Customer ratings can contribute to service-quality assessment, but a rating alone is not final proof of underfilling or misconduct.
Credible quantity, safety, fraud or service complaints may trigger review, evidence requests, temporary routing restrictions or other proportionate action.
## 16. SKIMA AI and station tools
Station AI may explain the station’s own authorised orders, inventory, settlement activity and operational next steps. AI does not override a scan, actual refill record, financial ledger, eligibility control or required human approval.
## 17. Incidents and support
Report cylinder mismatch, unsafe cylinders, measurement concerns, fraud, driver disputes, payment issues, data incidents and serious service failures through official SKIMA support.
For immediate fire, gas leak or other emergency, follow applicable facility emergency procedures and contact the appropriate emergency authority. Ordinary app support is not emergency response.
## 18. Suspension and termination
SKIMA may pause or terminate station participation for expired or invalid required authorisation, serious safety concerns, fraud, deliberate underfilling or false records, data misuse, unauthorised payment demands, repeated material service failures or a legal/regulatory requirement.
Where immediate protective action is not required, an appropriate correction or review opportunity should be provided.
## 19. Related documents
Read this policy together with:
SKIMA Partner Participation Terms & Public Policy
SKIMA Privacy Notice — Nigeria
Any signed Station Partner Agreement, pricing schedule or safety/compliance requirement that applies to the station
Use official SKIMA support channels for finance, access, privacy, application, safety or dispute questions.$p4$,'sha256'),'hex'),'published',
      timezone('utc',now()),timezone('utc',now()),false,
      'https://docs.google.com/document/d/1B56XF2mQJVQYO_1N-D6R_51hvCGTVl00ZZTwC4YeB8Q/edit?usp=drivesdk','gdrive:1B56XF2mQJVQYO_1N-D6R_51hvCGTVl00ZZTwC4YeB8Q',timezone('utc',now()),old_id,
      jsonb_build_object(
        'sourceType','google_drive',
        'driveDocumentId','1B56XF2mQJVQYO_1N-D6R_51hvCGTVl00ZZTwC4YeB8Q',
        'driveRevision','ANLCKQmr5PACoLMDz7-a_OS8HKiz_SRs3KGyvtmHSBYj5wpBDcgKWGHR4pLDrCtv-iqf_fqBh63msl261w4x8kAyruUsJTZzYqNlXajR0Wc',
        'syncedAt',timezone('utc',now())
      )
    from public.policy_documents document
    where document.id=doc_id;
  end if;
end
$sync$;


insert into public.admin_knowledge_documents(
  key,title,version_label,source_url,source_document_id,source_revision,content_format,content,content_hash,
  status,last_synced_at,metadata,updated_at
)
values(
  'guide.admin.operations',
  'SKIMA Administration — Operational Handbook',
  '1.0',
  'https://docs.google.com/document/d/1fYUC0sPklBXgrYKCEIOzwZIpZmz7WhFbJuAtajDsS8o/edit?usp=drivesdk',
  '1fYUC0sPklBXgrYKCEIOzwZIpZmz7WhFbJuAtajDsS8o',
  'ANLCKQltAuKxo4zizJQn1JZmOXsCO9gcghdBbZ5LwNk0JSaplLvfvCVLNWi5e1tLjANTNIi4ptVwNLyd8Ql6Ja7zyL5XiGCJz9WDzKWcAMU',
  'markdown',
  $admin$SKIMA
# Administration — Operational Handbook
Version 1.0 · Updated 23 September 2026
Complete operating guide for authorised SKIMA Platform Administrators
## Purpose
Use this handbook to operate the SKIMA administration dashboard safely and consistently. It explains what each workspace controls, the normal operating sequence, which records are authoritative, how to avoid financial or safety mistakes, and when to escalate rather than force an action.
This handbook is an operating guide, not a substitute for the permission system, database rules, legal advice, emergency procedures or role-specific approval authority.
## 1. Administration authority and access
SKIMA administration is permission-driven. A navigation item appearing on screen means the signed-in account has the relevant effective access; it does not mean every action inside that area is automatically allowed.
Use the smallest suitable role. Never share an administrator login, borrow another person’s session or copy service credentials into notes, chat, screenshots or AI prompts.
Super Admin authority should be limited to the small number of people who genuinely need final platform governance. Other administrators should receive the read/manage permissions required for their assigned work.
Every sensitive change should leave an audit trail or an authoritative backend record.
## 2. Home / Overview
Route: /dashboard
Start here at the beginning of an operating shift. Review platform totals, open issues, service health and the most important alerts available to your role.
Use Overview to identify what needs attention; move into the owning workspace before editing a record. Refresh before acting on time-sensitive order, payment, driver, station, inventory or provider information.
Do not use dashboard totals as a substitute for the underlying transaction or order record.
## 3. People & Partners
Workspace routes: /partners/*
### Applications — /partners/applications
Review partner applications, missing steps, submitted documents and readiness. A document marked approved does not mean the whole application is approved. Confirm every required eligibility gate before the final application decision.
### Companies — /partners/companies
Review organisations and partner entities. Confirm the exact organisation and ownership context before changing lifecycle state or access.
### Drivers — /partners/drivers
Review Driver Partner and SKIMA Managed Driver status, identity, operational eligibility, programmes and assignment readiness. Managed Driver is the current internal-fulfilment driver designation. Do not grant Managed Driver status merely because a driver requests it; it is an SKIMA-controlled programme assignment.
### Stations — /partners/stations
Review station branches, approval/compliance state, pricing, operating location and partner details. Station price and SKIMA fees are separate governed values. Never overwrite historical order economics to reflect a new price.
### Verification — /partners/verification
Review configured verification requirements and provider outcomes. Provider output is evidence within the verification process; final partner approval is a separate decision.
### Location Review — /partners/location-review
Check whether submitted station or driver locations match the real operating location and service geography. Review coordinates, address information and supporting evidence before approval.
### Fleet & Vehicles — /partners/fleet
Manage vehicles and assignments. For SKIMA-owned internal fulfilment, a vehicle must be marked as SKIMA/platform owned, active, LPG-eligible and linked through the correct fleet-owned relationship to the Managed Driver.
## 4. Operations
Workspace routes: /operations/*
### Orders & Dispatch — /operations/orders
Use the order record as the operational source of truth. Review current status, customer, cylinder, fulfilment channel, assigned driver/station or internal path, payment reservation and event history before intervening.
Do not manually jump an order to a later state to make a screen look correct. Use the supported retry, assignment or exception action so the event history remains consistent.
When a paid order has no driver, first determine whether the issue is eligibility, coverage, online availability, vehicle readiness, dispatch ranking, stale location or a runtime failure. Retry matching only when it is safe and idempotent.
### Service Coverage — /operations/coverage
Coverage is geographic policy, not a visual decoration. Configure state/LGA/city/town or custom/radius areas according to the intended launch scope. A broad enabled area can still contain exclusions.
Do not enable an area because a map pin looks close. Use the authoritative geography/coverage resolver and confirm driver/station operational coverage.
### Station Inventory — /operations/inventory
Review current stock, tanks/capacity, inventory source health, observations and fallback state. The source may be manual, POS/provider, tank telemetry or another approved adapter.
A manual override should include the required reason and must not conceal a broken provider feed. Reconcile material differences rather than repeatedly overwriting stock.
### Service Quality — /operations/quality
Review underfill, safety, custody, delivery and service-quality signals. Treat an allegation as a reason to investigate, not as an automatic finding. Preserve evidence and distinguish complaints from verified outcomes.
### Support — /operations/support
Review support threads, complaint state and the relevant order/payment/cylinder context. Give the user a practical answer: what happened, where the cylinder or money is, what happens next and what action SKIMA is taking.
## 5. SKIMA-owned fulfilment launch assurance
Internal fulfilment must remain disabled until the launch-readiness function reports ready.
The readiness model requires:
• an internal Managed Driver compensation percentage greater than zero;
• at least one active service-area internal LPG reference price;
• at least one approved Managed Driver in the configured programme;
• an active LPG-eligible SKIMA-owned fleet vehicle assigned through the fleet-owned relationship;
• approved LPG operational coverage; and
• at least one single Managed Driver who simultaneously has the eligible SKIMA vehicle and the approved coverage.
Do not satisfy these conditions with unrelated drivers. The readiness check intentionally requires one executable end-to-end Managed Driver path.
When internal fulfilment is enabled, the configured mode and priority determine whether partner fulfilment, internal fulfilment or a hybrid/fallback strategy applies.
## 6. Money
Workspace routes: /money/*
### Revenue — /money/revenue
SKIMA revenue is not the same as total customer money processed. Review platform-earned revenue separately from customer balances, station earnings, driver earnings, clearing/settlement balances and provider liabilities.
Only authorised treasury roles should initiate a platform revenue payout.
### Balances & Deposits — /money/balances
Review wallet balances, deposits and provider confirmation. A payment request existing in the database does not prove success. The authoritative provider result and financial ledger state determine whether value became available.
### Withdrawals — /money/withdrawals
Review payout account, requested amount, fee, total wallet debit, provider reference and final transfer state. A participant can configure a payout account even when the balance is zero; the balance requirement applies to the withdrawal itself.
### Settlements — /money/settlements
Review settlement beneficiaries and order stage before releasing money. Public/legal wording should not imply a regulated escrow product unless the real payment structure supports that term.
### Pricing — /money/pricing, /money/pricing/delivery, /money/pricing/drivers
Pricing is versioned policy. Draft, approve and activate according to your permission and the current governance flow. A future version applies prospectively and must not rewrite a completed transaction.
### Financial Controls — /money/controls
Use these controls for governed fee, payout and money policies. Record a clear change reason. Never edit ledger history to “correct” a policy problem.
## 7. Payment and payout provider operations
Paystack or another configured payment provider may handle deposits, account resolution and transfers. Provider secrets remain server-side.
For a wallet top-up:
• the app prepares the amount and fee;
• the backend creates a deposit request;
• the provider initializes checkout;
• provider webhook/verification confirms the result; and
• only then is the wallet credited.
For a payout account:
• the bank directory is loaded;
• the bank/account is resolved by the configured provider;
• the verified beneficiary is stored; and
• withdrawal uses the verified beneficiary and available balance.
If initialization fails, check the active provider, server secret, callback URL, webhook, provider response and runtime logs. Never expose a secret while troubleshooting.
## 8. Services
Workspace routes: /services/*
### Utility Billing — /services/utility-billing
Configure provider connections, billers/products, fees, catalogue sync, provider tests and reconciliation. The provider’s success response is authoritative for fulfilment. Do not mark a bill paid solely because SKIMA created the request.
### Service Catalog — /services/catalog
Maintain the services and products SKIMA exposes. Keep provider-specific codes behind the provider/configuration layer rather than hardcoding them into customer UI.
### Service Availability — /services/availability
Control where and when services are offered. Availability should reflect provider readiness, business policy and geography.
## 9. SKIMA Intelligence
Routes: /intelligence and /intelligence/ask
Use Ask SKIMA to explain current platform records, identify issues and guide an operator through the correct screen. Treat it as decision support, not an invisible administrator.
The assistant must respect the signed-in administrator’s permissions and may not reveal protected credentials, another user’s private KYC, or internal data outside that authority.
AI must not silently change orders, money, stock, approvals, dispatch, permissions or partner status. Any future action capability must require the authorised backend action and confirmation appropriate to that operation.
When asking a question, include the operational goal and relevant record. Do not paste secret keys or passwords.
## 10. Experience
Workspace routes: /experience/*
### Brand & Content — /experience/content
Manage public/customer-facing brand assets, banners and configured content. Use the approved SKIMA logo and media classes. Do not publish private verification media as promotional content.
### Terms & Policies — /experience/policies
Manage policy documents and version history. Material policy changes should create a new version and require renewed acceptance where appropriate. Keep the external source URL and in-app version aligned.
### App Branding — /experience/branding
Control supported branding/startup presentation. Maintain readable contrast and safe fallback assets.
## 11. Privacy and policy operations
SKIMA policy content is versioned in the backend. The Google Drive policy document is the readable external source; the in-app copy is stored as the current published policy version.
When updating a policy:
## 1. edit and approve the canonical Drive document;
## 2. create a new backend policy version from that approved source;
## 3. set the external source URL to the correct Drive document;
## 4. record source/version metadata;
## 5. decide whether the change requires reacceptance;
## 6. publish prospectively; and
## 7. test customer, driver and station policy readers.
Do not edit the text of a historical accepted version in place.
## 12. Maps and location
SKIMA’s mobile basemap is designed to work without a paid Google/Mapbox API key by using MapLibre with a keyless OSM-derived renderer.
Current launch map display should use the configured keyless renderer. If a map shows “API KEY REQUIRED”, first suspect an old APK or stale map configuration rather than purchasing a new API.
Geocoding, reverse geocoding, route calculation and map display are separate capabilities. A keyless basemap does not guarantee unlimited free routing/geocoding. Keep provider adapters replaceable and respect provider usage limits.
Driver background location is operational data. Verify that online/offline state, active-job state and permission handling match the disclosed privacy policy.
## 13. Platform
Workspace routes: /platform/*
### People & Access — /platform/people-access
Grant the smallest role that fits the person’s work. Confirm identity before inviting or changing access. Review effective navigation after a role change.
### Configuration — /platform/configuration
Use governed configuration for business rules and feature settings. Avoid code changes for values that are designed to be database-configurable.
### Integrations — /platform/integrations
Manage provider adapters and their public configuration. Protected credentials belong in Supabase Edge secrets or another authorised secret store, never in public config.
### System Health — /platform/system
Review runtime errors, queues, provider issues, audit events and operational history. Retry only operations that are designed to be safely retried.
## 14. Admin AI guidance knowledge
Ask SKIMA should use this handbook as its operating guide plus the current page, current database records the administrator is authorised to read, active policies and backend business rules.
If the handbook conflicts with a current authoritative backend state, the assistant should explain the difference rather than pretending the document changed the database.
If an operator asks for a password, secret key, private credential or another protected value, the assistant should explain that protected credentials are not available through the guide or ordinary AI context and direct the operator to the authorised credential-management process.
## 15. Safety, incidents and escalation
For a serious gas leak, fire, collision, injury or other emergency, prioritise emergency response and established safety procedure before ordinary dashboard work.
For a data incident, preserve relevant logs, restrict unnecessary access and escalate according to the privacy/security incident process.
For a payment ambiguity, do not manually credit or debit a wallet merely to match the user’s expectation. Reconcile against the authoritative provider and ledger records.
For suspected cylinder switching, preserve scan, custody, order and driver/station evidence before taking a final misconduct decision.
## 16. Operating discipline
Refresh before time-sensitive actions.
Read the record history before changing state.
Use the supported action, not direct data manipulation, for normal operations.
Write a meaningful reason for guarded changes.
Do not delete evidence merely because a case is uncomfortable or resolved.
Do not expose private customer/partner data in screenshots or public channels.
Never expose service-role keys, payment secrets or verification credentials.
Use staged testing for provider or pricing changes.
Check audit history after high-impact changes.
## 17. Troubleshooting
A page is missing — check the signed-in administrator, role, effective permissions and whether the module is reserved for a stronger role.
An action is read-only — the role may have read access without manage access. Do not bypass it with another user’s login.
A map shows API KEY REQUIRED — confirm the current APK and the keyless renderer configuration. Do not buy a map API before confirming the stale-config possibility.
A paid order has no driver — review dispatch eligibility, online Managed/Partner drivers, location freshness, vehicle readiness and coverage before retrying.
A station cannot add a payout account — confirm the station partner wallet exists and is visible to the authorised station user, then check payout-provider/bank-directory readiness. Zero balance alone should not hide payout setup.
A provider call fails — check provider status, configuration, server-side secret, request/response log and retry rules. Avoid repeated blind retries.
An AI answer appears wrong — open the authoritative record and compare. AI explanation is not the source of truth.
## 18. Daily operating checklist
At shift start:
• Review Home and System Health.
• Check urgent support/safety items.
• Check stuck paid orders and dispatch.
• Review provider/payment failures.
• Review station inventory exceptions.
• Review application/verification queues that are within your role.
Before shift end:
• Confirm unresolved critical items have an owner.
• Record necessary handoff notes in the supported operational system.
• Check that no temporary broad permission or emergency configuration remains unnecessarily enabled.
• Sign out on shared devices.
## 19. Glossary
Available balance — money currently eligible for a supported debit/withdrawal after authoritative financial posting.
Driver Partner — independently participating approved driver.
Managed Driver — SKIMA-controlled internal-fulfilment driver operating an eligible SKIMA-owned fleet vehicle.
Partner fulfilment — order fulfilled through eligible independent SKIMA partners.
SKIMA-managed fulfilment — internal fulfilment path enabled only when launch-readiness requirements pass.
Station Partner — independently operated eligible LPG station participating in SKIMA.
Provider adapter — replaceable integration layer for payment, maps, verification, utilities, AI or other external service.
Policy version — immutable accepted/published policy text for a specific effective version.
Source of truth — the authoritative backend/provider record used to decide state, not a UI assumption or AI summary.
## 20. Guide maintenance
This handbook is maintained as a Google Drive source and mirrored into the SKIMA administration app. The in-app guide should display the synchronized source version, not a hardcoded frontend copy.
Update the Drive source first, then synchronize the approved text into the backend knowledge record. Record the source document ID, revision and synchronization time. Admin AI should use the same synchronized knowledge so its operating guidance and the visible handbook stay aligned.$admin$,
  encode(extensions.digest($admin$SKIMA
# Administration — Operational Handbook
Version 1.0 · Updated 23 September 2026
Complete operating guide for authorised SKIMA Platform Administrators
## Purpose
Use this handbook to operate the SKIMA administration dashboard safely and consistently. It explains what each workspace controls, the normal operating sequence, which records are authoritative, how to avoid financial or safety mistakes, and when to escalate rather than force an action.
This handbook is an operating guide, not a substitute for the permission system, database rules, legal advice, emergency procedures or role-specific approval authority.
## 1. Administration authority and access
SKIMA administration is permission-driven. A navigation item appearing on screen means the signed-in account has the relevant effective access; it does not mean every action inside that area is automatically allowed.
Use the smallest suitable role. Never share an administrator login, borrow another person’s session or copy service credentials into notes, chat, screenshots or AI prompts.
Super Admin authority should be limited to the small number of people who genuinely need final platform governance. Other administrators should receive the read/manage permissions required for their assigned work.
Every sensitive change should leave an audit trail or an authoritative backend record.
## 2. Home / Overview
Route: /dashboard
Start here at the beginning of an operating shift. Review platform totals, open issues, service health and the most important alerts available to your role.
Use Overview to identify what needs attention; move into the owning workspace before editing a record. Refresh before acting on time-sensitive order, payment, driver, station, inventory or provider information.
Do not use dashboard totals as a substitute for the underlying transaction or order record.
## 3. People & Partners
Workspace routes: /partners/*
### Applications — /partners/applications
Review partner applications, missing steps, submitted documents and readiness. A document marked approved does not mean the whole application is approved. Confirm every required eligibility gate before the final application decision.
### Companies — /partners/companies
Review organisations and partner entities. Confirm the exact organisation and ownership context before changing lifecycle state or access.
### Drivers — /partners/drivers
Review Driver Partner and SKIMA Managed Driver status, identity, operational eligibility, programmes and assignment readiness. Managed Driver is the current internal-fulfilment driver designation. Do not grant Managed Driver status merely because a driver requests it; it is an SKIMA-controlled programme assignment.
### Stations — /partners/stations
Review station branches, approval/compliance state, pricing, operating location and partner details. Station price and SKIMA fees are separate governed values. Never overwrite historical order economics to reflect a new price.
### Verification — /partners/verification
Review configured verification requirements and provider outcomes. Provider output is evidence within the verification process; final partner approval is a separate decision.
### Location Review — /partners/location-review
Check whether submitted station or driver locations match the real operating location and service geography. Review coordinates, address information and supporting evidence before approval.
### Fleet & Vehicles — /partners/fleet
Manage vehicles and assignments. For SKIMA-owned internal fulfilment, a vehicle must be marked as SKIMA/platform owned, active, LPG-eligible and linked through the correct fleet-owned relationship to the Managed Driver.
## 4. Operations
Workspace routes: /operations/*
### Orders & Dispatch — /operations/orders
Use the order record as the operational source of truth. Review current status, customer, cylinder, fulfilment channel, assigned driver/station or internal path, payment reservation and event history before intervening.
Do not manually jump an order to a later state to make a screen look correct. Use the supported retry, assignment or exception action so the event history remains consistent.
When a paid order has no driver, first determine whether the issue is eligibility, coverage, online availability, vehicle readiness, dispatch ranking, stale location or a runtime failure. Retry matching only when it is safe and idempotent.
### Service Coverage — /operations/coverage
Coverage is geographic policy, not a visual decoration. Configure state/LGA/city/town or custom/radius areas according to the intended launch scope. A broad enabled area can still contain exclusions.
Do not enable an area because a map pin looks close. Use the authoritative geography/coverage resolver and confirm driver/station operational coverage.
### Station Inventory — /operations/inventory
Review current stock, tanks/capacity, inventory source health, observations and fallback state. The source may be manual, POS/provider, tank telemetry or another approved adapter.
A manual override should include the required reason and must not conceal a broken provider feed. Reconcile material differences rather than repeatedly overwriting stock.
### Service Quality — /operations/quality
Review underfill, safety, custody, delivery and service-quality signals. Treat an allegation as a reason to investigate, not as an automatic finding. Preserve evidence and distinguish complaints from verified outcomes.
### Support — /operations/support
Review support threads, complaint state and the relevant order/payment/cylinder context. Give the user a practical answer: what happened, where the cylinder or money is, what happens next and what action SKIMA is taking.
## 5. SKIMA-owned fulfilment launch assurance
Internal fulfilment must remain disabled until the launch-readiness function reports ready.
The readiness model requires:
• an internal Managed Driver compensation percentage greater than zero;
• at least one active service-area internal LPG reference price;
• at least one approved Managed Driver in the configured programme;
• an active LPG-eligible SKIMA-owned fleet vehicle assigned through the fleet-owned relationship;
• approved LPG operational coverage; and
• at least one single Managed Driver who simultaneously has the eligible SKIMA vehicle and the approved coverage.
Do not satisfy these conditions with unrelated drivers. The readiness check intentionally requires one executable end-to-end Managed Driver path.
When internal fulfilment is enabled, the configured mode and priority determine whether partner fulfilment, internal fulfilment or a hybrid/fallback strategy applies.
## 6. Money
Workspace routes: /money/*
### Revenue — /money/revenue
SKIMA revenue is not the same as total customer money processed. Review platform-earned revenue separately from customer balances, station earnings, driver earnings, clearing/settlement balances and provider liabilities.
Only authorised treasury roles should initiate a platform revenue payout.
### Balances & Deposits — /money/balances
Review wallet balances, deposits and provider confirmation. A payment request existing in the database does not prove success. The authoritative provider result and financial ledger state determine whether value became available.
### Withdrawals — /money/withdrawals
Review payout account, requested amount, fee, total wallet debit, provider reference and final transfer state. A participant can configure a payout account even when the balance is zero; the balance requirement applies to the withdrawal itself.
### Settlements — /money/settlements
Review settlement beneficiaries and order stage before releasing money. Public/legal wording should not imply a regulated escrow product unless the real payment structure supports that term.
### Pricing — /money/pricing, /money/pricing/delivery, /money/pricing/drivers
Pricing is versioned policy. Draft, approve and activate according to your permission and the current governance flow. A future version applies prospectively and must not rewrite a completed transaction.
### Financial Controls — /money/controls
Use these controls for governed fee, payout and money policies. Record a clear change reason. Never edit ledger history to “correct” a policy problem.
## 7. Payment and payout provider operations
Paystack or another configured payment provider may handle deposits, account resolution and transfers. Provider secrets remain server-side.
For a wallet top-up:
• the app prepares the amount and fee;
• the backend creates a deposit request;
• the provider initializes checkout;
• provider webhook/verification confirms the result; and
• only then is the wallet credited.
For a payout account:
• the bank directory is loaded;
• the bank/account is resolved by the configured provider;
• the verified beneficiary is stored; and
• withdrawal uses the verified beneficiary and available balance.
If initialization fails, check the active provider, server secret, callback URL, webhook, provider response and runtime logs. Never expose a secret while troubleshooting.
## 8. Services
Workspace routes: /services/*
### Utility Billing — /services/utility-billing
Configure provider connections, billers/products, fees, catalogue sync, provider tests and reconciliation. The provider’s success response is authoritative for fulfilment. Do not mark a bill paid solely because SKIMA created the request.
### Service Catalog — /services/catalog
Maintain the services and products SKIMA exposes. Keep provider-specific codes behind the provider/configuration layer rather than hardcoding them into customer UI.
### Service Availability — /services/availability
Control where and when services are offered. Availability should reflect provider readiness, business policy and geography.
## 9. SKIMA Intelligence
Routes: /intelligence and /intelligence/ask
Use Ask SKIMA to explain current platform records, identify issues and guide an operator through the correct screen. Treat it as decision support, not an invisible administrator.
The assistant must respect the signed-in administrator’s permissions and may not reveal protected credentials, another user’s private KYC, or internal data outside that authority.
AI must not silently change orders, money, stock, approvals, dispatch, permissions or partner status. Any future action capability must require the authorised backend action and confirmation appropriate to that operation.
When asking a question, include the operational goal and relevant record. Do not paste secret keys or passwords.
## 10. Experience
Workspace routes: /experience/*
### Brand & Content — /experience/content
Manage public/customer-facing brand assets, banners and configured content. Use the approved SKIMA logo and media classes. Do not publish private verification media as promotional content.
### Terms & Policies — /experience/policies
Manage policy documents and version history. Material policy changes should create a new version and require renewed acceptance where appropriate. Keep the external source URL and in-app version aligned.
### App Branding — /experience/branding
Control supported branding/startup presentation. Maintain readable contrast and safe fallback assets.
## 11. Privacy and policy operations
SKIMA policy content is versioned in the backend. The Google Drive policy document is the readable external source; the in-app copy is stored as the current published policy version.
When updating a policy:
## 1. edit and approve the canonical Drive document;
## 2. create a new backend policy version from that approved source;
## 3. set the external source URL to the correct Drive document;
## 4. record source/version metadata;
## 5. decide whether the change requires reacceptance;
## 6. publish prospectively; and
## 7. test customer, driver and station policy readers.
Do not edit the text of a historical accepted version in place.
## 12. Maps and location
SKIMA’s mobile basemap is designed to work without a paid Google/Mapbox API key by using MapLibre with a keyless OSM-derived renderer.
Current launch map display should use the configured keyless renderer. If a map shows “API KEY REQUIRED”, first suspect an old APK or stale map configuration rather than purchasing a new API.
Geocoding, reverse geocoding, route calculation and map display are separate capabilities. A keyless basemap does not guarantee unlimited free routing/geocoding. Keep provider adapters replaceable and respect provider usage limits.
Driver background location is operational data. Verify that online/offline state, active-job state and permission handling match the disclosed privacy policy.
## 13. Platform
Workspace routes: /platform/*
### People & Access — /platform/people-access
Grant the smallest role that fits the person’s work. Confirm identity before inviting or changing access. Review effective navigation after a role change.
### Configuration — /platform/configuration
Use governed configuration for business rules and feature settings. Avoid code changes for values that are designed to be database-configurable.
### Integrations — /platform/integrations
Manage provider adapters and their public configuration. Protected credentials belong in Supabase Edge secrets or another authorised secret store, never in public config.
### System Health — /platform/system
Review runtime errors, queues, provider issues, audit events and operational history. Retry only operations that are designed to be safely retried.
## 14. Admin AI guidance knowledge
Ask SKIMA should use this handbook as its operating guide plus the current page, current database records the administrator is authorised to read, active policies and backend business rules.
If the handbook conflicts with a current authoritative backend state, the assistant should explain the difference rather than pretending the document changed the database.
If an operator asks for a password, secret key, private credential or another protected value, the assistant should explain that protected credentials are not available through the guide or ordinary AI context and direct the operator to the authorised credential-management process.
## 15. Safety, incidents and escalation
For a serious gas leak, fire, collision, injury or other emergency, prioritise emergency response and established safety procedure before ordinary dashboard work.
For a data incident, preserve relevant logs, restrict unnecessary access and escalate according to the privacy/security incident process.
For a payment ambiguity, do not manually credit or debit a wallet merely to match the user’s expectation. Reconcile against the authoritative provider and ledger records.
For suspected cylinder switching, preserve scan, custody, order and driver/station evidence before taking a final misconduct decision.
## 16. Operating discipline
Refresh before time-sensitive actions.
Read the record history before changing state.
Use the supported action, not direct data manipulation, for normal operations.
Write a meaningful reason for guarded changes.
Do not delete evidence merely because a case is uncomfortable or resolved.
Do not expose private customer/partner data in screenshots or public channels.
Never expose service-role keys, payment secrets or verification credentials.
Use staged testing for provider or pricing changes.
Check audit history after high-impact changes.
## 17. Troubleshooting
A page is missing — check the signed-in administrator, role, effective permissions and whether the module is reserved for a stronger role.
An action is read-only — the role may have read access without manage access. Do not bypass it with another user’s login.
A map shows API KEY REQUIRED — confirm the current APK and the keyless renderer configuration. Do not buy a map API before confirming the stale-config possibility.
A paid order has no driver — review dispatch eligibility, online Managed/Partner drivers, location freshness, vehicle readiness and coverage before retrying.
A station cannot add a payout account — confirm the station partner wallet exists and is visible to the authorised station user, then check payout-provider/bank-directory readiness. Zero balance alone should not hide payout setup.
A provider call fails — check provider status, configuration, server-side secret, request/response log and retry rules. Avoid repeated blind retries.
An AI answer appears wrong — open the authoritative record and compare. AI explanation is not the source of truth.
## 18. Daily operating checklist
At shift start:
• Review Home and System Health.
• Check urgent support/safety items.
• Check stuck paid orders and dispatch.
• Review provider/payment failures.
• Review station inventory exceptions.
• Review application/verification queues that are within your role.
Before shift end:
• Confirm unresolved critical items have an owner.
• Record necessary handoff notes in the supported operational system.
• Check that no temporary broad permission or emergency configuration remains unnecessarily enabled.
• Sign out on shared devices.
## 19. Glossary
Available balance — money currently eligible for a supported debit/withdrawal after authoritative financial posting.
Driver Partner — independently participating approved driver.
Managed Driver — SKIMA-controlled internal-fulfilment driver operating an eligible SKIMA-owned fleet vehicle.
Partner fulfilment — order fulfilled through eligible independent SKIMA partners.
SKIMA-managed fulfilment — internal fulfilment path enabled only when launch-readiness requirements pass.
Station Partner — independently operated eligible LPG station participating in SKIMA.
Provider adapter — replaceable integration layer for payment, maps, verification, utilities, AI or other external service.
Policy version — immutable accepted/published policy text for a specific effective version.
Source of truth — the authoritative backend/provider record used to decide state, not a UI assumption or AI summary.
## 20. Guide maintenance
This handbook is maintained as a Google Drive source and mirrored into the SKIMA administration app. The in-app guide should display the synchronized source version, not a hardcoded frontend copy.
Update the Drive source first, then synchronize the approved text into the backend knowledge record. Record the source document ID, revision and synchronization time. Admin AI should use the same synchronized knowledge so its operating guidance and the visible handbook stay aligned.$admin$,'sha256'),'hex'),
  'active',
  timezone('utc',now()),
  jsonb_build_object('sourceType','google_drive','syncAuthority','drive_first','syncedAt',timezone('utc',now())),
  timezone('utc',now())
)
on conflict(key) do update set
  title=excluded.title,
  version_label=excluded.version_label,
  source_url=excluded.source_url,
  source_document_id=excluded.source_document_id,
  source_revision=excluded.source_revision,
  content_format=excluded.content_format,
  content=excluded.content,
  content_hash=excluded.content_hash,
  status='active',
  last_synced_at=excluded.last_synced_at,
  metadata=public.admin_knowledge_documents.metadata || excluded.metadata,
  updated_at=excluded.updated_at;

commit;
