# Pharmacy System frontend

React 18 single-page app built with Vite, React Router, Axios, Bootstrap and
React Icons. It uses the Django API in `../pharmacy-djangoAPI`; the Node/Express
backend is legacy and is not required to serve this frontend.

## Run locally

```bash
npm install
npm run dev
```

By default, the frontend calls `http://127.0.0.1:5000/api`. Set
`VITE_API_BASE_URL` before starting/building if Django runs elsewhere. Never
put passwords, Django secrets, or database credentials in frontend environment
variables; Vite variables are included in browser code.

## Application

Public pages: `/`, `/login`, `/register`. Authenticated modules include
dashboard, medicines, categories, suppliers, purchases, stock, sales, customers,
prescriptions, users/staff, reports, notifications, and settings. The backend
returns permissions for the active account and enforces them for API requests.

Key data-entry flow: set up categories and medicine records, add suppliers,
record purchases to receive stock by batch and expiry, then sell through POS.
Stock is not created by adding a medicine and the stock page does not provide
manual adjustment. See [`../SYSTEM_OVERVIEW.md`](../SYSTEM_OVERVIEW.md) for all
forms, workflows, data models, permissions, and backend setup.

## Build

```bash
npm run build
```
