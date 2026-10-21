# PBI-INV-1 — Invoice search, tenant-scoped reads and the daily billing reminder

Status: accepted · revision r1 · owner: the invoice product team (synthetic acceptance fixture)

These are the accepted acceptance criteria of a SYNTHETIC invoice application. Every value in them
(the statuses, the names, the schedule, the counts) is this fixture's own contract — nothing here
is imposed on any real application. The data is synthetic; the NAME a case searches for is issued
by the fixture's receipt.

Contract fixture quy định rõ search trả 200, chủ sở hữu đọc invoice trả 200, tenant khác đọc
invoice trả 404 với error not_found và không có dữ liệu hóa đơn. Các status này chỉ là contract của
fixture; không áp đặt 404 lên ứng dụng thực tế.

(The fixture's contract: search answers 200, the owner reading an invoice gets 200, another tenant
reading it gets 404 with error not_found and no invoice data. These statuses are only the fixture's
contract; 404 is not imposed on a real application.)

The HTTP contract is `contracts/openapi.json` (paths relative to its server, `/api`); the message
contract is `contracts/asyncapi.json`; the schedule is `contracts/schedule.json`.

## UI-AC-1 — search by name

Tìm kiếm theo tên phải hiển thị hóa đơn đã seed, gọi GET search thành công và kết quả khớp dữ liệu
tổng hợp. NAME do fixture receipt cấp; dữ liệu không chứa thông tin thật.

(Searching by name shows the seeded invoice, the GET search call succeeds, and the result matches
the synthetic data. NAME is issued by the fixture's receipt; the data holds no real information.)

- The search page is `/invoices`; the search box is `[data-testid=search]`, the button
  `[data-testid=search-submit]`, the results `[data-testid=results]`, which carries
  `data-loading="false"` once the answer is drawn.
- The search call is `GET /api/invoices?q=<name>` and answers 200.
- Exactly one stored invoice has that name.

## API-AC-1 — the owner reads its own invoice

Chủ sở hữu đọc invoice trả 200.

(The owner reading its invoice gets 200.) `GET /invoices/inv-a` as identity `tenant-a-reader`
answers 200 with `id` = `inv-a` and `tenantId` = `tenant-a`.

## API-AC-2 — another tenant cannot read it

Tenant khác đọc invoice trả 404 với error not_found và không có dữ liệu hóa đơn.

(Another tenant reading the invoice gets 404 with error not_found and no invoice data.) The same
request as identity `tenant-b-reader` answers 404 with `error` = `not_found`, and the answer
contains nothing of the invoice — in particular not its marker `canary-invoice-a`.

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

## Criteria the fixture adds

The four criteria above are the planning document's own. These are the fixture's, accepted with
it, so that every planted defect has an accepted criterion it contradicts.

### UI-AC-2 — a create the page reports is persisted

Creating an invoice on `/invoices` (`[data-testid=create-name]`, `[data-testid=create-amount]`,
`[data-testid=create-submit]`) by an identity that may create shows `[data-testid=toast]` with
"Invoice created", and the invoice is then stored — the toast alone is not the outcome.

### API-AC-3 — create is idempotent by key

`POST /invoices` with an `Idempotency-Key` header, as an identity that may create (`*-writer`),
creates one invoice and answers 201; the same request again with the same key creates nothing more
and answers 200 with the same invoice; the same key with a different body answers 409. An identity
that may only read (`*-reader`) gets 403.

### FIX-ASYNC-2 — a delivery that cannot succeed changes nothing and ends dead-lettered

A reminder request whose payload does not conform to `ReminderRequested`, or which names a tenant
the invoice does not belong to, writes no reminder and no notification and changes no tenant's
data. It is redelivered after a backoff, and its third delivery is dead-lettered with its reason
(`schema-invalid`, `tenant-mismatch`); the dead-lettered message keeps its message id. A delivery
whose notification sink cannot be reached is redelivered the same way — its reminder is written
once, whatever the number of deliveries — and its third failed delivery is dead-lettered with the
reason `dependency-failure`.
