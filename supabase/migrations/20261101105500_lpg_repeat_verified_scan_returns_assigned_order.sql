begin;

-- A driver can scan the same physical cylinder again after the order has
-- already advanced beyond the required hand-over stage. Resolve that exact
-- assigned order and return its previous successful scan as informational
-- state; never write another scan or repeat a lifecycle transition.
do $migration$
declare
  function_ddl text;
  old_block text := E'  if candidate_count = 0 then\n    raise exception ''this cylinder has no active order ready for verification in your workspace.'';\n  elsif candidate_count > 1 then\n    raise exception ''this cylinder is linked to more than one active order. Open the order queue to resolve the assignment.'';\n  end if;';
  new_block text := E'  if candidate_count = 0 then\n    if target_workspace = ''driver'' then\n      select order_row.id,order_row.status,order_row.public_reference,prior_scan.scan_type,prior_scan.id\n      into order_id,order_status,order_reference,scan_type,scan_id\n      from public.lpg_refill_orders order_row\n      left join public.driver_profiles assigned_driver on assigned_driver.id=order_row.driver_profile_id\n      join lateral (\n        select existing.id,existing.scan_type\n        from public.lpg_cylinder_scans existing\n        where existing.lpg_order_id=order_row.id\n          and existing.cylinder_id=matched_cylinder_id\n          and existing.result=''passed''\n        order by existing.created_at desc\n        limit 1\n      ) prior_scan on true\n      where order_row.cylinder_id=matched_cylinder_id\n        and (assigned_driver.user_id=auth.uid() or public.is_lpg_station_managed_order_driver(order_row.id,auth.uid()))\n        and order_row.status in (''pickup_verified'',''station_en_route'',''station_verified'',''refill_started'',''refill_in_progress'',''refill_confirmed'',''station_settled'',''return_en_route'',''delivery_verification_pending'')\n      order by order_row.updated_at desc\n      limit 1;\n    else\n      select order_row.id,order_row.status,order_row.public_reference,prior_scan.scan_type,prior_scan.id\n      into order_id,order_status,order_reference,scan_type,scan_id\n      from public.lpg_refill_orders order_row\n      join lateral (\n        select existing.id,existing.scan_type\n        from public.lpg_cylinder_scans existing\n        where existing.lpg_order_id=order_row.id\n          and existing.cylinder_id=matched_cylinder_id\n          and existing.result=''passed''\n        order by existing.created_at desc\n        limit 1\n      ) prior_scan on true\n      where order_row.cylinder_id=matched_cylinder_id\n        and order_row.station_branch_id is not null\n        and public.user_can_operate_lpg_station_branch(auth.uid(),order_row.station_branch_id,''lpg.orders.read'')\n        and order_row.status in (''station_verified'',''refill_started'',''refill_in_progress'',''refill_confirmed'',''station_settled'')\n      order by order_row.updated_at desc\n      limit 1;\n    end if;\n\n    if found then\n      return jsonb_build_object(\n        ''scanId'',scan_id,\n        ''lpgOrderId'',order_id,\n        ''orderReference'',order_reference,\n        ''cylinderIdentifier'',matched_cylinder_identifier,\n        ''scanType'',scan_type,\n        ''status'',order_status,\n        ''replayed'',true,\n        ''alreadyVerified'',true\n      );\n    end if;\n\n    raise exception ''this cylinder has no active order ready for verification in your workspace.'';\n  elsif candidate_count > 1 then\n    raise exception ''this cylinder is linked to more than one active order. Open the order queue to resolve the assignment.'';\n  end if;';

  if position(new_block in pg_get_functiondef('public.record_lpg_cylinder_scan_for_active_job(text,text,text,numeric,numeric,numeric,text)'::regprocedure)) > 0 then
    return;
  end if;

  function_ddl:=pg_get_functiondef(
    'public.record_lpg_cylinder_scan_for_active_job(text,text,text,numeric,numeric,numeric,text)'::regprocedure
  );

  if position(old_block in function_ddl)=0 then
    raise exception 'Could not find the expected active-job no-stage scan branch; refusing to patch cylinder verification';
  end if;

  if (length(function_ddl)-length(replace(function_ddl,old_block,'')))/length(old_block) <> 1 then
    raise exception 'Expected exactly one active-job no-stage scan branch';
  end if;

  function_ddl:=replace(function_ddl,old_block,new_block);
  execute function_ddl;
end
$migration$;

notify pgrst,'reload schema';
commit;