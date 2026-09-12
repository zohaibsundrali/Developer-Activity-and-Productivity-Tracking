# Spreadsheet export safety

CSV reports previously escaped CSV delimiters without protecting spreadsheet formula prefixes. User-controlled names and task text could therefore be interpreted as formulas when a report was opened in spreadsheet software.

A shared CSV serializer preserves typed numeric values while neutralizing dangerous text prefixes, including whitespace/control-prefixed and full-width variants. Headers use the same treatment. Quotes, delimiters, multiline text, Unicode, nulls and dates retain their CSV representation. Protection is applied when exporting; stored application records are unchanged.

CSV exports check whether their report scope is still current before serialization and before downloading. Temporary download anchors and object URLs are cleaned up even if DOM insertion or clicking fails.

Merge/deploy the web PR after its report/attendance predecessors. No new migration or desktop rebuild is needed. Test an exported report in the spreadsheet products used by your organization. CSV protections are not a universal guarantee across every import configuration or subsequent re-save/re-open operation; see the [OWASP CSV injection guidance](https://github.com/OWASP/www-community/blob/master/pages/attacks/CSV_Injection.md).

Very-large-report aggregation remains separate work. This release does not increase report processing ceilings or certify live production journeys.

Validation: 4,352 tests passed across 214 files and the production build passed. Targeted coverage includes formula-like cells, full-width/control prefixes, typed numeric preservation, CSV quoting and Unicode, cancelled exports and download cleanup failures. Payloads were serialized only, never executed. No SQL changes in this release.
