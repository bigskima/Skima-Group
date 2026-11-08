-- Publish the initial, immutable customer terms for Logistics, Store and Bills.
-- The separate statement is intentional: the policy documents are created by the
-- preceding migration, then these published versions are attached to those records.
with policy_seed(key,version_label,summary,content,app_key) as (
values
('policy.customer.bills.terms','1.0','These terms cover airtime, data, electricity, TV and other supported bill payments, including customer details, provider confirmation, fees, reversals, refunds, complaints and transaction records.','
# SKIMA Bills Customer Terms of Use
Version 1.0 · Effective 8 November 2026

## 1. About SKIMA Bills
SKIMA Bills provides access to supported airtime, data, electricity, television and other bill-payment services through the app. SKIMA connects your request to the relevant biller, distributor, aggregator or payment provider. The company that supplies the underlying utility or service remains responsible for that service.
A payment request is not proof that airtime, data, electricity or another service has been delivered. Completion depends on confirmation from the relevant provider and the transaction status shown in the app.

## 2. Your account and customer details
You must be legally able to make the transaction. Provide accurate phone numbers, smart-card or meter numbers, account references, network, provider, product, amount and other details requested by the app.
You are responsible for checking that the recipient and service details are correct before confirming. A transaction sent to an incorrect number, meter or account may not be recoverable once the provider has processed it. Contact Support immediately if you notice an error.

## 3. Confirming a bill payment
Before you confirm, review the provider, service, recipient or account number, amount, any available customer-name confirmation, applicable fee and total charge. Where the provider offers a name check or validation response, review it carefully. A successful validation does not replace your responsibility to confirm the details.
Do not proceed when a displayed name, account number, provider or service does not match your intention. Do not share your password, one-time code or payment authentication details with anyone who claims they can complete the transaction for you.

## 4. Fees, wallet balance and payment
The app should show the amount payable and any applicable SKIMA fee before you confirm. Charges may vary by service, provider, amount or payment method and are determined by the current prices shown in the app.
A SKIMA Wallet balance is an in-app transaction record used for supported services. It is not a bank deposit account unless the applicable regulated payment structure permits that description. Payments may also be processed through an approved payment provider. A top-up or payment is credited only after authoritative confirmation is received.
If the app shows that a payment is pending, do not repeat the payment until you have checked its status. Repeating a pending transaction may result in a duplicate debit.

## 5. Provider processing and successful delivery
The provider may process a transaction immediately or after a short delay. A transaction is successful only when the relevant provider confirms completion and the app records that result. A request accepted by SKIMA or a payment provider alone does not prove that the biller has credited the account.
Provider systems may be unavailable, delayed or unable to process a request. If a transaction fails, remains pending or returns an unclear result, SKIMA may check the provider response and reconcile the transaction before confirming the final outcome.

## 6. Failed, pending and duplicate transactions
When money has been debited but the provider has not delivered the service, SKIMA will review the authoritative provider status and payment records. Where a reversal or refund is due, it will be processed through the applicable payment route or wallet credit after reconciliation.
A pending transaction should not be treated as successful or failed until the provider result is established. If you see multiple debits for one request, report the issue through Support and include the transaction references. Do not send another payment to a personal account to resolve a pending transaction.
Refund timing may depend on the payment provider, bank, biller or other party involved. SKIMA will provide available transaction information and pursue the applicable resolution process. Nothing in these terms removes a right or remedy that cannot lawfully be excluded.

## 7. Reversals and provider restrictions
Some services, once successfully processed by the provider, may be difficult or impossible to reverse. This may include airtime, data or a bill credit applied to the recipient account. The app should disclose relevant limitations where known before confirmation.
If a provider supports a reversal, correction or refund, SKIMA may submit or coordinate the request. A reversal is not guaranteed where the provider has already completed an irreversible service or where the provider''s rules or applicable law do not permit it.

## 8. Receipts and transaction records
The app may provide a receipt, transaction reference, timestamp, status and provider response. Keep the receipt until the biller or recipient confirms the service has been credited. A receipt showing that a request was created is not proof of successful delivery unless it carries a confirmed success result.
SKIMA may retain transaction and audit records for customer support, reconciliation, fraud prevention, accounting and legal requirements.

## 9. Service availability and third parties
Service availability depends on the provider, biller, network, payment channel, location, maintenance, regulatory restrictions and other operational conditions. SKIMA does not control every provider system and cannot guarantee uninterrupted third-party service.
SKIMA may temporarily suspend a service when the provider is unavailable, a safety or fraud concern arises, a price or product is unclear, or a legal requirement prevents processing. If your payment has been taken, the transaction will be reviewed under the applicable reconciliation and refund process.

## 10. Customer conduct and account security
Use SKIMA Bills only for lawful payments. Do not use false recipient details, attempt to manipulate provider systems, abuse promotions, or make payments for unlawful activity. Keep your password, recovery links and one-time codes secure and report suspected account access promptly.
SKIMA may restrict an account or transaction where reasonably necessary to prevent fraud, protect users, meet legal obligations or investigate suspicious activity. Where appropriate, you may request a review through Support.

## 11. Support and complaints
Use the official in-app Support channel for failed payments, pending transactions, incorrect recipient details, duplicate debits, missing bill credits and other concerns. Include the transaction reference, service type, amount and time. Never send your password, one-time code or full card credentials in a support message.
If the issue concerns the underlying electricity, television, telecom or other service after the provider confirms delivery, you may also need to contact the relevant service provider using its official channel.

## 12. Privacy
SKIMA may process account, contact, recipient, transaction, wallet, payment, device and support information to submit and reconcile bill payments, protect accounts, provide receipts, investigate complaints and meet legal obligations. The relevant provider or payment partner may receive the information needed to process the transaction.
The separate SKIMA Privacy Notice explains how personal information is handled and the rights available to you under applicable law.

## 13. Changes to these terms
SKIMA may update these terms when supported services, providers, payment arrangements or applicable law change. Material changes will be communicated where appropriate. Where renewed acceptance is required, you must accept the new version before continuing to use SKIMA Bills. A new version does not silently alter the result of a completed transaction.

## 14. Governing law and contact
These terms are governed by applicable law in the Federal Republic of Nigeria. Contact SKIMA through official in-app Support or the authorised SKIMA website. You may also approach an appropriate regulator or court where the law permits.

## Acceptance
By selecting “Accept and continue”, you confirm that you have had the opportunity to read these terms and agree to the current version when using SKIMA Bills. Your statutory consumer rights remain protected.
','bills'),
('policy.customer.logistics.terms','1.0','These terms cover delivery requests, provider offers, bookings, pricing, customer and provider responsibilities, service changes, payments, complaints and claims when using SKIMA Logistics.','
# SKIMA Logistics Customer Terms of Use
Version 1.0 · Effective 8 November 2026

## 1. Using SKIMA Logistics
SKIMA Logistics helps customers find and communicate with independent or approved delivery and logistics providers. Depending on the service shown in the app, SKIMA may provide the marketplace, booking tools, support, payment collection or other coordination services. The provider shown on a confirmed booking is responsible for carrying out the agreed transport or delivery service unless the booking expressly says SKIMA is the service operator.
You must be legally able to request the service and must give accurate contact, pickup, destination, item and access information. A request is not a confirmed booking until the app tells you that it has been accepted or confirmed.

## 2. Requests, offers and provider choice
You may receive offers from providers who choose to respond to your request. An offer may include a price, estimated time, vehicle or service details, included work, exclusions and additional conditions. Review those details and ask questions before accepting.
A provider''s offer is not a guarantee that every requested item, route or handling requirement can be accommodated. Do not hide important information about the load, access restrictions, fragile or high-value goods, hazardous items, size, weight or special handling needs.

## 3. Price, fees and payment
Before you confirm a booking, the app should show the customer charges and the payment arrangement that applies. Depending on the booking, this may include the provider''s agreed price, a SKIMA booking or service fee, taxes, optional services or other clearly disclosed charges.
Some bookings may be settled directly between you and the provider outside the app. Where that is the selected arrangement, the app should identify it before confirmation. A booking or entry fee charged by SKIMA is separate from the provider''s offline service payment and must be shown before you commit. Do not pay a second SKIMA fee to a provider or to a person using an unofficial account.
If payment is collected through SKIMA or an approved payment provider, the transaction is considered paid only when the authoritative payment result confirms it. Failed, duplicated, reversed or disputed payments will be reviewed and handled through the applicable reversal, refund or reconciliation process.

## 4. Booking changes and cancellation
Check the pickup point, destination, agreed price, service scope, timing and provider details before confirming. A change to the route, load, timing or work may require a new offer or your approval of an updated price.
You may request cancellation through the app. The amount payable, if any, depends on the booking terms shown to you, the stage of the service, any actual disclosed costs and applicable law. A provider or SKIMA should not impose an undisclosed penalty or charge for a service that was not provided.

## 5. Your responsibilities
You must ensure that the goods are lawful to transport, appropriately packaged and ready at the agreed time and place. Tell the provider about fragile, perishable, unusually heavy, valuable or restricted items before accepting an offer. Keep your phone reachable and provide safe access to pickup and delivery locations.
You must not use the service to transport prohibited goods, commit fraud, threaten or abuse a provider, submit false delivery instructions, or interfere with tracking or proof of service.

## 6. Provider responsibilities
Providers are responsible for the accuracy of their offers, the suitability and lawful operation of their vehicle or equipment, the conduct of their staff, and the safe handling and delivery of the accepted load. They must comply with applicable transport, road-safety, licensing, insurance and other legal requirements.
SKIMA may review provider eligibility, information and service records, but a listing or matching result is not a guarantee of a provider''s performance, insurance coverage or legal compliance in every circumstance. You should review the provider and booking details shown to you.

## 7. Pickup, tracking and delivery confirmation
Be available at the agreed pickup and destination points or arrange for an authorised person to receive the goods. Confirm that the provider and vehicle reasonably match the booking information before handing over the goods.
The app may show status updates, location information, messages, timestamps, photographs or delivery evidence. Tracking depends on device, network and location-service availability and may not be exact at every moment. Do not confirm delivery or share a delivery code until the goods have actually been delivered, unless the booking expressly provides another verified completion method.

## 8. Loss, damage, delay and service complaints
Report missing, damaged, delayed or incorrectly delivered goods as soon as reasonably possible through the in-app support channel. Keep relevant photographs, receipts, packaging, messages and booking information.
SKIMA may help collect information, contact the provider, review booking records and support a resolution. Responsibility for loss, damage, delay, insurance and compensation depends on the provider''s accepted offer, the facts, any applicable insurance and Nigerian law. Nothing in these terms removes a right or remedy that cannot lawfully be excluded.

## 9. Service availability and interruptions
Service availability depends on location, provider capacity, vehicle suitability, road and weather conditions, safety, legal restrictions, network access and operational readiness. A request may receive no offer, and an offer may expire or become unavailable before you accept it.
SKIMA or a provider may pause, reroute or decline a service where reasonably required for safety, legality or practical completion. A material change to price or scope should be presented for your approval or handled through the applicable cancellation process.

## 10. Messages, support and personal information
You may use in-app messages and support tools to discuss the booking. Keep communication respectful and do not send passwords, one-time codes or full payment credentials. Do not use the messaging service for harassment, unlawful offers or unrelated advertising.
SKIMA processes account, contact, location, booking, message, payment and support information to operate the service, protect users and handle disputes. Relevant booking details may be shared with the provider so the accepted service can be performed. The SKIMA Privacy Notice explains personal-data handling and your rights in more detail.

## 11. Account safety and misuse
Keep your login details and device secure. Tell SKIMA promptly if you believe someone has accessed your account. SKIMA may restrict an account or booking where there are reasonable concerns about fraud, safety, abuse, unlawful activity, non-payment or misuse of the platform. Where appropriate, you may ask Support to review the restriction.

## 12. Promotions and communications
Promotions may have stated eligibility, location, timing, booking or usage conditions. SKIMA may send service messages about requests, offers, bookings, payments, delivery and support. Marketing communications are subject to applicable law and available preferences.

## 13. Changes to these terms
SKIMA may update these terms when the service, safety requirements, providers or applicable law change. Material changes will be communicated where appropriate. Where renewed acceptance is required, you must accept the new version before continuing to use the affected customer service. A new version does not silently change the agreed price or outcome of a completed booking.

## 14. Governing law and contact
These terms are governed by applicable law in the Federal Republic of Nigeria. You may contact SKIMA through the official support channel in the app or on the authorised SKIMA website. You may also approach an appropriate regulator or court where the law permits.

## Acceptance
By selecting “Accept and continue”, you confirm that you have had the opportunity to read these terms and agree to the current version when using SKIMA Logistics. Your statutory consumer rights remain protected.
','logistics'),
('policy.customer.store.terms','1.0','These terms cover product listings, sellers, orders, checkout, payments, delivery, cancellations, returns, refunds, complaints and customer responsibilities when shopping through SKIMA Store.','
# SKIMA Store Customer Terms of Use
Version 1.0 · Effective 8 November 2026

## 1. About SKIMA Store
SKIMA Store provides a digital shopping experience where customers can discover products, place orders and arrange payment and delivery. A product may be supplied by SKIMA or by a seller identified in the listing or order. The seller or supplier shown for an item is responsible for supplying the product as described, except where the app expressly identifies SKIMA as the seller.
You must be legally able to make the purchase and provide accurate account, contact, delivery and order information.

## 2. Product listings and availability
Product names, descriptions, photographs, variations, prices and stock information are provided to help you make a choice. Images are illustrative where the listing says so. Read the description, size, quantity, variant, condition, delivery information and any exclusions before ordering.
Stock and availability can change. Adding an item to a basket does not reserve it unless the app expressly confirms a reservation. If an item becomes unavailable or a listing contains a material error, SKIMA or the seller may contact you to offer an acceptable correction, replacement or cancellation and refund.

## 3. Orders and confirmation
Your order is a request to buy the selected items. The app will show whether the order is pending, accepted, being prepared, dispatched, delivered, cancelled or otherwise updated. An order is confirmed only when the app communicates confirmation.
You are responsible for checking the items, quantities, delivery address, contact details, price and any delivery instructions before submitting the order. Contact Support promptly if you notice an error.

## 4. Prices, charges and payment
The checkout should show the product prices, delivery charges, applicable SKIMA fees, discounts and taxes before you confirm payment. The total shown at checkout is the amount you authorise for that order. SKIMA or the seller must not add an undisclosed material charge after confirmation.
Payments may be processed by SKIMA Wallet or an approved payment provider. An order is paid only when the authoritative payment result confirms it. Do not send money to a personal account or pay a delivery person an extra amount that is not shown in the order.
If payment fails, is duplicated, reversed or remains uncertain, SKIMA may review the provider result and transaction records. Any amount due back will be handled through the applicable reversal, refund or reconciliation process and applicable law.

## 5. Delivery and receipt
Delivery options, charges and estimated times will be shown where available. Delivery estimates are not guaranteed where delays arise from traffic, weather, access, supplier readiness, safety or other circumstances outside reasonable control.
Provide a complete delivery address and keep your phone reachable. Arrange for an authorised person to receive the order if you will not be present. Check the package and items promptly on delivery. Do not share a delivery PIN or completion code before the order has been received, unless the app expressly provides another verified completion method.

## 6. Cancellations, returns and refunds
Cancellation and return eligibility depends on the item, order status, condition, reason for the request, seller terms disclosed before purchase and applicable consumer law. Some goods may be non-returnable after use, opening, activation, customisation or for health and safety reasons where the law permits. Any such restriction should be disclosed before purchase.
Where an item is missing, incorrect, defective, damaged or materially different from its listing, contact Support promptly and provide reasonable evidence. SKIMA or the seller may request photographs, packaging or other information needed to review the claim. Refunds, replacements and other remedies will be assessed according to the facts, the published return terms and applicable law.
Nothing in these terms removes a consumer right or remedy that cannot lawfully be excluded. A refund is not complete merely because it has been requested; the relevant payment provider or wallet record must confirm the reversal or credit.

## 7. Promotions and discounts
Promotions, vouchers and discounts may have specific eligibility, minimum order, product, location, timing or usage conditions. They cannot be exchanged for cash unless the offer says otherwise. SKIMA may reject a promotion used through fraud, duplicate accounts or manipulation, without affecting a separate valid refund right.

## 8. Customer conduct
Use SKIMA Store lawfully and respectfully. Do not submit false orders, abuse sellers or delivery providers, manipulate reviews or promotions, interfere with another person''s account, or use the platform to purchase prohibited goods. You must not ask a seller or delivery person to bypass the confirmed order or payment process in a way that creates a safety or fraud risk.

## 9. Sellers and delivery partners
Sellers are responsible for the accuracy of their product information, lawful supply, product quality and fulfilment obligations applicable to them. Delivery partners are responsible for carrying out the assigned delivery safely and lawfully. SKIMA may provide listing, order, payment, support or coordination tools and may review complaints, but the exact seller and fulfilment responsibilities depend on the order shown in the app.

## 10. Support and complaints
Use the in-app support channel for order, payment, product, seller or delivery concerns. Include the order reference and a clear description of the issue. SKIMA may review order events, payment confirmation, delivery evidence and messages to investigate and help resolve the complaint.
For urgent safety concerns involving a product, stop using it where reasonably necessary and contact the appropriate emergency or safety authority. In-app Support is not an emergency service.

## 11. Account security and privacy
Keep your password, verification codes and recovery links private. Tell SKIMA promptly if you suspect unauthorised access. SKIMA may use account, contact, order, payment, delivery, device and support information to provide the service, prevent fraud, investigate complaints and meet legal obligations. Order details may be shared with the seller or delivery provider to complete your purchase.
The separate SKIMA Privacy Notice explains how personal information is handled, how long it may be retained and the rights available to you under applicable law.

## 12. Service availability
SKIMA Store may be unavailable in some areas or for some products. Availability depends on stock, seller readiness, delivery coverage, network access, safety and legal requirements. SKIMA may suspend a listing or order where reasonably necessary to address a safety issue, legal restriction, suspected fraud or material listing error.

## 13. Changes to these terms
SKIMA may update these terms when the service, product categories, fulfilment arrangements or applicable law change. Material changes will be communicated where appropriate. Where renewed acceptance is required, you must accept the new version before continuing to use SKIMA Store. A new version does not silently alter a completed purchase.

## 14. Governing law and contact
These terms are governed by applicable law in the Federal Republic of Nigeria. Contact SKIMA through official in-app Support or the authorised SKIMA website. You may also approach an appropriate regulator or court where the law permits.

## Acceptance
By selecting “Accept and continue”, you confirm that you have had the opportunity to read these terms and agree to the current version when shopping through SKIMA Store. Your statutory consumer rights remain protected.
','store')
)
insert into public.policy_versions
  (policy_document_id,version_label,summary_content,full_content,content_format,content_hash,status,
   effective_from,published_at,requires_reacceptance,metadata,created_by)
select d.id,s.version_label,s.summary,s.content,'markdown',
       encode(digest(convert_to(s.content,'UTF8'),'sha256'),'hex'),
       'published',timezone('utc',now()),timezone('utc',now()),true,
       jsonb_build_object('sourceSurface','initial_customer_terms','applicationKey',s.app_key),
       null
from policy_seed s
join public.policy_documents d on d.key=s.key
where not exists (
  select 1 from public.policy_versions v
  where v.policy_document_id=d.id and v.version_label=s.version_label
);
