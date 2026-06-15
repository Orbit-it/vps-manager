# VPS App Manager

Panneau web pour gérer les applications sur un VPS : découverte via Nginx, DNS OVH, SSL Let's Encrypt et duplication d'apps.

## Fonctionnalités

- Liste des apps détectées depuis les configs Nginx
- Détail par app : domaines, proxy, root, SSL
- Configuration DNS OVH (affichage + création via API)
- Tests DNS, HTTP, HTTPS et Nginx
- Génération SSL Let's Encrypt (Certbot)
- Duplication d'app (fichiers + Nginx + DNS + SSL optionnel)
- **Authentification JWT** (cookie httpOnly, session sécurisée)

## Structure

```
vps-app-manager/
├── backend/          # API Node.js + Express
├── frontend/         # Interface React + Vite
└── package.json      # Scripts racine
```

## Installation

```bash
git clone git@github.com:Orbit-it/vps-manager.git
cd vps-app-manager
npm run install:all
cp backend/.env.example backend/.env
```

## Configuration

Éditez `backend/.env` :

```env
PORT=3001
DEMO_MODE=false

NGINX_SITES_ENABLED=/etc/nginx/sites-enabled
NGINX_SITES_AVAILABLE=/etc/nginx/sites-available
APPS_ROOT=/var/www
VPS_PUBLIC_IP=203.0.113.10

OVH_ENDPOINT=ovh-eu
OVH_APP_KEY=votre_app_key
OVH_APP_SECRET=votre_app_secret
OVH_CONSUMER_KEY=votre_consumer_key

CERTBOT_EMAIL=admin@votredomaine.com

# Authentification (OBLIGATOIRE)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=votre-mot-de-passe-fort
JWT_SECRET=une-cle-secrete-aleatoire-de-minimum-32-caracteres
SESSION_MAX_AGE=24h
```

### Authentification

Toutes les routes API (sauf `/api/auth/login` et `/api/health`) nécessitent une session valide.

Variables requises :
- `ADMIN_USERNAME` — identifiant admin
- `ADMIN_PASSWORD` — mot de passe (ou `ADMIN_PASSWORD_HASH` en production)
- `JWT_SECRET` — clé secrète d'au moins 32 caractères

Générer un hash bcrypt pour la production :

```bash
npm run hash-password --prefix backend -- "votre-mot-de-passe"
```

Puis dans `.env` :

```env
ADMIN_PASSWORD_HASH=$2a$12$...
# Supprimez ADMIN_PASSWORD
```

En production (`NODE_ENV=production`), le cookie de session est envoyé en `Secure` (HTTPS obligatoire).

### Exclure le manager de la liste

Le manager ne doit pas apparaître comme une app gérée. Il est exclu automatiquement si :

- son Nginx fait `proxy_pass` vers `127.0.0.1:PORT` (ex. `:3003`)
- ou son fichier est `vps-manager.conf` / `vps-app-manager.conf`
- ou son domaine est listé dans `MANAGER_DOMAINS`

Dans `backend/.env` :

```env
MANAGER_DOMAINS=manager.votredomaine.com
MANAGER_NGINX_CONFIGS=vps-manager.conf
```

Puis redémarrez l'app :

```bash
sudo systemctl restart vps-manager
```

### Les apps n'apparaissent pas

Le manager scanne par défaut :
- `/etc/nginx/sites-enabled`
- `/etc/nginx/conf.d`

Chaque app doit avoir un fichier `.conf` avec un `server_name`.

Si vos configs sont ailleurs, ajoutez dans `.env` :

```env
NGINX_SCAN_DIRS=/etc/nginx/sites-enabled,/etc/nginx/conf.d,/chemin/custom
```

Diagnostic API :

```bash
curl -b cookies.txt https://manager.votredomaine.com/api/apps/scan-debug
```

### Clés OVH

1. Créez un token sur [https://eu.api.ovh.com/createToken/](https://eu.api.ovh.com/createToken/)
2. Droits recommandés :
   - `GET/POST/PUT/DELETE` sur `/domain/zone/*`
3. Copiez les 3 clés dans `.env`

## Lancement

### Développement

```bash
npm run dev
```

- Frontend : [http://localhost:5173](http://localhost:5173)
- Backend : [http://localhost:3001](http://localhost:3001)

### Production (sur le VPS)

```bash
npm run build
npm run start
```

## Déploiement sur VPS

L'app tourne avec un utilisateur non-root (ex: `deploy`) et utilise **sudo** pour les opérations privilégiées.

Dans `backend/.env` :

```env
USE_SUDO=true
DEPLOY_USER=deploy
WEB_GROUP=www-data
```

### Configuration sudoers (obligatoire)

Créez `/etc/sudoers.d/vps-manager` avec `visudo` :

```bash
sudo visudo -f /etc/sudoers.d/vps-manager
```

Contenu (remplacez `deploy` par votre utilisateur) :

```
deploy ALL=(root) NOPASSWD: /usr/bin/cp, /usr/bin/ln, /usr/bin/mkdir, /usr/bin/chown, /usr/sbin/nginx, /bin/systemctl reload nginx, /usr/bin/certbot
```

Puis :

```bash
sudo chmod 440 /etc/sudoers.d/vps-manager
sudo systemctl restart vps-manager
```

Test manuel :

```bash
sudo -n cp /tmp/test.conf /etc/nginx/sites-available/test.conf
sudo -n nginx -t
sudo -n systemctl reload nginx
```

Si `sudo -n` demande un mot de passe, la config sudoers n'est pas correcte.

### Opérations concernées

- Écrire dans `/etc/nginx/sites-available/`
- Créer les symlinks dans `/etc/nginx/sites-enabled/`
- Copier les fichiers dans `/var/www/`
- Exécuter `nginx -t`, `systemctl reload nginx`, `certbot`

## API

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/apps` | Liste des apps |
| GET | `/api/apps/:id` | Détail app + DNS + SSL |
| GET | `/api/apps/:id/health` | Tests DNS/HTTP/HTTPS |
| POST | `/api/apps/:id/dns` | Créer/mettre à jour DNS OVH |
| POST | `/api/apps/:id/ssl` | Générer certificat SSL |
| POST | `/api/apps/:id/duplicate` | Dupliquer une app |
| GET | `/api/apps/ovh/zones` | Lister zones OVH |

## Mode démo

Par défaut `DEMO_MODE=true` : apps simulées, pas d'accès système requis. Idéal pour tester l'interface en local.

Sur le VPS, mettez `DEMO_MODE=false`.

## Workflow duplication

1. Choisir l'app source
2. Saisir nouveau nom + domaines
3. Cocher : copier fichiers, créer DNS OVH, générer SSL
4. L'app exécute : copie → nginx → DNS → (SSL si demandé)

## Prérequis VPS

- Node.js 18+
- Nginx
- Certbot (`certbot --nginx`)
- Accès API OVH configuré
