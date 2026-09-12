-- OPERATOR APPLY: this changes the eleven existing staff Auth links below.
-- Run only after confirming these are intended active accounts and reviewing
-- identity-repair-preview.sql: all eleven must be eligible with no failures.
-- This is NOT a migration. Never add it to an automatic deployment bundle.
-- Run the complete statement once. Every repair is revalidated under locks;
-- if any repair fails, PostgreSQL rolls back ALL links and audit inserts.
-- A successful replay is deliberately refused: inspect current state instead.
-- Missing Admin/Client profiles are not reconstructed by this script.
with candidates(org_id,profile_id,auth_id) as (
 values
 ('3b63ee84-c307-4b1b-a080-913be7f8d7b7'::uuid,'021d9c2e-fc96-4106-8570-6ef31541ac5f'::uuid,'e8ce3920-2f98-4c3b-ac87-9af209656275'::uuid),
 ('7b6c3bdd-a384-4f93-971d-678e61989db2','907d648b-651e-420a-90b8-7adeb2756687','775ae95a-4c58-44f9-8321-f7179d877cfd'),
 ('d320f0c6-b62d-4b1f-8b64-7564cbc080c9','187df90e-f8be-4338-9889-b97906e746d6','21772247-c377-4bdb-bffa-86ec16146089'),
 ('d320f0c6-b62d-4b1f-8b64-7564cbc080c9','5c6532e6-74fb-453d-9fbd-390b46c2e4e6','022ac1e1-0095-4092-9335-b3fe892fea93'),
 ('d320f0c6-b62d-4b1f-8b64-7564cbc080c9','6b8f841c-ed87-49a8-9636-2e53c1d22843','37a18b84-2af8-4d5e-a64f-66e2ab78380d'),
 ('d320f0c6-b62d-4b1f-8b64-7564cbc080c9','6f4a3322-cf50-4be6-94a8-b4aac758ae59','3bdd7bc3-b3b9-4fa4-9b60-61f60440d0dc'),
 ('d320f0c6-b62d-4b1f-8b64-7564cbc080c9','6f5488cd-cb29-441e-99d9-c6285acefbae','0988bb01-f0e6-45da-982a-0a76c4d7bfac'),
 ('d320f0c6-b62d-4b1f-8b64-7564cbc080c9','9a24dcbd-e6a9-4d4b-92a8-9a794a92252a','d78b5a58-f1f0-4c0f-9528-86d6e6334227'),
 ('d320f0c6-b62d-4b1f-8b64-7564cbc080c9','e34c73c8-24a2-4967-a584-16bae96f229a','8d380e53-7270-4274-ab3c-66ab9ef64025'),
 ('d320f0c6-b62d-4b1f-8b64-7564cbc080c9','ea4ecce3-0e74-4201-9c4c-776dca1b0be3','f0332724-b44a-4a73-b203-c23dee5af94b'),
 ('d320f0c6-b62d-4b1f-8b64-7564cbc080c9','ec8d37c5-35d9-4627-8549-b157fa507872','8b98e6ef-d0c8-4ed0-9797-7a33c8bdbcc0')
), repaired as materialized (
 select public.operator_repair_profile_identity(
  p_org=>org_id,p_profile=>profile_id,p_type=>'developer',p_auth=>auth_id,
  p_apply=>true,p_allow_null_org=>false,
  p_ack=>'REPAIR VERIFIED EXISTING IDENTITY',
  p_operator_reference=>'Operator reviewed 11 staff identity previews 2026-09-12'
 ) as result from candidates
)
select count(*) as repaired_accounts,
 jsonb_agg(result order by result->>'profileId') as repairs
from repaired;
