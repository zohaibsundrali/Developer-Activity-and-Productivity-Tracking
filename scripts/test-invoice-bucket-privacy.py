#!/usr/bin/env python3
"""Run the real migration against a public bucket; deployment must fail first."""
import pathlib
import subprocess
import sys

container = sys.argv[1]
database = 'invoice_public_bucket_guard_test'
subprocess.run(['docker', 'exec', container, 'createdb', '-U', 'postgres', database], check=True, capture_output=True)
command = ['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1']
setup = "create schema storage; create table storage.buckets(id text primary key,public boolean not null); insert into storage.buckets values('invoices',true);"
subprocess.run(command, input=setup, text=True, check=True, capture_output=True)
migration = pathlib.Path('supabase/migrations/20260912110551_production_transactional_typed_invoicing.sql').read_text()
result = subprocess.run(command, input=migration, text=True, capture_output=True)
if result.returncode == 0 or 'INVOICE_BUCKET_PUBLIC' not in result.stderr:
    raise AssertionError('Public invoice bucket did not refuse deployment: ' + result.stderr)
print('PASS: actual migration refuses public invoice bucket before schema changes')
