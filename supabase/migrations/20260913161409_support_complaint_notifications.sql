begin;

create or replace function public.queue_support_thread_reply_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  thread_record public.support_threads%rowtype;
  deep_link text;
begin
  if new.author_kind <> 'admin' then
    return new;
  end if;

  select thread.*
  into thread_record
  from public.support_threads thread
  where thread.id = new.thread_id;

  if not found or thread_record.requester_user_id is null then
    return new;
  end if;

  deep_link := case thread_record.workspace
    when 'driver' then '/(driver)/support'
    when 'station' then '/(station)/support'
    else '/(customer)/support'
  end;

  begin
    perform public.queue_communication_message(
      'in_app',
      'support.thread.reply',
      'user',
      thread_record.requester_user_id,
      null,
      jsonb_build_object(
        'title', 'SKIMA Support replied',
        'body', 'There is a new reply on your support request. Open Support to read the message and continue the conversation.',
        'category', 'support',
        'deepLink', deep_link,
        'threadId', thread_record.id,
        'workspace', thread_record.workspace
      ),
      'provider.communication.sandbox',
      'platform.support_notifications',
      'support-reply-notification:' || new.id::text,
      jsonb_build_object(
        'support_thread_id', thread_record.id,
        'support_message_id', new.id,
        'workspace', thread_record.workspace,
        'category', 'support'
      )
    );
  exception when others then
    null;
  end;

  return new;
end;
$$;

drop trigger if exists support_thread_reply_notification_trigger on public.support_thread_messages;
create trigger support_thread_reply_notification_trigger
after insert on public.support_thread_messages
for each row execute function public.queue_support_thread_reply_notification();

create or replace function public.queue_lpg_complaint_event_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  complaint_record public.lpg_service_complaints%rowtype;
  notification_title text;
  notification_body text;
begin
  if new.event_type <> 'complaint.status_changed' then
    return new;
  end if;

  select complaint.*
  into complaint_record
  from public.lpg_service_complaints complaint
  where complaint.id = new.complaint_id;

  if not found or complaint_record.customer_user_id is null then
    return new;
  end if;

  notification_title := case new.to_status
    when 'triaged' then 'Your complaint was received by the quality team'
    when 'under_review' then 'Your complaint is under review'
    when 'resolved' then 'Your complaint was resolved'
    when 'dismissed' then 'Your complaint review is closed'
    else 'Your complaint has an update'
  end;

  notification_body := coalesce(
    nullif(btrim(new.public_message), ''),
    case new.to_status
      when 'triaged' then 'SKIMA has triaged your complaint and will review the issue.'
      when 'under_review' then 'SKIMA is reviewing your complaint. Open Support for the latest status.'
      when 'resolved' then 'SKIMA has completed its review. Open Support to see the customer-facing resolution status.'
      when 'dismissed' then 'SKIMA has closed the complaint review. Open Support for the customer-facing status.'
      else 'The status of your complaint has changed.'
    end
  );

  begin
    perform public.queue_communication_message(
      'in_app',
      'support.complaint.' || coalesce(new.to_status, 'updated'),
      'user',
      complaint_record.customer_user_id,
      null,
      jsonb_build_object(
        'title', notification_title,
        'body', notification_body,
        'category', 'support',
        'deepLink', '/(customer)/support',
        'complaintId', complaint_record.id,
        'orderId', complaint_record.order_id,
        'status', new.to_status
      ),
      'provider.communication.sandbox',
      'platform.support_notifications',
      'complaint-event-notification:' || new.id::text,
      jsonb_build_object(
        'complaint_id', complaint_record.id,
        'complaint_event_id', new.id,
        'from_status', new.from_status,
        'to_status', new.to_status,
        'category', 'support'
      )
    );
  exception when others then
    null;
  end;

  return new;
end;
$$;

drop trigger if exists lpg_complaint_event_notification_trigger on public.lpg_complaint_events;
create trigger lpg_complaint_event_notification_trigger
after insert on public.lpg_complaint_events
for each row execute function public.queue_lpg_complaint_event_notification();

revoke all on function public.queue_support_thread_reply_notification() from public, anon, authenticated;
revoke all on function public.queue_lpg_complaint_event_notification() from public, anon, authenticated;
grant execute on function public.queue_support_thread_reply_notification() to service_role;
grant execute on function public.queue_lpg_complaint_event_notification() to service_role;

commit;
