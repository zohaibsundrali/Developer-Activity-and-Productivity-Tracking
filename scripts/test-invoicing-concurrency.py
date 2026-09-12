#!/usr/bin/env python3
"""Actual concurrent invoice claims and direct header/line lock ordering."""
import subprocess
import sys
import time

container = sys.argv[1]
database = sys.argv[2] if len(sys.argv) > 2 else 'transactional_typed_invoicing_test'
base = ['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1']
project = '99300000-0000-0000-0000-000000000001'
profile = '99100000-0000-0000-0000-000000000011'
manual = '99300000-0000-0000-0000-000000000090'
line = '99300000-0000-0000-0000-000000000091'
owner = "select set_config('request.jwt.claims',timesheet_test_claims('owner'),false); set role authenticated;"
dev = "select set_config('request.jwt.claims',timesheet_test_claims('developer'),false); set role authenticated;"
selection = "jsonb_build_array(jsonb_build_object('userId','" + profile + "','userType','developer','weekStart','2026-10-12'))"
raise_invoice = "select raise_timesheet_invoice('" + project + "'," + selection + ")"

def run(sql, ok=True):
    result = subprocess.run(base, input=sql, text=True, capture_output=True, timeout=40)
    if ok and result.returncode:
        raise AssertionError(result.stderr)
    return result

def start(sql):
    process = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.stdin.write("set application_name='invoicing_concurrency_first'; begin; " + owner + sql + '; select pg_sleep(1.5); commit;')
    process.stdin.close()
    for _ in range(200):
        if run("select count(*) from pg_stat_activity where application_name='invoicing_concurrency_first' and wait_event='PgSleep';").stdout.strip() == '1':
            return process
        if process.poll() is not None:
            raise AssertionError(process.stderr.read())
        time.sleep(.02)
    process.kill()
    raise AssertionError('First transaction did not reach its controlled hold')

def finish(process):
    process.wait(timeout=40)
    if process.returncode:
        raise AssertionError(process.stderr.read())

run(dev + "insert into task_time_logs(organization_id,developer_id,project_id,started_at,ended_at,seconds) values(auth_org(),auth_app_user_id(),'" + project + "','2026-10-12T10:00Z','2026-10-12T11:00Z',3600); select submit_timesheet_week('2026-10-12');")
run(owner + "select decide_timesheet((select id from timesheets where user_type='developer' and week_start='2026-10-12'),'approved',null);")
first = start(raise_invoice)
second = run(owner + raise_invoice + ';', ok=False)
finish(first)
assert second.returncode and 'INVOICE_ALREADY_BILLED' in second.stderr, second.stderr
assert run("select count(*) from invoice_lines l join invoices i on i.id=l.invoice_id where l.week_start='2026-10-12' and i.status<>'void';").stdout.strip() == '1'

run(owner + "insert into invoices(id,organization_id,number,amount) values('" + manual + "',auth_org(),'Concurrency manual',0); insert into invoice_lines(id,organization_id,invoice_id,description,quantity,unit_rate,amount,source) values('" + line + "',auth_org(),'" + manual + "','Concurrent line',1,10,10,'manual');")
first = start("update invoices set status='sent' where id='" + manual + "'")
run(owner + "update invoice_lines set quantity=2,amount=20 where id='" + line + "';")
finish(first)
assert run("select amount||':'||status from invoices where id='" + manual + "';").stdout.strip() == '20.00:sent'
first = start("update invoice_lines set quantity=3,amount=30 where id='" + line + "'")
run(owner + "update invoices set status='paid' where id='" + manual + "';")
finish(first)
assert run("select amount||':'||status from invoices where id='" + manual + "';").stdout.strip() == '30.00:paid'

old_id = run("select invoice_id from invoice_lines where week_start='2026-10-12';").stdout.strip()
run(owner + "update invoices set status='void' where id='" + old_id + "';")
first = start(raise_invoice)
second = run(owner + "update invoices set status='sent' where id='" + old_id + "';", ok=False)
finish(first)
assert second.returncode and 'INVOICE_ALREADY_BILLED' in second.stderr, second.stderr
assert run("select count(*) from invoice_lines l join invoices i on i.id=l.invoice_id where l.week_start='2026-10-12' and i.status<>'void';").stdout.strip() == '1'
print('PASS: one invoice claims each source; header/line edits serialize both ways; void reactivation cannot double bill')
