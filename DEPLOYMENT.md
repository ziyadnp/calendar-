# Deployment Guide — `calendar-app.mydomain.com`

Production setup on an Ubuntu VPS that already has **Caddy**, **MySQL** and **Node.js** installed.

## Architecture

```
Browser ──HTTPS──▶ Caddy (calendar-app.mydomain.com, auto TLS)
                    ├── /api/*  ──▶ reverse_proxy 127.0.0.1:5001  (Express backend, systemd service)
                    └── /*      ──▶ static files from frontend/dist (React SPA, falls back to index.html)
                                         │
                    Express ──▶ MySQL (markaz_calendar, dedicated user)
```

The frontend calls the API with relative URLs (`/api/...`), so frontend and backend share one domain and no CORS setup is needed.

| Item | Value used in this guide |
|---|---|
| Domain | `calendar-app.mydomain.com` |
| App directory | `/var/www/calendar-app` |
| Linux user running the backend | `calendar` |
| Backend port (internal only) | `5001` |
| Database / DB user | `markaz_calendar` / `markaz_app` |

Replace `mydomain.com` and all passwords with your own values.

---

## 1. DNS

At your DNS provider, add a record pointing the subdomain to the VPS:

| Type | Name | Value |
|---|---|---|
| `A` | `calendar-app` | `<your VPS IPv4>` |
| `AAAA` (optional) | `calendar-app` | `<your VPS IPv6>` |

Check that it resolves before configuring Caddy (Caddy needs this to obtain the TLS certificate):

```bash
dig +short calendar-app.mydomain.com
```

---

## 2. Check prerequisites on the VPS

```bash
node -v        # v18 or newer (v20/v22 LTS recommended)
npm -v
mysql --version
caddy version
```

Make sure only SSH and web traffic are open, so port 5001 is never reachable from the internet (the backend listens on all interfaces):

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

---

## 3. Get the code onto the server

First, on your **local machine**, commit and push your latest changes:

```bash
git add -A
git commit -m "Prepare for production deployment"
git push origin main
```

Then on the **VPS**:

```bash
# Dedicated system user with no login shell
sudo adduser --system --group --home /var/www/calendar-app calendar

# Clone the repository
sudo git clone https://github.com/mirjan4/calendar-.git /var/www/calendar-app
sudo chown -R calendar:calendar /var/www/calendar-app
```

> If the repository is private, use a deploy key or a personal access token for the clone.

---

## 4. Database

### 4.1 Create the schema

```bash
sudo mysql < /var/www/calendar-app/database/database.sql
```

This creates the `markaz_calendar` database and all tables. It is safe to re-run (`CREATE ... IF NOT EXISTS`).

### 4.2 Create a dedicated database user

Don't run the app as MySQL `root`. Generate a strong password first:

```bash
openssl rand -base64 24
```

```bash
sudo mysql
```

```sql
CREATE USER 'markaz_app'@'localhost' IDENTIFIED BY 'PASTE_STRONG_PASSWORD_HERE';
GRANT SELECT, INSERT, UPDATE, DELETE ON markaz_calendar.* TO 'markaz_app'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

> If you will later run `backend/src/scripts/migrate_calendar_quantity.js` (it uses `ALTER TABLE`), temporarily also grant `ALTER`, or run it with an admin MySQL account.

### 4.3 (Optional) Move existing local data

To carry over data from your local machine (students, places, registrations), export locally:

```bash
mysqldump -h 127.0.0.1 -u root --no-create-db markaz_calendar > markaz_calendar.sql
```

Copy it to the server (`scp markaz_calendar.sql user@vps:/tmp/`) and import:

```bash
sudo mysql markaz_calendar < /tmp/markaz_calendar.sql
rm /tmp/markaz_calendar.sql
```

---

## 5. Backend

### 5.1 Install dependencies

```bash
cd /var/www/calendar-app/backend
sudo -u calendar npm ci --omit=dev
```

### 5.2 Create the production `.env`

Generate a JWT secret:

```bash
openssl rand -hex 32
```

```bash
sudo -u calendar nano /var/www/calendar-app/backend/.env
```

```ini
PORT=5001
NODE_ENV=production

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=markaz_app
DB_PASSWORD=PASTE_STRONG_PASSWORD_HERE
DB_NAME=markaz_calendar

JWT_SECRET=PASTE_GENERATED_HEX_SECRET_HERE
JWT_EXPIRES_IN=24h

CLIENT_URL=https://calendar-app.mydomain.com

# One reverse proxy (Caddy) in front of the app.
# Required so rate limits apply per visitor IP instead of to all visitors combined.
TRUST_PROXY=1
```

Lock down the file:

```bash
sudo chmod 600 /var/www/calendar-app/backend/.env
```

### 5.3 Create the first admin account

```bash
cd /var/www/calendar-app/backend
sudo -u calendar node scripts/create_admin.js superadmin admin@mydomain.com 'YourStrongPassword' 'Super Admin' super_admin
```

Re-running the same command with a new password resets it.

> The password is saved in shell history. Run `history -d $(history 1)` right afterwards, or change the password from the app after your first login.

### 5.4 Run the backend as a systemd service

Find the Node binary path (needed in the unit file):

```bash
which node      # e.g. /usr/bin/node
```

```bash
sudo nano /etc/systemd/system/calendar-app.service
```

```ini
[Unit]
Description=Markaz Calendar App - Backend API
After=network.target mysql.service
Wants=mysql.service

[Service]
Type=simple
User=calendar
Group=calendar
WorkingDirectory=/var/www/calendar-app/backend
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/www/calendar-app/backend/uploads

