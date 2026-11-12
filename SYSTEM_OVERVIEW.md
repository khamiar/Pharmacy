# Pharmacy System — muhtasari wa mfumo wa sasa

Huu ndio mwongozo wa mfumo unaotumika sasa: React frontend, Django REST API,
na PostgreSQL. `DEVELOPER_GUIDE.md` ina maelezo mengi ya awali ya Express/MySQL;
sehemu hizo ni za kihistoria, si mwongozo wa kuanzisha backend ya sasa.

## 1. Muundo na mawasiliano

```text
Browser
  └── React 18 + Vite (`pharmacy-app/`)
        └── Axios / HTTP + Bearer token
              └── Django API (`pharmacy-djangoAPI/`, port 5000)
                    └── Django ORM + migrations
                          └── PostgreSQL (`pharmacy_system`)
```

- Frontend ni SPA; ukurasa na fomu ziko `pharmacy-app/src/pages/` na
  `pharmacy-app/src/components/`.
- `pharmacy-app/src/config/api.js` ina API base URL. Default ni
  `http://127.0.0.1:5000/api`; `VITE_API_BASE_URL` inaweza kubadilisha URL.
- API hujibu chini ya `/api/...`. Django huweka routes kupitia
  `pharmacy-djangoAPI/config/urls.py` na `pharmacy_api/urls.py`; dispatch ya
  API iko kwenye `pharmacy_api/views.py` na `pharmacy_api/operations.py`.
- Django hutumia PostgreSQL kwa default (`DB_NAME=pharmacy_system`). `.env`
  ndani ya `pharmacy-djangoAPI/` ina mipangilio ya mashine husika; usiweke
  siri kwenye Git, frontend `.env`, au nyaraka.
- `CLIENT_URL` kwenye Django `.env` lazima iwe origin ya Vite, kwa mfano
  `http://localhost:5173`, ili browser iruhusiwe kuwasiliana na API.
- PostgreSQL ndiyo hifadhi ya data ya mfumo. `DB_ENGINE=sqlite` ni kwa majaribio
  tu, si database ya matumizi ya kawaida.

## 2. Kurasa na data entry

| Eneo / URL | Data inayoingizwa au kuonyeshwa | Mtiririko muhimu |
|---|---|---|
| `/`, `/login`, `/register` | Jina, email, simu na nenosiri la akaunti | Usajili mpya unasubiri idhini ya admin; hauwezi kuingia kabla ya kuidhinishwa. |
| `/dashboard` | Hakuna data ya msingi inayoingizwa | Inaonyesha takwimu kulingana na ruhusa za mtumiaji; takwimu zisizopatikana hazibuniwi. |
| `/categories` | Jina, maelezo | Hutengeneza makundi ya bidhaa; bidhaa zinaweza kuhusishwa na kundi. |
| `/medicines` | Jina, generic/brand, kundi, aina, barcode, mtengenezaji, maelezo, bei ya ununuzi/kuuza, kiwango cha chini, mahali pa kuhifadhi na picha | Kuongeza dawa hakutengenezi stock. Stock ya mwanzo ni sifuri. |
| `/suppliers` | Jina, kampuni, simu, email, anwani, namba ya usajili, contact person, maelezo | Supplier anaweza kuhaririwa au kuzimwa; historia ya manunuzi/deni huonekana. |
| `/purchases` | Supplier, tarehe na invoice ya supplier, malipo, maelezo; kila bidhaa/batch: dawa, batch number, quantity, expiry, purchase price, selling price | Kuthibitisha purchase huongeza batch na stock mara moja, kisha huandika stock movement. Purchase iliyokamilika haiwezi kuhaririwa/kufutwa. |
| `/stock` | Hakuna stock adjustment form ya kawaida kwa sasa | Ni usomaji wa stock/batches/movements, pamoja na search na filters. Stock hubadilika kupitia purchase na sale. |
| `/sales` | Cart ya dawa/quantity, customer hiari, discount, kiasi kilicholipwa na njia ya malipo | Sale hukagua stock, hupunguza batch, huhifadhi receipt na movement; invoice inaweza kupakuliwa kama PDF. |
| `/customers` | Jina, simu, email, anwani, tarehe ya kuzaliwa na maelezo | Rekodi za mauzo zilizounganishwa na customer huonekana kwenye historia yake. |
| `/prescriptions` | Customer, daktari, tarehe, maelezo; kwa kila dawa: dosage, frequency, duration, quantity, instructions | Pharmacist/admin huingiza prescription; ku-dispense hufanyika kupitia POS, yote au sehemu. |
| `/users` | Orodha ya akaunti, approval status na role | Admin anaidhinisha/kukataa usajili, kubadilisha role na kusimamisha/kuwasha access. |
| `/reports` | Vichujio vya tarehe/aina | Ripoti za transaction na inventory; export ya CSV hufuata data iliyoonyeshwa. Inventory ni snapshot ya sasa, si historia ya stock ya zamani. |
| `/notifications` | Hakuna fomu ya kuunda alert | Maonyo ya stock/expiry na matukio; kila mtumiaji ana hali yake ya kusoma. |
| `/settings` | Jina/anwani/mawasiliano ya pharmacy, usajili, logo, TZS, vizingiti vya stock/expiry, invoice na ratiba za alerts | Hifadhi wasifu unaotumika kwenye invoice na alerts. Mabadiliko muhimu huandikwa audit log. |

