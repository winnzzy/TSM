# WhatsApp Template Submission Guide

The system only sends business-initiated messages through approved Meta
message templates. Submit the three templates below in the WhatsApp Manager
(**Message templates → Create template**, category **Utility**,
language `en`), then put the approved names in
`WHATSAPP_TEMPLATE_MANIFEST`, `WHATSAPP_TEMPLATE_UPDATE`, and
`WHATSAPP_TEMPLATE_REMINDER`.

The notification is intentionally a **summary + link** — WhatsApp template
variables have length limits, so the full grouped roster lives on the public
manifest page instead.

## 1. `transport_manifest` — daily manifest

```
🚐 Transport Manifest — {{1}}
Shift end: {{2}} | Agents: {{3}} | Campaigns: {{4}}
Routes: {{5}}
Full manifest: {{6}}
Reply CONFIRM to acknowledge.
```

| Variable | Example |
|---|---|
| `{{1}}` | Thu, 08 Oct 2026 |
| `{{2}}` | 7:00 PM |
| `{{3}}` | 38 |
| `{{4}}` | Acme Support, Beta Retail |
| `{{5}}` | Ikeja-Ogba (12), Lekki-Ajah (14), Yaba-Surulere (9) |
| `{{6}}` | https://your-host/m/Ab3dEf7h |

Sample submission text (fill the variables with realistic examples):

> 🚐 Transport Manifest — Thu, 08 Oct 2026
> Shift end: 7:00 PM | Agents: 38 | Campaigns: 2
> Routes: Ikeja-Ogba (12), Lekki-Ajah (14), Yaba-Surulere (9)
> Full manifest: https://example.com/m/Ab3dEf7h
> Reply CONFIRM to acknowledge.

## 2. `transport_manifest_update` — post-cutoff amendment

```
🔄 Manifest UPDATED — {{1}} (v{{2}})
Added: {{3}} | Removed: {{4}} | Moved: {{5}}
Updated manifest: {{6}}
Reply CONFIRM to acknowledge.
```

| Variable | Example |
|---|---|
| `{{1}}` | Thu, 08 Oct 2026 |
| `{{2}}` | 2 |
| `{{3}}` | Dami Mensah (Beta Retail) |
| `{{4}}` | — (use `—` when empty) |
| `{{5}}` | — |
| `{{6}}` | https://your-host/m/Ab3dEf7h |

## 3. `transport_confirm_reminder` — confirmation reminder

```
⏰ Reminder: transport manifest for {{1}} is not yet confirmed. View: {{2}} — reply CONFIRM.
```

| Variable | Example |
|---|---|
| `{{1}}` | Thu, 08 Oct 2026 |
| `{{2}}` | https://your-host/m/Ab3dEf7h |

## Notes for approval

- All three are **Utility** templates: they carry transactional transport
  information the recipient arranged to receive. No marketing content.
- `{{6}}` / `{{2}}` are URL variables — Meta allows URLs in template
  parameters; keep the public manifest link short (the token is a cuid).
- Keep each rendered message under ~1000 characters; the route list in
  `{{5}}` is compacted (`Zone (n)`) for this reason.
- Replies (`CONFIRM`) arrive inside the 24-hour customer-service window, so
  the acknowledgement is sent with `sendText`, not a template.
- Phone numbers must be E.164 (e.g. `+2348012345678`); the app validates
  this when recipients are saved.
