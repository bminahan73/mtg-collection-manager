# Docker Development Setup

## Quick Start

Build and start both services with one command:

```bash
docker-compose up --build
```

Then visit:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3000

## Common Commands

### Start services (images already built)
```bash
docker-compose up
```

### Start in background
```bash
docker-compose up -d
```

### Stop services
```bash
docker-compose down
```

### Rebuild images (after dependency changes)
```bash
docker-compose up --build
```

### View logs
```bash
docker-compose logs -f
```

### View specific service logs
```bash
docker-compose logs -f backend
docker-compose logs -f client
```

### Run a command in a container
```bash
docker-compose exec backend npm install
docker-compose exec client npm install
```

## How It Works

- **Backend** runs on port 3000 with hot-reload via volume mounts
- **Client** runs on port 5173 (Vite dev server) with hot-reload
- Changes to code files are instantly reflected without rebuilding
- `node_modules` are preserved in Docker volumes to avoid repeated installs

## Troubleshooting

### Port already in use
Change ports in `docker-compose.yml`:
```yaml
ports:
  - "3001:3000"  # Backend on 3001
  - "5174:5173"  # Client on 5174
```

### Clear everything and start fresh
```bash
docker-compose down -v
docker-compose up --build
```

### Check what's running
```bash
docker-compose ps
```
