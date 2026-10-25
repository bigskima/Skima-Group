begin;

-- Version the mobile tours together with their target-key namespace. A user
-- who has already completed v1 will see v2 once, so existing progress never
-- traps the updated guide behind the old version.
update public.in_app_guides
set
  version = 2,
  title = case key
    when 'lpg.customer.core-tour' then 'Customer app tour'
    when 'lpg.driver.core-tour' then 'Driver app tour'
    when 'lpg.station.core-tour' then 'Station app tour'
    else title
  end,
  description = case key
    when 'lpg.customer.core-tour' then 'A guided tour of delivery location, refill actions, cylinders, orders, wallet and account tools.'
    when 'lpg.driver.core-tour' then 'A guided tour of your current work, scanning, availability, jobs, earnings and account tools.'
    when 'lpg.station.core-tour' then 'A guided tour of reception actions, queue, scanning, settlements, station-managed drivers and account tools.'
    else description
  end,
  metadata = metadata || jsonb_build_object(
    'tourContentVersion', 2,
    'targetResolution', 'workspace-scoped-and-route-confirmed',
    'surface', 'lpg-mobile'
  ),
  updated_at = timezone('utc', now())
where key in ('lpg.customer.core-tour','lpg.driver.core-tour','lpg.station.core-tour');

-- Remove stale trailing steps if an earlier configuration had a different
-- number of steps. The desired v2 tours below are the canonical sequence.
delete from public.in_app_guide_steps s
using public.in_app_guides g
where s.guide_id = g.id
  and (
    (g.key = 'lpg.customer.core-tour' and s.step_order > 8)
    or (g.key = 'lpg.driver.core-tour' and s.step_order > 7)
    or (g.key = 'lpg.station.core-tour' and s.step_order > 7)
  );

with desired(
  guide_key, step_order, route, target_key, title, body, action_label, placement
) as (
  values
  -- Customer: follow the visible top-to-bottom home flow, then the bottom tabs
  -- and the account-settings entry used to replay this tour.
  ('lpg.customer.core-tour',1,'/(customer)','customer.workspace-switcher','Your SKIMA workspace','Use this control to switch between the SKIMA workspaces approved for your account. Only workspaces you are allowed to access will appear.','Next','bottom'),
  ('lpg.customer.core-tour',2,'/(customer)','customer.location','Delivery location','Check the address shown under “Delivering to”. Tap Change to choose the pickup and return location for your cylinder.','Next','bottom'),
  ('lpg.customer.core-tour',3,'/(customer)','customer.primary-action','Your next refill action','This highlighted card changes with your journey: add your first cylinder, start a refill, or track an order already in progress.','Next','bottom'),
  ('lpg.customer.core-tour',4,'/(customer)/cylinders','nav.customer.cylinders','Cylinders','Your registered cylinders and their identification details live here. Add a cylinder before requesting its first refill.','Next','top'),
  ('lpg.customer.core-tour',5,'/(customer)/orders','nav.customer.orders','Orders','Follow an order through pickup, station processing and return, or open a previous refill to review its status.','Next','top'),
  ('lpg.customer.core-tour',6,'/(customer)/wallet','nav.customer.wallet','Wallet','Check your available balance and review payment and transaction activity from the Wallet workspace.','Next','top'),
  ('lpg.customer.core-tour',7,'/(customer)/account','nav.customer.account','Account and support','Find notifications, help, applications, policies and account settings here. When enabled for your account, the Station Affiliate tools and referral status are available through Account settings.','Next','top'),
  ('lpg.customer.core-tour',8,'/(customer)/account-settings','account.customer.app-guide','Replay this tour','This is the App guide control. Open it whenever you need to replay the tour; guide reminders follow your saved schedule.','Finish','top'),

  -- Driver: home controls are distinct from the tab navigation.
  ('lpg.driver.core-tour',1,'/(driver)','driver.workspace-switcher','Driver workspace','Use this control to move between approved SKIMA workspaces without signing out.','Next','bottom'),
  ('lpg.driver.core-tour',2,'/(driver)','driver.operations','Your live driver controls','The current assignment appears above these quick actions. Use Scan cylinder at the instructed pickup or handover point, and update Availability when your work status changes.','Next','bottom'),
  ('lpg.driver.core-tour',3,'/(driver)/jobs','nav.driver.jobs','Jobs','Assigned and upcoming delivery work is organised here. Open a job for its route and hand-off details.','Next','top'),
  ('lpg.driver.core-tour',4,'/(driver)/scan','nav.driver.scan','Scan','Verify the matching order and cylinder at the required hand-off stage. Follow the job instructions before confirming a scan.','Next','top'),
  ('lpg.driver.core-tour',5,'/(driver)/earnings','nav.driver.earnings','Earnings','Review delivery earnings, commissions, payout status and related wallet activity here.','Next','top'),
  ('lpg.driver.core-tour',6,'/(driver)/account','nav.driver.account','Driver account','Manage your vehicle, documents, service area, support, policies and account settings from this section.','Next','top'),
  ('lpg.driver.core-tour',7,'/(driver)/account-settings','account.driver.app-guide','Replay this tour','Open App guide from Account settings whenever you want to replay the driver tour.','Finish','top'),

  -- Station: include the updated reception actions, including station-managed
  -- driver controls, rather than describing a generic reception queue only.
  ('lpg.station.core-tour',1,'/(station)','station.workspace-switcher','Station workspace','Switch between workspaces approved for your account using this control.','Next','bottom'),
  ('lpg.station.core-tour',2,'/(station)','station.operations','Reception and fulfilment actions','Use Verify arrival to check the driver and cylinder, Safety and refill to record the fill, and Your drivers to manage Station Managed delivery settings and drivers. Orders should only be accepted when the required fulfilment resources are eligible.','Next','bottom'),
  ('lpg.station.core-tour',3,'/(station)/jobs','nav.station.jobs','Reception queue','Incoming cylinders and their processing status are organised in the queue. Open a row to review that order’s steps.','Next','top'),
  ('lpg.station.core-tour',4,'/(station)/scan','nav.station.scan','Scan','Use scanning at the required reception hand-off to match the driver, order and cylinder.','Next','top'),
  ('lpg.station.core-tour',5,'/(station)/settlements','nav.station.settlements','Money and settlements','Review completed refill earnings and settlement activity here. A completed refill and a settled payment are separate states.','Next','top'),
  ('lpg.station.core-tour',6,'/(station)/account','nav.station.account','Station account','Find station tools, staff access, support, policies and account settings here. Fulfilment and vehicle management remain in the relevant station tools.','Next','top'),
  ('lpg.station.core-tour',7,'/(station)/account-settings','account.station.app-guide','Replay this tour','Open App guide from Account settings whenever you want to replay the station tour.','Finish','top')
)
insert into public.in_app_guide_steps (
  guide_id, step_order, route, target_key, title, body, action_label, placement, metadata
)
select
  g.id,
  d.step_order,
  d.route,
  d.target_key,
  d.title,
  d.body,
  d.action_label,
  d.placement,
  jsonb_build_object('tourContentVersion', 2, 'targetWorkspace', g.workspace)
from desired d
join public.in_app_guides g on g.key = d.guide_key
order by g.key, d.step_order
on conflict (guide_id, step_order) do update
set
  route = excluded.route,
  target_key = excluded.target_key,
  title = excluded.title,
  body = excluded.body,
  action_label = excluded.action_label,
  placement = excluded.placement,
  metadata = public.in_app_guide_steps.metadata || excluded.metadata,
  updated_at = timezone('utc', now());

notify pgrst, 'reload schema';
commit;
