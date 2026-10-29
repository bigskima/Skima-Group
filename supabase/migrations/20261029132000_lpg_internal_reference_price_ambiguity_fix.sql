-- Fix the ambiguous local/column name in the SKIMA Managed LPG buying-price writer.
-- The PL/pgSQL local variable "module_id" collided with financial_policy_versions.module_id
-- in the current-version lookup, yielding SQLSTATE 42702 on every save.

do $migration$
declare
  function_ddl text;
begin
  function_ddl := pg_get_functiondef(
    'public.set_lpg_internal_reference_price(text,text,numeric,numeric,numeric,text,text)'::regprocedure
  );

  if position('version.module_id=resolved_module_id' in function_ddl) > 0 then
    return;
  end if;

  if position('version.module_id=module_id' in function_ddl) = 0
     or position('module_id uuid;' in function_ddl) = 0
     or position('select id into module_id from public.business_modules' in function_ddl) = 0
     or position('if module_id is null then' in function_ddl) = 0
     or position('null,module_id,''lpg.refill.internal''' in function_ddl) = 0 then
    raise exception 'LPG reference-price ambiguity fix could not match the expected function definition; refusing to alter it';
  end if;

  function_ddl := replace(function_ddl,'module_id uuid;','resolved_module_id uuid;');
  function_ddl := replace(function_ddl,'select id into module_id from public.business_modules','select id into resolved_module_id from public.business_modules');
  function_ddl := replace(function_ddl,'if module_id is null then','if resolved_module_id is null then');
  function_ddl := replace(function_ddl,'version.module_id=module_id','version.module_id=resolved_module_id');
  function_ddl := replace(function_ddl,'null,module_id,''lpg.refill.internal''','null,resolved_module_id,''lpg.refill.internal''');

  if position('version.module_id=resolved_module_id' in function_ddl) = 0
     or position('select id into resolved_module_id from public.business_modules' in function_ddl) = 0 then
    raise exception 'LPG reference-price ambiguity fix did not fully replace the conflicting variable; refusing to apply';
  end if;

  execute function_ddl;
end
$migration$;
