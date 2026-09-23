# Pharmacy System frontend

JavaScript, React 18, Vite, React Router, Bootstrap, Axios and React Icons.

## Run

Install with `npm install`, then run `npm run dev`. Run `npm run build` for the
production bundle. Start the existing Express backend and run its catalog
migration before using the authenticated application.

Optional `VITE_API_BASE_URL` in a frontend `.env` changes the API address before
building; default: `http://localhost:5000/api`. Never put secrets in Vite variables.
Set the backend's `CLIENT_URL` to the frontend origin for CORS.

## Routes and access

Public routes: `/`, `/login`, `/register`. The original landing page and shared
authentication styles are preserved. Login/register show backend errors,
normalize email input, and provide prefilled sign-in after successful or
duplicate registration. Existing passwords are preserved.

Protected routes: `/dashboard`, `/medicines`, `/categories`, `/suppliers`, `/purchases`.
The original `/dashboard/medicine` and `/dashboard/suppliers` URLs redirect to
canonical routes. `ProtectedRoute` validates sessions via `/api/auth/me`; network
errors offer retry, while invalid sessions return to login. Server-returned
permissions determine module/action visibility; backend APIs enforce access too.
Staff can browse categories and add/edit medicines. Category changes remain
limited to administrators/pharmacists. Refresh the app after an upgrade to reload
permissions from the backend.

Suppliers and Purchases now use real APIs and require the relevant permissions.
Other sidebar modules are disabled until implemented. Search finds modules. Navigation supports
desktop collapse, a mobile drawer, Escape, focus containment and a skip link.

## Catalog

Medicines and Categories persist through real REST APIs. Both support server
search/sort/pagination, validated add/edit forms, details, status confirmations,
loading, empty/error states and success notices. Medicines also offer category,
stock and expiry filters. No hardcoded catalog records are displayed.

`pages/CatalogPage.jsx` shares catalog UI between medicines and categories;
`Medicine.jsx` uses it instead of the prototype `Table`. `components/Modal.jsx`
uses a native dialog for focus handling. The existing `Table` is now a presentational component shared by Suppliers and
Purchases. API integration is in `services/catalogService.js`.

Stock is read-only in the catalog and starts at zero. Authorized receiving staff
add stock through Purchases; batches, expiry and supplier names then appear in
medicine details. The dashboard
shows real medicine/stock counts and permitted registration activity. Other
operational figures explicitly remain unavailable rather than fabricated.

Production build and real-backend browser flows were checked: registration,
login, duplicate email guidance, medicine/category persistence, role restrictions,
archive safeguards, mobile forms and dashboard counts.


## Suppliers and Purchases

The existing `Suplier.jsx` page now manages real suppliers, including add/edit,
status filters, deactivation, contact details, purchase totals, balances and
supplied medicines. No sample suppliers or balances are shown.

`Purchases.jsx` lists completed purchases with search/payment/date filters and
pagination. `PurchaseForm.jsx` supports supplier/medicine search, multiple batch
lines, pricing, expiry, quantities, amount paid and notes. Confirmation completes
the receipt through the backend transaction; the returned detail displays the
items and recorded stock movements. Completed receipts have no edit/delete action.
Forms use the existing native-dialog component and shared API helper.

Outstanding balances reflect payments recorded when stock was received; later
payment recording and returns/adjustments are not available yet. Supplier/purchase
editing remains restricted to admin/storekeeper permissions. Changing category
browsing access does not grant purchasing privileges or change account roles.
