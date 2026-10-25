-- Align in-app guide copy and anchors with the current SKIMA LPG navigation and fulfillment screens.
-- Bumping the guide versions causes existing users to receive the updated tour once.

update public.in_app_guides
set
  version = 2,
  description = case key
    when 'lpg.customer.core-tour' then 'A guided tour of refill actions, cylinder tracking, wallet, affiliate earnings and account settings.'
    when 'lpg.driver.core-tour' then 'A guided tour of driver operations, jobs, scanning, earnings and account settings.'
    when 'lpg.station.core-tour' then 'A guided tour of station reception, scanning, settlements and Station Managed delivery controls.'
    else description
  end,
  updated_at = timezone('utc', now())
where key in ('lpg.customer.core-tour', 'lpg.driver.core-tour', 'lpg.station.core-tour');

delete from public.in_app_guide_steps
where guide_id in (
  '91000000-0000-4000-8000-000000000001'::uuid,
  '91000000-0000-4000-8000-000000000002'::uuid,
  '91000000-0000-4000-8000-000000000003'::uuid
);

insert into public.in_app_guide_steps (guide_id, step_order, route, target_key, title, body, action_label)
values
-- Customer: target the actual workspace switcher, home controls, tab destinations, affiliate panel and guide replay control.
('91000000-0000-4000-8000-000000000001',1,'/(customer)','common.workspace-switcher','Your SKIMA workspace','This switcher sits at the top of Home. Use it to move between workspaces approved for your account.','Next'),
('91000000-0000-4000-8000-000000000001',2,'/(customer)','customer.location','Pickup and return location','This Home control shows the location used for cylinder collection and return. Tap Change to update it.','Next'),
('91000000-0000-4000-8000-000000000001',3,'/(customer)','customer.primary-action','Your next refill action','These Home actions adapt to your account: register a cylinder, start a refill, or follow an active order.','Next'),
('91000000-0000-4000-8000-000000000001',4,'/(customer)/cylinders','nav.cylinders','Your cylinders','Open Cylinders from the bottom navigation to review registered cylinders and their identification details.','Next'),
('91000000-0000-4000-8000-000000000001',5,'/(customer)/orders','nav.orders','Refill orders','Open Orders from the bottom navigation to check active and previous refills, status and tracking.','Next'),
('91000000-0000-4000-8000-000000000001',6,'/(customer)/wallet','nav.wallet','Your wallet','Open Wallet to review your available balance, payments and transaction activity.','Next'),
('91000000-0000-4000-8000-000000000001',7,'/(customer)/account','nav.account','Account and settings','Account contains your profile, support, partner opportunities and the settings entry for this guide.','Next'),
('91000000-0000-4000-8000-000000000001',8,'/(customer)/account-settings','account.station-affiliate','Station Affiliate','This section lets you apply to refer eligible LPG stations, track referral status and view eligible earnings after approval. Commission settings remain subject to SKIMA’s approved financial policy.','Next'),
('91000000-0000-4000-8000-000000000001',9,'/(customer)/account-settings','account.app-guide','Replay this guide','Use Start guided tour in Settings whenever you want to revisit the customer guide.','Finish'),

-- Driver: preserve the current tab routes and anchor every step to the matching workspace control.
('91000000-0000-4000-8000-000000000002',1,'/(driver)','common.workspace-switcher','Driver workspace','This switcher is at the top of Home. Use it to move between workspaces approved for your account.','Next'),
('91000000-0000-4000-8000-000000000002',2,'/(driver)','driver.operations','Your driver controls','Use these Home actions to scan a cylinder or update your delivery availability.','Next'),
('91000000-0000-4000-8000-000000000002',3,'/(driver)/jobs','nav.jobs','Jobs','Open Jobs in the bottom navigation to review assigned and upcoming delivery work.','Next'),
('91000000-0000-4000-8000-000000000002',4,'/(driver)/scan','nav.scan','Scan','Use Scan at the required hand-off points to verify the order and cylinder.','Next'),
('91000000-0000-4000-8000-000000000002',5,'/(driver)/earnings','nav.earnings','Earnings','Open Earnings to review commissions, payout status and related money activity.','Next'),
('91000000-0000-4000-8000-000000000002',6,'/(driver)/account','nav.account','Driver account','Account is where you can access vehicle and document tools, service information, support and settings.','Next'),
('91000000-0000-4000-8000-000000000002',7,'/(driver)/account-settings','account.app-guide','Replay this guide','Use Start guided tour in Account settings whenever you want to revisit the driver guide.','Finish'),

-- Station: include the new Station Managed delivery configuration screen as a dedicated, route-matched step.
('91000000-0000-4000-8000-000000000003',1,'/(station)','common.workspace-switcher','Station workspace','This switcher sits at the top of the station Home screen and changes between approved workspaces.','Next'),
('91000000-0000-4000-8000-000000000003',2,'/(station)','station.operations','Reception controls','Use these Home actions to verify arrivals, record safety and refill details, and open your Station Managed delivery tools.','Next'),
('91000000-0000-4000-8000-000000000003',3,'/(station)/jobs','nav.jobs','Reception queue','Open Queue in the bottom navigation to review incoming cylinders and their processing state.','Next'),
('91000000-0000-4000-8000-000000000003',4,'/(station)/scan','nav.scan','Scan','Use Scan at reception to match the driver, order and cylinder at the required hand-off.','Next'),
('91000000-0000-4000-8000-000000000003',5,'/(station)/settlements','nav.settlements','Settlements','Open Money to review station earnings and settlement activity.','Next'),
('91000000-0000-4000-8000-000000000003',6,'/(station)/managed-fulfillment','station.managed-fulfillment','Station Managed delivery','This screen contains your station’s delivery option, pricing, driver onboarding and agreements, vehicle readiness and driver payment records. These settings do not replace SKIMA Fleet or independent-driver flows.','Next'),
('91000000-0000-4000-8000-000000000003',7,'/(station)/account','nav.account','Station account','Open Account for station tools, staff access, support and account settings.','Next'),
('91000000-0000-4000-8000-000000000003',8,'/(station)/account-settings','account.app-guide','Replay this guide','Use Start guided tour in Account settings whenever you want to revisit the station guide.','Finish');
