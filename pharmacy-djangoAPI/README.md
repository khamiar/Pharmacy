# Pharmacy Django API

This is the active backend for the React frontend, replacing the legacy Express
API. It keeps the frontend's `/api/...` URL structure and uses PostgreSQL by
default. The default database name is `pharmacy_system`. See the repository's
[system overview](../SYSTEM_OVERVIEW.md) for the application flows and data model.

## Local setup

1. Install PostgreSQL and create the database and application role:

   ```sql
   CREATE ROLE pharmacy_app LOGIN PASSWORD 'choose-a-strong-password';
   CREATE DATABASE pharmacy_system OWNER pharmacy_app;
   ```

2. From this directory, create and activate a virtual environment, then install
   dependencies:

   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

3. Copy `.env.example` to `.env`. Set `DB_USER=pharmacy_app`,
   `DB_PASSWORD` to the password from step 1, and replace
   `DJANGO_SECRET_KEY` with a private random value (for example, generate one
   with `openssl rand -hex 32`).

4. Create Django's tables and run the API on the port expected by the frontend:

   ```bash
   python manage.py migrate
   python manage.py runserver 127.0.0.1:5000
   ```

5. In another terminal, start the frontend:

   ```bash
   cd ../pharmacy-app
   npm install
   npm run dev
   ```

   The frontend connects to `http://127.0.0.1:5000/api` by default. To use a
   different API host, set `VITE_API_BASE_URL` in the frontend environment.

6. Create the first super administrator directly from the Django project. This
   command securely prompts for account details and a password; it does not
   echo the password and refuses to create another active administrator:

   ```bash
   python manage.py create_initial_admin
   ```

   Existing registrations can instead be promoted with
   `python manage.py bootstrap_admin <account-id>`. This preserves that account's
   password. Django's default table names are used by its migrations.

The Django migrations create a new schema. They do not import records from the
Express/MySQL database. Back up or export any data that must be retained before
switching backends. Do not run Express and Django on port 5000 simultaneously.

Set `DB_ENGINE=sqlite` only when intentionally running local tests without
PostgreSQL:

```bash
DB_ENGINE=sqlite python manage.py test pharmacy_api
```