Picha za logo na dawa hupakiwa kupitia API ya media. Upload inaruhusu JPEG,
PNG au WebP hadi 2 MB. Frontend hutumia APIs halisi kwa modules zilizo hapo
juu; haipaswi kuonyesha sample catalog kama data ya database.

## 3. Mlolongo wa kazi za pharmacy

1. **Akaunti ya kwanza:** endesha `create_initial_admin` kwenye Django. Baada
   ya hapo, watumiaji wengine hujisajili na kusubiri idhini.
2. **Usanidi:** admin huweka taarifa za pharmacy na mipangilio ya invoice.
3. **Catalog:** tengeneza categories kisha medicine records. Kuweka medicine
   peke yake hakuongezi stock.
4. **Kupokea stock:** sajili supplier, kisha tengeneza purchase yenye batch
   number, quantity, expiry na bei. Kuthibitisha purchase huongeza stock,
   huandika movement na huhesabu kiasi kilicholipwa/deni la supplier.
5. **Kuuza:** chagua dawa yenye stock inayotumika, quantities, malipo na
   customer ikiwa anajulikana. Mfumo hutengeneza invoice, hupunguza batch na
   kurekodi movement. Batch zilizo karibu ku-expire hutumika kwanza; zilizokwisha
   muda hazitumiki.
6. **Prescription:** rekodi prescription kwa customer. Dispensing huunganishwa
   na sale; kiasi kilichotolewa husasisha prescription kuwa pending,
   partially-dispensed au dispensed.
7. **Ufuatiliaji:** admin/staff husimamia approvals, reports, notifications,
   audit entries na profile kulingana na ruhusa zao.

## 4. Data model ya Django

Schema ipo katika `pharmacy-djangoAPI/pharmacy_api/models.py`; migration ya
kwanza ni `pharmacy-djangoAPI/pharmacy_api/migrations/0001_initial.py`.

| Kundi | Models | Uhusiano / matumizi |
|---|---|---|
| Watumiaji na audit | `PharmacyUser`, `UserAccess`, `AdministrationLock`, `AuditLog` | Account, hali ya approval, kufunga uundaji wa admin wa kwanza na kumbukumbu za vitendo. |
| Catalog na stock | `Category`, `Medicine`, `MedicineBatch`, `MedicineImage`, `ImageUpload`, `MedicineCreationRequest`, `StockMovement` | Medicine ina category (hiari), batches nyingi na movement history; image huunganishwa na medicine au logo. |
| Ugavi | `Supplier`, `Purchase`, `PurchaseItem` | Purchase huhifadhi supplier na line items/batches zilizopokelewa. |
| Mauzo | `Sale`, `SaleItem`, `SaleDetail` | Sale huhifadhi invoice/line items; detail huunganisha customer, prescription na snapshot ya profile. |
| Wateja na dawa za daktari | `Customer`, `Prescription`, `PrescriptionItem` | Customer ana prescriptions/mauzo; prescription item tracks quantity prescribed and dispensed. |
| Mipangilio na alerts | `PharmacySettings`, `PharmacyPreference`, `NotificationRead` | Wasifu, invoice/alert preferences na hali ya kusoma notification kwa kila mtumiaji. |

Fedha huhifadhiwa kama decimal, currency ya mfumo ni TZS. Mahusiano mengi
hutumia `PROTECT` ili kuzuia kufuta rekodi zinazorejelewa na historia ya
manunuzi/mauzo.

## 5. API na ruhusa