[Install]
WantedBy=multi-user.target
```

Replace `/usr/bin/node` if `which node` printed something else (for example an `nvm` path. With nvm, install Node system-wide instead, because the `calendar` user can't read your nvm directory).

Start it:

```bash
sudo mkdir -p /var/www/calendar-app/backend/uploads/imports
sudo chown -R calendar:calendar /var/www/calendar-app/backend/uploads

sudo systemctl daemon-reload
sudo systemctl enable --now calendar-app
sudo systemctl status calendar-app
```

Verify it locally on the VPS:

```bash
curl http://127.0.0.1:5001/api/health
# {"status":"healthy",...}
```

---

## 6. Frontend

Build the static files on the server:

```bash
cd /var/www/calendar-app/frontend
sudo -u calendar npm ci
sudo -u calendar npm run build
```

This produces `/var/www/calendar-app/frontend/dist`. No frontend `.env` is needed in production, because `API_TARGET` is only used by the Vite dev server.

Caddy must be able to read the build output:

```bash
sudo chmod 755 /var/www/calendar-app /var/www/calendar-app/frontend
sudo chmod -R a+rX /var/www/calendar-app/frontend/dist
```

---

## 7. Caddy

Add a site block to your Caddyfile (usually `/etc/caddy/Caddyfile`). Keep your existing sites as they are.

```bash
sudo nano /etc/caddy/Caddyfile
```

```caddy
calendar-app.mydomain.com {
	encode zstd gzip

	# Backend API
	handle /api/* {
		# Student imports allow files up to 15 MB
		request_body {
			max_size 20MB
		}
		reverse_proxy 127.0.0.1:5001
	}

	# React SPA
	handle {
		root * /var/www/calendar-app/frontend/dist
		try_files {path} /index.html
		file_server
	}

	# Long cache for hashed build assets, no cache for index.html
	@assets path /assets/*
	header @assets Cache-Control "public, max-age=31536000, immutable"
	@html path / /index.html
	header @html Cache-Control "no-cache"

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}

	log {
		output file /var/log/caddy/calendar-app.log
		format json
	}
}
```

Validate and reload:

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy obtains the HTTPS certificate automatically on the first request. Open **https://calendar-app.mydomain.com** and log in with the admin account from step 5.3.

---

## 8. Deploying updates

After pushing new commits to `main`:

```bash
cd /var/www/calendar-app
sudo -u calendar git pull origin main

# Backend
cd backend
sudo -u calendar npm ci --omit=dev
sudo systemctl restart calendar-app

# Frontend
cd ../frontend
sudo -u calendar npm ci
sudo -u calendar npm run build
```

If `database/database.sql` gained new tables, re-run `sudo mysql < /var/www/calendar-app/database/database.sql`. It only creates missing tables and never changes existing ones, so column changes need an `ALTER TABLE` or a migration script.

Optionally, save this as `/var/www/calendar-app/deploy.sh` and run it with `sudo bash deploy.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /var/www/calendar-app
sudo -u calendar git pull origin main
(cd backend  && sudo -u calendar npm ci --omit=dev)
(cd frontend && sudo -u calendar npm ci && sudo -u calendar npm run build)
systemctl restart calendar-app
curl -fsS http://127.0.0.1:5001/api/health && echo " <- backend OK"
```

---

## 9. Backups

Daily database backup, keeping 14 days:

```bash
sudo mkdir -p /var/backups/calendar-app
sudo crontab -e
```

```cron
30 2 * * * mysqldump --single-transaction markaz_calendar | gzip > /var/backups/calendar-app/markaz_calendar_$(date +\%F).sql.gz && find /var/backups/calendar-app -name '*.sql.gz' -mtime +14 -delete
```

Copy backups off the server regularly (another machine or object storage). A backup that only lives on the VPS won't survive losing the VPS.

Restore:

```bash
gunzip < /var/backups/calendar-app/markaz_calendar_YYYY-MM-DD.sql.gz | sudo mysql markaz_calendar
```

---

## 10. Troubleshooting

| Symptom | Check |
|---|---|
| Site doesn't load / certificate error | `dig +short calendar-app.mydomain.com` points at the VPS; ports 80 and 443 are open; `sudo journalctl -u caddy -n 100` |
| `502 Bad Gateway` on `/api/...` | Backend is down: `sudo systemctl status calendar-app` and `sudo journalctl -u calendar-app -n 100 -f` |
| Backend log shows `Could not connect to MySQL` | `DB_*` values in `backend/.env`; test with `mysql -u markaz_app -p markaz_calendar` |
| `EADDRINUSE: address already in use :::5001` | Another process holds the port: `sudo ss -ltnp \| grep 5001`; change `PORT` in `.env` **and** the `reverse_proxy` port in the Caddyfile |
| Refreshing a page like `/admin/students` gives 404 | The `try_files {path} /index.html` line is missing from the Caddy block |
| Blank page / 403 on static files | Caddy can't read `frontend/dist`: re-run the `chmod` commands in step 6 |
| "Too many requests" for many users at once | `TRUST_PROXY=1` missing from `backend/.env`; restart the service after adding it |
| Student import fails with `413` | Increase `request_body max_size` in the Caddyfile |
| Login works then everyone gets logged out after a deploy | `JWT_SECRET` changed. Keep it constant across deploys |

Useful commands:

```bash
sudo journalctl -u calendar-app -f          # live backend logs
sudo tail -f /var/log/caddy/calendar-app.log # access logs
sudo systemctl restart calendar-app          # restart backend
sudo systemctl reload caddy                  # apply Caddyfile changes
```
