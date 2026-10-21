# PBI-INV-1 — Invoice search, tenant-scoped reads and the daily billing reminder

Status: accepted · revision r1 · owner: the invoice product team (synthetic acceptance fixture)

These are the accepted acceptance criteria of a SYNTHETIC invoice application. Every value in them
(the statuses, the names, the schedule, the counts) is this fixture's own contract — nothing here
is imposed on any real application. The data is synthetic; the NAME a case searches for is issued
by the fixture's receipt.

## UI-AC-1 — search by name

Tìm kiếm theo tên phải hiển thị hóa đơn đã seed, gọi GET search thành công và kết quả khớp dữ liệu
tổng hợp.

(Searching by name shows the seeded invoice, the GET search call succeeds, and the result matches
the synthetic data.)

- The search page is `/invoices`; the search box is `[data-testid=search]`, the button
  `[data-testid=search-submit]`, the results `[data-testid=results]`, which carries
  `data-loading="false"` once the answer is drawn.
- The search call is `GET /api/invoices?q=<name>` and answers 200.
- Exactly one stored invoice has that name.

## API-AC-1 — the owner reads its own invoice

Chủ sở hữu đọc invoice trả 200.

(The owner reading its invoice gets 200.) `GET /api/invoices/inv-a` as an identity of tenant A
answers 200 with `id` = `inv-a` and `tenantId` = `tenant-a`.

## API-AC-2 — another tenant cannot read it

Tenant khác đọc invoice trả 404 với error not_found và không có dữ liệu hóa đơn.

(Another tenant reading the invoice gets 404 with error not_found and no invoice data.) The same
request as an identity of tenant B answers 404 with `error` = `not_found`, and the answer contains
nothing of the invoice — in particular not its marker `canary-invoice-a`.

## API-AC-3 — create is idempotent by key

`POST /api/invoices` with an `Idempotency-Key` header creates one invoice and answers 201; the same
request again with the same key creates nothing more and answers the same invoice. A create the
interface reported as successful is persisted.

## FIX-ASYNC-1 — one reminder and one notification per period

Một kỳ hợp lệ tạo đúng một reminder record cho invoice inv-a của tenant A và đúng một notification
trong sink tổng hợp; tenant B không bị thay đổi. Kỳ thử được pin bằng occurrenceId
billing-daily:2026-10-22T09:00:00+07:00. Business key kết hợp tenant, invoice và occurrence; nó
không thay đổi khi retry hoặc redelivery.

(A valid period creates exactly one reminder record for invoice inv-a of tenant A and exactly one
notification in the synthetic sink; tenant B is not changed. The period under test is pinned by
occurrenceId `billing-daily:2026-10-22T09:00:00+07:00`. The business key combines tenant, invoice
and occurrence; it does not change on a retry or a redelivery.)

- The schedule is `contracts/schedule.json` (`billing-daily`, 09:00 every day, Asia/Ho_Chi_Minh).
- The reminder and the notification exist within 120 seconds of the occurrence being due.
- The message is `contracts/asyncapi.json` `ReminderRequested`; a redelivered or duplicated message
  leaves one reminder and one notification per business key.
- A message whose payload does not conform, or which names a tenant the invoice does not belong
  to, changes nothing and ends in the dead-letter route after at most 3 deliveries.
