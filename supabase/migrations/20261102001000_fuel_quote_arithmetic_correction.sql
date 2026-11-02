begin;

-- Repair older installations where the Fuel commercial quote function was
-- compiled with an undeclared subtotal_amount reference. The accepted quote
-- must use the server-calculated resolved_subtotal_amount.
do $fuel_quote_arithmetic_fix$
declare
  function_sql text;
  wrong_formula text := 'grand_total:=subtotal_amount+platform_fee_amount+tax_amount;';
  correct_formula text := 'grand_total:=resolved_subtotal_amount+platform_fee_amount+tax_amount;';
begin
  function_sql:=pg_get_functiondef('public.create_fuel_commercial_quote(uuid,text,jsonb)'::regprocedure);
  if position(wrong_formula in function_sql)>0 then
    execute replace(function_sql,wrong_formula,correct_formula);
  elsif position(correct_formula in function_sql)=0 then
    raise exception 'Fuel commercial quote total formula is not the expected resolved subtotal calculation';
  end if;
end;
$fuel_quote_arithmetic_fix$;

commit;