Mifano ya endpoints kuu (zinahitaji `Authorization: Bearer <token>` isipokuwa
register/login na public media):

| API group | Endpoints za kawaida |
|---|---|
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` |
| Dashboard | `GET /api/dashboard` |
| Catalog | `GET/POST /api/medicines`, `GET/PUT /api/medicines/{id}`, `GET/POST /api/categories`; catalog options/details/status endpoints pia zipo. |
| Suppliers / purchases | `/api/suppliers`, `/api/purchases`, `/api/purchases/medicines` |
| Stock | `/api/stock`, `/api/stock/options`, `/api/stock/movements`, `/api/stock/{medicine_id}/batches` |
| POS / sales | `/api/sales`, `/api/sales/medicines`, `/api/sales/{id}`, `/api/sales/{id}/invoice` |
| Customers / prescriptions | `/api/customers`, `/api/customers/{id}/history`, `/api/prescriptions` |
| Admin / system | `/api/users`, `/api/settings`, `/api/notifications`, `/api/audit`, `/api/reports`, `/api/media` |

Roles zinazoainishwa na model ya sasa ni `admin`, `pharmacist`, na `staff`.
Admin ana access pana ya modules zote. Pharmacist ana catalog, customers,
prescriptions, sales, stock na notifications. Staff wa kawaida ana medicines,
categories za kusoma, sales, customers na notifications; ruhusa za kuandika
zinatofautiana kwa action. Backend hukagua ruhusa yenyewe—kuficha menu kwenye
frontend pekee si ulinzi.

Majibu mengi ya API yana muundo `{ "data": ... }`; auth hutumia `user`,
`token` na `permissions`. Orodha zina search/pagination. Validation errors
hurejeshwa kwa HTTP status na ujumbe badala ya kufanikiwa kimyakimya.

## 6. Kuanzisha kwenye kompyuta

### Django API

```bash
cd pharmacy-djangoAPI
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Weka DB_USER/DB_PASSWORD/DB_HOST na DJANGO_SECRET_KEY kwenye .env ya ndani.
python manage.py migrate
python manage.py create_initial_admin
python manage.py runserver 127.0.0.1:5000
```

`.env` ni local-only; `.env.example` ina placeholders tu. `create_initial_admin`
inauliza jina, email, simu, na password kwa prompt iliyofichwa. Inaunda admin
ACTIVE wa kwanza na hukataa kama tayari kuna admin ACTIVE.

### React frontend

Kwenye terminal nyingine:

```bash
cd pharmacy-app
npm install
npm run dev
```

Vite itaonyesha URL ya frontend (kwa kawaida `http://localhost:5173`). Hakikisha
origin hiyo inalingana na `CLIENT_URL` ya Django. `npm run build` hutengeneza
production bundle.

### Checks

```bash
cd pharmacy-djangoAPI
venv/bin/python manage.py check
DB_ENGINE=sqlite venv/bin/python manage.py test pharmacy_api
venv/bin/python manage.py makemigrations --check --dry-run
```

Test suite hutumia SQLite kwa makusudi ili isiandike data kwenye PostgreSQL ya
maendeleo. Kabla ya production, tumia PostgreSQL yenye backup, `DEBUG=false`,
`DJANGO_SECRET_KEY` ya siri, na `DJANGO_ALLOWED_HOSTS` inayolingana na host.

## 7. Django dhidi ya Node/Express

- `pharmacy-backend/` ni backend ya zamani ya Node.js/Express inayotumia
  MySQL. Frontend ya sasa imewekwa kuzungumza na Django; usiendeshe backend
  zote mbili kwenye port 5000.
- Node/Express backend **haihitajiki** kuendesha API ya mfumo wa sasa. Django
  ndiyo ina logic, API na schema ya PostgreSQL.
- Node.js/npm bado inahitajika kwa frontend ya React/Vite (`npm install`,
  `npm run dev`, `npm run build`). Hii haimaanishi kuwa Express backend bado
  inahitajika.
- Usifute `pharmacy-backend/` mpaka uhakikishe umehifadhi/export data yoyote ya
  zamani ya MySQL na huna tena haja ya legacy source, migrations au tests.
  Django migrations zimeunda schema mpya; hazija-import data ya Express/MySQL.
  Ukishathibitisha backup na hakuna matumizi ya legacy, unaweza kuondoa
  **folder ya Express backend pekee**. Usifute `pharmacy-app/` au Node/npm
  installation inayohitajika kuendesha frontend.
