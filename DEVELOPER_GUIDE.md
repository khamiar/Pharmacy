# Pharmacy Management System: Developer Architecture & Workflow Guide

A comprehensive architectural reference, implementation breakdown, and developer onboarding manual for the Pharmacy Management System.

---

## Table of Contents
1. [Executive Summary & System Architecture](#1-executive-summary--system-architecture)
2. [Technology Stack & Directory Structure](#2-technology-stack--directory-structure)
3. [Core Architectural Patterns & Design Invariants](#3-core-architectural-patterns--design-invariants)
   - [3.1 RBAC & Real-Time Token Revalidation](#31-rbac--real-time-token-revalidation)
   - [3.2 Batch-Driven Inventory & FEFO Depletion](#32-batch-driven-inventory--fefo-depletion)
   - [3.3 Concurrency Control & Row Locking](#33-concurrency-control--row-locking)
   - [3.4 Idempotent Transactions](#34-idempotent-transactions)
   - [3.5 Currency Precision & Financial Integrity](#35-currency-precision--financial-integrity)
4. [Frontend Architecture (`pharmacy-app`)](#4-frontend-architecture-pharmacy-app)
   - [4.1 Routes & Access Control](#41-routes--access-control)
   - [4.2 Authentication & Session Flow](#42-authentication--session-flow)
   - [4.3 State Management & Data Fetching Patterns](#43-state-management--data-fetching-patterns)
   - [4.4 UI & Reusable Component Hierarchy](#44-ui--reusable-component-hierarchy)
5. [Backend Architecture (`pharmacy-backend`)](#5-backend-architecture-pharmacy-backend)
   - [5.1 Request Lifecycle & Middleware Chain](#51-request-lifecycle--middleware-chain)
   - [5.2 Modular Domain Architecture](#52-modular-domain-architecture)
   - [5.3 Database Schema & Migration Pipeline](#53-database-schema--migration-pipeline)
6. [Developer Workflow & Operations Manual](#6-developer-workflow--operations-manual)
   - [6.1 Environment Setup & Prerequisites](#61-environment-setup--prerequisites)
   - [6.2 Database Initialization & Running Migrations](#62-database-initialization--running-migrations)
   - [6.3 Bootstrapping the Primary Administrator](#63-bootstrapping-the-primary-administrator)
   - [6.4 Launching Development Servers](#64-launching-development-servers)
   - [6.5 Testing & Verification Suite](#65-testing--verification-suite)
7. [Step-by-Step: Implementing a New Feature](#7-step-by-step-implementing-a-new-feature)

---

## 1. Executive Summary & System Architecture

The Pharmacy Management System is a full-stack, enterprise-grade application engineered to streamline pharmacy operations. It handles catalog administration, purchasing, batch inventory, POS sales, prescription fulfillment, customer records, staff approvals, notifications, audit logging, and financial reporting.

### High-Level System Flow

```
+-----------------------------------------------------------------------+
|                              FRONTEND                                 |
|                       React 18 + Vite (SPA)                           |
|                                                                       |
|   +-------------------+  +--------------------+  +----------------+   |
|   |  Landing / Auth   |  |   Protected Route  |  |  Layout & Nav  |   |
|   +---------+---------+  +---------+----------+  +-------+--------+   |
|             |                      |                     |            |
|             v                      v                     v            |
|       [AuthContext]       [ModulePermission]     [Pages & Views]      |
|             \                      |                    /             |
|              +---------------------+-------------------+              |
|                                    |                                  |
|                       [catalogService / Axios]                        |
+------------------------------------+----------------------------------+
                                     |  HTTP REST (JWT Bearer)
                                     v
+-----------------------------------------------------------------------+
|                              BACKEND                                  |
|                         Express.js + Node.js                          |
|                                                                       |
|   [server.js] ---> [authMiddleware] ---> [authorize(perm)]            |
|                           |                                           |
|                           v                                           |
|     +---------------------+---------------------+                     |
|     |                     |                     |                     |
|     v                     v                     v                     |
| [Catalog / Stock]     [Purchasing]         [Sales / POS]              |
|     |                     |                     |                     |
|     +---------------------+---------------------+                     |
|                           |                                           |
|                           v                                           |
|             [Services (saleService, etc.)]                            |
|                           |                                           |
|                           v                                           |
|              [utilities/transaction.js]                               |
+---------------------------+-------------------------------------------+
                            |  MySQL2 Connection Pool
                            v
+-----------------------------------------------------------------------+
|                             DATABASE                                  |
|                       MySQL 8 (InnoDB Engine)                         |
|                                                                       |
|  - users & user_access             - purchases & purchase_items       |
|  - categories & medicines          - sales & sale_items               |
|  - medicine_batches & movements    - customers & prescriptions        |
|  - audit_logs                      - pharmacy_preferences & settings  |
+-----------------------------------------------------------------------+
```

---

## 2. Technology Stack & Directory Structure

### 2.1 Workspace Overview

```
Pharmacy/
├── DEVELOPER_GUIDE.md             # This document
├── pharmacy-app/                  # Client-side Single Page Application (SPA)
│   ├── src/
│   │   ├── assets/                # Static brand graphics and product imagery
│   │   ├── components/            # Reusable UI widgets (Modal, Table, RecordLookup, StatCard)
│   │   ├── config/                # Environment API endpoint and navigation routes
│   │   ├── context/               # React Contexts (AuthContext for user sessions)
│   │   ├── hooks/                 # Custom React hooks (usePagedData)
│   │   ├── pages/                 # Full-page views for modules (Sales, Users, Medicine, etc.)
│   │   ├── services/              # API wrappers using Axios (authServices, catalogService)
│   │   ├── App.jsx                # Route declarations & permission gating
│   │   ├── main.jsx               # React DOM bootstrap
│   │   └── index.css              # Custom layout, sidebar, and utility classes
│   ├── index.html                 # Single page template
│   ├── package.json               # Dependencies: React 18, React Router v6, Bootstrap 5, Axios
│   └── vite.config.js             # Vite build settings & plugins
│
└── pharmacy-backend/              # Server-side RESTful API
    ├── config/                    # MySQL connection pool (db.js) & RBAC rules (permissions.js)
    ├── controllers/               # Express request/response endpoints
    ├── middleware/                # JWT verification (authMiddleware) & errorHandler
    ├── migrations/                # Versioned, idempotent SQL scripts (002-008)
    ├── models/                    # SQL query abstractions & DB entity models
    ├── routes/                    # Route routing files
    ├── scripts/                   # CLI maintenance tools (migrate.js, bootstrap-admin.js)
    ├── services/                  # Core domain logic, lock sequencing & transactions
    ├── tests/                     # Integration and regression test suites
    ├── utilities/                 # Transaction execution wrapper (transaction.js)
    ├── validators/                # Input validation and business guardrails
    ├── package.json               # Dependencies: Express, mysql2, bcryptjs, jsonwebtoken, sharp, pdfkit
    └── server.js                  # Application entry point & route registration
```

---

## 3. Core Architectural Patterns & Design Invariants

### 3.1 RBAC & Real-Time Token Revalidation

* **Supported Roles**:
  * `admin`: Complete administrative control, user approvals, reporting, pharmacy settings, and audit trails.
  * `pharmacist`: Medicines, categories, inventory stock, prescriptions, and sales dispensing.
  * `staff`: Catalog view/edit, sales checkout, and customer management.
  * Supported role mappings exist for `cashier`, `store_keeper`, and `pharmacy_assistant`.
* **Zero Trust Token Revalidation**:
  Tokens are verified cryptographically via JWT, but [`authMiddleware.js`](file:///home/khamiar/Documents/REAL_PROJECTS/Pharmacy/pharmacy-backend/middleware/authMiddleware.js) also queries the database on **every single request** to verify the user account still exists and retains `status = 'ACTIVE'`. If an administrator deactivates, suspends, or demotes a user, their access terminates immediately.
* **Staff Approval Pipeline**:
  Public registration `/api/auth/register` creates an inactive account with `status = 'PENDING'`. No token is returned upon registration. An existing administrator must approve the account via `/users`.

### 3.2 Batch-Driven Inventory & FEFO Depletion

* **No Synthetic Stock Counters**: Stock is never stored as an arbitrary integer on medicine master records. Stock is strictly the sum of active, unexpired `medicine_batches`.
* **FEFO (First-Expired, First-Out)**:
  During POS checkout in [`saleService.js`](file:///home/khamiar/Documents/REAL_PROJECTS/Pharmacy/pharmacy-backend/services/saleService.js), batches are retrieved and sorted using `ORDER BY expiry_date, id FOR UPDATE`. Batches with the earliest expiration dates are depleted first. Expired batches are automatically bypassed.
* **Audit Trail via Stock Movements**:
  Every stock increase or decrease writes an immutable entry into `stock_movements` recording the movement type (`PURCHASE`, `SALE`, `OPENING_STOCK`, `ADJUSTMENT`), previous quantity, new quantity, and the responsible `user_id`.

### 3.3 Concurrency Control & Row Locking

* **Deadlock Prevention Lock Sequencing**:
  When an operation affects multiple database rows (e.g., selling or receiving multiple medicines), rows are sorted and locked in a consistent deterministic order (e.g., ascending medicine IDs) using `SELECT ... FOR UPDATE`.
* **Optimistic Concurrency Control**:
  Entities subject to concurrent edits (`medicines`, `categories`, `suppliers`, `users`, `settings`, `prescriptions`) maintain an integer `version` column. Mutations enforce `WHERE id = ? AND version = ?`. If a concurrent change occurred, the API rejects the update with `409 Conflict`.

### 3.4 Idempotent Transactions

* All high-impact financial operations (`POST /api/sales`, `POST /api/purchases`, `POST /api/medicines/opening-stock`) require a client-generated UUID `request_key`.
* The server calculates a SHA-256 hash of the request payload and checks for an existing record. If a client retries due to a network timeout or dropped connection, the backend re-returns the existing saved receipt without charging the customer or reducing inventory a second time.

### 3.5 Currency Precision & Financial Integrity

* Database monetary columns use MySQL `DECIMAL(12,2)` or `DECIMAL(14,2)`.
* In JavaScript/Node.js, intermediate arithmetic is performed using integer minor units (cents) via `BigInt` to avoid standard IEEE-754 floating-point inaccuracies.

---

## 4. Frontend Architecture (`pharmacy-app`)

### 4.1 Routes & Access Control

Routing is centralized in `src/App.jsx`.

| Route | View Component | Protected? | Required Permission |
| :--- | :--- | :---: | :--- |
| `/` | `LandingPage.jsx` | No | Public |
| `/login` | `Login.jsx` | No | Public |
| `/register` | `Register.jsx` | No | Public |
| `/dashboard` | `Dashboard.jsx` | Yes | Authenticated session |
| `/medicines` | `Medicine.jsx` | Yes | `medicines` |
| `/categories` | `CatalogPage.jsx` | Yes | `categories` |
| `/suppliers` | `Suplier.jsx` | Yes | `suppliers` |
| `/purchases` | `Purchases.jsx` | Yes | `purchases` |
| `/sales` | `Sales.jsx` | Yes | `sales` |
| `/reports` | `Reports.jsx` | Yes | `reports` (Admin) |
| `/customers` | `Customers.jsx` | Yes | `customers` |
| `/prescriptions`| `Prescriptions.jsx` | Yes | `prescriptions` |
| `/notifications`| `Notifications.jsx`| Yes | `notifications` |
| `/settings` | `Settings.jsx` | Yes | `settings` (Admin) |
| `/stock` | `Stock.jsx` | Yes | `stock` |
| `/users` | `Users.jsx` | Yes | `users` (Admin) |

### 4.2 Authentication & Session Flow

1. **Sign In**: `Login.jsx` calls `loginUser(credentials)` from `src/services/authServices.js`. On success, `token` and `user` profile are saved in `localStorage`.
2. **Session Verification**: When accessing any private URL, `ProtectedRoute.jsx` executes `getProfile(token)` (`GET /api/auth/me`).
3. **Permission Hydration**: The server responds with `{ user, permissions }`. These permissions are passed down through `AuthContext.Provider`.
4. **Tab Synchronization**: `ProtectedRoute.jsx` listens to the browser `window.storage` event. If a user logs out in one browser tab, all other tabs synchronize immediately.

### 4.3 State Management & Data Fetching Patterns

* **`usePagedData(resource, filters, refresh)`**:
  Custom hook located in `src/hooks/usePagedData.js`. Provides debounced queries (200ms), handles server pagination, and uses `AbortController` to cancel in-flight HTTP requests when filter parameters change.
* **`catalogRequest(resource, options)`**:
  Generic HTTP request helper in `src/services/catalogService.js`. Automatically attaches the JWT `Authorization: Bearer <token>` header, handles REST URLs, and parses response structures.

### 4.4 UI & Reusable Component Hierarchy

* **`Layout.jsx`**: Shell container providing top navigation bar (`Header.jsx`), responsive collapsible navigation drawer (`SideBar.jsx`), and content `<Outlet />`.
* **`Modal.jsx`**: Native `<dialog>` modal wrapper handling backdrop clicks, ESC key dismissal, focus trapping, and clean rendering.
* **`Table.jsx` & `Pagination.jsx`**: Reusable data grid components supporting sort indicators, empty states, and pagination controls.
* **`RecordLookup.jsx`**: Asynchronous autocomplete search box used for linking customers and prescriptions inside POS checkout.

---

## 5. Backend Architecture (`pharmacy-backend`)

### 5.1 Request Lifecycle & Middleware Chain

```
HTTP Request
     |
     v
[express.json() & cors()]
     |
     v
[authMiddleware.js]
  ├── Validates JWT Bearer format
  ├── Verifies signature using process.env.JWT_SECRET
  ├── Executes UserModel.findById(decoded.id)
  └── Enforces account status === 'ACTIVE'
     |
     v
[authorize(permission)]
  └── Checks permissionsFor(req.user.role).includes(permission)
     |
     v
[Controller Method (e.g. salesController.create)]
     |
     v
[Service Transaction (e.g. saleService.complete)]
  ├── Acquires DB connection from pool
  ├── Starts MySQL transaction (BEGIN)
  ├── Locks rows FOR UPDATE
  ├── Applies business validation & FEFO deductions
  ├── Commits transaction (COMMIT)
  └── Injects audit_logs entry
     |
     v
[HTTP Response: 200 / 201] (or catches error -> errorHandler.js)
```

### 5.2 Modular Domain Architecture

* **Authentication (`routes/authRoutes.js`, `controllers/authController.js`)**:
  Manages login, registration, and `/me` self-introspection.
* **Catalog & Inventory (`routes/catalogRoutes.js`, `services/catalogService.js`, `models/Catalog.js`)**:
  Manages medicines and categories with soft archiving (`status = 'ARCHIVED'`).
* **Purchasing (`routes/purchaseRoutes.js`, `services/purchaseService.js`)**:
  Handles vendor purchase orders, inventory intake, batch creation, and price updates.
* **Sales & POS (`routes/salesRoutes.js`, `services/saleService.js`)**:
  Manages checkout, invoice number generation, payment methods (Cash, Card, Mobile Money), customer linking, and prescription dispensing.
* **Operations (`routes/operationsRoutes.js`, `controllers/operationsController.js`)**:
  Consolidated routing for Customers, Prescriptions, Pharmacy Settings, In-App Notifications, and Audit Logs.
* **Media Handling (`routes/mediaRoutes.js`, `models/Media.js`)**:
  Handles logo and medicine image uploads, processing raw buffers through `sharp` and persisting images in `image_uploads`.

### 5.3 Database Schema & Migration Pipeline

Migrations are managed via the custom runner `scripts/migrate.js`. The runner obtains an advisory lock (`SELECT GET_LOCK('pharmacy_catalog_migration', 15)`) to guarantee atomic execution across clustered instances.

| Migration Script | Description |
| :--- | :--- |
| `models/schema.sql` | Base users table (`users`) with roles `admin`, `pharmacist`, `staff`. |
| `002_catalog.sql` | `categories`, `medicines`, and initial indexing. |
| `003_purchasing.sql`| `suppliers`, `purchases`, `purchase_items`, `medicine_batches`, `stock_movements`. |
| `004_staff_approval.sql` | `user_access` approval states, `administration_lock`, and `audit_logs`. |
| `005_opening_stock.sql` | Initial opening stock intake tracking and idempotency records. |
| `006_sales.sql` | `sales`, `sale_items`, `sale_details` with financial constraints. |
| `007_operations.sql` | `customers`, `prescriptions`, `prescription_items`. |
| `008_media_alerts.sql` | `image_uploads`, `medicine_images`, and `pharmacy_preferences`. |

---

## 6. Developer Workflow & Operations Manual

### 6.1 Environment Setup & Prerequisites

* **Runtime**: Node.js 18+ and npm 9+
* **Database**: MySQL 8.0+

#### Configure Backend `.env` (`pharmacy-backend/.env`):
```env
PORT=5000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=pharmacy_system

JWT_SECRET=your_super_secret_64_character_random_string
JWT_EXPIRES_IN=7d

CLIENT_URL=http://localhost:5173
```

#### Configure Frontend `.env` (`pharmacy-app/.env` - optional):
```env
VITE_API_BASE_URL=http://localhost:5000/api
```

---

### 6.2 Database Initialization & Running Migrations

1. Ensure the MySQL database exists:
   ```bash
   mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS pharmacy_system;"
   ```

2. If starting completely fresh, load the base schema:
   ```bash
   cd pharmacy-backend
   mysql -u root -p pharmacy_system < models/schema.sql
   ```

3. Run migrations:
   ```bash
   npm run migrate
   ```
   *Migrations are idempotent and can be safely re-run.*

---

### 6.3 Bootstrapping the Primary Administrator

Because public registration defaults to `PENDING` staff status, the very first administrator must be explicitly promoted via the server CLI:

1. Register an account through the UI (`/register`) or insert a user record.
2. In `pharmacy-backend/`, run:
   ```bash
   npm run bootstrap-admin -- <user-id>
   ```
   *(e.g., `npm run bootstrap-admin -- 1`)*
3. The targeted user is granted `role = 'admin'` and `status = 'ACTIVE'`.

---

### 6.4 Launching Development Servers

Run the backend and frontend in separate terminals:

#### Terminal 1 (Backend):
```bash
cd pharmacy-backend
npm run dev
# Starts nodemon watching server.js on http://localhost:5000
```

#### Terminal 2 (Frontend):
```bash
cd pharmacy-app
npm run dev
# Starts Vite local dev server on http://localhost:5173
```

---

### 6.5 Testing & Verification Suite

#### Run Backend Regression Suite:
```bash
cd pharmacy-backend
npm test
```

#### Run Database Integration Tests:
> Requires a MySQL user with permission to create/drop temporary `pharmacy_test_*` databases.
```bash
cd pharmacy-backend
RUN_DB_TESTS=1 npm test
```

#### Validate Frontend Build:
```bash
cd pharmacy-app
npm run build
```

---

## 7. Step-by-Step: Implementing a New Feature

Follow this standard pattern whenever building a new feature (e.g., an `expenses` module):

```
1. SQL Migration      ──>  pharmacy-backend/migrations/009_expenses.sql
2. Role Permissions   ──>  pharmacy-backend/config/permissions.js
3. Model              ──>  pharmacy-backend/models/Expense.js
4. Service / Logic    ──>  pharmacy-backend/services/expenseService.js (with transaction if needed)
5. Controller         ──>  pharmacy-backend/controllers/expenseController.js
6. Express Route      ──>  pharmacy-backend/routes/expenseRoutes.js
7. Server Mount       ──>  pharmacy-backend/server.js
8. Nav Registration   ──>  pharmacy-app/src/config/navigation.js
9. Page View          ──>  pharmacy-app/src/pages/Expenses.jsx (using usePagedData & Table)
10. App Router        ──>  pharmacy-app/src/App.jsx (wrapped in <ModuleAccess permission="expenses">)
```

### Golden Rules for Contributions
1. **Never mutate stock directly**: All stock adjustments must pass through batch creations or sales deductions with recorded `stock_movements`.
2. **Never expose passwords**: Always strip `password` hashes before returning user payloads.
3. **Enforce optimistic locking**: Require and increment `version` on resource edits to prevent concurrent overwrite collisions.
4. **Preserve audit history**: Record sensitive state changes (`APPROVED_USER`, `COMPLETED_SALE`, `ADJUSTED_STOCK`) in `audit_logs`.

