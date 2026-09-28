# Pharmacy System backend

JavaScript, Express, MySQL (`mysql2`), JWT and bcrypt. Routes delegate to
controllers, catalog services handle transactions, models contain SQL, and
middleware enforces authentication, authorization and consistent errors.

## Setup

1. Run `npm install`.
2. Configure `.env` with `PORT`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`,
   `DB_NAME`, `JWT_SECRET`, `JWT_EXPIRES_IN`, and `CLIENT_URL`. Never commit secrets.
3. For a new database, run `models/schema.sql` to create the existing users schema.
   Existing installations should preserve their users table.
4. Run `npm run migrate` to add catalog, suppliers, purchases and stock-movement tables.
5. Start with `npm run dev` (nodemon) or `npm start`.

The migration is additive and repeatable. It does not alter existing accounts,
passwords or roles. MySQL DDL commits independently; the migration statements are
idempotent so an interrupted migration can be rerun. Restart a running plain Node
server after code updates; nodemon reloads automatically.

## Authentication

- `POST /api/auth/register`: `fullName`, `email`, `phone`, `password`.
- `POST /api/auth/login`: `email`, `password`.
- `GET /api/auth/me`: current `user` and server-derived `permissions`.

Login returns `{ message, token, user }`. Registration returns `{ message, user }`
with a pending account and no token; password hashes are omitted.
Protected APIs require `Authorization: Bearer <token>`. They load the current
account so account removal and role changes take effect immediately.

409 on registration means the email is already registered. Sign in with the
existing password. 401 on login means the credentials do not match. Email input
is trimmed and lowercased; passwords retain their exact characters. Registration
requires at least 6 characters and at most 72 UTF-8 bytes for bcrypt. Duplicate
email races also return 409. The UI shows these errors and links duplicate
registrations to a prefilled sign-in form. Password recovery is not implemented;
this update does not reset any existing password.

Existing roles remain `admin`, `pharmacist`, and `staff`. Legacy `staff` has
assistant permissions. New accounts always default to staff; clients cannot
assign privileged roles. Additional role names are mapped for future phases but
have not yet been added to the SQL enum.

## Medicines and Categories

Both `/api/medicines` and `/api/categories` support:

- `GET /` with `search`, `status`, `sort`, `direction`, `page`, and `limit`.
- `GET /:id` for details, `POST /` for creation, and `PUT /:id` for editing.
- Medicine actions: `PATCH /:id/archive` and `PATCH /:id/restore`.
- Category actions: `PATCH /:id/deactivate` and `PATCH /:id/activate`.

Medicines also filter by `category`, `stock` (`in`, `low`, `out`), and `expiry`
(`expired`, `30`, `60`, `90`). Search includes name, generic name, brand and barcode.
`GET /api/medicines/options` supplies active categories and medicine types.

Create/edit bodies use snake_case keys. Editable medicine fields are `name`,
`generic_name`, `brand_name`, `category_id`, `medicine_type`, `description`,
`manufacturer`, `barcode`, `purchase_price`, `selling_price`, `minimum_stock`,
and `storage_location`. Category fields are `name` and `description`. Edits also
require the last retrieved `version`; status actions accept only
`{ "version": 1 }`. Stale updates return 409. Responses use `{ data }`; list data
contains `items` and `pagination`. Errors use `{ message }` and appropriate HTTP
status codes without exposing SQL or credentials.

Admin/pharmacist accounts can manage both modules and archive/deactivate records.
Staff can create/edit medicines and browse categories/details/medicine counts,
but cannot change categories or archive medicines. Every API action enforces these permissions.

Stock is derived from batches and cannot be written through catalog APIs. New
medicines have zero stock; batch number and expiry are read-only receipt data.
Purchases receive stock, preserve supplier relationships through receipt items,
and create movements. Transaction services lock medicine rows before changing
batches. Returns, damage/expiry write-offs and adjustments remain future work. Archiving is blocked when stock remains. Categories with active
medicines cannot be deactivated. Category names and nonempty barcodes are unique;
records are retained instead of deleted. Prices use DECIMAL and validation
rejects negative values, excess precision and unexpected stock fields.

## Dashboard

`GET /api/dashboard` returns permitted real medicine/stock aggregates. Counts use
active medicines. Low-stock warnings include out-of-stock medicines; the stock
overview low-stock category excludes out-of-stock medicines so those categories
do not overlap. Expiry warnings consider positive-quantity batches using the
Tanzania date (UTC+3). Expiring-soon counts are an overlay on physical stock.

Supplier counts and today's purchase totals also use persisted records. Supplier
counts include active suppliers; daily purchases use the selected purchase date
in Tanzania. Currency defaults to TZS. Administrators receive registration activity
without emails, phone numbers or passwords. Sales and other unfinished
modules explicitly return `value: null` with `status: not_configured`, or
`restricted` when unauthorized. No operational statistics or transactions are
fabricated. Full audit history is planned for Phase 9; catalog rows currently
preserve creator, last editor, timestamps and version.

## Checks

- `npm test`: isolated HTTP/authentication regression suite.
- `RUN_DB_TESTS=1 npm test`: also runs real MySQL catalog integration tests.
  This requires permission to create/drop a temporary database. The suite creates
  a unique `pharmacy_test_*` database and removes it on exit; it does not insert
  test records into the configured pharmacy database.

Integration coverage includes normalized login, duplicate registration,
permissions, CRUD, searches, pagination, validation, stale updates, category
relationships, archive safeguards, expiry calculations and dashboard counts.


## Suppliers and Purchases (Phase 3)

`003_purchasing.sql` adds `suppliers`, `purchases`, `purchase_items`, and
`stock_movements`. The migration runner applies all numbered SQL files in order.
No account roles, passwords or existing stock are altered. Staff category access
is now read-only; refresh the app to reload server permissions after upgrading.

Supplier endpoints:

- `GET /api/suppliers`: search name/company/phone/email, status filter, pagination.
- `GET /api/suppliers/:id`: profile, total purchases, outstanding balance, eight
  recent purchases and up to 100 supplied medicines.
- `POST /api/suppliers`, `PUT /api/suppliers/:id`: validated create/edit.
- `PATCH /api/suppliers/:id/deactivate` or `/activate`: retains purchase history.
  Edit/status changes require the current `version` to prevent lost updates.

Purchase endpoints:

- `GET /api/purchases`: search number/invoice/supplier, payment status, supplier ID,
  date range (`from`, `to`) and pagination.
- `GET /api/purchases/medicines`: active medicine lookup by name/barcode, up to 30.
- `GET /api/purchases/:id`: completed receipt, item snapshots and stock movements.
- `POST /api/purchases`: completes a receipt. There are no update/delete endpoints.

A receipt body contains `supplier_id`, `purchase_date` (`YYYY-MM-DD`),
`invoice_number`, `amount_paid`, optional `notes`, a UUID `request_key`, and
`items`. Each item contains `medicine_id`, `batch_number`, integer `quantity`,
`purchase_price`, `selling_price`, and `expiry_date`. Totals and payment status
are calculated on the server with integer minor-unit arithmetic; JSON amounts
are decimal strings. At most 100 items can be received per request. Supplier
invoice numbers are unique per supplier. A duplicate medicine/batch line is
rejected; combine its quantities instead. Multiple batches of one medicine must
use the same selling price in a receipt.

Admin and mapped storekeeper roles can manage suppliers and receive purchases;
staff, assistants, cashiers and pharmacists do not inherit these permissions.
The current SQL role enum still contains the original admin/pharmacist/staff
roles; assignment of additional staff roles remains part of the Users phase.
No existing user is automatically promoted to bypass these restrictions.

Receiving locks the supplier and medicine rows (medicines in ID order). It saves
header/items, creates or increases batches, updates catalog prices, and writes
one PURCHASE movement per item in a single transaction. Stock calculations use
current locking reads, so concurrent receipts cannot record stale stock totals.
Any error rolls back the whole receipt, including catalog-price changes. Existing
batch expiry and unit purchase price must match. Expired batches, inactive
suppliers/medicines, negative/invalid amounts, stock overflow and overpayment are
rejected. All batch writers must continue to lock the parent medicine row.

Retry the exact same request key/payload after a timeout: a committed receipt is
returned without increasing stock again. Reusing a key for changed content or
another user is rejected. The browser preserves its key while retrying an open
form; if the form was closed, check purchase history before starting a new receipt.
Unique supplier invoices provide additional protection against duplicates.

Purchase number, item name, supplier name, prices, expiry and batch are recorded
as receipt snapshots so later master-data edits do not rewrite history. Received
stock and movement rows retain their responsible user and timestamp. Medicine
supplier names are derived from receipts, not a duplicated supplier field.
Balances reflect payment recorded at receipt; subsequent payment entries and
returns/adjustments are not implemented yet.

The MySQL suite also checks concurrent receipts, idempotent retries, duplicate
invoices, exact decimal totals, rollback after a later-line conflict, supplier
deactivation and historical snapshots. Temporary test databases are removed on
completion. Browser checks cover staff category access, supplier/purchase flows,
stock movements, dashboard totals and mobile receiving forms.


## Administrator setup and staff approval

`004_staff_approval.sql` adds `user_access` approval state to existing users and
`audit_logs` for registration and access decisions. Existing non-admin users become
PENDING on first migration; existing admins remain ACTIVE. Select the owner and
coordinate migration with first-admin setup to avoid locking out existing users.
Rerunning migration preserves reviewed status.

After migration, explicitly configure the selected owner account:

```bash
npm run bootstrap-admin -- <account-id>
```

This server-only command preserves the password, enables ACTIVE/admin access,
and records the setup in the audit log. It refuses if an active administrator
already exists. There is no public admin-registration route and no automatic
promotion of the first public registrant.

New registrations are saved atomically as PENDING/staff with an audit entry and
receive no token. Login requires a correct password and ACTIVE approval status.
Every authenticated API checks current database status and role, including for
previously issued tokens.

Admins use Users / Staff (`/users`) to approve/reject registrations, assign roles
to approved staff, and suspend/reactivate accounts. API endpoints are admin-only:

- `GET /api/users`: search, status/role filters and pagination.
- `PATCH /api/users/:id/approve`, `/reject`, `/suspend`, `/activate`: `{ version }`.
- `PATCH /api/users/:id/role`: `{ version, role }`; supported roles are staff,
  pharmacist and admin. Approve as staff first, then explicitly assign admin.

Responses omit passwords. Updates require the current version, disallow self
changes, retain the last active administrator, and recheck the actor's admin
access under a shared database lock. This prevents simultaneous administrators
from removing each other's access. Changes and audit entries commit together.
Full audit reporting and additional role assignments remain future work.

During a staged upgrade with approval tables not yet installed, existing accounts
retain their previous sign-in access (`approval_setup_required: true`). New
registration is blocked with 503 and rolled back until setup completes. Once the
approval tables exist, all access uses their status without this legacy fallback.

### Sales and reports

Run `npm run migrate` to install `006_sales.sql` before starting the updated API.

- `GET /api/sales`: search by invoice/customer, inclusive `from`/`to` dates, pagination.
- `GET /api/sales/medicines?search=...`: up to 30 active medicines with usable stock.
- `GET /api/sales/:id`: saved receipt.
- `POST /api/sales`: request UUID, optional customer name, discount, amount paid,
  payment method, and items containing medicine ID, quantity and expected unit price.
  Server prices are authoritative; stale expected prices return 409.
- `GET /api/reports?type=sales&from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&limit=25`:
  admin-only reports. Types: sales, purchases, stock, expiry, low_stock, profit,
  suppliers, medicines. Inventory reports are current snapshots; expiry includes
  expired stock and the next 90 days.

Sales use earliest-expiring non-expired batches, medicine locks shared with
purchasing, integer monetary arithmetic, idempotent checkout keys and atomic
sale/item/stock/audit writes. Completed sales cannot be edited or deleted.
Payments must cover the total. Customer names are receipt snapshots until the
customer module exists. Returns, partial payments and payment-provider processing
are not implemented. Payment method records the staff's received payment.

Gross profit deducts recorded batch costs and invoice discounts from sales;
operating expenses are not included. Medicine sales reports show revenue before
invoice discounts. Missing/zero historical batch costs affect profit accuracy.

### Customers, prescriptions, notifications and settings

Run `npm run migrate` for additive `007_operations.sql` before using these modules.

- `/api/customers`: authorized customer list/search, create, detail, update with
  version, and `/:id/history` (paginated linked sales). No destructive delete API.
- `/api/prescriptions`: admin/pharmacist list/search/status filters, create,
  detail, pending-only versioned edits and `PATCH /:id/cancel`. List responses
  omit patient names, clinical notes and instructions.
- POS accepts optional `customer_id` and `prescription_id`. Prescription checkout
  requires admin/pharmacist permission and locks the prescription before stock.
  Only remaining prescribed quantities may be sold. Status, dispensed quantities,
  customer history, sale, stock and audit commit together. Cancellation preserves
  completed dispensing and blocks further dispensing.
- `/api/notifications`: role-filtered stock/expiry warnings, purchases, pending
  staff approvals and recent system events. `POST /read` with `{ key }` stores
  per-user read state. Lists are bounded to 100 stock warnings, 100 expiry batches
  and 30 events per event category. Refresh fetches current conditions; no email,
  SMS, background push service or full historical alert archive is implied.
- `/api/settings`: admin-only versioned updates. `/profile` exposes the pharmacy
  profile and defaults to authenticated staff. TZS remains the fixed accounting
  currency. Low-stock defaults apply to new medicine forms. Existing individual
  medicine thresholds are unchanged. Expiry settings drive notifications and the
  dashboard; Stock/Reports retain their explicit 30/60/90-day filters.
- `/api/audit`: admin-only paginated action/entity search. New catalog, supplier,
  receipt, sale, prescription, customer, staff and settings changes are recorded
  transactionally. Audit entries cannot be edited or deleted through the API.

New receipts snapshot the pharmacy profile and invoice footer. Later settings
changes do not alter those saved receipts. Existing pre-migration receipts remain
available without an invented profile or customer link. Customer names on old
receipts are not automatically matched to customer records. Clinical instructions
are entered from a prescription; the system does not generate dosing advice.

### Invoice PDFs, images and recurring alert preferences

Run `npm run migrate` for `008_media_alerts.sql`. Uploaded medicine/logo images
are stored in MySQL, so database backups include them. `POST /api/media` accepts
`{ purpose: 'medicine' | 'logo', image: '<data URL>' }` from authorized staff.
JPEG/PNG/WebP inputs are limited to 2 MB and 20 megapixels, decoded, stripped of
metadata and re-encoded as PNG. Logo uploads require settings permission. Product
and logo images have public, unguessable immutable URLs; these are not patient
photo uploads. Medicine saves validate the image purpose and preserve references.

`GET /api/sales/:id/invoice` downloads an authenticated A4 PDF using saved invoice
amounts and the pharmacy profile snapshot. It supports pagination and uploaded
logos without fetching arbitrary remote URLs. Old receipts without a saved logo
remain downloadable. New profile/invoice settings affect subsequent sales.

Notification responses include uncapped critical-condition totals in `alerts`.
Defaults are expired batches, expiry within 10 days (inclusive), and 10 or fewer
usable units. The header refreshes unread counts every minute and after reads or
navigation. It repeats visible reminders every 10 minutes while the app is open,
including conditions already marked read. Background tabs may be throttled;
conditions are rechecked when the tab becomes visible. No closed-browser push
service is implied. Preferences can change the interval/thresholds or disable
recurring reminders without disabling the notification list.
