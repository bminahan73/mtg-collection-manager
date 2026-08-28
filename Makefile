.PHONY: help up down build logs logs-backend logs-client clean

help:
	@echo "MTG Collection Manager - Docker Commands"
	@echo ""
	@echo "make up           - Start services (docker-compose up)"
	@echo "make down         - Stop services"
	@echo "make build        - Build/rebuild Docker images"
	@echo "make logs         - View logs from all services"
	@echo "make logs-backend - View backend logs only"
	@echo "make logs-client  - View client logs only"
	@echo "make clean        - Remove all containers and volumes"
	@echo "make shell-backend - Open shell in backend container"
	@echo "make shell-client  - Open shell in client container"

up:
	docker-compose up

up-build:
	docker-compose up --build

down:
	docker-compose down

build:
	docker-compose build

logs:
	docker-compose logs -f

logs-backend:
	docker-compose logs -f backend

logs-client:
	docker-compose logs -f client

clean:
	docker-compose down -v
	docker system prune -f

shell-backend:
	docker-compose exec backend sh

shell-client:
	docker-compose exec client sh
