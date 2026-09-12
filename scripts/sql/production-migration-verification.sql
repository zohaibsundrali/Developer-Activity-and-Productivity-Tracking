-- Read-only catalog verification for PR #103 and PR #104, seven migrations.
-- No application routines execute; no customer rows, credentials or auth data are read.
-- A match proves these catalog checks only, not live feature correctness.
-- Exact body fingerprints may flag formatting-only edits for review.
-- source-sha256 20260912035637_production_current_profile_authority.sql 9921b5aad934a8c159256d3238015b345fc99638c1f600291d4544a6efd11dca
-- source-sha256 20260912035950_production_invitation_cleanup_confirmation.sql 880b54478cca8a0e77fc4c7eef7ea9e2adf7c5b82860ea63c0a777a59cd1cfbe
-- source-sha256 20260912043321_production_reserved_profile_provisioning.sql 91084c50f76259b6f9bc2bce3e48e95959c2f7bdec82a362bbc417ecff79908d
-- source-sha256 20260912043604_production_operator_identity_repair.sql 2ddd8dd72a6d42815ae784d5d76425aeb59d0aeb331da514bb869102cee5f5e0
-- source-sha256 20260912043622_production_transactional_signup_recovery.sql 4f04abb02233ed74a7953f33886e353ea5d8d92e7a81af0591ad75159c1fd247
-- source-sha256 20260912044800_production_atomic_recurring_tasks.sql 3ed297c712dcceb7539d5be9a7ca4b8b3b58eef9201dec3fc112f0ff3a2d7b51
-- source-sha256 20260912044958_production_completed_signup_cleanup.sql f93ce1617d6e07d576460118a71441945ee5c3f9d46ef2f05105866031756d6d
begin read only;
set local search_path=pg_catalog;
with settings as (select false as include_passes), expected as (
 select * from jsonb_to_recordset($expected$
[
  {
    "migration": "20260912035637",
    "kind": "function",
    "identity": "public.auth_org()",
    "relation": null,
    "name": null,
    "properties": {
      "body_md5": "d620632fe48037ac49c1928b5bfb0611",
      "security_definer": true,
      "volatility": "s",
      "language": "sql",
      "search_path": [
        "search_path=pg_catalog, public, app_private"
      ],
      "defaults": null,
      "public_execute": false,
      "anon_execute": false,
      "authenticated_execute": true,
      "service_execute": false
    }
  },
  {
    "migration": "20260912035637",
    "kind": "function",
    "identity": "public.auth_role()",
    "relation": null,
    "name": null,
    "properties": {
      "body_md5": "2ebf782fbd1f7288f69fbe81b40c9af7",
      "security_definer": true,
      "volatility": "s",
      "language": "sql",
      "search_path": [
        "search_path=public, pg_temp"
      ],
      "defaults": null,
      "public_execute": false,
      "anon_execute": false,
      "authenticated_execute": true,
      "service_execute": false
    }
  },
  {
    "migration": "20260912035950",
    "kind": "function",
    "identity": "public.finish_invitation_cleanup(uuid,uuid)",
    "relation": null,
    "name": null,
    "properties": {
      "body_md5": "fb0259dfbfd4e9bcdb14affaddf4e710",
      "security_definer": true,
      "volatility": "v",
      "language": "plpgsql",
      "search_path": [
        "search_path=pg_catalog, public, app_private"
      ],
      "defaults": null,
      "public_execute": false,
      "anon_execute": false,
      "authenticated_execute": false,
      "service_execute": true
    }
  },
  {
    "migration": "20260912043321",
    "kind": "function",
    "identity": "public.reserve_profile_provision(uuid,uuid,text,text,text)",
    "relation": null,
    "name": null,
    "properties": {
      "body_md5": "99f26fca379bf3ec28a7268710e87be9",
      "security_definer": true,
      "volatility": "v",
      "language": "plpgsql",
      "search_path": [
        "search_path=pg_catalog, public, app_private"
      ],
      "defaults": null,
      "public_execute": false,
      "anon_execute": false,
      "authenticated_execute": false,
      "service_execute": true
    }
  },
  {
    "migration": "20260912043321",
    "kind": "function",
    "identity": "public.finish_profile_provision(uuid,uuid,text,text,text,uuid)",
    "relation": null,
    "name": null,
    "properties": {
      "body_md5": "dae6832c7d61bc3a27bee3c84e0a74f9",
      "security_definer": true,
      "volatility": "v",
      "language": "plpgsql",
      "search_path": [
        "search_path=pg_catalog, public, app_private"
      ],
      "defaults": null,
      "public_execute": false,
      "anon_execute": false,
      "authenticated_execute": false,
      "service_execute": true
    }
  },
  {
    "migration": "20260912043321",
    "kind": "function",
    "identity": "app_private.guard_pending_profile_provision()",
    "relation": null,
    "name": null,
    "properties": {
      "body_md5": "ed11f04d78516c2f9b2aff164a0f44e3",
      "security_definer": true,
      "volatility": "v",
      "language": "plpgsql",
      "search_path": [
        "search_path=pg_catalog, app_private"
      ],
      "defaults": null,
      "public_execute": false,
      "anon_execute": false,
      "authenticated_execute": false,
      "service_execute": false
    }
  },
  {
    "migration": "20260912043321",
    "kind": "function",
    "identity": "app_private.guard_pending_provision_profile()",
    "relation": null,
    "name": null,
    "properties": {
      "body_md5": "0fcf1b8bc637b66da61aecfda573fa47",
      "security_definer": true,
      "volatility": "v",
      "language": "plpgsql",
      "search_path": [
        "search_path=pg_catalog, app_private"
      ],
      "defaults": null,
      "public_execute": false,
      "anon_execute": false,
      "authenticated_execute": false,
      "service_execute": false
    }
  },
  {
    "migration": "20260912043321",
    "kind": "function",
    "identity": "public.claim_profile_provisions(integer)",
    "relation": null,
    "name": null,
    "properties": {
      "body_md5": "7844f5c2df89308c6285d109011a5c70",
      "security_definer": true,
      "volatility": "v",
      "language": "plpgsql",
      "search_path": [
        "search_path=pg_catalog, public, app_private"
      ],
      "defaults": "10",
      "public_execute": false,
      "anon_execute": false,
      "authenticated_execute": false,
      "service_execute": true
    }
  },
  {
    "migration": "20260912043321",
    "kind": "function",
    "identity": "public.profile_provision_status(uuid)",
    "relation": null,
    "name": null,
    "properties": {
      "body_md5": "f08553337a3ea7e280864ad2354d4d44",
      "security_definer": true,
      "volatility": "s",
      "language": "sql",
      "search_path": [
        "search_path=pg_catalog, app_private"
      ],
      "defaults": null,
      "public_execute": false,
      "anon_execute": false,
      "authenticated_execute": false,
      "service_execute": true
    }
  },
  {
    "migration": "20260912043321",
    "kind": "table",
    "identity": "app_private.profile_provisioning",
    "relation": "app_private.profile_provisioning",
    "name": null,
    "properties": {
      "rls": true,
      "force_rls": false,
      "public_access": false,
      "anon_access": false,
      "authenticated_access": false,
      "service_access": false,
      "policy_count": 0
    }
  },
  {
    "migration": "20260912043321",
    "kind": "column",
    "identity": "app_private.profile_provisioning.id",
    "relation": "app_private.profile_provisioning",
    "name": "id",
    "properties": {
      "type": "uuid",
      "not_null": true
    }
  },
  {
    "migration": "20260912043321",
    "kind": "column",
    "identity": "app_private.profile_provisioning.organization_id",
    "relation": "app_private.profile_provisioning",
    "name": "organization_id",
    "properties": {
      "type": "uuid",
      "not_null": true
    }
  },
  {
    "migration": "20260912043321",
    "kind": "column",
    "identity": "app_private.profile_provisioning.profile_id",
    "relation": "app_private.profile_provisioning",
    "name": "profile_id",
    "properties": {
      "type": "uuid",
      "not_null": true
    }
  },
  {
    "migration": "20260912043321",
    "kind": "column",
    "identity": "app_private.profile_provisioning.user_type",
    "relation": "app_private.profile_provisioning",
    "name": "user_type",
    "properties": {
      "type": "text",
      "not_null": true
    }
  },
  {
    "migration": "20260912043321",
    "kind": "column",
    "identity": "app_private.profile_provisioning.role",
    "relation": "app_private.profile_provisioning",
    "name": "role",
    "properties": {
      "type": "text",
      "not_null": true
    }
  },
  {
    "migration": "20260912043321",
    "kind": "column",
    "identity": "app_private.profile_provisioning.email",
    "relation": "app_private.profile_provisioning",
    "name": "email",
    "properties": {
      "type": "text",
      "not_null": true
    }
  },
  {
    "migration": "20260912043321",
    "kind": "column",
    "identity": "app_private.profile_provisioning.auth_user_id",
    "relation": "app_private.profile_provisioning",
    "name": "auth_user_id",
    "properties": {
      "type": "uuid",
      "not_null": true
    }
  },
  {
    "migration": "20260912043321",
    "kind": "column",
    "identity": "app_private.profile_provisioning.completed_at",
    "relation": "app_private.profile_provisioning",
    "name": "completed_at",
    "properties": {
      "type": "timestamp with time zone",
      "not_null": false
    }
  },
  {
    "migration": "20260912043321",
    "kind": "column",
    "identity": "app_private.profile_provisioning.created_at",
    "relation": "app_private.profile_provisioning",
    "name": "created_at",
    "properties": {
      "type": "timestamp with time zone",
      "not_null": true
    }
  },
  {
    "migration": "20260912043321",
    "kind": "column",
    "identity": "app_private.profile_provisioning.next_attempt_at",
    "relation": "app_private.profile_provisioning",
    "name": "next_attempt_at",
    "properties": {
      "type": "timestamp with time zone",
      "not_null": true
    }
  },
  {
    "migration": "20260912043321",
    "kind": "trigger",
    "identity": "app_private.organization_deletions.aaa_pending_profile_provision",
    "relation": "app_private.organization_deletions",
    "name": "aaa_pending_profile_provision",
    "properties": {
      "function": "app_private.guard_pending_profile_provision()",
      "type": 7,
      "enabled": "O",
      "arguments": 0,
      "when": null
    }
  },
  {
    "migration": "20260912043321",
    "kind": "trigger",
    "identity": "public.admin_users.aaa_pending_provision",
    "relation": "public.admin_users",
    "name": "aaa_pending_provision",
    "properties": {
      "function": "app_private.guard_pending_provision_profile()",
      "type": 27,
      "enabled": "O",
      "arguments": 0,
      "when": null
    }
  },
  {
    "migration": "20260912043321",
    "kind": "trigger",
    "identity": "public.developers.aaa_pending_provision",
    "relation": "public.developers",
    "name": "aaa_pending_provision",
    "properties": {
      "function": "app_private.guard_pending_provision_profile()",
      "type": 27,
      "enabled": "O",
      "arguments": 0,
      "when": null
    }
  },
  {
    "migration": "20260912043321",
    "kind": "trigger",
    "identity": "public.clients.aaa_pending_provision",
    "relation": "public.clients",
    "name": "aaa_pending_provision",
    "properties": {
      "function": "app_private.guard_pending_provision_profile()",
      "type": 27,
      "enabled": "O",
      "arguments": 0,
      "when": null
    }
  },
  {
    "migration": "20260912043604",
    "kind": "function",
    "identity": "public.operator_repair_profile_identity(uuid,uuid,text,uuid,boolean,boolean,text,text)",
    "relation": null,
    "name": null,
    "properties": {
      "body_md5": "00c5fd85028d5d8cccf440bf4c525f93",
      "security_definer": true,
      "volatility": "v",
      "language": "plpgsql",
      "search_path": [
        "search_path=pg_catalog, public, app_private"
      ],
      "defaults": "false, false, NULL::text, NULL::text",
      "public_execute": false,
      "anon_execute": false,
      "authenticated_execute": false,
      "service_execute": true
    }
  },
  {
    "migration": "20260912043604",
    "kind": "table",
    "identity": "app_private.identity_repair_audit",
    "relation": "app_private.identity_repair_audit",
    "name": null,
    "properties": {
      "rls": true,
      "force_rls": false,
      "public_access": false,
      "anon_access": false,
      "authenticated_access": false,
      "service_access": false,
      "policy_count": 0
    }
  },
  {
    "migration": "20260912043604",
    "kind": "column",
    "identity": "app_private.identity_repair_audit.id",
    "relation": "app_private.identity_repair_audit",
    "name": "id",
    "properties": {
      "type": "uuid",
      "not_null": true
    }
  },
  {
    "migration": "20260912043604",
    "kind": "column",
    "identity": "app_private.identity_repair_audit.organization_id",
    "relation": "app_private.identity_repair_audit",
    "name": "organization_id",
    "properties": {
      "type": "uuid",
      "not_null": true
    }
  },
  {
    "migration": "20260912043604",
    "kind": "column",
    "identity": "app_private.identity_repair_audit.profile_id",
    "relation": "app_private.identity_repair_audit",
    "name": "profile_id",
    "properties": {
      "type": "uuid",
      "not_null": true
    }
  },
  {
    "migration": "20260912043604",
    "kind": "column",
    "identity": "app_private.identity_repair_audit.user_type",
    "relation": "app_private.identity_repair_audit",
    "name": "user_type",
    "properties": {
      "type": "text",
      "not_null": true
    }
  },
  {
    "migration": "20260912043604",
    "kind": "column",
    "identity": "app_private.identity_repair_audit.auth_user_id",
    "relation": "app_private.identity_repair_audit",
    "name": "auth_user_id",
    "properties": {
      "type": "uuid",
      "not_null": true
    }
  },
  {
    "migration": "20260912043604",
    "kind": "column",
    "identity": "app_private.identity_repair_audit.operator_reference",
    "relation": "app_private.identity_repair_audit",
    "name": "operator_reference",
    "properties": {
      "type": "text",
      "not_null": true
    }
  },
  {
    "migration": "20260912043604",
    "kind": "column",
    "identity": "app_private.identity_repair_audit.repaired_link",
    "relation": "app_private.identity_repair_audit",
    "name": "repaired_link",
    "properties": {
      "type": "boolean",
      "not_null": true
    }
  },
  {
    "migration": "20260912043604",
    "kind": "column",
    "identity": "app_private.identity_repair_audit.repaired_organization",
    "relation": "app_private.identity_repair_audit",
    "name": "repaired_organization",
    "properties": {
      "type": "boolean",
      "not_null": true
    }
  },
  {
    "migration": "20260912043604",
    "kind": "column",
    "identity": "app_private.identity_repair_audit.created_at",
    "relation": "app_private.identity_repair_audit",
    "name": "created_at",
    "properties": {
      "type": "timestamp with time zone",
      "not_null": true
    }
  },
  {
    "migration": "20260912043622",
    "kind": "function",
    "identity": "public.verify_signup_code(text,text,text)",
    "relation": null,
    "name": null,
    "properties": {
      "body_md5": "1f13fe658ca83002db37e0b640c83f53",
      "security_definer": true,
      "volatility": "v",
      "language": "plpgsql",
      "search_path": [
        "search_path=pg_catalog, public"
      ],
      "defaults": null,
      "public_execute": false,
      "anon_execute": false,
      "authenticated_execute": false,
      "service_execute": true
    }
  },
  {
    "migration": "20260912043622",
    "kind": "function",
    "identity": "public.claim_signup(text,uuid,jsonb,text,text,text,inet)",
    "relation": null,
    "name": null,
    "properties": {
      "body_md5": "4d9fa6110e42f6815a4572f95467ff3d",
      "security_definer": true,
      "volatility": "v",
      "language": "plpgsql",
      "search_path": [
        "search_path=pg_catalog, public, app_private"
      ],
      "defaults": "NULL::inet",
      "public_execute": false,
      "anon_execute": false,
      "authenticated_execute": false,
      "service_execute": true
    }
  },
  {
    "migration": "20260912043622",
    "kind": "function",
    "identity": "public.finish_signup(uuid,uuid)",
    "relation": null,
    "name": null,
    "properties": {
      "body_md5": "621a85a8bd608a2b471cd536625401cd",
      "security_definer": true,
      "volatility": "v",
      "language": "plpgsql",
      "search_path": [
        "search_path=pg_catalog, public, app_private"
      ],
      "defaults": null,
      "public_execute": false,
      "anon_execute": false,
      "authenticated_execute": false,
      "service_execute": true
    }
  },
  {
    "migration": "20260912043622",
    "kind": "function",
    "identity": "public.release_signup_claim(uuid,uuid)",
    "relation": null,
    "name": null,
    "properties": {
      "body_md5": "405c3a0aac1eae4c5bac115ea0d98bc9",
      "security_definer": true,
      "volatility": "v",
      "language": "sql",
      "search_path": [
        "search_path=pg_catalog, public, app_private"
      ],
      "defaults": null,
      "public_execute": false,
      "anon_execute": false,
      "authenticated_execute": false,
      "service_execute": true
    }
  },
  {
    "migration": "20260912043622",
    "kind": "function",
    "identity": "public.claim_signup_recovery(integer)",
    "relation": null,
    "name": null,
    "properties": {
      "body_md5": "54564ffac9037858464469f5879f505e",
      "security_definer": true,
      "volatility": "v",
      "language": "plpgsql",
      "search_path": [
        "search_path=pg_catalog, public, app_private"
      ],
      "defaults": "10",
      "public_execute": false,
      "anon_execute": false,
      "authenticated_execute": false,
      "service_execute": true
    }
  },
  {
    "migration": "20260912043622",
    "kind": "table",
    "identity": "app_private.signup_attempts",
    "relation": "app_private.signup_attempts",
    "name": null,
    "properties": {
      "rls": true,
      "force_rls": false,
      "public_access": false,
      "anon_access": false,
      "authenticated_access": false,
      "service_access": false,
      "policy_count": 0
    }
  },
  {
    "migration": "20260912043622",
    "kind": "column",
    "identity": "app_private.signup_attempts.id",
    "relation": "app_private.signup_attempts",
    "name": "id",
    "properties": {
      "type": "uuid",
      "not_null": true
    }
  },
  {
    "migration": "20260912043622",
    "kind": "column",
    "identity": "app_private.signup_attempts.email",
    "relation": "app_private.signup_attempts",
    "name": "email",
    "properties": {
      "type": "text",
      "not_null": true
    }
  },
  {
    "migration": "20260912043622",
    "kind": "column",
    "identity": "app_private.signup_attempts.profile_id",
    "relation": "app_private.signup_attempts",
    "name": "profile_id",
    "properties": {
      "type": "uuid",
      "not_null": true
    }
  },
  {
    "migration": "20260912043622",
    "kind": "column",
    "identity": "app_private.signup_attempts.organization_id",
    "relation": "app_private.signup_attempts",
    "name": "organization_id",
    "properties": {
      "type": "uuid",
      "not_null": true
    }
  },
  {
    "migration": "20260912043622",
    "kind": "column",
    "identity": "app_private.signup_attempts.auth_user_id",
    "relation": "app_private.signup_attempts",
    "name": "auth_user_id",
    "properties": {
      "type": "uuid",
      "not_null": true
    }
  },
  {
    "migration": "20260912043622",
    "kind": "column",
    "identity": "app_private.signup_attempts.details",
    "relation": "app_private.signup_attempts",
    "name": "details",
    "properties": {
      "type": "jsonb",
      "not_null": true
    }
  },
  {
    "migration": "20260912043622",
    "kind": "column",
    "identity": "app_private.signup_attempts.subscription",
    "relation": "app_private.signup_attempts",
    "name": "subscription",
    "properties": {
      "type": "jsonb",
      "not_null": true
    }
  },
  {
    "migration": "20260912043622",
    "kind": "column",
    "identity": "app_private.signup_attempts.terms_version",
    "relation": "app_private.signup_attempts",
    "name": "terms_version",
    "properties": {
      "type": "text",
      "not_null": true
    }
  },
  {
    "migration": "20260912043622",
    "kind": "column",
    "identity": "app_private.signup_attempts.accepted_ip",
    "relation": "app_private.signup_attempts",
    "name": "accepted_ip",
    "properties": {
      "type": "inet",
      "not_null": false
    }
  },
  {
    "migration": "20260912043622",
    "kind": "column",
    "identity": "app_private.signup_attempts.claim_id",
    "relation": "app_private.signup_attempts",
    "name": "claim_id",
    "properties": {
      "type": "uuid",
      "not_null": true
    }
  },
  {
    "migration": "20260912043622",
    "kind": "column",
    "identity": "app_private.signup_attempts.lease_until",
    "relation": "app_private.signup_attempts",
    "name": "lease_until",
    "properties": {
      "type": "timestamp with time zone",
      "not_null": true
    }
  },
  {
    "migration": "20260912043622",
    "kind": "column",
    "identity": "app_private.signup_attempts.created_at",
    "relation": "app_private.signup_attempts",
    "name": "created_at",
    "properties": {
      "type": "timestamp with time zone",
      "not_null": true
    }
  },
  {
    "migration": "20260912043622",
    "kind": "column",
    "identity": "app_private.signup_attempts.updated_at",
    "relation": "app_private.signup_attempts",
    "name": "updated_at",
    "properties": {
      "type": "timestamp with time zone",
      "not_null": true
    }
  },
  {
    "migration": "20260912043622",
    "kind": "column",
    "identity": "app_private.signup_attempts.completed_at",
    "relation": "app_private.signup_attempts",
    "name": "completed_at",
    "properties": {
      "type": "timestamp with time zone",
      "not_null": false
    }
  },
  {
    "migration": "20260912044800",
    "kind": "function",
    "identity": "app_private.recurring_next_date(date,jsonb)",
    "relation": null,
    "name": null,
    "properties": {
      "body_md5": "81f7968eeccc10d6a6c9ae91d022f5ae",
      "security_definer": false,
      "volatility": "i",
      "language": "plpgsql",
      "search_path": [
        "search_path=pg_catalog"
      ],
      "defaults": null,
      "public_execute": false,
      "anon_execute": false,
      "authenticated_execute": false,
      "service_execute": false
    }
  },
  {
    "migration": "20260912044800",
    "kind": "function",
    "identity": "public.spawn_recurring_task(uuid,jsonb,date,date)",
    "relation": null,
    "name": null,
    "properties": {
      "body_md5": "8eb1890c2c36e084a4d9bc4a1645c137",
      "security_definer": true,
      "volatility": "v",
      "language": "plpgsql",
      "search_path": [
        "search_path=pg_catalog, public, app_private"
      ],
      "defaults": null,
      "public_execute": false,
      "anon_execute": false,
      "authenticated_execute": false,
      "service_execute": true
    }
  },
  {
    "migration": "20260912044958",
    "kind": "function",
    "identity": "app_private.cleanup_completed_signup()",
    "relation": null,
    "name": null,
    "properties": {
      "body_md5": "57d7b14016679c39faf348ea62acee2f",
      "security_definer": true,
      "volatility": "v",
      "language": "plpgsql",
      "search_path": [
        "search_path=pg_catalog, app_private"
      ],
      "defaults": null,
      "public_execute": false,
      "anon_execute": false,
      "authenticated_execute": false,
      "service_execute": false
    }
  },
  {
    "migration": "20260912044958",
    "kind": "trigger",
    "identity": "public.organizations.aaa_completed_signup_cleanup",
    "relation": "public.organizations",
    "name": "aaa_completed_signup_cleanup",
    "properties": {
      "function": "app_private.cleanup_completed_signup()",
      "type": 9,
      "enabled": "O",
      "arguments": 0,
      "when": null
    }
  },
  {
    "migration": "20260912043622",
    "kind": "column",
    "identity": "public.email_verifications.signup_grant_hash",
    "relation": "public.email_verifications",
    "name": "signup_grant_hash",
    "properties": {
      "type": "text",
      "not_null": false
    }
  },
  {
    "migration": "20260912043622",
    "kind": "index",
    "identity": "app_private.signup_pending_email",
    "relation": "app_private.signup_attempts",
    "name": "signup_pending_email",
    "properties": {
      "unique": true,
      "valid": true,
      "ready": true,
      "columns": [
        "email"
      ],
      "predicate": "(completed_at IS NULL)"
    }
  }
]
$expected$::jsonb)
 as e(migration text,kind text,identity text,relation text,name text,properties jsonb)
), inspected as (
 select e.*, case e.kind
 when 'function' then (select jsonb_build_object(
  'body_md5',md5(replace(p.prosrc,E'\r\n',E'\n')),'security_definer',p.prosecdef,'volatility',p.provolatile,
  'language',l.lanname,'search_path',to_jsonb(p.proconfig),'defaults',pg_get_expr(p.proargdefaults,0),
  'public_execute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'),
  'anon_execute',(select has_function_privilege(r.oid,p.oid,'EXECUTE') from pg_roles r where rolname='anon'),
  'authenticated_execute',(select has_function_privilege(r.oid,p.oid,'EXECUTE') from pg_roles r where rolname='authenticated'),
  'service_execute',(select has_function_privilege(r.oid,p.oid,'EXECUTE') from pg_roles r where rolname='service_role'))
  from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(e.identity))
 when 'table' then (select jsonb_build_object('rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
  'public_access',exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee=0),
  'anon_access',(select has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') from pg_roles r where rolname='anon'),
  'authenticated_access',(select has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') from pg_roles r where rolname='authenticated'),
  'service_access',(select has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') from pg_roles r where rolname='service_role'),
  'policy_count',(select count(*) from pg_policy p where p.polrelid=c.oid)) from pg_class c where c.oid=to_regclass(e.identity) and c.relkind in ('r','p'))
 when 'column' then (select jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull)
  from pg_attribute a where a.attrelid=to_regclass(e.relation) and a.attname=e.name and not a.attisdropped and a.attnum>0)
 when 'trigger' then (select jsonb_build_object('function',t.tgfoid::regprocedure::text,'type',t.tgtype,'enabled',t.tgenabled,'arguments',t.tgnargs,'when',pg_get_expr(t.tgqual,t.tgrelid))
  from pg_trigger t where t.tgrelid=to_regclass(e.relation) and t.tgname=e.name and not t.tgisinternal)
 when 'index' then (select jsonb_build_object('unique',i.indisunique,'valid',i.indisvalid,'ready',i.indisready,
  'columns',(select jsonb_agg(a.attname order by k.ordinality) from unnest(i.indkey::smallint[]) with ordinality k(attnum,ordinality) join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum),
  'predicate',pg_get_expr(i.indpred,i.indrelid)) from pg_index i where i.indexrelid=to_regclass(e.identity) and i.indrelid=to_regclass(e.relation))
 end as actual from expected e
), checks as (
 select *,case when actual is null then 'MISSING' when actual=properties then 'MATCH' else 'DRIFT' end as status from inspected
), output as (
 select migration,'SUMMARY'::text as check_type,migration as object,
  case when bool_and(status='MATCH') then 'CATALOG_CHECKS_MATCH' else 'REVIEW_REQUIRED' end as status,
  jsonb_build_object('expected_checks',count(*)) as expected,
  jsonb_build_object('matched',count(*) filter(where status='MATCH'),'missing',count(*) filter(where status='MISSING'),'drifted',count(*) filter(where status='DRIFT')) as actual
 from checks group by migration
 union all
 select migration,kind,identity,status,properties,actual from checks where status<>'MATCH' or (select include_passes from settings)
)
select migration,check_type,object,status,expected,actual from output order by migration,(check_type<>'SUMMARY'),check_type,object;
commit;
