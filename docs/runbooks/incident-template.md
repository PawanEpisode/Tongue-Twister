# Incident: <short title>

Copy this file to `incident-YYYYMMDD-<slug>.md` (outside the repo if it holds user data) and fill it as you go.
Times in UTC.

| | |
|---|---|
| Severity | SEV1 data exposure or total outage / SEV2 a feature down / SEV3 degraded |
| Detected | `hh:mm` by (alert / user report / self) |
| Declared | `hh:mm` |
| Resolved | `hh:mm` |
| Owner | |

## 1. Symptom
What users see. Link the report. Do not paste personal data.

## 2. Impact
Who and how many, which flags/endpoints, since when. Data affected? (yes/no/unknown)

## 3. Timeline
- `hh:mm` ...

## 4. Mitigation taken
Kill switch flipped (flag code, previous value), release rolled back, secret rotated, link revoked. Say how to
undo each.

## 5. Verification
How you know it is fixed: the check that failed now passes (command or screenshot).

## 6. Root cause
Five whys. Separate the trigger from the underlying gap.

## 7. User and legal follow-up
- [ ] Users to notify? What was said?
- [ ] Personal data involved: the owner decides about regulator notification (GDPR 72 h clock starts at awareness).
- [ ] Takedown/consent records updated (`takedown-sla.md`)

## 8. Follow-ups
| Action | Owner | Due |
|---|---|---|
| Test or alert that would have caught it | | |
| Runbook edit | | |
