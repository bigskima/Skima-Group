begin;

-- Extend the existing branch-authorized Station Managed workspace read model.
-- Delivery operations are projected from the canonical order, assignment, driver,
-- vehicle, and customer-location records. This migration creates no parallel
-- dispatch, tracking, or order tables and does not change order lifecycle actions.

create or replace function public.read_lpg_station_managed_workspace(
  target_station_branch_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $station_managed_workspace$
declare
  settings_record public.lpg_station_fulfillment_settings%rowtype;
  result jsonb;
  settings_found boolean:=false;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication required';
  end if;
  if not public.can_operate_lpg_station_branch(target_station_branch_id,'lpg.stations.manage') then
    raise exception using errcode='42501',message='branch-scoped station management permission is required';
  end if;

  select * into settings_record
  from public.lpg_station_fulfillment_settings
  where station_branch_id=target_station_branch_id;
  settings_found:=found;

  result:=jsonb_build_object(
    'settings',case when settings_found then jsonb_build_object(
      'stationManagedEnabled',settings_record.station_managed_enabled,
      'deliveryPricingMode',settings_record.delivery_pricing_mode,
      'deliveryFeeAmount',settings_record.delivery_fee_amount,
      'driverCompensationMode',settings_record.driver_compensation_mode,
      'driverCompensationPlan',settings_record.driver_compensation_plan,
      'currencyCode',settings_record.currency_code
    ) else jsonb_build_object(
      'stationManagedEnabled',false,
      'deliveryPricingMode','separate',
      'deliveryFeeAmount',0,
      'driverCompensationMode','in_app_plan',
      'driverCompensationPlan',jsonb_build_object(),
      'currencyCode','NGN'
    ) end,

    'drivers',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',d.id,
        'userId',d.user_id,
        'displayName',d.display_name,
        'phone',d.phone,
        'status',d.status
      ) order by d.created_at desc)
      from public.lpg_station_managed_drivers d
      where d.station_branch_id=target_station_branch_id
    ),'[]'::jsonb),

    'agreements',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',agreement.id,
        'stationDriverId',agreement.station_driver_id,
        'agreementMode',agreement.agreement_mode,
        'agreementStatus',agreement.agreement_status,
        'terms',agreement.terms,
        'notes',agreement.notes,
        'effectiveFrom',agreement.effective_from
      ) order by agreement.created_at desc)
      from (
        select a.*
        from public.lpg_station_managed_driver_agreements a
        where a.station_branch_id=target_station_branch_id
        order by a.created_at desc
        limit 20
      ) agreement
    ),'[]'::jsonb),

    'payments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',payment.id,
        'stationDriverId',payment.station_driver_id,
        'lpgOrderId',payment.lpg_order_id,
        'currencyCode',payment.currency_code,
        'amount',payment.amount,
        'paymentMethod',payment.payment_method,
        'paymentStatus',payment.payment_status,
        'externalReference',payment.external_reference,
        'confirmedAt',payment.confirmed_at
      ) order by payment.confirmed_at desc)
      from (
        select p.*
        from public.lpg_station_managed_driver_payment_records p
        where p.station_branch_id=target_station_branch_id
        order by p.confirmed_at desc
        limit 20
      ) payment
    ),'[]'::jsonb),

    -- Active and recently completed assignments already created by dispatch.
    -- Branch scope is enforced before any driver/order details are projected.
    'deliveries',coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignmentId',delivery.assignment_id,
        'lpgOrderId',delivery.order_id,
        'publicReference',delivery.public_reference,
        'assignmentStatus',delivery.assignment_status,
        'orderStatus',delivery.order_status,
        'requestedKg',delivery.requested_kg,
        'actualKg',delivery.actual_kg,
        'totalAmount',delivery.total_amount,
        'currencyCode',delivery.currency_code,
        'paymentStatus',delivery.payment_status,
        'assignedAt',delivery.assigned_at,
        'completedAt',delivery.completed_at,
        'updatedAt',delivery.order_updated_at,
        'stationDriverId',delivery.station_driver_id,
        'driverName',delivery.driver_name,
        'driverPhone',delivery.driver_phone,
        'vehicleId',delivery.vehicle_id,
        'vehicleRegistrationNumber',delivery.vehicle_registration_number,
        'vehicleManufacturer',delivery.vehicle_manufacturer,
        'vehicleModel',delivery.vehicle_model,
        'vehicleType',delivery.vehicle_type,
        'deliveryAddress',delivery.delivery_address,
        'deliveryInstructions',delivery.delivery_instructions,
        'customerName',delivery.customer_name,
        'customerPhone',delivery.customer_phone,
        'isActive',delivery.is_active
      ) order by delivery.is_active desc,delivery.assigned_at desc)
      from (
        select
          assignment.id as assignment_id,
          order_record.id as order_id,
          order_record.public_reference,
          assignment.status as assignment_status,
          order_record.status as order_status,
          order_record.requested_kg,
          order_record.actual_kg,
          order_record.total_amount,
          order_record.currency_code,
          order_record.payment_status,
          assignment.assigned_at,
          assignment.completed_at,
          order_record.updated_at as order_updated_at,
          driver.id as station_driver_id,
          driver.display_name as driver_name,
          driver.phone as driver_phone,
          vehicle.id as vehicle_id,
          vehicle.registration_number as vehicle_registration_number,
          vehicle.manufacturer as vehicle_manufacturer,
          vehicle.model as vehicle_model,
          vehicle_type.display_name as vehicle_type,
          location.formatted_address as delivery_address,
          location.delivery_instructions,
          location.contact_name as customer_name,
          location.contact_phone as customer_phone,
          (assignment.status in ('assigned','accepted','en_route')) as is_active
        from public.lpg_station_managed_driver_assignments assignment
        join public.lpg_refill_orders order_record
          on order_record.id=assignment.lpg_order_id
        join public.lpg_station_managed_drivers driver
          on driver.id=assignment.station_driver_id
        left join public.vehicles vehicle
          on vehicle.id=assignment.vehicle_id
        left join public.vehicle_types vehicle_type
          on vehicle_type.id=vehicle.vehicle_type_id
        left join public.lpg_customer_locations location
          on location.id=order_record.delivery_location_id
        where assignment.station_branch_id=target_station_branch_id
          and order_record.station_branch_id=target_station_branch_id
          and order_record.fulfillment_channel='marketplace'
          and order_record.fulfillment_mode='station_managed'
          and assignment.status in ('assigned','accepted','en_route','delivered')
          and order_record.status not in ('cancelled','failed','refunded')
        order by
          (assignment.status in ('assigned','accepted','en_route')) desc,
          assignment.assigned_at desc
        limit 50
      ) delivery
    ),'[]'::jsonb),

    -- Orders without a live assignment remain visible as a dispatch queue.
    'assignableOrders',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',o.id,
        'publicReference',o.public_reference,
        'status',o.status,
        'requestedKg',o.requested_kg,
        'totalAmount',o.total_amount,
        'currencyCode',o.currency_code,
        'fulfillmentMode',o.fulfillment_mode,
        'dispatchStatus',o.metadata->>'stationManagedDispatch'
      ) order by o.created_at desc)
      from public.lpg_refill_orders o
      where o.station_branch_id=target_station_branch_id
        and o.fulfillment_channel='marketplace'
        and o.fulfillment_mode='station_managed'
        and o.status in ('payment_reserved','matching_station','matching_driver','driver_offered','driver_accepted','pickup_verified','station_en_route')
        and not exists(
          select 1
          from public.lpg_station_managed_driver_assignments a
          where a.lpg_order_id=o.id and a.status<>'cancelled'
        )
    ),'[]'::jsonb)
  );

  return result;
end;
$station_managed_workspace$;

comment on function public.read_lpg_station_managed_workspace(uuid) is
  'Branch-authorized Station Managed operations read model. Drivers, assignments, orders, vehicles and delivery addresses are projected from canonical SKIMA LPG records; no parallel dispatch or tracking system is created.';

notify pgrst,'reload schema';
commit;
